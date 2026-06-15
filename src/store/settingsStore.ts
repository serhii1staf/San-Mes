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
  // Background image rendered full-bleed inside `MiniAppPreviewCard`.
  // Stable registry id from `mini-app-previews/registry.ts` (e.g.
  // `preview_3`) or `null` when the card stays transparent (default).
  // Picked from `app/settings/mini-app-preview.tsx`.
  miniAppPreviewBg: string | null;
  // Weather chip on the messages-tab header. Off by default per Apple's
  // "no auto-fetch on launch" guidance — the user opts in from settings.
  // City is the human-readable label rendered next to the temperature; lat/
  // lon drive the Open-Meteo fetch. `null` city means weather is on but the
  // user has not picked a place yet (chip stays hidden until they do).
  weatherEnabled: boolean;
  weatherCityName: string | null;
  weatherLat: number | null;
  weatherLon: number | null;
  // Phase 5 of the Cloudflare D1 migration. The data layer is now D1
  // by default; `'supabase'` is left as an emergency escape hatch for
  // future debugging but `src/lib/supabase.ts` no longer honours it
  // (it logs a perfMonitor warning and stays on the Worker). The flag
  // exists so the admin screen can show "production is on D1" with
  // unambiguous wording.
  dataLayer: 'd1' | 'supabase';
  setDataLayer: (v: 'd1' | 'supabase') => void;
  /**
   * @deprecated Phase-2 read shadowing flag — superseded by `dataLayer`.
   * Reads true when `dataLayer === 'd1'` so legacy callers still work
   * during OTA migration. New code should use `dataLayer` directly.
   */
  useD1Reads: boolean;
  setUseD1Reads: (v: boolean) => void;
  setHaptic: (enabled: boolean) => void;
  setInAppBrowser: (enabled: boolean) => void;
  setBrowserWidgetPosition: (position: 'top' | 'bottom') => void;
  setPerfMonitorEnabled: (enabled: boolean) => void;
  setPerfMonitorPosition: (x: number, y: number) => void;
  setPerfMonitorFilter: (kind: string, on: boolean) => void;
  setHomeHeaderIcon: (id: string | null) => void;
  setMiniAppPreviewBg: (id: string | null) => void;
  setWeatherEnabled: (enabled: boolean) => void;
  setWeatherCity: (city: { name: string; lat: number; lon: number } | null) => void;
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
      // No preview-card background by default — `MiniAppPreviewCard`
      // keeps its current transparent look until the user picks one.
      miniAppPreviewBg: null,
      // Weather opt-in defaults: feature OFF, no city picked yet.
      weatherEnabled: false,
      weatherCityName: null,
      weatherLat: null,
      weatherLon: null,
      // D1 is the default in production. Supabase is kept only as an
      // emergency escape-hatch label; the data layer ignores the flag
      // and always uses the Worker.
      dataLayer: 'd1' as const,
      // Legacy phase-2 mirror so anything still reading `useD1Reads`
      // gets a truthy value when D1 is the active layer.
      useD1Reads: true,
      setHaptic: (hapticEnabled) => set({ hapticEnabled }),
      setInAppBrowser: (useInAppBrowser) => set({ useInAppBrowser }),
      setBrowserWidgetPosition: (browserWidgetPosition) => set({ browserWidgetPosition }),
      setPerfMonitorEnabled: (perfMonitorEnabled) => set({ perfMonitorEnabled }),
      setPerfMonitorPosition: (perfMonitorPosX, perfMonitorPosY) =>
        set({ perfMonitorPosX, perfMonitorPosY }),
      setPerfMonitorFilter: (kind, on) =>
        set((s) => ({ perfMonitorFilters: { ...s.perfMonitorFilters, [kind]: on } })),
      setHomeHeaderIcon: (homeHeaderIcon) => set({ homeHeaderIcon }),
      setMiniAppPreviewBg: (miniAppPreviewBg) => set({ miniAppPreviewBg }),
      setWeatherEnabled: (weatherEnabled) => set({ weatherEnabled }),
      setWeatherCity: (city) =>
        set(
          city
            ? { weatherCityName: city.name, weatherLat: city.lat, weatherLon: city.lon }
            : { weatherCityName: null, weatherLat: null, weatherLon: null }
        ),
      setDataLayer: (dataLayer) => set({ dataLayer, useD1Reads: dataLayer === 'd1' }),
      setUseD1Reads: (useD1Reads) =>
        set({ useD1Reads, dataLayer: useD1Reads ? 'd1' : 'supabase' }),
    }),
    {
      name: 'app-settings',
      storage: createJSONStorage(() => appStorage),
    }
  )
);
