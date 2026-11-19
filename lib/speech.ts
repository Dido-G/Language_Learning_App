// Native (Android/iOS) speech.
//
// Words play the same neural voices as the web (en-US-JennyNeural / bg-BG-KalinaNeural): MP3s are
// downloaded once from Supabase Storage into the app's cache directory, so repeats play instantly
// and offline, through a dedicated expo-audio player. It never touches the lock screen; Listen mode's
// silent keep-alive player owns that. If a clip is unavailable (offline and not cached, or missing),
// we fall back to the device's text-to-speech (expo-speech).
import * as Speech from 'expo-speech';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { neuralAudioUrl, type AudioRef } from './audio-url';
import { sleep, withTimeout } from './clock';

export type { AudioRef } from './audio-url';

export const EN_LANG = 'en-US';
export const BG_LANG = 'bg-BG';

const MAX_UTTERANCE_MS = 8000; // hard cap per utterance so nothing can freeze the loop
const AUDIO_START_TIMEOUT_MS = 3000; // a cached clip that hasn't started by then -> fall back
const DOWNLOAD_TIMEOUT_MS = 5000;

let player: AudioPlayer | null = null;
let generation = 0; // bumped on every new request/stop so stale awaits bail out
let finishCurrent: (() => void) | null = null;
const inflight = new Map<string, Promise<string | null>>();

const lang2 = (language: string) => language.slice(0, 2).toLowerCase();

function cacheFile(ref: AudioRef, language: string): File {
  const dir = new Directory(Paths.cache, 'neural-audio');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return new File(dir, `${ref.level}_${ref.id}_${lang2(language)}.mp3`);
}

/** Local file URI of the word's neural clip, downloading it if needed. Never throws. */
function localClip(ref: AudioRef, language: string): Promise<string | null> {
  let file: File;
  try {
    file = cacheFile(ref, language);
    if (file.exists) return Promise.resolve(file.uri);
  } catch {
    return Promise.resolve(null);
  }
  const key = file.uri;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = withTimeout(
    File.downloadFileAsync(neuralAudioUrl(ref, language), file, { idempotent: true }).then((f) => f.uri),
    DOWNLOAD_TIMEOUT_MS
  )
    .then((uri) => uri ?? null)
    .catch(() => {
      try {
        if (file.exists) file.delete(); // don't keep a partial/failed download
      } catch {}
      return null;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function speechPlayer(): AudioPlayer {
  if (!player) player = createAudioPlayer(null, { updateInterval: 100 });
  return player;
}

function cancelPlayback() {
  try {
    Speech.stop();
  } catch {}
  try {
    player?.pause();
  } catch {}
  const f = finishCurrent;
  finishCurrent = null;
  f?.();
}

/** Play a local clip. Resolves true when finished or cancelled, false if it could not play. */
function playClip(uri: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = speechPlayer();
    let settled = false;
    let started = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      sub.remove();
      if (finishCurrent === cancel) finishCurrent = null;
      resolve(ok);
    };
    const cancel = () => settle(true);
    // Status updates may be partial, so check each field independently.
    const sub = p.addListener('playbackStatusUpdate', (s) => {
      if (s.playing === true) started = true;
      if (s.didJustFinish === true || s.playbackState === 'ended') settle(true);
    });
    finishCurrent = cancel;
    sleep(AUDIO_START_TIMEOUT_MS).then(() => !started && settle(false));
    sleep(MAX_UTTERANCE_MS).then(() => settle(true));
    try {
      p.replace({ uri });
      p.play();
    } catch {
      settle(false);
    }
  });
}

/** Device text-to-speech fallback. */
function speakTts(text: string, language: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (finishCurrent === done) finishCurrent = null;
      resolve();
    };
    finishCurrent = done;
    sleep(MAX_UTTERANCE_MS).then(() => {
      if (settled) return;
      Speech.stop(); // a hung utterance must not block the ones queued after it
      done();
    });
    try {
      Speech.speak(text, { language, rate: 0.9, onDone: done, onStopped: done, onError: done });
    } catch {
      done();
    }
  });
}

/**
 * Speak a word and resolve when finished, stopped, failed, or after the hard cap. Never rejects.
 * Pass `ref` (a Word) to use its neural clip; without it, device TTS is used.
 */
export async function speakAsync(text: string, language: string, ref?: AudioRef): Promise<void> {
  const mine = ++generation;
  cancelPlayback();
  if (ref) {
    const uri = await localClip(ref, language);
    if (mine !== generation) return;
    if (uri && (await playClip(uri))) return;
    if (mine !== generation) return;
  }
  await speakTts(text, language);
}

/** Download a word's neural clip ahead of time so it plays with no delay. */
export async function prefetchSpeech(_text: string, language: string, ref?: AudioRef): Promise<void> {
  if (ref) await localClip(ref, language);
}

/** Web-only autoplay unlock; nothing to do on native. */
export function unlockSpeech() {}

export function stopSpeaking() {
  generation++;
  cancelPlayback();
}

/** Neural clips cover every word, so device voices only matter offline. */
export async function hasVoice(langPrefix: string): Promise<boolean> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    return voices.some((v) => v.language.toLowerCase().startsWith(langPrefix));
  } catch {
    return true;
  }
}
