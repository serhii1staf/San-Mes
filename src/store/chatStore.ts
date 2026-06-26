import { create } from 'zustand';
import { ChatMessage as Message, Conversation } from '../types';

export type { ChatMessage as Message, Conversation } from '../types';

interface ChatStoreState {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  isLoading: boolean;
  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (conversationId: string, message: Message) => void;
  markAsRead: (conversationId: string) => void;
  setLoading: (loading: boolean) => void;
}

/**
 * Maximum number of whole conversations whose full message arrays are retained
 * in the in-memory `messages` map at once. This is a MAP-level cap (conversation
 * count), NOT an array-level cap — individual conversation arrays are never
 * truncated, so scroll-up / reply-jump / search over the OPEN conversation's
 * full history keep working. Evicted conversations are safely re-seeded from the
 * on-disk `chat_tail` / `chat_messages` cache when reopened.
 */
const MAX_CACHED_CONVERSATIONS = 8;

/**
 * Module-level LRU access-order tracker, kept OUTSIDE the zustand state so it
 * never triggers re-renders. Ordered most-recently-used LAST. We only ever store
 * conversation ids that currently exist (or are being added to) the map.
 */
let accessOrder: string[] = [];

/** Mark a conversation id as most-recently-used in the access-order tracker. */
function touch(conversationId: string): void {
  const idx = accessOrder.indexOf(conversationId);
  if (idx !== -1) accessOrder.splice(idx, 1);
  accessOrder.push(conversationId);
}

/**
 * Apply LRU eviction to a freshly-updated `messages` map. Deletes whole
 * conversation ENTRIES (never truncates arrays) until the number of retained
 * conversations is within `MAX_CACHED_CONVERSATIONS`. The just-touched
 * conversation (`keepId`, the active/open one) is never evicted in this call.
 * Returns the same map reference if nothing was evicted, otherwise a new map.
 */
function evictIfNeeded(
  messages: Record<string, Message[]>,
  keepId: string
): Record<string, Message[]> {
  const keys = Object.keys(messages);
  if (keys.length <= MAX_CACHED_CONVERSATIONS) {
    return messages;
  }

  // Reconcile the tracker with the actual map keys: drop stale ids (e.g. the map
  // was reset to {} by switchAccount) and ensure every live key is represented.
  const liveKeys = new Set(keys);
  accessOrder = accessOrder.filter((id) => liveKeys.has(id));
  for (const id of keys) {
    if (accessOrder.indexOf(id) === -1) {
      // Unknown key (never touched here) — treat as least-recently-used.
      accessOrder.unshift(id);
    }
  }

  const next = { ...messages };
  // Evict from the front (least-recently-used) until within the cap, never
  // touching the active conversation.
  let i = 0;
  while (Object.keys(next).length > MAX_CACHED_CONVERSATIONS && i < accessOrder.length) {
    const candidate = accessOrder[i];
    if (candidate !== keepId && next[candidate] !== undefined) {
      delete next[candidate];
    }
    i++;
  }
  // Re-sync the tracker to the surviving keys.
  const survivors = new Set(Object.keys(next));
  accessOrder = accessOrder.filter((id) => survivors.has(id));
  return next;
}

export const useChatStore = create<ChatStoreState>()((set) => ({
  conversations: [],
  messages: {},
  isLoading: false,
  setConversations: (conversations) => set({ conversations }),
  addConversation: (conversation) =>
    set((state) => ({ conversations: [conversation, ...state.conversations] })),
  setMessages: (conversationId, messages) =>
    set((state) => {
      // Apply the update first, then mark MRU + evict whole least-recently-used
      // conversation entries from the map (arrays are never truncated).
      touch(conversationId);
      const updated = { ...state.messages, [conversationId]: messages };
      return { messages: evictIfNeeded(updated, conversationId) };
    }),
  addMessage: (conversationId, message) =>
    set((state) => {
      const existing = state.messages[conversationId] || [];
      // Dedup by id: never append a message whose id is already present.
      // This is the universal safety net against the chat duplication bug —
      // optimistic send, realtime echo, canonical-id reconcile re-keying and
      // cache merges can all try to add the same logical message. The send
      // path reconciles the optimistic client id (`m-<ts>`) to the server's
      // uuid so the server copy and the optimistic copy share an id and
      // collapse here instead of rendering twice.
      if (message?.id && existing.some((m) => m.id === message.id)) {
        return state;
      }
      // Apply the update first, then mark MRU + evict whole least-recently-used
      // conversation entries from the map (arrays are never truncated).
      touch(conversationId);
      const updated = {
        ...state.messages,
        [conversationId]: [...existing, message],
      };
      return { messages: evictIfNeeded(updated, conversationId) };
    }),
  markAsRead: (conversationId) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c
      ),
    })),
  setLoading: (isLoading) => set({ isLoading }),
}));
