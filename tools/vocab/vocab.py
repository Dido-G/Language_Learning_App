#!/usr/bin/env python3
"""Prepare (download + translate) and push CEFR vocabulary to Supabase.

Usage: vocab.py prepare --level A1 | vocab.py push --level A1 [--dry-run] [--allow-unreviewed]
"""
import argparse
import csv
import json
import os
import re
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
DATA_DIR = HERE / "data"
CACHE_DIR = HERE / "cache"
WORDLIST_URL = "https://raw.githubusercontent.com/tyypgzl/Oxford-5000-words/main/full-word.json"
LEVELS = ("A1", "A2", "B1")
CSV_FIELDS = ["english", "bg", "pos", "needs_review"]
MIN_INTERVAL = 0.8  # seconds between requests (Google allows ~5/s but blocks IPs on bursts)
BATCH_SIZE = 200


# --------------------------------------------------------------------------- env
def load_env() -> None:
    """Load KEY=VALUE lines from the repo .env without overriding the shell."""
    path = REPO_ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


# --------------------------------------------------------------------- word list
def load_words(level: str) -> list[dict]:
    """Unique words of a CEFR level: [{english, pos}], POS merged for duplicate spellings."""
    CACHE_DIR.mkdir(exist_ok=True)
    src = CACHE_DIR / "oxford-full-word.json"
    if not src.exists():
        print(f"Downloading word list from {WORDLIST_URL} ...")
        r = requests.get(WORDLIST_URL, timeout=60)
        r.raise_for_status()
        src.write_bytes(r.content)
    merged: dict[str, dict] = {}
    for item in json.loads(src.read_text()):
        v = item["value"]
        if v.get("level") != level:
            continue
        word = v["word"].strip()
        key = word.lower()
        pos = (v.get("type") or "").strip()
        if key not in merged:
            merged[key] = {"english": word, "pos": [pos] if pos else []}
        elif pos and pos not in merged[key]["pos"]:
            merged[key]["pos"].append(pos)
    return sorted(merged.values(), key=lambda w: w["english"].lower())


# ------------------------------------------------------------------- translation
class Translator:
    def __init__(self, engine: str = "google") -> None:
        from deep_translator import GoogleTranslator, MyMemoryTranslator

        self.engine = engine
        if engine == "mymemory":
            self._gt = MyMemoryTranslator(source="en-GB", target="bg-BG")
        else:
            self._gt = GoogleTranslator(source="en", target="bg")
        self._cache_path = CACHE_DIR / "translations.json"
        CACHE_DIR.mkdir(exist_ok=True)
        self._cache: dict[str, str] = (
            json.loads(self._cache_path.read_text()) if self._cache_path.exists() else {}
        )
        self._last = 0.0

    def _save(self) -> None:
        self._cache_path.write_text(json.dumps(self._cache, ensure_ascii=False, indent=1))

    def translate(self, text: str) -> str:
        key = text if self.engine == "google" else f"{self.engine}:{text}"
        if key in self._cache:
            return self._cache[key]
        delay = 2.0
        for attempt in range(6):
            wait = MIN_INTERVAL - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                result = (self._gt.translate(text) or "").strip()
                self._cache[key] = result
                self._save()
                return result
            except Exception as exc:  # TooManyRequests, network hiccups, ...
                print(f"  ! {text!r}: {type(exc).__name__}; retry in {delay:.0f}s", file=sys.stderr)
                time.sleep(delay)
                delay = min(delay * 2, 60)
        raise RuntimeError(f"Giving up translating {text!r}")


def translate_word(tr: Translator, entry: dict) -> tuple[str, list[str]]:
    """Return (bulgarian, review_reasons) for a word-list entry."""
    word, pos = entry["english"], entry["pos"]
    reasons: list[str] = []
    is_verb = bool(pos) and pos[0] in ("verb", "modal verb") and " " not in word
    text = tr.translate(f"to {word}" if is_verb else word)
    if is_verb:
        text = re.sub(r"^да\s+", "", text, flags=re.IGNORECASE)
    bg = text.strip().strip(".,;:!?")
    # Capitalise like the English source (Google tends to capitalise sentence starts).
    if bg and word[:1].islower():
        bg = bg[:1].lower() + bg[1:]

    if not bg:
        reasons.append("empty")
    elif bg.lower() == word.lower():
        reasons.append("unchanged")
    if re.search(r"[A-Za-z]", bg):
        reasons.append("latin-letters")
    if len(pos) > 1:
        reasons.append("multi-pos:" + "/".join(pos))
    if len(word) <= 2 or re.search(r"[/()]", word):
        reasons.append("short-or-variant")
    if len(bg.split()) > 3:
        reasons.append("long")
    return bg, reasons


