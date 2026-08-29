import { create } from 'zustand';
import { ChatMessage as Message, Conversation } from '../types';
import { bumpPreviewFromTranscript } from './conversationPreviewStore';
import { useChatUnread } from './chatUnreadStore';

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
 * Is `candidate` already present in `list`, under either of its two identities?
 *
 * A message can be known by its stable local id (`m-<ts>` for an optimistic send) and
 * by the server's uuid. Two copies of the same logical message may therefore arrive
 * with the ids swapped between the `id` and `serverId` fields depending on which path
 * produced them, so every combination is checked:
 *
 *   local.id       === candidate.id
 *   local.serverId === candidate.id          (echo arrives keyed by the server uuid)
 *   local.id       === candidate.serverId    (cache copy keyed by the local id)
 *   local.serverId === candidate.serverId    (two server-keyed copies)
 *
 * Exported for tests: this predicate is the whole defence against duplicated
 * messages, and it is easy to break silently.
 */
export function isSameMessage(list: Message[], candidate: Message): boolean {
  const id = candidate.id;
  const serverId = candidate.serverId;
  for (const m of list) {
    if (m.id === id) return true;
    if (m.serverId && m.serverId === id) return true;
    if (serverId) {
      if (m.id === serverId) return true;
      if (m.serverId && m.serverId === serverId) return true;
    }
  }
  return false;
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
      // ── A WRITE THAT CHANGES NOTHING MUST NOT CHANGE IDENTITY ────────────────
      //
      // Measured in `chat/[id]`, from one snapshot, inside 430 ms:
      //
      //   chat.reverse(120) @265879
      //   chat.reverse(120) @265994   <- same count, 115 ms later
      //   chat.reverse(180) @266152   <- +60, the full-history hydration
      //   chat.reverse(179) @266309   <- -1, the optimistic row deduped
      //   -> long task 386 ms, pendingDecodes 0
      //
      // Four full re-derivations for one user action, each followed by a long task on a
      // pure-JS frame. The derivations themselves cost 0-1 ms; what costs is what happens
      // downstream of a new array identity — the screen re-renders and FlashList reconciles
      // a 179-row list.
      //
      // The `120 -> 120` pair is the provable waste: identical length, so at least one of
      // those writes moved no data. It still allocated a fresh array, which is all a
      // subscriber needs to see in order to re-render everything.
      //
      // WHY REFERENCE EQUALITY AND NOT A FIELD COMPARISON
      //
      // Comparing chosen fields (id, text, imageUrls...) would catch more cases, and it
      // would also be a silent-staleness hazard: any field left out of the comparison
      // becomes a change the UI refuses to show. Element-wise reference equality cannot
      // have that failure mode. Every mutation path here builds new message objects rather
      // than mutating them, so different content ALWAYS means a different reference — this
      // can only ever skip writes that were genuinely redundant.
      //
      // It therefore may not catch a redundant write whose objects were rebuilt (e.g. a
      // re-heal that `.map()`s over the same data). That is deliberate: if the next
      // snapshot still shows a duplicate pair, the answer is to stop that path rebuilding
      // identical objects, not to loosen this comparison.
      const prev = state.messages[conversationId];
      if (prev && prev.length === messages.length) {
        let identical = true;
        for (let i = 0; i < prev.length; i++) {
          if (prev[i] !== messages[i]) { identical = false; break; }
        }
        // `messages` untouched, so every selector reading this slice keeps its reference and
        // nothing re-renders. The preview bump and MRU touch below are skipped too: with no
        // data change the preview would be recomputed to the value it already holds, and the
        // MRU order cannot be affected by a write that did not happen.
        if (identical) return state;
      }
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
      // ── Dedupe on EITHER identity ──────────────────────────────────────────
      //
      // The universal safety net against the chat duplication bug: an optimistic
      // send, a realtime echo, a history fetch and a cache merge can all try to add
      // the same logical message.
      //
      // A message now has up to TWO identities — the stable local `id` a row keeps
      // for its whole life, and the server's `serverId` (see the note on
      // `ChatMessage.serverId` for why the local id is no longer overwritten). So the
      // check has to consider both, in both directions: an incoming copy carrying the
      // server uuid as its `id` must collapse onto the local row that has that uuid
      // as its `serverId`, and vice versa.
      if (message?.id && isSameMessage(existing, message)) {
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
  markAsRead: (conversationId) => {
    // Clear the DERIVED count too, not just the field on the row.
    //
    // The `unreadCount` on a conversation row is rebuilt as 0 from the server on every list fetch —
    // the backend has no read state — so zeroing it here only holds until the next refresh. The
    // count that actually drives the row badge lives in `chatUnreadStore` (per-install, MMKV-backed,
    // fed by the realtime bridge). Clearing it here also advances that conversation's read
    // watermark, which is what stops the "at least one new message" reconcile from immediately
    // re-raising a badge for the chat just read.
    try { useChatUnread.getState().clear(conversationId); } catch {}
    set((state) => {
      // ── A WRITE THAT CHANGES NOTHING MUST NOT CHANGE IDENTITY ────────────────
      //
      // `.map()` allocated a new `conversations` array UNCONDITIONALLY, even when the row was
      // already at 0 — which is the common case, because this fires on every chat open and the
      // count was usually cleared the last time. Three container subscriptions on
      // `(tabs)/messages.tsx` read this array, so every chat open re-rendered the chat list and
      // re-ran its preview Map build for a value that did not move.
      //
      // Same guard, same reasoning as `setMessages` above and `bumpConversationPreview` below,
      // which both already return the untouched state/array when nothing changed. This was the
      // one write in the store that did not.
      const idx = state.conversations.findIndex((c) => c.id === conversationId);
      if (idx === -1) return state;
      if (!state.conversations[idx].unreadCount) return state;
      const conversations = state.conversations.slice();
      conversations[idx] = { ...conversations[idx], unreadCount: 0 };
      return { conversations };
    });
  },
  setLoading: (isLoading) => set({ isLoading }),
}));
