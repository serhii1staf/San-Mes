import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
// Synchronous (MMKV): San AI / Music rows are in the chat list's first frame instead of popping in.
import { syncPersistStorage as storage } from './syncPersistStorage';

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
