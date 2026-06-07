import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const storage: StateStorage = {
  setItem: async (n, v) => { await AsyncStorage.setItem(n, v); },
  getItem: async (n) => await AsyncStorage.getItem(n),
  removeItem: async (n) => { await AsyncStorage.removeItem(n); },
};

// Per-device choice of a decorative emoji shown faintly inside the user's own
// profile post containers (Telegram-style). Empty string = off.
interface ProfileAppearanceStore {
  postEmoji: string;
  setPostEmoji: (emoji: string) => void;
}

export const useProfileAppearanceStore = create<ProfileAppearanceStore>()(
  persist(
    (set) => ({
      postEmoji: '',
      setPostEmoji: (emoji) => set({ postEmoji: emoji }),
    }),
    { name: 'profile-appearance', storage: createJSONStorage(() => storage) }
  )
);
