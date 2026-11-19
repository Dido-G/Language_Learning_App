import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DataState, Screen } from '@/components/screen';
import { useTheme } from '@/hooks/use-theme';
import { useWords } from '@/hooks/use-words';
import { useLevel } from '@/lib/level-context';
import { BG_LANG, EN_LANG, prefetchSpeech, speakAsync, stopSpeaking, unlockSpeech } from '@/lib/speech';
import type { Word } from '@/lib/words';

export default function WordsScreen() {
  const t = useTheme();
  const { level } = useLevel();
  const { words, loading, error, reload } = useWords(level);
  const [query, setQuery] = useState('');

  useEffect(() => () => void stopSpeaking(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? words.filter((w) => w.english.toLowerCase().includes(q) || w.bg.toLowerCase().includes(q)) : words;
  }, [words, query]);

  const play = async (w: Word) => {
    unlockSpeech();
    stopSpeaking();
    prefetchSpeech(w.bg, BG_LANG, w);
    await speakAsync(w.english, EN_LANG, w);
    await speakAsync(w.bg, BG_LANG, w);
  };

  const ready = !loading && !error && words.length > 0;

  return (
    <Screen title="Words">
      {!ready ? (
        <DataState loading={loading} error={error} empty={words.length === 0} level={level} onRetry={reload} />
      ) : (
        <View style={styles.flex}>
          <View style={[styles.search, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Ionicons name="search" size={18} color={t.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={`Search ${words.length} ${level} words`}
              placeholderTextColor={t.textMuted}
              style={[styles.input, { color: t.text }]}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(w) => String(w.id)}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={[styles.empty, { color: t.textMuted }]}>No matches</Text>}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => play(item)}
                accessibilityRole="button"
                accessibilityLabel={`Play ${item.english}`}
                style={[styles.row, { backgroundColor: t.surface, borderColor: t.border }]}>
                <View style={styles.flex}>
                  <Text style={[styles.en, { color: t.text }]}>{item.english}</Text>
                  <Text style={[styles.bg, { color: t.accent }]}>{item.bg}</Text>
                </View>
                <Ionicons name="volume-medium" size={22} color={t.textMuted} />
              </Pressable>
            )}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 16 },
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, borderWidth: 1, gap: 12 },
  en: { fontSize: 17, fontWeight: '700' },
  bg: { fontSize: 15, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 32 },
});
