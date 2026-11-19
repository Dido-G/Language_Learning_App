import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { sleep, tick, withTimeout } from '@/lib/clock';
import { BG_LANG, EN_LANG, prefetchSpeech, speakAsync, stopSpeaking, unlockSpeech } from '@/lib/speech';
import { pickRandom, type Level, type Word } from '@/lib/words';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SILENCE = require('@/assets/audio/silence.wav'); // 30 s of silence, looped
const SILENCE_SECONDS = 30;

const PAUSE_AFTER_ENGLISH_MS = 150;
const PAUSE_AFTER_BULGARIAN_MS = 400;
const ERROR_BACKOFF_MS = 700;
const PREFETCH_WAIT_MS = 4000;
const STATUS_INTERVAL_MS = 250; // silent-track status updates double as the background clock
const SEEK_DETECT_S = 6; // lock-screen seek buttons move the silent track by ±10 s

export type Phase = 'idle' | 'loading' | 'english' | 'bulgarian' | 'pause' | 'paused';

/**
 * Continuous Listen Mode, Spotify-style:
 *   English -> 150 ms -> Bulgarian -> 400 ms -> next random word, until Stop.
 *
 * How it survives a locked screen (Android dev/EAS build):
 * - A looping silent track plays through expo-audio with `shouldPlayInBackground` and
 *   `setActiveForLockScreen`, which runs expo-audio's foreground media-playback service. That keeps
 *   the process (and CPU, via the active audio track) alive and shows a media notification.
 * - RN pauses JS timers in the background, so every wait uses lib/clock `sleep`, which is also
 *   advanced by this track's status updates (`tick()`).
 *
 * Lock-screen controls map onto the silent track:
 * - Pause / Play  -> the track pauses/plays -> the session pauses/resumes (the current word restarts).
 * - Seek forward  -> skip to the next word.  Seek back -> replay the current word.
 * `interruptionMode: 'duckOthers'` makes Android *duck* (not pause) the track for short focus
 * requests such as TTS, so only real pauses (user, phone call, another media app) pause the session,
 * and transient ones resume by themselves when focus returns.
 */
