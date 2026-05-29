import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mmkvStorage: StateStorage = {
  setItem: async (name: string, value: string) => { await AsyncStorage.setItem(name, value); },
  getItem: async (name: string) => { return await AsyncStorage.getItem(name); },
  removeItem: async (name: string) => { await AsyncStorage.removeItem(name); },
};

export type ThemeMode = 'light' | 'dark';
export type AccentColor = 'coral' | 'sage' | 'lavender' | 'sky' | 'peach' | 'mint' | 'ocean' | 'sunset' | 'berry' | 'gold' | 'slate' | 'rose' | 'forest' | 'violet' | 'copper' | 'arctic';
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
  { key: 'ocean', label: 'Океан', color: '#4E9FD4', light: '#EBF5FF', darkBg: '#101820', darkElevated: '#182838', darkSecondary: '#14202C', darkBorder: '#203448' },
  { key: 'sunset', label: 'Закат', color: '#FF7B54', light: '#FFF2ED', darkBg: '#1E1410', darkElevated: '#30201A', darkSecondary: '#281A14', darkBorder: '#402A20' },
  { key: 'berry', label: 'Ягода', color: '#C45BAA', light: '#FAF0F8', darkBg: '#1C1220', darkElevated: '#2E1E30', darkSecondary: '#241828', darkBorder: '#3D2840' },
  { key: 'gold', label: 'Золото', color: '#D4A843', light: '#FDF8ED', darkBg: '#1C1A10', darkElevated: '#2E2A1A', darkSecondary: '#262214', darkBorder: '#3D3820' },
  { key: 'slate', label: 'Сланец', color: '#7B8FA1', light: '#F2F4F6', darkBg: '#151820', darkElevated: '#1E2430', darkSecondary: '#1A1E28', darkBorder: '#283040' },
  { key: 'rose', label: 'Роза', color: '#E8839C', light: '#FFF0F4', darkBg: '#1E1418', darkElevated: '#2E2028', darkSecondary: '#261A20', darkBorder: '#3D2830' },
  { key: 'forest', label: 'Лес', color: '#5B9B6B', light: '#EEF6F0', darkBg: '#101A14', darkElevated: '#1A2E20', darkSecondary: '#14261A', darkBorder: '#203D28' },
  { key: 'violet', label: 'Фиалка', color: '#8B6CC0', light: '#F4F0FF', darkBg: '#161220', darkElevated: '#241E38', darkSecondary: '#1E182E', darkBorder: '#302848' },
  { key: 'copper', label: 'Медь', color: '#C07850', light: '#FBF4F0', darkBg: '#1C1510', darkElevated: '#2E221A', darkSecondary: '#261C14', darkBorder: '#3D3020' },
  { key: 'arctic', label: 'Арктика', color: '#6CB4D4', light: '#EDF8FC', darkBg: '#10181E', darkElevated: '#182830', darkSecondary: '#142028', darkBorder: '#203540' },
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
