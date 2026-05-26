import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';

let mmkvStorage: StateStorage;

try {
  const { MMKV } = require('react-native-mmkv');
  const storage = new MMKV({ id: 'theme-storage' });
  mmkvStorage = {
    setItem: (name: string, value: string) => {
      storage.set(name, value);
    },
    getItem: (name: string) => {
      const value = storage.getString(name);
      return value ?? null;
    },
    removeItem: (name: string) => {
      storage.delete(name);
    },
  };
} catch {
  mmkvStorage = {
    setItem: () => {},
    getItem: () => null,
    removeItem: () => {},
  };
}

export type ThemeMode = 'light' | 'dark';
export type AccentColor = 'coral' | 'sage' | 'lavender' | 'sky' | 'peach' | 'mint';

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
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: AccentColor) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeStoreState>()(
  persist(
    (set) => ({
      mode: 'dark',
      accent: 'coral',
      setMode: (mode) => set({ mode }),
      setAccent: (accent) => set({ accent }),
      toggle: () => set((state) => ({ mode: state.mode === 'light' ? 'dark' : 'light' })),
    }),
    {
      name: 'theme-mode',
      storage: createJSONStorage(() => mmkvStorage),
    }
  )
);
