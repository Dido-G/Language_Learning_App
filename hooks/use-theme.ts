import { useColorScheme } from 'react-native';
import { Palettes, type Palette } from '@/constants/theme';

export function useTheme(): Palette {
  return Palettes[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
