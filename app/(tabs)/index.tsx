import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DataState, Screen } from '@/components/screen';
import { useListenSession } from '@/hooks/use-listen-session';
import { useTheme } from '@/hooks/use-theme';
import { useWords } from '@/hooks/use-words';
import { useLevel } from '@/lib/level-context';
import { BG_LANG, hasVoice } from '@/lib/speech';

export default function ListenScreen() {
  const t = useTheme();
  const { level } = useLevel();
  const { words, loading, error, reload } = useWords(level);
  const { running, current, phase, start, stop } = useListenSession(words, level);
  const [bgVoice, setBgVoice] = useState(true);

  useEffect(() => {
    hasVoice(BG_LANG.slice(0, 2)).then(setBgVoice);
  }, []);

  const ready = !loading && !error && words.length > 0;

  return (
    <Screen title="Listen">
      {!ready ? (
        <DataState loading={loading} error={error} empty={words.length === 0} level={level} onRetry={reload} />
      ) : (
        <View style={styles.content}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.hint, { color: t.textMuted }]}>
              {running ? `Playing random ${level} words` : `${words.length} words in ${level}`}
            </Text>
            <Text
              style={[styles.english, { color: phase === 'english' ? t.primary : t.text }]}
              adjustsFontSizeToFit
              numberOfLines={2}>
              {current ? current.english : '—'}
            </Text>
            <View style={[styles.divider, { backgroundColor: t.border }]} />
            <Text
              style={[styles.bg, { color: phase === 'bulgarian' ? t.accent : t.textMuted }]}
              adjustsFontSizeToFit
              numberOfLines={2}>
              {current ? current.bg : '—'}
            </Text>
          </View>

          <Pressable
            onPress={running ? stop : start}
            accessibilityRole="button"
            accessibilityLabel={running ? 'Stop listening' : 'Start listening'}
            style={[styles.play, { backgroundColor: running ? t.danger : t.primary }]}>
            <Ionicons name={running ? 'stop' : 'play'} size={36} color={t.onPrimary} />
          </Pressable>

          <Text style={[styles.note, { color: t.textMuted }]}>
            English → Bulgarian → next word, on repeat. Keeps going with the screen locked
            (Android development build).
          </Text>
          {!bgVoice && (
            <Text style={[styles.note, { color: t.danger }]}>
              No Bulgarian text-to-speech voice found. Install one in Android Settings → Text-to-speech.
            </Text>
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 20, gap: 24, alignItems: 'center' },
  card: {
    width: '100%',
    flex: 1,
    maxHeight: 420,
    borderRadius: 28,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  hint: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  english: { fontSize: 44, fontWeight: '800', textAlign: 'center' },
  divider: { width: 48, height: 3, borderRadius: 2 },
  bg: { fontSize: 38, fontWeight: '700', textAlign: 'center' },
  play: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 13, textAlign: 'center', paddingHorizontal: 12 },
});
