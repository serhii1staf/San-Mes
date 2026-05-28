import { create } from 'zustand';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

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
      set({ status: 'checking', progress: 10, message: 'Проверка обновлений...' });

      const update = await Updates.checkForUpdateAsync();

      if (update.isAvailable) {
        set({ status: 'downloading', progress: 20, message: 'Загрузка обновления...', updateAvailable: true });

        // Start download with progress simulation
        // expo-updates doesn't provide real progress, so we simulate it
        const progressInterval = setInterval(() => {
          const current = get().progress;
          if (current < 85) {
            set({ progress: current + Math.random() * 8 });
          }
        }, 500);

        await Updates.fetchUpdateAsync();

        clearInterval(progressInterval);
        set({ status: 'ready', progress: 100, message: 'Обновление готово. Перезапустите приложение.' });
      } else {
        set({ status: 'idle', progress: 0, message: '', updateAvailable: false });
      }
    } catch (e: any) {
      set({ status: 'error', progress: 0, message: e?.message || 'Ошибка обновления' });
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