export function useListenSession(words: Word[], level: Level) {
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [current, setCurrent] = useState<Word | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');

  const runId = useRef(0);
  const player = useRef<AudioPlayer | null>(null);
  const wordsRef = useRef(words);
  const pausedRef = useRef(false);
  const resumeWaiters = useRef<(() => void)[]>([]);
  const skipRef = useRef<'next' | 'replay' | null>(null);

  useEffect(() => {
    wordsRef.current = words;
  }, [words]);

  const releaseWaiters = () => {
    const w = resumeWaiters.current;
    resumeWaiters.current = [];
    w.forEach((f) => f());
  };

  /** Session pause state. Mirrors the silent track; interrupts speech when pausing. */
  const setPausedState = useCallback((value: boolean) => {
    if (pausedRef.current === value) return;
    pausedRef.current = value;
    setPaused(value);
    if (value) {
      stopSpeaking();
      setPhase('paused');
    } else {
      releaseWaiters();
    }
  }, []);

  const waitWhilePaused = () =>
    pausedRef.current ? new Promise<void>((r) => resumeWaiters.current.push(r)) : Promise.resolve();

  const stop = useCallback(() => {
    runId.current++;
    stopSpeaking();
    pausedRef.current = false;
    setPaused(false);
    releaseWaiters();
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

  const pause = useCallback(() => {
    try {
      player.current?.pause();
    } catch {}
    setPausedState(true);
  }, [setPausedState]);

  const resume = useCallback(() => {
    unlockSpeech();
    try {
      player.current?.play();
    } catch {}
    setPausedState(false);
  }, [setPausedState]);

  const next = useCallback(() => {
    skipRef.current = 'next';
    stopSpeaking();
    if (pausedRef.current) resume();
  }, [resume]);

  const start = useCallback(async () => {
    if (wordsRef.current.length === 0) return;
    unlockSpeech(); // web: must run synchronously inside the click
    stop();
    const id = ++runId.current;
    const alive = () => runId.current === id;
    setRunning(true);
    setPhase('loading');

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
        interruptionMode: 'duckOthers',
        allowsRecording: false,
        shouldRouteThroughEarpiece: false,
      });
      if (!alive()) return;
      const p = createAudioPlayer(SILENCE, { updateInterval: STATUS_INTERVAL_MS });
      p.loop = true;
      player.current = p;

      let wasPlaying = false;
      let lastTime: number | null = null;
      // NOTE: expo-audio sends *partial* status updates (e.g. only `{ playing }` or only
      // `{ playbackState }`), so a missing field must never be read as "paused".
      p.addListener('playbackStatusUpdate', (s) => {
        tick(); // background clock
        if (!alive() || player.current !== p) return;
        // Web: the silent track never controls the session; only the on-screen buttons do.
        if (Platform.OS === 'web') return;

        // Lock-screen seek buttons (full updates carry currentTime).
        if (typeof s.currentTime === 'number' && s.playing !== false) {
          if (lastTime !== null) {
            const d = s.currentTime - lastTime;
            const dur = s.duration || SILENCE_SECONDS;
            const loopWrap = lastTime > dur - 2 && s.currentTime < 2;
            if (d > SEEK_DETECT_S) next();
            else if (d < -SEEK_DETECT_S && !loopWrap) {
              skipRef.current = 'replay';
              stopSpeaking();
            }
          }
          lastTime = s.currentTime;
        }

        if (s.playing === true) {
          wasPlaying = true;
          if (pausedRef.current) setPausedState(false); // lock-screen / headset Play
        } else if (s.playing === false && wasPlaying && !pausedRef.current) {
          // Confirm against the player's live state: a genuine pause (lock-screen Pause, headset,
          // call, another media app) — not buffering and not the 30 s loop boundary.
          const t = p.currentTime;
          const dur = p.duration || SILENCE_SECONDS;
          const nearLoop = t < 0.75 || t > dur - 0.75;
          if (p.playing || p.isBuffering) return;
          if (nearLoop) {
            try {
              p.play(); // loop-point hiccup: keep the media service alive, keep going
            } catch {}
            return;
          }
          lastTime = null;
          setPausedState(true);
        }
      });

      p.play();
      p.setActiveForLockScreen(
        true,
        { title: 'Listen mode', artist: `Level ${level}` },
        { showSeekForward: true, showSeekBackward: true }
      );
    } catch (e) {
      // Keep the loop going where lock-screen support is unavailable.
      console.warn('Background audio setup failed:', e);
    }

    let upcoming: Word | null = pickRandom(wordsRef.current, null);
    while (alive()) {
      // One word cycle. Any failure is contained so the loop always carries on.
      try {
        await waitWhilePaused();
        if (!alive()) break;
        const word = upcoming ?? pickRandom(wordsRef.current, null);
        if (!word) break;
        skipRef.current = null;
        setCurrent(word);
        try {
          player.current?.updateLockScreenMetadata({
            title: word.english,
            artist: word.bg,
            albumTitle: `Vocabulary ${level}`,
          });
        } catch {}

        // Both clips ready before we start (web: instant if prefetched during the previous word).
        await withTimeout(
          Promise.all([prefetchSpeech(word.english, EN_LANG, word), prefetchSpeech(word.bg, BG_LANG, word)]),
          PREFETCH_WAIT_MS
        );
        // Look ahead: fetch the next word's audio while this one plays.
        const following = pickRandom(wordsRef.current, word);
        if (following) {
          prefetchSpeech(following.english, EN_LANG, following);
          prefetchSpeech(following.bg, BG_LANG, following);
        }

        const interrupted = () => !alive() || pausedRef.current || skipRef.current !== null;
        if (!interrupted()) {
          setPhase('english');
          await speakAsync(word.english, EN_LANG, word);
        }
        if (!interrupted()) {
          setPhase('pause');
          await sleep(PAUSE_AFTER_ENGLISH_MS);
        }
        if (!interrupted()) {
          setPhase('bulgarian');
          await speakAsync(word.bg, BG_LANG, word);
        }
        if (!interrupted()) {
          setPhase('pause');
          await sleep(PAUSE_AFTER_BULGARIAN_MS);
        }
        if (!alive()) break;

        const skip = skipRef.current;
        skipRef.current = null;
        // Paused or "replay" mid-word: say this word again; otherwise move on.
        upcoming = pausedRef.current || skip === 'replay' ? word : following;
      } catch (e) {
        console.warn('Listen cycle failed, continuing with the next word:', e);
        upcoming = null;
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  }, [level, stop, next, setPausedState]);

  // Stop when leaving the screen or switching level.
  useEffect(() => stop, [stop, level]);

  return { running, paused, current, phase, start, stop, pause, resume, next };
}
