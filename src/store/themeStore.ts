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
  // Fallback to no-op storage if MMKV is not available (e.g., Expo Go)
  mmkvStorage = {
    setItem: () => {},
    getItem: () => null,
    removeItem: () => {},
  };
}

export type ThemeMode = 'light' | 'dark';

interface ThemeStoreState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeStoreState>()(
  persist(
    (set) => ({
      mode: 'light',
      setMode: (mode) => set({ mode }),
      toggle: () => set((state) => ({ mode: state.mode === 'light' ? 'dark' : 'light' })),
    }),
    {
      name: 'theme-mode',
      storage: createJSONStorage(() => mmkvStorage),
    }
  )
);
