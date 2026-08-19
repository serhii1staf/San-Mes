import { create } from 'zustand';
import { kvGetJSONSync, kvSetJSON } from '../services/kvStore';

/**
 * conversationPreviewStore — the "last activity" line under each chat-list row, and
 * the timestamp the list sorts and the header's active-today faces are derived from.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
 * The preview was being derived from `chatStore.messages` — the newest message of
 * each conversation's transcript. That is correct while the app is running, and
 * wrong after a restart: transcripts are only re-seeded from disk when a chat is
 * OPENED, so on a cold start the map is empty. The row then fell back to
 * `Conversation.lastMessage` / `lastMessageAt`, which `syncConversations` does not
 * carry at all, so both were blank.
 *
 * Two reported symptoms, one cause:
 *   • "the last activity under the name disappears after I fully restart the app";
 *   • "the active-today faces in the header disappear after a restart" — those are
 *     selected by `lastMessageAt` being within 24 h, so a blank timestamp means no
 *     faces.
 *
 * So the preview is persisted in its own tiny store instead of being re-derived
 * from data that is not loaded yet.
 *
 * ── WHY NOT IN chatStore ──────────────────────────────────────────────────────
 * `chatStore.conversations` is subscribed to by the whole chat list, and its
 * `messages` map is under an LRU that evicts whole conversations. A preview must
 * outlive that eviction and must not force a list-wide re-render every time a
 * message lands. A separate store with its own selector keeps both properties.
 *
 * ── PERSISTENCE ───────────────────────────────────────────────────────────────
 * MMKV reads are synchronous, so the map is populated during module init and the
 * FIRST render after a restart already has every preview — no loading state, no
 * flash of blank rows. Writes are coalesced onto a microtask because a sync burst
 * can bump dozens of conversations in one tick and each write serialises the whole
 * (small) map.
 */

const STORAGE_KEY = 'chat_previews';

export interface ConversationPreview {
  /** Message text. Empty for an attachment-only message — the UI labels those. */
  text: string;
  /** ISO timestamp of the message. ISO strings compare lexicographically = chrono. */
  at: string;
  /** True when the message carried at least one image, so the UI can say "Photo". */
  hasImage: boolean;
}

type PreviewMap = Record<string, ConversationPreview>;

interface PreviewState {
  previews: PreviewMap;
  /**
   * Record `preview` as the conversation's latest activity.
   *
   * Ignored when it is not NEWER than what is already stored, so a late realtime
   * echo, a re-seed of older cached history, or a transcript hydrate cannot drag the
   * preview backwards.
   */
  bump: (conversationId: string, preview: ConversationPreview) => void;
  /** Drop a conversation's preview (used when a chat is deleted). */
  clear: (conversationId: string) => void;
}

/** Stable empty map so selectors never hand out a fresh object reference. */
const EMPTY_PREVIEWS: PreviewMap = {};

function loadPreviews(): PreviewMap {
  const raw = kvGetJSONSync<unknown>(STORAGE_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: PreviewMap = {};
  for (const [convId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    // `at` is the only load-bearing field (sort order + the 24 h active window), so
    // an entry without it is dropped rather than kept in a half-valid state.
    if (typeof v.at !== 'string' || !v.at) continue;
    out[convId] = {
      text: typeof v.text === 'string' ? v.text : '',
      at: v.at,
      hasImage: v.hasImage === true,
    };
  }
  return out;
}

// ── Coalesced persistence ────────────────────────────────────────────────────
// A single sync can bump many conversations in one tick. Writing per bump would
// serialise the whole map each time, so the write is deferred to the end of the
// current microtask queue and only the final state is written.
let flushScheduled = false;
function schedulePersist(getMap: () => PreviewMap): void {
  if (flushScheduled) return;
  flushScheduled = true;
  Promise.resolve().then(() => {
    flushScheduled = false;
    try {
      kvSetJSON(STORAGE_KEY, getMap());
    } catch {
      // Storage failures are never fatal here: the in-memory map is still correct
      // for this session, and the next bump will retry the write.
    }
  });
}

export const useConversationPreviewStore = create<PreviewState>()((set, get) => ({
  previews: loadPreviews(),

  bump: (conversationId, preview) =>
    set((state) => {
      if (!conversationId || !preview?.at) return state;
      const current = state.previews[conversationId];
      // Not newer → no-op, and return the SAME state object so nothing re-renders.
      if (current && current.at >= preview.at) return state;
      const previews = { ...state.previews, [conversationId]: preview };
      schedulePersist(() => get().previews);
      return { previews };
    }),

  clear: (conversationId) =>
    set((state) => {
      if (!conversationId || state.previews[conversationId] === undefined) return state;
      const previews = { ...state.previews };
      delete previews[conversationId];
      schedulePersist(() => get().previews);
      return { previews };
    }),
}));

/**
 * Record the newest message of a transcript as the conversation's preview.
 *
 * Exported as a plain function (not a hook) so the chat store can call it from
 * inside `addMessage` / `setMessages` — the choke points every message addition and
 * every cache re-seed flow through. Calling it from there is what makes the preview
 * correct on a cold start: opening a chat re-seeds its tail from MMKV, and that
 * re-seed now also writes the durable preview, so chats that predate this store
 * backfill themselves the first time they are opened.
 *
 * Takes the whole array and picks the tail itself (transcripts are oldest → newest)
 * so callers cannot get the direction wrong.
 */
export function bumpPreviewFromTranscript(
  conversationId: string,
  messages: Array<{ text?: string; createdAt?: string; imageUrls?: string[] }> | undefined,
): void {
  if (!conversationId || !messages || messages.length === 0) return;
  const last = messages[messages.length - 1];
  if (!last?.createdAt) return;
  useConversationPreviewStore.getState().bump(conversationId, {
    text: last.text || '',
    at: last.createdAt,
    hasImage: !!last.imageUrls && last.imageUrls.length > 0,
  });
}

/** Selector for the whole map. Stable reference while nothing changes. */
export function selectPreviews(state: PreviewState): PreviewMap {
  return state.previews ?? EMPTY_PREVIEWS;
}
