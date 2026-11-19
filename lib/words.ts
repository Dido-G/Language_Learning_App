import { supabase } from './supabase';

export const LEVELS = ['A1', 'A2', 'B1'] as const;
export type Level = (typeof LEVELS)[number];

export type Word = {
  id: number;
  level: Level;
  english: string;
  bg: string;
};

const PAGE_SIZE = 1000; // Supabase's default max rows per request

/** All words of a level, alphabetical. Pages through results so >1000 rows work. */
export async function getWordsByLevel(level: Level): Promise<Word[]> {
  const words: Word[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('vocabulary')
      .select('id, level, english, bg')
      .eq('level', level)
      .order('english')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load ${level} words: ${error.message}`);
    words.push(...(data as Word[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return words;
}

/** Random element, avoiding `previous` when there is more than one choice. */
export function pickRandom(words: Word[], previous?: Word | null): Word | null {
  if (words.length === 0) return null;
  if (words.length === 1) return words[0];
  let next: Word;
  do {
    next = words[Math.floor(Math.random() * words.length)];
  } while (previous && next.id === previous.id);
  return next;
}
