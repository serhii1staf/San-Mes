import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountKey } from '../services/cacheService';

export type WidgetContent = 'feed' | 'following';

interface WidgetSettingsState {
  // How many posts to show in the widget (clamped 1..4 by the native widget).
  postCount: number;
  // What the widget shows.
  content: WidgetContent;
  setPostCount: (n: number) => void;
  setContent: (c: WidgetContent) => void;
}

// Per-account persistence so each account keeps its own widget preferences.
const storage: StateStorage = {
  setItem: async (name, value) => { await AsyncStorage.setItem(accountKey(name), value); },
  getItem: async (name) => { return await AsyncStorage.getItem(accountKey(name)); },
  removeItem: async (name) => { await AsyncStorage.removeItem(accountKey(name)); },
};

export const useWidgetSettingsStore = create<WidgetSettingsState>()(
  persist(
    (set) => ({
      postCount: 4,
      content: 'feed',
      setPostCount: (n) => set({ postCount: Math.max(1, Math.min(4, n)) }),
      setContent: (content) => set({ content }),
    }),
    {
      name: 'widget-settings',
      storage: createJSONStorage(() => storage),
    }
  )
);
