#!/usr/bin/env python3
"""Tiny local text-to-speech server for browser testing (natural Bulgarian/English voices).

    cd tools/vocab && source .venv/bin/activate && python tts_server.py

GET http://127.0.0.1:8765/tts?lang=bg-BG&text=здравей  ->  audio/mpeg

Speed: a cached word is read from disk and returned in ~1 ms. An uncached word needs a fresh
connection to Microsoft's TTS service (~0.5-1.5 s). Pre-generate a whole level so every word is
instant:   python tts_server.py --warm A1      (runs in the background while serving)
Uses Microsoft Edge's online neural voices via the `edge-tts` package (needs internet, no API key).
Results are cached on disk in cache/tts/. Bound to localhost only; CORS open for the dev web app.
"""
import argparse
import asyncio
import csv
import hashlib
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import edge_tts

HOST, PORT = "127.0.0.1", 8765
VOICES = {"bg": "bg-BG-KalinaNeural", "en": "en-US-JennyNeural"}
CACHE = Path(__file__).resolve().parent / "cache" / "tts"
MAX_TEXT = 300


def cache_path(text: str, voice: str) -> Path:
    return CACHE / (hashlib.sha256(f"{voice}|{text}".encode()).hexdigest()[:32] + ".mp3")


async def synthesize(text: str, voice: str, dest: Path) -> None:
    tmp = dest.with_suffix(f".{threading.get_ident()}.part")
    await edge_tts.Communicate(text, voice).save(str(tmp))
    tmp.replace(dest)


def ensure(text: str, voice: str) -> Path:
    path = cache_path(text, voice)
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        asyncio.run(synthesize(text, voice, path))
    return path


def warm(level: str, workers: int = 3) -> None:
    """Pre-generate audio for every word in data/<level>.csv (both languages)."""
    src = Path(__file__).resolve().parent / "data" / f"{level}.csv"
    with src.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    jobs = [(r["english"], VOICES["en"]) for r in rows] + [(r["bg"], VOICES["bg"]) for r in rows]
    todo = [j for j in jobs if j[0].strip() and not cache_path(*j).exists()]
    print(f"[warm] {level}: {len(jobs) - len(todo)} cached, generating {len(todo)}...")
    done = failed = 0
    def run(job):
        try:
            ensure(*job)
            return True
        except Exception:
            return False
    with ThreadPoolExecutor(workers) as pool:
        for ok in pool.map(run, todo):
            done += ok
            failed += not ok
            if (done + failed) % 100 == 0:
                print(f"[warm] {done + failed}/{len(todo)}")
    print(f"[warm] {level} done: {done} generated, {failed} failed")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"  # keep-alive: no new TCP connection per word

    def _send(self, status: int, body: bytes = b"", ctype: str = "text/plain") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        if status == 200 and ctype == "audio/mpeg":
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # CORS preflight
        self._send(204)

    def do_GET(self) -> None:
        url = urlparse(self.path)
        if url.path == "/health":
            return self._send(200, b"ok")
        if url.path != "/tts":
            return self._send(404, b"not found")
        q = parse_qs(url.query)
        text = (q.get("text") or [""])[0].strip()
        lang = ((q.get("lang") or ["en"])[0])[:2].lower()
        voice = VOICES.get(lang)
        if not text or len(text) > MAX_TEXT or not voice:
            return self._send(400, b"need text (<=300 chars) and lang in bg|en")
        t0 = time.perf_counter()
        try:
            cached = cache_path(text, voice).exists()
            path = ensure(text, voice)
            self._send(200, path.read_bytes(), "audio/mpeg")
            ms = (time.perf_counter() - t0) * 1000
            print(f"{'HIT ' if cached else 'MISS'} {ms:6.0f} ms  {lang} {text!r}")
        except Exception as exc:  # network down, service error...
            print(f"TTS failed for {text!r}: {exc}", file=sys.stderr)
            self._send(502, b"tts failed")

    def log_message(self, fmt: str, *args) -> None:
        pass  # per-request timing is printed in do_GET


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--warm", metavar="LEVEL", action="append", default=[],
                    help="pre-generate audio for data/LEVEL.csv in the background (repeatable)")
    args = ap.parse_args()
    for lvl in args.warm:
        threading.Thread(target=warm, args=(lvl,), daemon=True).start()
    print(f"TTS server on http://{HOST}:{PORT}  voices: {VOICES}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
