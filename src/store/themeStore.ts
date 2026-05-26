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

export const ACCENT_COLORS: { key: AccentColor; label: string; color: string; light: string }[] = [
  { key: 'coral', label: 'Коралл', color: '#FF8F8F', light: '#FFF0F0' },
  { key: 'sage', label: 'Шалфей', color: '#8FAE8B', light: '#F0F5EF' },
  { key: 'lavender', label: 'Лаванда', color: '#B4A7D6', light: '#F3F0FA' },
  { key: 'sky', label: 'Небо', color: '#87CEEB', light: '#EFF8FF' },
  { key: 'peach', label: 'Персик', color: '#FFBFA0', light: '#FFF5F0' },
  { key: 'mint', label: 'Мята', color: '#98D4BB', light: '#F0FBF6' },
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
