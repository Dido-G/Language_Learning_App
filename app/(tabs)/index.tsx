import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { getRandomWord } from '../functions/getRandomWord'

export default function App() {
  const [word, setWord] = useState<{ text: string } | null>(null)
  
  useEffect(() => {
    fetchWord();

    const interval = setInterval(fetchWord, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchWord = async () => {
    const randomWord = await getRandomWord()
    if (randomWord) setWord(randomWord)
    alert(JSON.stringify(randomWord));
  }

  return (
    <View style={styles.container}>
      <Text style={styles.word}>
        {word ? word.text : 'Loading...'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  word: { fontSize: 32, fontWeight: 'bold' }
})
