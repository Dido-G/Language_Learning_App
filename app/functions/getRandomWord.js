import { supabase } from '@/supbaseClient'

export async function getRandomWord() {
  const { data, error } = await supabase
    .from('a1_words')      // lowercase table name
    .select('English')

  console.log(data)

  if (error) {
    console.log('Error fetching word:', error)
    return null
  }

  const randomIndex = Math.floor(Math.random() * data.length)
  return data[randomIndex]
}
