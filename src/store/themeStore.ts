import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mmkvStorage: StateStorage = {
  setItem: async (name: string, value: string) => { await AsyncStorage.setItem(name, value); },
  getItem: async (name: string) => { return await AsyncStorage.getItem(name); },
  removeItem: async (name: string) => { await AsyncStorage.removeItem(name); },
};

export type ThemeMode = 'light' | 'dark';
export type AccentColor = 'coral' | 'sage' | 'lavender' | 'sky' | 'peach' | 'mint';
export type FontFamily = 'inter' | 'system' | 'serif' | 'mono';
export type FontSize = 'small' | 'medium' | 'large';

export const FONT_FAMILIES: { key: FontFamily; label: string; preview: string }[] = [
  { key: 'inter', label: 'Inter', preview: 'Aa' },
  { key: 'system', label: 'Системный', preview: 'Aa' },
  { key: 'serif', label: 'Serif', preview: 'Aa' },
  { key: 'mono', label: 'Mono', preview: 'Aa' },
];

export const FONT_SIZES: { key: FontSize; label: string; scale: number }[] = [
  { key: 'small', label: 'Мелкий', scale: 0.85 },
  { key: 'medium', label: 'Обычный', scale: 1.0 },
  { key: 'large', label: 'Крупный', scale: 1.15 },
];

export const ACCENT_COLORS: {
  key: AccentColor;
  label: string;
  color: string;
  light: string;
  // Dark mode background tints
  darkBg: string;
  darkElevated: string;
  darkSecondary: string;
  darkBorder: string;
}[] = [
  { key: 'coral', label: 'Коралл', color: '#FF8F8F', light: '#FFF0F0', darkBg: '#1A1414', darkElevated: '#2A1E1E', darkSecondary: '#221919', darkBorder: '#3A2828' },
  { key: 'sage', label: 'Шалфей', color: '#8FAE8B', light: '#F0F5EF', darkBg: '#141A14', darkElevated: '#1E2A1E', darkSecondary: '#192219', darkBorder: '#283A28' },
  { key: 'lavender', label: 'Лаванда', color: '#B4A7D6', light: '#F3F0FA', darkBg: '#18151E', darkElevated: '#241F30', darkSecondary: '#1E1A26', darkBorder: '#332D42' },
  { key: 'sky', label: 'Небо', color: '#87CEEB', light: '#EFF8FF', darkBg: '#121A1E', darkElevated: '#1B2830', darkSecondary: '#162026', darkBorder: '#253540' },
  { key: 'peach', label: 'Персик', color: '#FFBFA0', light: '#FFF5F0', darkBg: '#1E1815', darkElevated: '#2E241E', darkSecondary: '#261F1A', darkBorder: '#3D3028' },
  { key: 'mint', label: 'Мята', color: '#98D4BB', light: '#F0FBF6', darkBg: '#131E1A', darkElevated: '#1C2E28', darkSecondary: '#182620', darkBorder: '#253D35' },
];

interface ThemeStoreState {
  mode: ThemeMode;
  accent: AccentColor;
  fontFamily: FontFamily;
  fontSize: FontSize;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: AccentColor) => void;
  setFontFamily: (fontFamily: FontFamily) => void;
  setFontSize: (fontSize: FontSize) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeStoreState>()(
  persist(
    (set) => ({
      mode: 'dark',
      accent: 'coral',
      fontFamily: 'inter',
      fontSize: 'medium',
      setMode: (mode) => set({ mode }),
      setAccent: (accent) => set({ accent }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setFontSize: (fontSize) => set({ fontSize }),
      toggle: () => set((state) => ({ mode: state.mode === 'light' ? 'dark' : 'light' })),
    }),
    {
      name: 'theme-mode',
      storage: createJSONStorage(() => mmkvStorage),
    }
  )
);
