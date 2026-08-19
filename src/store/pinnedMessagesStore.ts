import { create } from 'zustand';
import { kvGetJSONSync, kvSetJSON } from '../services/kvStore';

/**
 * pinnedMessagesStore — pinned messages per conversation.
 *
 * ── MULTIPLE PINS ─────────────────────────────────────────────────────────────
 * A conversation can have MANY pinned messages, kept in pin order (oldest pin
 * first) so the bar can page through them predictably. The first version allowed
 * exactly one, which meant pinning a second message silently threw the first away.
 *
 * ── WHY A SEPARATE STORE ──────────────────────────────────────────────────────
 * A pin is a tiny, long-lived, per-conversation preference — not transcript data.
 * Putting it in `chatStore` would mean every pin/unpin allocates a new
 * `conversations` array (the chat list subscribes to it) and would tie the pin's
 * lifetime to the LRU that evicts message arrays: reopening a conversation whose
 * messages were evicted would silently drop the pins. Keeping them here means they
 * survive eviction, account switches (the kv layer namespaces per account) and app
 * restarts.
 *
 * ── PERSISTENCE ───────────────────────────────────────────────────────────────
 * Written through `kvStore`, which is synchronous when MMKV is available, so the
 * pinned bar is on screen in the FIRST render after a restart — no loading state,
 * no flash of an unpinned header. The whole map is a handful of ids, so writing it
 * wholesale on every change is cheaper than tracking dirty keys.
 *
 * Only message IDs are stored. Text is always resolved from the live transcript, so
 * a pinned message that was later edited shows its current text, and one that was
 * deleted resolves to nothing (see `resolvePinned`).
 */

const STORAGE_KEY = 'chat_pinned_messages';

/** conversationId → pinned messageIds, in pin order. */
type PinMap = Record<string, string[]>;

/**
 * Upper bound per conversation. Pins are a navigation aid, not storage: an
 * unbounded list would grow the persisted blob forever and make the bar useless.
 * Pinning past the cap drops the OLDEST pin, which is the least likely to still
 * matter.
 */
const MAX_PINS_PER_CONVERSATION = 20;

interface PinnedMessagesState {
  pinned: PinMap;
  /** Add `messageId` to the conversation's pins. No-op when already pinned. */
  pin: (conversationId: string, messageId: string) => void;
  /** Remove one pin. No-op when it is not pinned. */
  unpin: (conversationId: string, messageId: string) => void;
  /** Remove every pin in the conversation. */
  unpinAll: (conversationId: string) => void;
  /** Pin, or unpin when `messageId` is already pinned. */
  toggle: (conversationId: string, messageId: string) => void;
}

/** Stable empty array so selectors never hand out a fresh reference on a miss. */
const NO_PINS: string[] = [];

/**
 * Read the persisted map, discarding anything that is not a
 * `Record<string, string[]>` — a corrupted payload must degrade to "nothing
 * pinned", never crash the chat screen on mount.
 *
 * Also migrates the ORIGINAL single-pin shape (`Record<string, string>`) by
 * wrapping each value in an array, so anyone who pinned a message on the previous
 * build keeps it.
 */
function loadPinned(): PinMap {
  const raw = kvGetJSONSync<unknown>(STORAGE_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: PinMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v) {
      out[k] = [v];
    } else if (Array.isArray(v)) {
      const ids = v.filter((x): x is string => typeof x === 'string' && !!x);
      if (ids.length > 0) out[k] = ids.slice(0, MAX_PINS_PER_CONVERSATION);
    }
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
      const existing = state.pinned[conversationId] ?? NO_PINS;
      // Already pinned → return the SAME state object so no subscriber re-renders.
      if (existing.includes(messageId)) return state;
      const next = existing.concat(messageId);
      const pinned = {
        ...state.pinned,
        [conversationId]:
          next.length > MAX_PINS_PER_CONVERSATION
            ? next.slice(next.length - MAX_PINS_PER_CONVERSATION)
            : next,
      };
      persist(pinned);
      return { pinned };
    }),

  unpin: (conversationId, messageId) =>
    set((state) => {
      if (!conversationId || !messageId) return state;
      const existing = state.pinned[conversationId];
      if (!existing || !existing.includes(messageId)) return state;
      const next = existing.filter((idValue) => idValue !== messageId);
      const pinned = { ...state.pinned };
      if (next.length === 0) delete pinned[conversationId];
      else pinned[conversationId] = next;
      persist(pinned);
      return { pinned };
    }),

  unpinAll: (conversationId) =>
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
      const existing = state.pinned[conversationId] ?? NO_PINS;
      const pinned = { ...state.pinned };
      if (existing.includes(messageId)) {
        const next = existing.filter((idValue) => idValue !== messageId);
        if (next.length === 0) delete pinned[conversationId];
        else pinned[conversationId] = next;
      } else {
        const next = existing.concat(messageId);
        pinned[conversationId] =
          next.length > MAX_PINS_PER_CONVERSATION
            ? next.slice(next.length - MAX_PINS_PER_CONVERSATION)
            : next;
      }
      persist(pinned);
      return { pinned };
    }),
}));

/**
 * Selector factory for a conversation's pinned message ids.
 *
 * Returns the shared `NO_PINS` array on a miss rather than a fresh `[]`, so
 * zustand's reference equality never sees a spurious change and re-renders the
 * chat screen on every unrelated store update.
 */
export function selectPinnedIds(conversationId: string | undefined) {
  return (state: PinnedMessagesState): string[] =>
    (conversationId ? state.pinned[conversationId] : undefined) ?? NO_PINS;
}

/**
 * Resolve pinned ids against a transcript, in transcript order.
 *
 * Kept as a pure helper (rather than inside the store) because the transcript lives
 * in `chatStore` and pins must NOT go stale when a message is deleted: an id with no
 * matching message is skipped, which the UI renders as one fewer pin. The pin entry
 * itself is left alone — a message outside the bounded in-memory window can come
 * back when older history is hydrated, and dropping it on a transient miss would
 * lose it permanently.
 *
 * Ordered by position in the transcript, not by pin order, so paging through pins
 * moves the viewport in one direction instead of jumping around.
 */
export function resolvePinned<T extends { id: string }>(
  messages: T[] | undefined,
  pinnedIds: string[] | undefined,
): Array<{ message: T; index: number }> {
  if (!pinnedIds || pinnedIds.length === 0 || !messages || messages.length === 0) return [];
  const wanted = new Set(pinnedIds);
  const out: Array<{ message: T; index: number }> = [];
  for (let i = 0; i < messages.length; i++) {
    if (wanted.has(messages[i].id)) out.push({ message: messages[i], index: i });
  }
  return out;
}
