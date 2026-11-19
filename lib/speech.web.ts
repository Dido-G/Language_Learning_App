// Web implementation (Metro picks this file on web instead of speech.ts).
//
// Both English and Bulgarian are played as neural MP3s (en-US-JennyNeural / bg-BG-KalinaNeural):
// first the pre-generated clip in Supabase Storage (when a Word is passed), else the local
// tts_server.py. Audio is downloaded into blob:
// URLs ahead of time (prefetchSpeech) so playback starts instantly with no network wait.
// Fallbacks if the server is down: Google Translate TTS, then a local speechSynthesis voice.
// Browsers block audio until the user interacts, so call unlockSpeech() from a click handler.
import { neuralAudioUrl, type AudioRef } from './audio-url';
import { sleep } from './clock';

export type { AudioRef } from './audio-url';

export const EN_LANG = 'en-US';
export const BG_LANG = 'bg-BG';

const LOCAL_TTS_URL = 'http://127.0.0.1:8765/tts';
const SILENT_WAV = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
const MAX_UTTERANCE_MS = 8000; // hard cap per utterance so nothing can freeze the loop
const AUDIO_START_TIMEOUT_MS = 4000; // audio must begin playing within this, else fall back
const FETCH_TIMEOUT_MS = 5000;
const BLOB_CACHE_LIMIT = 40;

let generation = 0; // bumped on every new request/stop so stale awaits bail out
let finishCurrent: (() => void) | null = null;
let shared: HTMLAudioElement | null = null;

const blobs = new Map<string, string>(); // "lang|text" -> blob: URL (insertion order = LRU)
const inflight = new Map<string, Promise<string | null>>();

const lang2 = (lang: string) => lang.slice(0, 2).toLowerCase();
const keyOf = (text: string, lang: string) => `${lang2(lang)}|${text}`;
const serverUrl = (text: string, lang: string) =>
  `${LOCAL_TTS_URL}?lang=${lang2(lang)}&text=${encodeURIComponent(text)}`;
const googleUrl = (text: string, lang: string) =>
  `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang2(lang)}&q=${encodeURIComponent(text)}`;

function audioEl(): HTMLAudioElement {
  if (!shared) shared = new Audio();
  return shared;
}

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

/** Call from a user gesture (click/tap) to satisfy browser autoplay rules. */
export function unlockSpeech() {
  try {
    const a = audioEl();
    a.src = SILENT_WAV;
    a.play().catch(() => {});
  } catch {}
}

/** Fetch the first URL that works into a blob: URL. Never throws. */
async function fetchFirst(urls: string[]): Promise<Blob | null> {
  for (const url of urls) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (r.ok) return await r.blob();
    } catch {
      // try the next source
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Download a word's neural audio into a blob: URL (deduped, cached, never throws). */
function fetchBlob(text: string, language: string, ref?: AudioRef): Promise<string | null> {
  const key = keyOf(text, language);
  const have = blobs.get(key);
  if (have) {
    blobs.delete(key); // refresh LRU position
    blobs.set(key, have);
    return Promise.resolve(have);
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const urls = ref ? [neuralAudioUrl(ref, language), serverUrl(text, language)] : [serverUrl(text, language)];
  const p = fetchFirst(urls)
    .then((blob) => {
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      blobs.set(key, url);
      while (blobs.size > BLOB_CACHE_LIMIT) {
        const oldest = blobs.keys().next().value as string;
        URL.revokeObjectURL(blobs.get(oldest)!);
        blobs.delete(oldest);
      }
      return url;
    })
    .catch(() => null) // every source failed: speakAsync falls back
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Make text's audio ready to play instantly. Resolves when ready (or failed). */
export async function prefetchSpeech(text: string, language: string, ref?: AudioRef): Promise<void> {
  await fetchBlob(text, language, ref);
}

function cancelPlayback() {
  try {
    synth()?.cancel();
  } catch {}
  try {
    shared?.pause();
  } catch {}
  const f = finishCurrent;
  finishCurrent = null;
  f?.();
}

/** Play an audio URL. Resolves true when finished or cancelled, false if it could not play. */
function playUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const a = audioEl();
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (finishCurrent === cancelFinish) finishCurrent = null;
      resolve(ok);
    };
    const cancelFinish = () => settle(true);
    finishCurrent = cancelFinish;
    let started = false;
    sleep(AUDIO_START_TIMEOUT_MS).then(() => !started && settle(false));
    sleep(MAX_UTTERANCE_MS).then(() => settle(true));
    a.onplaying = () => {
      started = true;
    };
    a.onended = () => settle(true);
    a.onerror = () => settle(false);
    a.src = url;
    a.play().catch(() => settle(false));
  });
}

/** Last resort: a local browser voice (may be robotic, e.g. espeak on Linux). */
function playLocalVoice(text: string, language: string, rate: number): Promise<void> {
  const s = synth();
  const want = language.toLowerCase();
  const voice = s
    ?.getVoices()
    .find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(want.slice(0, 2)));
  if (!s || !voice) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (finishCurrent === settle) finishCurrent = null;
      resolve();
    };
    finishCurrent = settle;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = rate;
    u.onend = settle;
    u.onerror = settle;
    sleep(MAX_UTTERANCE_MS).then(() => {
      try {
        s.cancel();
      } catch {}
      settle();
    });
    s.speak(u);
  });
}

/** Speak text and resolve when finished (or stopped/failed). Never rejects, never hangs > ~13 s. */
export async function speakAsync(text: string, language: string, ref?: AudioRef): Promise<void> {
  const rate = 0.9;
  const mine = ++generation;
  cancelPlayback();
  const blobUrl = await fetchBlob(text, language, ref); // instant when prefetched
  if (mine !== generation) return;
  if (blobUrl && (await playUrl(blobUrl))) return;
  if (mine !== generation) return;
  if (await playUrl(googleUrl(text, language))) return;
  if (mine !== generation) return;
  await playLocalVoice(text, language, rate);
}

export function stopSpeaking() {
  generation++;
  cancelPlayback();
}

/** Web always has a working path (TTS server, Google, or local voice). */
export async function hasVoice(_langPrefix: string): Promise<boolean> {
  return true;
}
