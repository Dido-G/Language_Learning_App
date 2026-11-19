# Language Learning App — English → Bulgarian

An Expo (React Native) app for learning Bulgarian vocabulary by CEFR level (**A1, A2, B1, B2**, about
3,860 words), with natural neural voices.

- **Listen** — hands-free mode: English word → Bulgarian translation → next random word, on a loop.
  Keeps playing with the screen locked, like a music app, with Play / Pause / Next on the lock
  screen and in the notification.
- **Study** — flashcards: flip, previous/next, shuffle, tap to hear.
- **Words** — searchable list of every word in the level, tap any word to hear it.

Words live in a Supabase table; each word has two pre-generated MP3 clips (Microsoft neural voices
`en-US-JennyNeural` and `bg-BG-KalinaNeural`) in Supabase Storage. The app downloads each clip once
and caches it on the phone, so repeats work offline. If a clip can't be fetched (offline and not yet
cached), it falls back to the phone's built-in text-to-speech.

---

## Install on Android (APK)

You need an Android phone running **Android 7.0 or newer** and the `.apk` file (from the
[Releases](https://github.com/Dido-G/Language_Learning_App/releases) page, or the download link /
QR code printed by `eas build` — see [Build the APK yourself](#build-the-apk-yourself)).

1. **Download the APK on the phone.** Open the link in Chrome on the phone (or scan the QR code with
   the camera) and download `Language_Learning_App.apk`. If Chrome warns that the file may be harmful,
   tap **Download anyway**.
2. **Allow installing apps from this source.** Open the downloaded file. Android will say installing
   unknown apps is blocked: tap **Settings** → turn on **Allow from this source** → go back.
   (Or later: *Settings → Apps → Special app access → Install unknown apps → Chrome → Allow*.)
3. **Install.** Tap **Install**. If Google Play Protect shows *"Unsafe app blocked"* or *"App not
   scanned"*, tap **More details → Install anyway** (the app is just not published on the Play Store).
4. **Open the app** and pick a level at the top.
5. **Allow notifications** when asked (first time you press Play in *Listen*). Android 13+ needs this
   for the lock-screen / notification player controls.
6. **Recommended — let it play in the background without being killed:**
   *Settings → Apps → Language_Learning_App → Battery* → choose **Unrestricted** (wording varies:
   "Don't optimise", "No restrictions"). On Xiaomi, Huawei, Samsung and OnePlus phones also allow
   **Autostart / background activity** for the app if such an option exists.

**Using Listen mode with the screen off:** press Play, then lock the phone. Control it from the lock
screen or notification: **Pause / Play**, **⏩ (seek forward) = next word**, **⏪ (seek back) = repeat
the word**. It only stops when you press Stop or Pause.

**Updating:** install the new APK over the old one (same steps) — your downloaded audio stays cached.
If Android says *"App not installed … conflicts with an existing package"*, the new APK was signed
with a different key: uninstall the old app first, then install the new one.

**Uninstalling:** long-press the app icon → **Uninstall**.

---

## Build the APK yourself

APKs are built in the cloud with [EAS Build](https://docs.expo.dev/build/introduction/) (free Expo
account, nothing to install besides Node.js; no Android SDK needed).

```bash
npm install
npx eas-cli@latest login            # once: log in / sign up at expo.dev
npx eas-cli@latest init             # once: links the project to your Expo account (adds projectId to app.json)

# once: give the cloud build the two PUBLIC Supabase values (the same as in your .env)
npx eas-cli@latest env:create --environment preview --visibility plaintext \
  --name EXPO_PUBLIC_SUPABASE_URL --value "https://<project>.supabase.co"
npx eas-cli@latest env:create --environment preview --visibility plaintext \
  --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon / publishable key>"

npx eas-cli@latest build --platform android --profile preview
```

The build takes roughly 10–20 minutes (plus queue time on the free tier). When it finishes, the CLI
prints a download link and QR code for the `.apk`; the build is also listed on expo.dev. On the first
build EAS asks to generate an Android signing keystore — answer **yes**; EAS stores it and reuses it,
so later APKs install as updates.

Profiles in [`eas.json`](eas.json):

| Profile       | Output | Use |
|---------------|--------|-----|
| `preview`     | `.apk` | standalone app to install and share (the one above) |
| `development` | `.apk` | development client that loads JS from `npx expo start` on your PC |
| `production`  | `.aab` | Google Play upload |

> Never put `SUPABASE_SERVICE_ROLE_KEY` into EAS or any `EXPO_PUBLIC_*` variable — everything
> `EXPO_PUBLIC_*` ends up inside the APK. The app only needs the public URL and anon key (the table
> and audio bucket are read-only to the public via Row Level Security).

**Building locally instead** (no Expo account): install Android Studio (SDK + NDK) and **JDK 17**,
then `npx expo run:android --variant release`. The APK is written to
`android/app/build/outputs/apk/release/`. Needs ~10 GB of free disk space.

---

## Development

```bash
npm install
cp .env.example .env        # fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
npx expo start              # press w for web, or scan the QR code with a development build
```

- **Web:** `npx expo start --web`. Plays the same neural MP3s from Supabase.
- **Android development build** (needed for lock-screen playback; Expo Go can't do background audio):
  `npx eas-cli@latest build -p android --profile development`, install it, then `npx expo start`.
- Checks: `npx tsc --noEmit` and `npm run lint`.

### Project layout

| Path | What |
|------|------|
| `app/(tabs)/` | Listen (`index.tsx`), Study, Words screens (expo-router tabs) |
| `hooks/use-listen-session.ts` | Listen-mode loop, timing, lock-screen controls (silent keep-alive track) |
| `lib/speech.ts` / `lib/speech.web.ts` | Neural MP3 playback + cache (native / web), TTS fallback |
| `lib/clock.ts` | Background-safe `sleep` (JS timers stop when the screen is locked) |
| `lib/words.ts`, `lib/supabase.ts` | Levels, word fetching, Supabase client |
| `supabase/migrations/` | `vocabulary` table, RLS, level constraint |
| `tools/vocab/` | Python pipeline: word lists → translations → Supabase → neural MP3s ([README](tools/vocab/README.md)) |

### Data

- Table `vocabulary(id, level, english, bg)`, unique `(level, english)`, publicly readable.
- Storage: public bucket `audio`, files `audio/<level>/<word id>_en.mp3` and `_bg.mp3`.
- Word lists: Oxford 3000/5000 CEFR levels; Bulgarian translations reviewed by hand
  (`tools/vocab/data/<level>.csv`). B2 excludes words already in A1–B1.
