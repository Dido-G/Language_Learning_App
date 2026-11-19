import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { BG_LANG, EN_LANG, speakAsync, stopSpeaking } from '@/lib/speech';
import { pickRandom, type Level, type Word } from '@/lib/words';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SILENCE = require('@/assets/audio/silence.wav');

const PAUSE_AFTER_ENGLISH_MS = 900;
const PAUSE_AFTER_BULGARIAN_MS = 1800;

export type Phase = 'idle' | 'english' | 'bulgarian' | 'pause';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Continuous Listen Mode: English -> pause -> Bulgarian -> pause -> next random word of the level.
 *
 * Lock-screen support (Android): while running, a looping *silent* track is played through
 * expo-audio with `shouldPlayInBackground` and registered via `setActiveForLockScreen`. That makes
 * expo-audio start its foreground media-playback service, which keeps the app process alive and
 * shows the current word pair as lock-screen media metadata. Speech itself is device TTS.
 */
export function useListenSession(words: Word[], level: Level) {
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<Word | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');

  const runId = useRef(0);
  const player = useRef<AudioPlayer | null>(null);
  const wordsRef = useRef(words);
  const speaking = useRef(false);

  useEffect(() => {
    wordsRef.current = words;
  }, [words]);

  const stop = useCallback(() => {
    runId.current++;
    stopSpeaking();
    const p = player.current;
    player.current = null;
    if (p) {
      try {
        p.clearLockScreenControls();
      } catch {}
      try {
        p.remove();
      } catch {}
    }
    setRunning(false);
    setPhase('idle');
  }, []);

  const start = useCallback(async () => {
    if (wordsRef.current.length === 0) return;
    stop();
    const id = ++runId.current;
    const alive = () => runId.current === id;
    setRunning(true);

    // Android 13+: the lock-screen media notification needs the notification permission.
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      try {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      } catch {}
      if (!alive()) return;
    }

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      });
      const p = createAudioPlayer(SILENCE);
      p.loop = true;
      p.play();
      player.current = p;
      p.setActiveForLockScreen(true, { title: 'Listen mode', artist: `Level ${level}` });

      // Lock-screen pause button (while we're between utterances) ends the session.
      let wasPlaying = false;
      p.addListener('playbackStatusUpdate', (status) => {
        const isPlaying = status.timeControlStatus === 'playing';
        if (isPlaying) wasPlaying = true;
        else if (wasPlaying && alive() && !speaking.current && status.playbackState !== 'buffering') {
          stop();
        }
      });
    } catch (e) {
      // Keep the loop going on platforms without lock-screen support (e.g. web).
      console.warn('Background audio setup failed:', e);
    }

    let previous: Word | null = null;
    while (alive()) {
      const word = pickRandom(wordsRef.current, previous);
      if (!word) break;
      previous = word;
      setCurrent(word);
      try {
        player.current?.updateLockScreenMetadata({
          title: word.english,
          artist: word.bg,
          albumTitle: `Vocabulary ${level}`,
        });
      } catch {}

      speaking.current = true;
      setPhase('english');
      await speakAsync(word.english, EN_LANG);
      speaking.current = false;
      if (!alive()) break;

      setPhase('pause');
      await sleep(PAUSE_AFTER_ENGLISH_MS);
      if (!alive()) break;

      speaking.current = true;
      setPhase('bulgarian');
      await speakAsync(word.bg, BG_LANG);
      speaking.current = false;
      if (!alive()) break;

      setPhase('pause');
      await sleep(PAUSE_AFTER_BULGARIAN_MS);
    }
  }, [level, stop]);

  // Stop when leaving the screen or switching level.
  useEffect(() => stop, [stop, level]);

  return { running, current, phase, start, stop };
}
