import React, { createContext, useContext, useMemo, useState } from 'react';
import type { Level } from './words';

type Ctx = { level: Level; setLevel: (l: Level) => void };
const LevelContext = createContext<Ctx | null>(null);

export function LevelProvider({ children }: { children: React.ReactNode }) {
  const [level, setLevel] = useState<Level>('A1');
  const value = useMemo(() => ({ level, setLevel }), [level]);
  return <LevelContext.Provider value={value}>{children}</LevelContext.Provider>;
}

export function useLevel(): Ctx {
  const ctx = useContext(LevelContext);
  if (!ctx) throw new Error('useLevel must be used inside <LevelProvider>');
  return ctx;
}
