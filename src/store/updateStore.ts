import { create } from 'zustand';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { t } from '../i18n/store';

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

interface UpdateStoreState {
  status: UpdateStatus;
  progress: number; // 0-100
  message: string;
  updateAvailable: boolean;
  checkForUpdate: () => Promise<void>;
  applyUpdate: () => Promise<void>;
}

export const useUpdateStore = create<UpdateStoreState>()((set, get) => ({
  status: 'idle',
  progress: 0,
  message: '',
  updateAvailable: false,

  checkForUpdate: async () => {
    // Skip in development or web
    if (__DEV__ || Platform.OS === 'web') return;

    try {
      set({ status: 'checking', progress: 10, message: t('update.checking') });

      const update = await Updates.checkForUpdateAsync();

      if (update.isAvailable) {
        set({ status: 'downloading', progress: 20, message: t('update.downloading'), updateAvailable: true });

        // ── THE SIMULATED PROGRESS IS GONE ────────────────────────────────────
        //
        // It was a `setInterval(…, 500)` doing `set({ progress: current + Math.random() * 8 })`, with
        // its own comment admitting "expo-updates doesn't provide real progress, so we simulate it".
        //
        // Two problems, and the second is the expensive one.
        //
        // It was a fabricated number presented as a measurement. The home feed rendered it as
        // `${Math.round(updateProgress)}%` in a chip next to the wordmark, so the user watched a
        // percentage climb by a random amount twice a second that bore no relation to how much of the
        // bundle had arrived. It could sit at 85 for the rest of a slow download, or reach 85 while the
        // fetch had barely started.
        //
        // And every one of those ticks was a Zustand write to a field the feed subscribes to
        // (`useUpdateStore((s) => s.progress)`), so it re-rendered the home screen twice a second for
        // the whole duration of an update check. The feed even carries a comment claiming it
        // "subscribe[s] to update store fields individually so the feed screen doesn't re-render on
        // every progress tick of an OTA download" — narrowing the selector does nothing when the
        // narrowed field is the one changing.
        //
        // `expo-updates` exposes no download-progress callback, so the honest UI is indeterminate:
        // `progress` now marks the two phases it can actually know about (20 = downloading, 100 =
        // ready) and the surfaces that displayed a percentage show a spinner and a label instead.
        await Updates.fetchUpdateAsync();
        set({ status: 'ready', progress: 100, message: t('update.ready') });
      } else {
        set({ status: 'idle', progress: 0, message: '', updateAvailable: false });
      }
    } catch (e: any) {
      set({ status: 'error', progress: 0, message: e?.message || t('update.error') });
      // Reset after 5 seconds
      setTimeout(() => {
        set({ status: 'idle', progress: 0, message: '' });
      }, 5000);
    }
  },

  applyUpdate: async () => {
    if (__DEV__ || Platform.OS === 'web') return;
    try {
      await Updates.reloadAsync();
    } catch {}
  },
}));
