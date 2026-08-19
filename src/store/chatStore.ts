import { create } from 'zustand';
import { ChatMessage as Message, Conversation } from '../types';
import { bumpPreviewFromTranscript } from './conversationPreviewStore';

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
 * Return `conversations` with the matching row's preview advanced to `message`,
 * or the SAME array reference when nothing changed.
 *
 * Returning the identical reference matters: the chat list subscribes to
 * `conversations`, so allocating a new array on every message would re-render the
 * whole list even when no row's content moved.
 *
 * Rules:
 *  - Unknown conversation id → no-op. A brand-new chat is added by its own flow;
 *    inventing a row here would produce one with no participant data.
 *  - Older or same-age message → no-op, so a late realtime echo or a merge of
 *    older cached history can never drag the preview backwards.
 *  - Empty text (a photo-only message) still updates the TIMESTAMP, so recency
 *    sorting stays right, and leaves the text empty for the row to render its own
 *    fallback — presentation and i18n stay out of the store.
 */
function bumpConversationPreview(
  conversations: Conversation[],
  conversationId: string,
  message: Message,
): Conversation[] {
  const at = message?.createdAt;
  if (!conversationId || !at) return conversations;

  const idx = conversations.findIndex((c) => c.id === conversationId);
  if (idx === -1) return conversations;

  const current = conversations[idx];
  // ISO-8601 strings compare lexicographically in chronological order.
  if (current.lastMessageAt && current.lastMessageAt >= at) return conversations;

  const next = conversations.slice();
  next[idx] = { ...current, lastMessage: message.text || '', lastMessageAt: at };
  return next;
}

/**
 * Per-conversation ARRAY-level cap on the number of messages retained in memory.
 * Matches the chat screen's on-disk MAX_PERSISTED_MESSAGES (1000) so a long-lived,
 * very active chat (realtime echoes + sends appending via `addMessage`) cannot
 * grow its in-memory array unboundedly. Messages are stored oldest→newest, so we
 * keep the LAST `MAX_MEMORY_MESSAGES` (the newest) and slice the oldest off the
 * front. Scroll-up into older history is unaffected: the chat screen re-hydrates
 * older messages from disk on demand (disk is bounded at the same 1000), so this
 * cap loses nothing the disk doesn't already bound.
 */
const MAX_MEMORY_MESSAGES = 1000;

/**
 * Return an array capped to the newest `MAX_MEMORY_MESSAGES` entries. No-op (same
 * reference, no allocation) when the array is within the cap.
 */
function capMessages(arr: Message[]): Message[] {
  if (arr.length <= MAX_MEMORY_MESSAGES) return arr;
  return arr.slice(arr.length - MAX_MEMORY_MESSAGES);
}

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
      // Persist the newest message as the conversation's durable preview. This is
      // the cache re-seed path (opening a chat hydrates its tail from MMKV), so
      // doing it here is what BACKFILLS previews for conversations that predate the
      // preview store — and what keeps them correct across a cold start, where
      // `messages` itself is empty until a chat is opened.
      bumpPreviewFromTranscript(conversationId, messages);
      // Apply the update first, then mark MRU + evict whole least-recently-used
      // conversation entries from the map (arrays are never truncated).
      touch(conversationId);
      // Cap the per-conversation array to the newest MAX_MEMORY_MESSAGES in case
      // an over-cap array is passed in (no-op when within the cap).
      const updated = { ...state.messages, [conversationId]: capMessages(messages) };
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
      // Append first, then cap the array to the newest MAX_MEMORY_MESSAGES. The
      // cap runs AFTER the id-dedupe guard above so deduping is never affected;
      // it only slices the OLDEST entries off the front when over the cap.
      const updated = {
        ...state.messages,
        [conversationId]: capMessages([...existing, message]),
      };

      // ── Keep the chat-list preview in step ────────────────────────────────
      //
      // `addMessage` is the single choke point every message addition flows
      // through — optimistic send, realtime echo, canonical-id reconcile, cache
      // merge — so updating the conversation row here means the list preview can
      // never drift from the transcript.
      //
      // It was not updated at all before, and `syncConversations` does not carry
      // `lastMessage` either, so the line under a contact's name only ever
      // changed when a whole conversation object happened to be replaced. That is
      // the "I send a message and the preview doesn't appear / disappears again"
      // report: there was no local write, and the next sync overwrote the row
      // with a preview-less copy.
      //
      // Guarded by timestamp so an out-of-order arrival (a late realtime echo, a
      // cache merge of older history) can never move the preview BACKWARDS.
      const conversations = bumpConversationPreview(state.conversations, conversationId, message);

      // ── And in the DURABLE preview store ──────────────────────────────────
      //
      // The row above only lives as long as this session's `conversations` array,
      // and the list also derives previews from the transcripts in this store — both
      // of which are empty after a full app restart, because transcripts are only
      // re-seeded when a chat is opened. That is the "the last activity under the
      // name disappears after I restart the app" report, and the same blank
      // timestamp is why the header's active-today faces vanished too.
      //
      // `bump` is timestamp-guarded, so an out-of-order arrival cannot move the
      // preview backwards, and it writes through to MMKV (coalesced).
      bumpPreviewFromTranscript(conversationId, [message]);

      return { messages: evictIfNeeded(updated, conversationId), conversations };
    }),
  markAsRead: (conversationId) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c
      ),
    })),
  setLoading: (isLoading) => set({ isLoading }),
}));
