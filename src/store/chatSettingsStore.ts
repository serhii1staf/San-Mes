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
  // Telegram-style floating "scroll-to-bottom" affordance. Defaults
  // to true. When the user has scrolled away from the newest message
  // (inverted FlatList contentOffset.y > a small threshold) the chat
  // screen renders a small button just above the input bar that
  // scrolls the list back to offset 0 on tap. Per-chat so a power
  // user can hide it on a noisy chat where they always read top-down.
  scrollToBottomButton: boolean;
}

// Special key for global/default chat settings (applies to all chats without their own overrides)
export const GLOBAL_CHAT_SETTINGS_KEY = '__global__';

interface ChatSettingsStore {
  settings: Record<string, ChatSettings>; // keyed by chatId (or GLOBAL key)
  archived: string[]; // archived chat IDs
  blocked: string[]; // blocked chat IDs
  deleted: string[]; // deleted chat IDs
  // Last time the user OPENED each chat (ISO string), keyed by chatId. The
  // messages list sorts by max(lastMessageAt, openedAt) so opening a chat
  // floats it to the top "по активности" even if no new message arrived. Kept
  // SEPARATE from the conversation's lastMessageAt (which a sync overwrites
  // with the real last-message time) so the open-bump survives reconciliation.
  openedAt: Record<string, string>;
  /**
   * Chats the user pinned to the top of the list, in pin order.
   *
   * UNLIKE `archived`/`blocked`/`deleted` this is NOT mutually exclusive with them: a
   * chat is in exactly one bucket, but it can be pinned in whichever bucket it sits in.
   * The three bucket setters deliberately do not clear it.
   */
  pinned: string[];
  /**
   * The user's manual ordering, most-recent-first, for chats they have dragged.
   *
   * Sparse on purpose. A chat that has never been dragged is absent, and absent chats
   * keep sorting by activity after the arranged ones. Storing a full ordering instead
   * would mean every new conversation had to be inserted somewhere, and any chat the
   * user has not touched would stop floating on new messages — which is the behaviour
   * they already have and did not ask to lose.
   */
  order: string[];
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
  /** Stamp `chatId` as opened right now so it floats to the top of the list. */
  markChatOpened: (chatId: string) => void;
  pinChat: (chatId: string) => void;
  unpinChat: (chatId: string) => void;
  isPinned: (chatId: string) => boolean;
  /** Pin when unpinned, unpin when pinned. */
  togglePinChat: (chatId: string) => void;
  /**
   * Replace the manual ordering with `ids`, in the order given.
   *
   * The caller passes the ids it actually rearranged (the currently visible list), so
   * ids for other buckets that were already arranged are preserved by merging: anything
   * in the previous order that is not in `ids` keeps its relative position after them.
   */
  setChatOrder: (ids: string[]) => void;
}

const DEFAULT_SETTINGS: ChatSettings = { fontSize: 15, fontFamily: 'system', bubbleRadius: 18, scrollToBottomButton: true };

// Exported for components that merge settings manually (e.g. with useMemo)
export const DEFAULT_CHAT_SETTINGS = DEFAULT_SETTINGS;

export const useChatSettingsStore = create<ChatSettingsStore>()(
  persist(
    (set, get) => ({
      settings: {},
      archived: [],
      blocked: [],
      deleted: [],
      openedAt: {},
      pinned: [],
      order: [],
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
      markChatOpened: (chatId) => set((s) => ({ openedAt: { ...s.openedAt, [chatId]: new Date().toISOString() } })),
      // Pin: dedupe-then-append, matching the bucket setters' idiom. Note the absence of
      // any `archived`/`blocked`/`deleted` clearing — pinning is orthogonal to buckets.
      pinChat: (chatId) => set((s) => (s.pinned.includes(chatId) ? s : { pinned: [...s.pinned, chatId] })),
      unpinChat: (chatId) => set((s) => (s.pinned.includes(chatId) ? { pinned: s.pinned.filter((id) => id !== chatId) } : s)),
      isPinned: (chatId) => get().pinned.includes(chatId),
      togglePinChat: (chatId) => set((s) => (
        s.pinned.includes(chatId)
          ? { pinned: s.pinned.filter((id) => id !== chatId) }
          : { pinned: [...s.pinned, chatId] }
      )),
      // Merge rather than replace: `ids` is only the bucket the user was looking at, so
      // an arrangement made in Chats must not be wiped by a later drag in Archive.
      setChatOrder: (ids) => set((s) => {
        const incoming = new Set(ids);
        const kept = s.order.filter((id) => !incoming.has(id));
        return { order: [...ids, ...kept] };
      }),
    }),
    { name: 'chat-settings', storage: createJSONStorage(() => storage) }
  )
);
