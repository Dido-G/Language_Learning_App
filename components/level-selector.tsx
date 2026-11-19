import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { useLevel } from '@/lib/level-context';
import { LEVELS } from '@/lib/words';

export function LevelSelector() {
  const t = useTheme();
  const { level, setLevel } = useLevel();
  return (
    <View style={[styles.row, { backgroundColor: t.surfaceAlt }]} accessibilityRole="tablist">
      {LEVELS.map((l) => {
        const active = l === level;
        return (
          <Pressable
            key={l}
            onPress={() => setLevel(l)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.chip, active && { backgroundColor: t.primary }]}>
            <Text style={[styles.label, { color: active ? t.onPrimary : t.textMuted }]}>{l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: 14, padding: 4 },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  label: { fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
});
