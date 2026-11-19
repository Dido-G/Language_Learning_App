import { supabase } from './supabase';

export type Level = 'A1' | 'A2' | 'B1';

export type Word = {
  id: number;
  level: Level;
  english: string;
  bulgarian: string;
  part_of_speech: string | null;
  notes: string | null;
};

export async function getRandomWord(level: Level = 'A1'): Promise<Word | null> {
  const { count, error: countError } = await supabase
    .from('vocabulary')
    .select('id', { count: 'exact', head: true })
    .eq('level', level);
  if (countError || !count) {
    if (countError) console.warn('Error counting words:', countError.message);
    return null;
  }

  const offset = Math.floor(Math.random() * count);
  const { data, error } = await supabase
    .from('vocabulary')
    .select('id, level, english, bulgarian, part_of_speech, notes')
    .eq('level', level)
    .order('id')
    .range(offset, offset);
  if (error) {
    console.warn('Error fetching word:', error.message);
    return null;
  }
  return (data?.[0] as Word) ?? null;
}
