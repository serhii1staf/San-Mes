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
  // In-app perf monitor — small draggable bubble that shows live JS/UI FPS
  // and opens a panel with recent navigation/timing events. Default ON so
  // QA / the dev can spot jank in the wild without a separate debug build.
  perfMonitorEnabled: boolean;
  perfMonitorPosX: number; // last drop position in px (top-left origin)
  perfMonitorPosY: number;
  // Filter chip selection persisted across panel re-opens. Keys mirror the
  // PerfEventKind values the panel filters on (NAV, MOUNT, INPUT, IMG, LONG,
  // UI, MARK). Missing key = filter on (default-on behaviour).
  perfMonitorFilters: Record<string, boolean>;
  // Decorative pixel-icon next to the "San" title on the home feed
  // header. Stable registry id (e.g. `pack-1/01_ghost_king`) or `null`
  // when the user hasn't picked one — the title then stays bare.
  // Picked via the existing pixel-icons screen launched with
  // `?purpose=home-header` from a long-press on the title.
  homeHeaderIcon: string | null;
  setHaptic: (enabled: boolean) => void;
  setInAppBrowser: (enabled: boolean) => void;
  setBrowserWidgetPosition: (position: 'top' | 'bottom') => void;
  setPerfMonitorEnabled: (enabled: boolean) => void;
  setPerfMonitorPosition: (x: number, y: number) => void;
  setPerfMonitorFilter: (kind: string, on: boolean) => void;
  setHomeHeaderIcon: (id: string | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      hapticEnabled: true,
      useInAppBrowser: true,
      browserWidgetPosition: 'top',
      // Perf monitor defaults: visible, sitting near the bottom-right safe
      // area so it doesn't overlap the floating tab bar. Negative numbers
      // act as "unset"; the bubble computes the initial position on mount
      // when it sees -1.
      perfMonitorEnabled: true,
      perfMonitorPosX: -1,
      perfMonitorPosY: -1,
      // Default: every chip on, so first-time openers see all events.
      perfMonitorFilters: {
        NAV: true,
        MOUNT: true,
        INPUT: true,
        IMG: true,
        LONG: true,
        UI: true,
        MARK: true,
      },
      // No icon by default — the "San" title stands alone unless the
      // user explicitly picks one from the pixel-icons picker.
      homeHeaderIcon: null,
      setHaptic: (hapticEnabled) => set({ hapticEnabled }),
      setInAppBrowser: (useInAppBrowser) => set({ useInAppBrowser }),
      setBrowserWidgetPosition: (browserWidgetPosition) => set({ browserWidgetPosition }),
      setPerfMonitorEnabled: (perfMonitorEnabled) => set({ perfMonitorEnabled }),
      setPerfMonitorPosition: (perfMonitorPosX, perfMonitorPosY) =>
        set({ perfMonitorPosX, perfMonitorPosY }),
      setPerfMonitorFilter: (kind, on) =>
        set((s) => ({ perfMonitorFilters: { ...s.perfMonitorFilters, [kind]: on } })),
      setHomeHeaderIcon: (homeHeaderIcon) => set({ homeHeaderIcon }),
    }),
    {
      name: 'app-settings',
      storage: createJSONStorage(() => appStorage),
    }
  )
);
