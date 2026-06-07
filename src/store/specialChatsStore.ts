import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const storage: StateStorage = {
  setItem: async (n, v) => { await AsyncStorage.setItem(n, v); },
  getItem: async (n) => await AsyncStorage.getItem(n),
  removeItem: async (n) => { await AsyncStorage.removeItem(n); },
};

// Tracks when the built-in chats (San AI, Music) were last opened, so they only
// appear in the chat list AFTER being opened (via the FAB / "+" menu) and are
// ordered by activity, exactly like normal conversations.
interface SpecialChatsStore {
  aiLastOpened: number | null;
  musicLastOpened: number | null;
  markOpened: (which: 'ai' | 'music') => void;
}

export const useSpecialChatsStore = create<SpecialChatsStore>()(
  persist(
    (set) => ({
      aiLastOpened: null,
      musicLastOpened: null,
      markOpened: (which) => set(which === 'ai' ? { aiLastOpened: Date.now() } : { musicLastOpened: Date.now() }),
    }),
    { name: 'special-chats', storage: createJSONStorage(() => storage) }
  )
);
