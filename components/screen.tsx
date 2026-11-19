import React from 'react';
import { StyleSheet, Text, View, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LevelSelector } from './level-selector';
import { useTheme } from '@/hooks/use-theme';

/** Common screen chrome: title + level selector. */
export function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: t.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.text }]}>{title}</Text>
        <LevelSelector />
      </View>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

/** Loading / error / empty states for a word-backed screen. Returns null when content is ready. */
export function DataState({
  loading,
  error,
  empty,
  level,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  level: string;
  onRetry: () => void;
}) {
  const t = useTheme();
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={t.primary} size="large" />
      </View>
    );
  }
  if (error || empty) {
    return (
      <View style={styles.center}>
        <Text style={[styles.stateTitle, { color: t.text }]}>
          {error ? 'Could not load words' : `No ${level} words yet`}
        </Text>
        <Text style={[styles.stateText, { color: t.textMuted }]}>
          {error ?? 'Import them with tools/vocab (see its README), then retry.'}
        </Text>
        <Pressable onPress={onRetry} style={[styles.retry, { backgroundColor: t.primary }]}>
          <Text style={{ color: t.onPrimary, fontWeight: '700' }}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 14 },
  title: { fontSize: 28, fontWeight: '800' },
  body: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  stateTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  stateText: { fontSize: 14, textAlign: 'center' },
  retry: { marginTop: 8, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 12 },
});
