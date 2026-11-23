/**
 * Session state for the chat screen's history poll, plus a head start for chats opened from a
 * notification.
 *
 * ── WHY A CHAT OPENED FROM A NOTIFICATION SHOWED ITS NEW MESSAGES LATE ───────────────────────────
 *
 * Reported: tap a push (or the in-app banner) and the chat opens without the new messages, which
 * then pop in a couple of seconds later.
 *
 * Measured on the Android emulator, from the tap's `router.push`:
 *
 *     783 ms  the history request starts (after the slide ends and `runAfterInteractions`)
 *     955 ms  its answer lands (172 ms on a warm connection; 768 ms on the first request after a
 *             cold start)
 *
 * A message that arrived while the app was in the background is only on the server, so until that
 * answer the transcript cannot have it. Two more cases made it worse:
 *
 *   - Reopening a chat less than a minute after its last answer skipped the request entirely when
 *     realtime reported `connected`. After a stay in the background that state is stale (iOS
 *     suspends the socket; Ably notices only when it next tries), so the skip dropped exactly the
 *     request that would have found the new message.
 *   - With the chat itself on screen, tapping its push does not navigate, and nothing refetched on
 *     return to the foreground: the message waited for realtime to reconnect and replay it.
 *
 * So: a notification tap starts the request itself, before navigating, and the screen consumes
 * that answer instead of asking again (the network runs during the slide instead of after it); the
 * fresh-reopen skip does not apply across a stay in the background; and the screen refetches when
 * the app returns to the foreground (see the poll effect in app/chat/[id].tsx).
 */
import { AppState } from 'react-native';

/** The poll's page size; the delete detection in the chat screen compares a page's length to it. */
export const CHAT_HISTORY_PAGE_LIMIT = 200;

/**
 * The history poll's server watermark per conversation, for this app session.
 *
 * The cursor used to be a local of the poll effect, so every open of a chat started from nothing
 * and its first tick re-read a full 200-row page: a network round trip plus a parse, map, prune and
 * merge measured at 167-193 ms on the JS thread, about a second after the chat appeared, on every
 * open. The first open of a session still reads the full page (it is the only one that can notice
 * messages deleted on another device); reopening the chat later in the session resumes from here
 * and an idle reopen transfers an empty array.
 */
export const historyCursorByConv = new Map<string, string>();

/**
 * When the history poll last got an answer for each conversation, this session. Closing a chat and
 * opening it again a few seconds later used to cost a fetch on every open; with realtime connected
 * everything since then has already arrived live, so a recent answer is skipped. See the poll effect.
 */
export const historyFetchedAtByConv = new Map<string, number>();

let lastBackgroundAt = 0;
try {
  AppState.addEventListener('change', (next) => {
    if (next === 'background') lastBackgroundAt = Date.now();
  });
} catch {
  // No AppState (tests): every answer counts as after the last background, as before.
}

/** When the app last went to the background this session (0 if it has not). */
export function lastBackgroundedAt(): number {
  return lastBackgroundAt;
}

type Page = { messages: any[]; error: string | null };

interface Pending {
  since: string | null;
  at: number;
  promise: Promise<Page>;
}

const pending = new Map<string, Pending>();
/** A head start nobody claimed within this long is dropped rather than shown stale. */
const PREFETCH_MAX_AGE_MS = 15_000;

/**
 * Start `conversationId`'s history request now, for a chat about to be opened from a notification.
 * The request is the one the chat screen would make first (same cursor, same page size), so the
 * screen can use its answer as is. Idempotent while one is in flight.
 */
export function prefetchChatHistory(conversationId: string): void {
  if (!conversationId) return;
  const now = Date.now();
  const current = pending.get(conversationId);
  if (current && now - current.at < PREFETCH_MAX_AGE_MS) return;
  const since = historyCursorByConv.get(conversationId) ?? null;
  const promise: Promise<Page> = import('../lib/supabase')
    .then(({ getMessages }) =>
      getMessages(conversationId, { limit: CHAT_HISTORY_PAGE_LIMIT, ...(since ? { since } : {}) }),
    )
    .catch(() => ({ messages: [], error: 'prefetch_failed' }));
  pending.set(conversationId, { since, at: now, promise });
}

/** Whether a head start is waiting for `conversationId`. */
export function hasChatHistoryPrefetch(conversationId: string): boolean {
  const p = pending.get(conversationId);
  return !!p && Date.now() - p.at < PREFETCH_MAX_AGE_MS;
}

/**
 * The head start for `conversationId`, if there is one made with the same cursor the caller is
 * about to use. Consumed: a second call returns null and the caller fetches normally.
 */
export function takeChatHistoryPrefetch(conversationId: string, since: string | null): Promise<Page> | null {
  const p = pending.get(conversationId);
  if (!p) return null;
  pending.delete(conversationId);
  if (Date.now() - p.at >= PREFETCH_MAX_AGE_MS) return null;
  if (p.since !== since) return null;
  return p.promise;
}
