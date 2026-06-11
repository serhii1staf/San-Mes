import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const appStorage: StateStorage = {
  setItem: async (name: string, value: string) => { await AsyncStorage.setItem(name, value); },
  getItem: async (name: string) => { return await AsyncStorage.getItem(name); },
  removeItem: async (name: string) => { await AsyncStorage.removeItem(name); },
};

interface SettingsState {
  hapticEnabled: boolean;
  useInAppBrowser: boolean;
  // Where the minimized browser/mini-app pill appears. "top" floats it under
  // the status bar (default), "bottom" docks it above the tab bar with the
  // same rounded glass styling — the rest of the UI keeps full reach without
  // the pill cutting into the safe-area indicator at the top of the screen.
  browserWidgetPosition: 'top' | 'bottom';
  setHaptic: (enabled: boolean) => void;
  setInAppBrowser: (enabled: boolean) => void;
  setBrowserWidgetPosition: (position: 'top' | 'bottom') => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      hapticEnabled: true,
      useInAppBrowser: true,
      browserWidgetPosition: 'top',
      setHaptic: (hapticEnabled) => set({ hapticEnabled }),
      setInAppBrowser: (useInAppBrowser) => set({ useInAppBrowser }),
      setBrowserWidgetPosition: (browserWidgetPosition) => set({ browserWidgetPosition }),
    }),
    {
      name: 'app-settings',
      storage: createJSONStorage(() => appStorage),
    }
  )
);
