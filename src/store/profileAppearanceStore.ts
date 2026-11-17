import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
// Synchronous (MMKV): the post cards render with the chosen emoji in the first frame.
import { syncPersistStorage as storage } from './syncPersistStorage';

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
