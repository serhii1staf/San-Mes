import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

let appStorage: StateStorage;
try {
  const { MMKV } = require('react-native-mmkv');
  const storage = new MMKV({ id: 'settings-storage' });
  appStorage = {
    setItem: (name: string, value: string) => { storage.set(name, value); },
    getItem: (name: string) => { return storage.getString(name) ?? null; },
    removeItem: (name: string) => { storage.delete(name); },
  };
} catch {
  appStorage = {
    setItem: async (name: string, value: string) => { await AsyncStorage.setItem(name, value); },
    getItem: async (name: string) => { return await AsyncStorage.getItem(name); },
    removeItem: async (name: string) => { await AsyncStorage.removeItem(name); },
  };
}

interface SettingsState {
  hapticEnabled: boolean;
  useInAppBrowser: boolean;
  setHaptic: (enabled: boolean) => void;
  setInAppBrowser: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      hapticEnabled: true,
      useInAppBrowser: true,
      setHaptic: (hapticEnabled) => set({ hapticEnabled }),
      setInAppBrowser: (useInAppBrowser) => set({ useInAppBrowser }),
    }),
    {
      name: 'app-settings',
      storage: createJSONStorage(() => appStorage),
    }
  )
);
