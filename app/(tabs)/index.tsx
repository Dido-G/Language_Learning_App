import React, { useCallback, useEffect, useState } from 'react';
import * as Speech from 'expo-speech';
import { StyleSheet, Text, View } from 'react-native';
import { getRandomWord, type Word } from '@/lib/words';

export default function HomeScreen() {
  const [word, setWord] = useState<Word | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchWord = useCallback(async () => {
    setWord(await getRandomWord('A1'));
    setLoading(false);
  }, []);

  // Interim device TTS; replaced by pre-generated audio files later.
  useEffect(() => {
    if (!word) return;
    Speech.stop();
    Speech.speak(word.english, { language: 'en' });
    Speech.speak(word.bulgarian, { language: 'bg' });
  }, [word]);

  useEffect(() => {
    fetchWord();
    const interval = setInterval(fetchWord, 5000);
    return () => clearInterval(interval);
  }, [fetchWord]);

  return (
    <View style={styles.container}>
      <Text style={styles.word}>
        {word ? word.english : loading ? 'Loading...' : 'No words yet'}
      </Text>
      {word && <Text style={styles.translation}>{word.bulgarian}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  word: { fontSize: 32, fontWeight: 'bold' },
  translation: { fontSize: 24, marginTop: 8, opacity: 0.7 },
});
