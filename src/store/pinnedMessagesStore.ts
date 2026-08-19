import { create } from 'zustand';
import { kvGetJSONSync, kvSetJSON } from '../services/kvStore';

/**
 * pinnedMessagesStore — one pinned message per conversation.
 *
 * ── WHY A SEPARATE STORE ──────────────────────────────────────────────────────
 * A pin is a tiny, long-lived, per-conversation preference — not transcript data.
 * Putting it in `chatStore` would mean every pin/unpin allocates a new
 * `conversations` array (the chat list subscribes to it) and would tie the pin's
 * lifetime to the LRU that evicts message arrays: reopening a conversation whose
 * messages were evicted would silently drop the pin. Keeping it here means the
 * pin survives eviction, account switches (the kv layer namespaces per account)
 * and app restarts.
 *
 * ── PERSISTENCE ───────────────────────────────────────────────────────────────
 * Written through `kvStore`, which is synchronous when MMKV is available, so the
 * pinned bar is on screen in the FIRST render after a restart — no loading state,
 * no flash of an unpinned header. The whole map is a handful of ids, so writing
 * it wholesale on every change is cheaper than tracking dirty keys.
 *
 * Only the message ID is stored. The message text is always resolved from the
 * live transcript, so a pinned message that was later edited shows its current
 * text, and one that was deleted resolves to nothing (see `selectPinnedMessage`).
 */

const STORAGE_KEY = 'chat_pinned_messages';

/** conversationId → pinned messageId */
type PinMap = Record<string, string>;

interface PinnedMessagesState {
  pinned: PinMap;
  /** Pin `messageId` in `conversationId`, replacing any existing pin there. */
  pin: (conversationId: string, messageId: string) => void;
  /** Remove the conversation's pin. No-op when nothing is pinned. */
  unpin: (conversationId: string) => void;
  /** Pin, or unpin when `messageId` is already the pinned one. */
  toggle: (conversationId: string, messageId: string) => void;
}

/**
 * Read the persisted map, discarding anything that is not a
 * `Record<string, string>` — a corrupted or older-shaped payload must degrade to
 * "nothing pinned", never crash the chat screen on mount.
 */
function loadPinned(): PinMap {
  const raw = kvGetJSONSync<unknown>(STORAGE_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: PinMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

function persist(pinned: PinMap): void {
  kvSetJSON(STORAGE_KEY, pinned);
}

export const usePinnedMessagesStore = create<PinnedMessagesState>()((set) => ({
  pinned: loadPinned(),

  pin: (conversationId, messageId) =>
    set((state) => {
      if (!conversationId || !messageId) return state;
      // Identical pin → return the SAME state object so no subscriber re-renders.
      if (state.pinned[conversationId] === messageId) return state;
      const pinned = { ...state.pinned, [conversationId]: messageId };
      persist(pinned);
      return { pinned };
    }),

  unpin: (conversationId) =>
    set((state) => {
      if (!conversationId || state.pinned[conversationId] === undefined) return state;
      const pinned = { ...state.pinned };
      delete pinned[conversationId];
      persist(pinned);
      return { pinned };
    }),

  toggle: (conversationId, messageId) =>
    set((state) => {
      if (!conversationId || !messageId) return state;
      const pinned = { ...state.pinned };
      if (pinned[conversationId] === messageId) {
        delete pinned[conversationId];
      } else {
        pinned[conversationId] = messageId;
      }
      persist(pinned);
      return { pinned };
    }),
}));

/**
 * Selector factory for a conversation's pinned message id.
 *
 * Returns `undefined` rather than `null` so it matches the map's own miss value
 * and zustand's shallow equality never sees a changed reference.
 */
export function selectPinnedId(conversationId: string | undefined) {
  return (state: PinnedMessagesState): string | undefined =>
    conversationId ? state.pinned[conversationId] : undefined;
}

/**
 * Resolve a pinned id against a transcript.
 *
 * Kept as a pure helper (rather than inside the store) because the transcript
 * lives in `chatStore` and the pin must NOT go stale when the message is deleted:
 * an id with no matching message resolves to `null`, which the UI renders as "no
 * pinned bar". The pin entry itself is left alone — a message removed from the
 * bounded in-memory window can come back when older history is hydrated, and
 * dropping the pin on a transient miss would lose it permanently.
 */
export function resolvePinned<T extends { id: string }>(
  messages: T[] | undefined,
  pinnedId: string | undefined,
): { message: T; index: number } | null {
  if (!pinnedId || !messages || messages.length === 0) return null;
  const index = messages.findIndex((m) => m.id === pinnedId);
  if (index === -1) return null;
  return { message: messages[index], index };
}
