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
  linkEmoji?: string; // decorative emoji shown faintly in link-preview containers (Telegram-style)
  // Decorative pixel-icon attached to outgoing reply messages from
  // this chat. Stable registry id from `PIXEL_ICON_BY_ID`. Read by
  // the chat input bar when composing a reply: if set, the id is
  // copied onto the new ChatMessage's `replyPixelIconId` so the
  // recipient (and the sender on re-render) can render the icon
  // alongside the existing reply text/image preview. Picked from
  // the pixel-icons screen launched with `?purpose=chat-reply&chatId=…`.
  replyPixelIcon?: string;
}

// Special key for global/default chat settings (applies to all chats without their own overrides)
export const GLOBAL_CHAT_SETTINGS_KEY = '__global__';

interface ChatSettingsStore {
  settings: Record<string, ChatSettings>; // keyed by chatId (or GLOBAL key)
  archived: string[]; // archived chat IDs
  blocked: string[]; // blocked chat IDs
  deleted: string[]; // deleted chat IDs
  getSettings: (chatId: string) => ChatSettings;
  updateSettings: (chatId: string, updates: Partial<ChatSettings>) => void;
  /**
   * Drop the entry under `chatId` so subsequent reads fall back to defaults
   * (or, for non-global ids, defaults+global). Used by the chat-settings
   * "Reset to defaults" affordance.
   */
  resetSettings: (chatId: string) => void;
  archiveChat: (chatId: string) => void;
  unarchiveChat: (chatId: string) => void;
  isArchived: (chatId: string) => boolean;
  blockChat: (chatId: string) => void;
  unblockChat: (chatId: string) => void;
  isBlocked: (chatId: string) => boolean;
  deleteChat: (chatId: string) => void;
  restoreChat: (chatId: string) => void;
  isDeleted: (chatId: string) => boolean;
}

const DEFAULT_SETTINGS: ChatSettings = { fontSize: 15, fontFamily: 'system', bubbleRadius: 18 };

// Exported for components that merge settings manually (e.g. with useMemo)
export const DEFAULT_CHAT_SETTINGS = DEFAULT_SETTINGS;

export const useChatSettingsStore = create<ChatSettingsStore>()(
  persist(
    (set, get) => ({
      settings: {},
      archived: [],
      blocked: [],
      deleted: [],
      getSettings: (chatId) => {
        const state = get();
        const global = state.settings[GLOBAL_CHAT_SETTINGS_KEY];
        const specific = state.settings[chatId];
        // Merge: defaults < global < chat-specific
        return { ...DEFAULT_SETTINGS, ...global, ...specific };
      },
      updateSettings: (chatId, updates) => set((s) => ({ settings: { ...s.settings, [chatId]: { ...DEFAULT_SETTINGS, ...s.settings[chatId], ...updates } } })),
      resetSettings: (chatId) => set((s) => {
        // Drop the chatId entry entirely so getSettings() falls back through
        // the merge chain (defaults < global < specific). For the global key
        // itself this resets the app-wide defaults to the hardcoded ones.
        if (!(chatId in s.settings)) return {} as Partial<ChatSettingsStore>;
        const next = { ...s.settings };
        delete next[chatId];
        return { settings: next };
      }),
      // Archive: a chat is in exactly one of: normal / archived / blocked / deleted
      archiveChat: (chatId) => set((s) => ({ archived: [...s.archived.filter(id => id !== chatId), chatId], blocked: s.blocked.filter(id => id !== chatId), deleted: s.deleted.filter(id => id !== chatId) })),
      unarchiveChat: (chatId) => set((s) => ({ archived: s.archived.filter(id => id !== chatId) })),
      isArchived: (chatId) => get().archived.includes(chatId),
      blockChat: (chatId) => set((s) => ({ blocked: [...s.blocked.filter(id => id !== chatId), chatId], archived: s.archived.filter(id => id !== chatId), deleted: s.deleted.filter(id => id !== chatId) })),
      unblockChat: (chatId) => set((s) => ({ blocked: s.blocked.filter(id => id !== chatId) })),
      isBlocked: (chatId) => get().blocked.includes(chatId),
      deleteChat: (chatId) => set((s) => ({ deleted: [...s.deleted.filter(id => id !== chatId), chatId], archived: s.archived.filter(id => id !== chatId), blocked: s.blocked.filter(id => id !== chatId) })),
      restoreChat: (chatId) => set((s) => ({ deleted: s.deleted.filter(id => id !== chatId) })),
      isDeleted: (chatId) => get().deleted.includes(chatId),
    }),
    { name: 'chat-settings', storage: createJSONStorage(() => storage) }
  )
);