# --------------------------------------------------------------------------- CSV
def csv_path(level: str) -> Path:
    return DATA_DIR / f"{level}.csv"


def read_csv(level: str) -> list[dict]:
    path = csv_path(level)
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(level: str, rows: list[dict]) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    with csv_path(level).open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        w.writerows(rows)


# -------------------------------------------------------------------- commands
def cmd_prepare(level: str, engine: str) -> None:
    words = load_words(level)
    existing = {r["english"].lower(): r for r in read_csv(level)}
    todo = [w for w in words if w["english"].lower() not in existing]
    print(f"{level}: {len(words)} words, {len(existing)} already in CSV, {len(todo)} to translate")
    tr = Translator(engine)
    rows = list(existing.values())
    try:
        for i, entry in enumerate(todo, 1):
            try:
                bg, reasons = translate_word(tr, entry)
            except RuntimeError as exc:
                print(
                    f"\n{exc}. The translation service is blocking requests (HTTP 429).\n"
                    "Progress is saved; re-run the same command later to resume, or use "
                    "--engine mymemory (free, lower quality, ~5000 chars/day).",
                    file=sys.stderr,
                )
                break
            if engine != "google":
                reasons.append(f"engine:{engine}")
            rows.append(
                {
                    "english": entry["english"],
                    "bg": bg,
                    "pos": "/".join(entry["pos"]),
                    "needs_review": ";".join(reasons),
                }
            )
            if i % 25 == 0:
                print(f"  {i}/{len(todo)}")
                write_csv(level, sorted(rows, key=lambda r: r["english"].lower()))
    finally:  # keep partial progress on Ctrl-C / failures
        write_csv(level, sorted(rows, key=lambda r: r["english"].lower()))
    flagged = sum(1 for r in rows if r["needs_review"])
    print(f"Wrote {csv_path(level)} ({len(rows)} rows, {flagged} flagged needs_review)")


def cmd_push(level: str, dry_run: bool, allow_unreviewed: bool) -> None:
    rows = read_csv(level)
    if not rows:
        sys.exit(f"{csv_path(level)} not found/empty. Run: vocab.py prepare --level {level}")
    ready, skipped = {}, 0
    for r in rows:
        english, bg = r["english"].strip(), r["bg"].strip()
        if not english or not bg:
            skipped += 1
        elif r["needs_review"].strip() and not allow_unreviewed:
            skipped += 1
        else:
            ready[english] = {"level": level, "english": english, "bg": bg}
    print(f"{len(ready)} rows ready, {skipped} skipped (empty or still needs_review)")
    if dry_run:
        for row in list(ready.values())[:10]:
            print("  ", row["english"], "->", row["bg"])
        return
    if not ready:
        return

    load_env()
    url = os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("Set EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
    endpoint = url.rstrip("/") + "/rest/v1/vocabulary?on_conflict=level,english"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    batch_rows = list(ready.values())
    for i in range(0, len(batch_rows), BATCH_SIZE):
        chunk = batch_rows[i : i + BATCH_SIZE]
        r = requests.post(endpoint, headers=headers, data=json.dumps(chunk), timeout=60)
        if not r.ok:
            sys.exit(f"Upsert failed ({r.status_code}): {r.text[:300]}")
        print(f"  upserted {i + len(chunk)}/{len(batch_rows)}")
    print("Done.")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("prepare", "push"):
        sp = sub.add_parser(name)
        sp.add_argument("--level", required=True, choices=LEVELS)
        if name == "prepare":
            sp.add_argument("--engine", choices=("google", "mymemory"), default="google")
        if name == "push":
            sp.add_argument("--dry-run", action="store_true")
            sp.add_argument("--allow-unreviewed", action="store_true")
    a = p.parse_args()
    if a.cmd == "prepare":
        cmd_prepare(a.level, a.engine)
    else:
        cmd_push(a.level, a.dry_run, a.allow_unreviewed)


if __name__ == "__main__":
    main()
