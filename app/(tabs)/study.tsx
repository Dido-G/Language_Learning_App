import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DataState, Screen } from '@/components/screen';
import { useTheme } from '@/hooks/use-theme';
import { useWords } from '@/hooks/use-words';
import { useLevel } from '@/lib/level-context';
import { BG_LANG, EN_LANG, speakAsync, stopSpeaking } from '@/lib/speech';
import type { Word } from '@/lib/words';

function shuffled<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function StudyScreen() {
  const t = useTheme();
  const { level } = useLevel();
  const { words, loading, error, reload } = useWords(level);
  const [seed, setSeed] = useState(0);
  const deck: Word[] = useMemo(() => shuffled(words), [words, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
  }, [deck]);

  useEffect(() => () => void stopSpeaking(), []);

  const card = deck[index];
  const go = useCallback(
    (delta: number) => {
      if (deck.length === 0) return;
      stopSpeaking();
      setFlipped(false);
      setIndex((i) => (i + delta + deck.length) % deck.length);
    },
    [deck.length]
  );

  const speak = () => {
    if (!card) return;
    stopSpeaking();
    speakAsync(flipped ? card.bg : card.english, flipped ? BG_LANG : EN_LANG);
  };

  const ready = !loading && !error && deck.length > 0;

  return (
    <Screen title="Study">
      {!ready ? (
        <DataState loading={loading} error={error} empty={deck.length === 0} level={level} onRetry={reload} />
      ) : (
        <View style={styles.content}>
          <Text style={[styles.counter, { color: t.textMuted }]}>
            {index + 1} / {deck.length}
          </Text>
          <Pressable
            onPress={() => setFlipped((f) => !f)}
            accessibilityRole="button"
            accessibilityLabel="Flip card"
            style={[styles.card, { backgroundColor: flipped ? t.surfaceAlt : t.surface, borderColor: t.border }]}>
            <Text style={[styles.side, { color: t.textMuted }]}>{flipped ? 'Български' : 'English'}</Text>
            <Text style={[styles.word, { color: flipped ? t.accent : t.text }]} adjustsFontSizeToFit numberOfLines={3}>
              {flipped ? card.bg : card.english}
            </Text>
            <Text style={[styles.tap, { color: t.textMuted }]}>Tap to flip</Text>
          </Pressable>

          <View style={styles.controls}>
            <RoundButton icon="chevron-back" onPress={() => go(-1)} label="Previous" />
            <RoundButton icon="volume-high" onPress={speak} label="Speak" primary />
            <RoundButton icon="chevron-forward" onPress={() => go(1)} label="Next" />
          </View>
          <Pressable onPress={() => setSeed((s) => s + 1)} style={styles.shuffle} accessibilityRole="button">
            <Ionicons name="shuffle" size={18} color={t.primary} />
            <Text style={{ color: t.primary, fontWeight: '700' }}>Shuffle deck</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

function RoundButton({
  icon,
  onPress,
  label,
  primary,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  label: string;
  primary?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.round, { backgroundColor: primary ? t.primary : t.surfaceAlt }]}>
      <Ionicons name={icon} size={26} color={primary ? t.onPrimary : t.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 20, gap: 18, alignItems: 'center' },
  counter: { fontSize: 13, fontWeight: '600' },
  card: {
    width: '100%',
    flex: 1,
    maxHeight: 400,
    borderRadius: 28,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  side: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2 },
  word: { fontSize: 46, fontWeight: '800', textAlign: 'center' },
  tap: { fontSize: 12 },
  controls: { flexDirection: 'row', gap: 20, alignItems: 'center' },
  round: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  shuffle: { flexDirection: 'row', gap: 6, alignItems: 'center', padding: 8 },
});
