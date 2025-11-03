import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { getRandomWord } from '../../functions/getRandomWord'
import * as Speech from 'expo-speech'


export default function App() {
  const [word, setWord] = useState<string>('');
  const [bgWord, setBgWord] = useState<string>('');

  useEffect(() => {
    if(word) {
      Speech.speak(word, {language:'en'})
    }
    if(bgWord) {
      Speech.speak(bgWord, {language:'bg'})
    }
  }, [word]);
  

  useEffect(() => {
    fetchWord();

    const interval = setInterval(fetchWord, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchWord = async () => {
    const randomWord = await getRandomWord()
    if (randomWord) {
      setWord(randomWord.eng)
      setBgWord(randomWord.bulg)
    }
  }
  return (
    <View style={styles.container}>
      <Text style={styles.word}>
        {word ? word: 'Loading...'}
      </Text>
      <Text style={styles.word}>
        {bgWord ? bgWord:'Loading...'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  word: { fontSize: 32, fontWeight: 'bold', color:'#FFFFFF' }
})
