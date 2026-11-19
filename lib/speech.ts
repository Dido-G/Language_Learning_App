import * as Speech from 'expo-speech';
import { sleep } from './clock';

export const EN_LANG = 'en-US';
export const BG_LANG = 'bg-BG';

const MAX_UTTERANCE_MS = 8000;

/** Speak text and resolve when finished, stopped, failed, or after a hard 8 s cap. */
export function speakAsync(text: string, language: string, rate = 0.9): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    // Background-safe hard cap (see lib/clock.ts). Clearing the engine stops a hung utterance from
    // blocking the ones queued after it.
    sleep(MAX_UTTERANCE_MS).then(() => {
      if (settled) return;
      Speech.stop();
      done();
    });
    try {
      Speech.speak(text, { language, rate, onDone: done, onStopped: done, onError: done });
    } catch {
      done();
    }
  });
}

/** Web-only: download audio ahead of time. Native TTS needs no prefetch. */
export async function prefetchSpeech(_text: string, _language: string): Promise<void> {}

/** Web-only autoplay unlock; nothing to do on native. */
export function unlockSpeech() {}

export function stopSpeaking() {
  return Speech.stop();
}

/** Whether the device has a TTS voice for a language prefix like 'bg'. */
export async function hasVoice(langPrefix: string): Promise<boolean> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    return voices.some((v) => v.language.toLowerCase().startsWith(langPrefix));
  } catch {
    return true; // unknown: don't block the user
  }
}
