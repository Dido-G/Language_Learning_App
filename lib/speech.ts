import * as Speech from 'expo-speech';

export const EN_LANG = 'en-US';
export const BG_LANG = 'bg-BG';

/** Speak text and resolve when finished (or stopped/failed/timed out). */
export function speakAsync(text: string, language: string, rate = 0.9): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    // Safety net: some engines never fire onDone (e.g. missing voice).
    const timer = setTimeout(done, 15000);
    Speech.speak(text, { language, rate, onDone: done, onStopped: done, onError: done });
  });
}

export function stopSpeaking() {
  return Speech.stop();
}

/** Whether the device has a TTS voice for a language prefix like 'bg'. */
export async function hasVoice(langPrefix: string): Promise<boolean> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    return voices.some((v) => v.language.toLowerCase().startsWith(langPrefix));
  } catch {
    return true; // unknown (e.g. web): don't block the user
  }
}
