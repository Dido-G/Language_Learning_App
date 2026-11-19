import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getRandomWord, type Word } from '@/lib/words';

export default function HomeScreen() {
  const [word, setWord] = useState<Word | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchWord = useCallback(async () => {
    setWord(await getRandomWord('A1'));
    setLoading(false);
  }, []);

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
