export type Palette = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  accent: string;
  danger: string;
};

export const Palettes: Record<'light' | 'dark', Palette> = {
  light: {
    background: '#F5F7FB',
    surface: '#FFFFFF',
    surfaceAlt: '#E9EEF8',
    border: '#DDE3EE',
    text: '#0F172A',
    textMuted: '#64748B',
    primary: '#4F46E5',
    onPrimary: '#FFFFFF',
    accent: '#0D9488',
    danger: '#DC2626',
  },
  dark: {
    background: '#0B1020',
    surface: '#151B2E',
    surfaceAlt: '#1F2742',
    border: '#2A3350',
    text: '#F1F5F9',
    textMuted: '#94A3B8',
    primary: '#818CF8',
    onPrimary: '#0B1020',
    accent: '#2DD4BF',
    danger: '#F87171',
  },
};
