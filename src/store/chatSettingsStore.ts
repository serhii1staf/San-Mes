import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const storage: StateStorage = {
  setItem: async (n, v) => { await AsyncStorage.setItem(n, v); },
  getItem: async (n) => await AsyncStorage.getItem(n),
  removeItem: async (n) => { await AsyncStorage.removeItem(n); },
};

export interface ChatSettings {
  backgroundImage?: string; // local URI
  fontSize: number; // 14-20
  fontFamily: string; // 'system' | 'serif' | 'mono'
  localName?: string; // override display name
  bubbleRadius: number; // 12-24
}

// Special key for global/default chat settings (applies to all chats without their own overrides)
export const GLOBAL_CHAT_SETTINGS_KEY = '__global__';

interface ChatSettingsStore {
  settings: Record<string, ChatSettings>; // keyed by chatId (or GLOBAL key)
  archived: string[]; // archived chat IDs
  getSettings: (chatId: string) => ChatSettings;
  updateSettings: (chatId: string, updates: Partial<ChatSettings>) => void;
  archiveChat: (chatId: string) => void;
  unarchiveChat: (chatId: string) => void;
  isArchived: (chatId: string) => boolean;
}

const DEFAULT_SETTINGS: ChatSettings = { fontSize: 15, fontFamily: 'system', bubbleRadius: 18 };

export const useChatSettingsStore = create<ChatSettingsStore>()(
  persist(
    (set, get) => ({
      settings: {},
      archived: [],
      getSettings: (chatId) => {
        const state = get();
        const global = state.settings[GLOBAL_CHAT_SETTINGS_KEY];
        const specific = state.settings[chatId];
        // Merge: defaults < global < chat-specific
        return { ...DEFAULT_SETTINGS, ...global, ...specific };
      },
      updateSettings: (chatId, updates) => set((s) => ({ settings: { ...s.settings, [chatId]: { ...DEFAULT_SETTINGS, ...s.settings[chatId], ...updates } } })),
      archiveChat: (chatId) => set((s) => ({ archived: [...s.archived.filter(id => id !== chatId), chatId] })),
      unarchiveChat: (chatId) => set((s) => ({ archived: s.archived.filter(id => id !== chatId) })),
      isArchived: (chatId) => get().archived.includes(chatId),
    }),
    { name: 'chat-settings', storage: createJSONStorage(() => storage) }
  )
);
