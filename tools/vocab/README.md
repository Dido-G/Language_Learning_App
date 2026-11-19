# Vocabulary pipeline

Builds the English → Bulgarian `vocabulary(level, english, bg)` rows for CEFR levels.

```bash
cd tools/vocab
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1. Download the CEFR list and machine-translate it -> data/A1.csv  (resumable, cached)
#    If Google blocks you (HTTP 429) wait and re-run, or add: --engine mymemory
python vocab.py prepare --level A1

# 2. Open data/A1.csv, fix `bg` where needed, and set needs_review to empty on rows you checked
#    (rows with a reason in `needs_review` are suspicious: untranslated, latin letters, multi-POS...)

# 3. Upsert into Supabase (needs SUPABASE_SERVICE_ROLE_KEY in ../../.env)
python vocab.py push --level A1 --dry-run
python vocab.py push --level A1
```

Same for `--level A2`, `--level B1` and `--level B2` (B2 automatically skips words already in A1–B1). Re-running `prepare` never overwrites rows you already
edited in the CSV; it only adds missing words. `push` skips rows still flagged `needs_review`
unless you pass `--allow-unreviewed`.

- Word list: Oxford 3000/5000 CEFR tags (`tyypgzl/Oxford-5000-words`), downloaded on demand into
  `cache/` (git-ignored). Check Oxford's terms before redistributing the list publicly.
- Translation: Google Translate via `deep-translator`, ≤ ~2 requests/s with retry + backoff;
  results cached in `cache/translations.json`. Verbs are translated as "to X" and the Bulgarian
  "да" is stripped so you get the dictionary form (e.g. `харесвам`).
- Env vars read from the repo `.env` (or the shell): `EXPO_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`)
  and `SUPABASE_SERVICE_ROLE_KEY`. The service key is never used by the app.

## Neural audio (Supabase Storage)

```bash
# 4. Generate en-US-JennyNeural + bg-BG-KalinaNeural MP3s for every word of the level and upload them
#    to the public bucket `audio` as audio/<level>/<id>_en.mp3 and <id>_bg.mp3 (bucket created if missing)
python vocab.py audio --level A1
```

Already-uploaded files are skipped, so re-running only fills gaps (e.g. after a transient
"No audio was received" from edge-tts). Files are named by word **id**: if you change a word's
text, re-run with `--force` to regenerate. Clips are synthesised with `edge-tts` and cached locally
in `cache/tts/` (git-ignored, safe to delete).

`tts_server.py` serves the same voices on `http://127.0.0.1:8765/tts?lang=bg&text=...` for the
web app's local fallback; `python tts_server.py --warm A1` pre-generates a level's clips.
