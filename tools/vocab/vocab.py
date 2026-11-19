#!/usr/bin/env python3
"""Prepare (download + translate) and push CEFR vocabulary to Supabase.

Usage: vocab.py prepare --level A1 | push --level A1 [--dry-run] [--allow-unreviewed]
       | audio --level A1 [--force]   (neural MP3s -> Supabase Storage)
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


# ------------------------------------------------------------------ neural audio
AUDIO_BUCKET = "audio"
AUDIO_WORKERS = 2  # Supabase free tier rejects many parallel storage connections (429)


def supabase_session() -> tuple[str, dict]:
    load_env()
    url = os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("Set EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
    return url.rstrip("/"), {"apikey": key, "Authorization": f"Bearer {key}"}


def ensure_bucket(base: str, h: dict) -> None:
    r = requests.get(f"{base}/storage/v1/bucket/{AUDIO_BUCKET}", headers=h, timeout=30)
    if r.ok:
        return
    r = requests.post(
        f"{base}/storage/v1/bucket",
        headers={**h, "Content-Type": "application/json"},
        json={"id": AUDIO_BUCKET, "name": AUDIO_BUCKET, "public": True,
              "allowed_mime_types": ["audio/mpeg"], "file_size_limit": 1048576},
        timeout=30,
    )
    if not r.ok:
        sys.exit(f"Could not create bucket ({r.status_code}): {r.text[:200]}")
    print(f"Created public storage bucket '{AUDIO_BUCKET}'")


def list_objects(base: str, h: dict, prefix: str) -> set[str]:
    names, offset = set(), 0
    while True:
        r = requests.post(
            f"{base}/storage/v1/object/list/{AUDIO_BUCKET}",
            headers={**h, "Content-Type": "application/json"},
            json={"prefix": prefix, "limit": 1000, "offset": offset},
            timeout=60,
        )
        r.raise_for_status()
        page = r.json()
        names.update(o["name"] for o in page)
        if len(page) < 1000:
            return names
        offset += 1000


def fetch_rows(base: str, h: dict, level: str) -> list[dict]:
    rows, start = [], 0
    while True:
        r = requests.get(
            f"{base}/rest/v1/vocabulary?select=id,english,bg&level=eq.{level}&order=id",
            headers={**h, "Range": f"{start}-{start + 999}"},
            timeout=60,
        )
        r.raise_for_status()
        rows += r.json()
        if len(r.json()) < 1000:
            return rows
        start += 1000


def cmd_audio(level: str, force: bool) -> None:
    """Generate en-US-JennyNeural / bg-BG-KalinaNeural MP3s and upload to audio/<level>/<id>_<lang>.mp3.

    Re-run with --force after editing a word's text so its audio is regenerated.
    """
    from concurrent.futures import ThreadPoolExecutor

    import tts_server  # shares the on-disk cache in cache/tts/

    base, h = supabase_session()
    ensure_bucket(base, h)
    rows = fetch_rows(base, h, level)
    existing = set() if force else list_objects(base, h, f"{level}/")
    jobs = []
    for r in rows:
        for lang, text in (("en", r["english"]), ("bg", r["bg"])):
            name = f"{r['id']}_{lang}.mp3"
            if text.strip() and name not in existing:
                jobs.append((f"{level}/{name}", text, tts_server.VOICES[lang]))
    print(f"{level}: {len(rows)} words, {len(existing)} files already uploaded, {len(jobs)} to upload")

    def run(job: tuple[str, str, str]) -> str | None:
        path, text, voice = job
        try:
            data = tts_server.ensure(text, voice).read_bytes()
            delay = 1.0
            for _ in range(6):
                r = requests.post(
                    f"{base}/storage/v1/object/{AUDIO_BUCKET}/{path}",
                    headers={**h, "Content-Type": "audio/mpeg", "x-upsert": "true",
                             "Cache-Control": "max-age=31536000"},
                    data=data,
                    timeout=60,
                )
                if r.status_code not in (429, 500, 502, 503, 504):
                    break
                time.sleep(delay)
                delay = min(delay * 2, 30)
            return None if r.ok else f"{path}: {r.status_code} {r.text[:120]}"
        except Exception as exc:
            return f"{path}: {exc}"

    failures = []
    with ThreadPoolExecutor(AUDIO_WORKERS) as pool:
        for i, err in enumerate(pool.map(run, jobs), 1):
            if err:
                failures.append(err)
            if i % 200 == 0:
                print(f"  {i}/{len(jobs)}")
    print(f"Uploaded {len(jobs) - len(failures)}/{len(jobs)}; {len(failures)} failed")
    for f in failures[:10]:
        print("  !", f)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("prepare", "push", "audio"):
        sp = sub.add_parser(name)
        sp.add_argument("--level", required=True, choices=LEVELS)
        if name == "prepare":
            sp.add_argument("--engine", choices=("google", "mymemory"), default="google")
        if name == "audio":
            sp.add_argument("--force", action="store_true", help="re-upload existing files")
        if name == "push":
            sp.add_argument("--dry-run", action="store_true")
            sp.add_argument("--allow-unreviewed", action="store_true")
    a = p.parse_args()
    if a.cmd == "prepare":
        cmd_prepare(a.level, a.engine)
    elif a.cmd == "audio":
        cmd_audio(a.level, a.force)
    else:
        cmd_push(a.level, a.dry_run, a.allow_unreviewed)


if __name__ == "__main__":
    main()
