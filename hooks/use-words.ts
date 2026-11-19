import { useCallback, useEffect, useState } from 'react';
import { getWordsByLevel, type Level, type Word } from '@/lib/words';

const cache = new Map<Level, Word[]>();

export function useWords(level: Level) {
  const [words, setWords] = useState<Word[]>(cache.get(level) ?? []);
  const [loading, setLoading] = useState(!cache.has(level));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
      if (!force && cache.has(level)) {
        setWords(cache.get(level)!);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await getWordsByLevel(level);
        cache.set(level, data);
        setWords(data);
      } catch (e) {
        setWords([]);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [level]
  );

  useEffect(() => {
    load();
  }, [load]);

  return { words, loading, error, reload: () => load(true) };
}
