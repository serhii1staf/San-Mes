// Tell the server which messages the user has read.
//
// ── WHY THIS IS A SERVICE AND NOT A LINE INSIDE `chatUnreadStore.clear` ──────
//
// `clear` is called from four places in `app/chat/[id].tsx` — screen mount, return to foreground,
// screen leave, and message send — and each of them passes BOTH the resolved conversation id and the
// route id, because a chat opened from a profile carries the peer's user id in the route. Putting the
// network call inside `clear` would therefore POST a user id to a conversation endpoint on every chat
// open: a guaranteed 403 round-trip, every time, forever.
//
// It would also give a synchronous store mutator hidden I/O, which makes `clear` untestable without a
// network mock and surprising to read.
//
// So the store stays local and pure, and the screen calls this with the id it knows is a conversation.
//
// ── WHY THE SERVER NEEDS TO KNOW AT ALL ─────────────────────────────────────
//
// Before migration 0005 "read" was `Date.now()` in per-install MMKV. That has two failure modes the
// user reported as separate bugs:
//
//   * it does not travel. Read a chat on the phone, the tablet still shows it unread. Reinstall, and
//     every conversation is unread again, because the watermark went with the old install.
//   * it is on the wrong clock. A device-stamped watermark was compared against `messages.created_at`,
//     which the Worker stamps. Whichever way the skew fell decided whether an already-read message
//     counted as unread — and that is the skew a whole layer of author-guards in `reconcile` exists to
//     paper over.
//
// ── THROTTLED WITH A TRAILING SEND, NOT DEBOUNCED ───────────────────────────
//
// The four call sites can fire in quick succession (mount, then a send, then leave). A plain debounce
// would delay the most important one: the LEAVE call is what covers messages that arrived while the
// chat was on screen, which `bump` deliberately never counts because the thread is active. If the user
// backgrounds the app right after leaving, a pending debounce timer dies with the JS context and those
// messages come back as unread.
//
// So: send the first one immediately, suppress the next few, and always send one more after the window
// closes carrying the newest timestamp. Bounded traffic, and the last watermark always lands.

import { apiPost } from './apiClient';

/** Minimum gap between POSTs for the same conversation. */
const THROTTLE_MS = 3000;

/**
 * Cap on how many conversations we track timers for. A chat list can hold 500 rows, but read-marking
 * only happens for chats actually opened, so this is generous. Oldest entry is evicted rather than
 * letting two Maps grow for the life of the process.
 */
const MAX_TRACKED = 64;

const lastSentAt = new Map<string, number>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();

function evictIfNeeded(): void {
  if (lastSentAt.size <= MAX_TRACKED) return;
  // Map preserves insertion order, and entries are re-inserted on every send, so the first key is
  // the least recently used.
  const oldest = lastSentAt.keys().next();
  if (!oldest.done) lastSentAt.delete(oldest.value);
}

function send(conversationId: string): void {
  lastSentAt.delete(conversationId);
  lastSentAt.set(conversationId, Date.now());
  evictIfNeeded();
  // ── NO TIMESTAMP IN THE BODY, AND THAT IS THE POINT ────────────────────────
  //
  // This used to send `{ at: new Date().toISOString() }`. End-to-end verification against the live
  // database caught what that costs: the Android emulator's clock was 3h34m behind real time, so the
  // watermark was written three and a half hours into the past and every message from those hours
  // would have come back as unread on the next chat-list sync. That is the bug this whole feature
  // exists to fix, reproduced by the fix, on any device whose clock has drifted.
  //
  // The server stamps its own `now`, which is the same clock that writes `messages.created_at` — the
  // single-clock property that motivated moving read state off the device in the first place. The
  // device's opinion about what time it is has no place in it.
  //
  // Fire-and-forget. A failed read-sync must never surface to the user: the local watermark has
  // already zeroed the badge, so the visible state is right either way, and the next chat open
  // retries. `apiPost` resolves rather than throwing, so this cannot produce an unhandled rejection —
  // the catch is for a module-resolution failure only.
  void (async () => {
    try {
      await apiPost(`/v1/conversations/${encodeURIComponent(conversationId)}/read`);
    } catch {
      // best-effort
    }
  })();
}

/**
 * Record that the user has read `conversationId`, as of whenever the server processes the call.
 *
 * Safe to call from anywhere, as often as you like, in any order. The server refuses to move a
 * watermark backwards, so a late-arriving request cannot resurrect a badge.
 */
export function markConversationRead(conversationId: string): void {
  if (!conversationId) return;
  const now = Date.now();
  const last = lastSentAt.get(conversationId) || 0;

  if (now - last >= THROTTLE_MS) {
    // Outside the window. A queued trailing send is redundant now — this call covers it.
    const queued = pending.get(conversationId);
    if (queued) {
      clearTimeout(queued);
      pending.delete(conversationId);
    }
    send(conversationId);
    return;
  }

  // Inside the window. If a trailing send is already scheduled there is nothing to add: the server
  // stamps on receipt, so the queued call will carry a later time than this one would have.
  // Deliberately does NOT reset the timer — that would make it a debounce, and a chat receiving a
  // message every second would push the send out indefinitely.
  if (pending.has(conversationId)) return;

  const wait = Math.max(0, THROTTLE_MS - (now - last));
  const timer = setTimeout(() => {
    pending.delete(conversationId);
    send(conversationId);
  }, wait);
  pending.set(conversationId, timer);
}

/** Test seam: drop all throttle state and cancel pending timers. */
export function __resetReadStateForTests(): void {
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
  lastSentAt.clear();
}
