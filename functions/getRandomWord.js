import { supabase } from './supabaseClient'

export async function getRandomWord() {
  const { data, error } = await supabase
    .from('a1_words')
    .select('*')
    .limit(5)

  if (error) {
    console.log('Error fetching word:', error)
    return null
  }

  // console.log('Fetched data:', data)

  // Pick random row
  const randomIndex = Math.floor(Math.random() * data.length)
  const randomWord = data[randomIndex]

  // console.log('Random word:', randomWord)
  return {eng: randomWord.english, bulg: randomWord.bg}
}