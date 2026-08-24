import { create } from 'zustand';
import { kvGetJSONSync, kvSetJSON } from '../services/kvStore';
import { isActiveThread } from '../services/activeThread';

/**
 * Per-conversation unread counts — the thing that makes the badge on a chat-list row appear.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Reported repeatedly: "when someone writes to me, no indicator shows up on the right side of the
 * chat list row."
 *
 * The badge was never missing from the UI. app/(tabs)/messages.tsx has rendered it all along — it
 * bolds the row's name and preview when `item.unreadCount > 0`, draws a count pill, and already
 * arranges the pill so it coexists with the pin icon instead of fighting it.
 *
 * What was missing was a number. Conversations are built from the server with `unreadCount: 0`
 * hardcoded (two places in that screen), and a repo-wide search for `unread`, `last_read` or
 * `read_at` in workers/api/src returns NOTHING: the backend has no concept of read state at all.
 * The only other reference in the client sets the count back to 0 when a chat is opened. So the
 * condition `item.unreadCount > 0` was being evaluated against a constant zero forever. Complete
 * UI, no data.
 *
 * ── WHY THIS IS CLIENT-SIDE ─────────────────────────────────────────────────
 *
 * The server-side version is the better one: a `last_read_at` per (conversation, user) in D1, with
 * the Worker returning a real count that is correct on a fresh install and consistent across
 * devices. It needs a D1 migration, and the Cloudflare token available to me is rejected for D1
 * (code 7403), so migrations cannot be applied — two are already queued and unapplied for the same
 * reason.
 *
 * Rather than leave the feature broken a fourth time, this derives unread on the device. It ships
 * over OTA, needs no schema, and is honest about its limits (below). When D1 access exists, the
 * Worker becomes the source of truth and this becomes a cache.
 *
 * ── WHAT COUNTS AS READ ─────────────────────────────────────────────────────
 *
 * Reuses `isActiveThread('chat', id)` — the register that already decides whether to suppress a
 * push for the thread on screen. If a message arrives for the chat you are looking at, the push is
 * suppressed AND it must not count as unread; those are the same judgement, so they read the same
 * source rather than drifting apart.
 *
 * ── LIMITS, STATED PLAINLY ──────────────────────────────────────────────────
 *
 *   • A device only counts what it observed. Messages that land while the app is killed produce no
 *     realtime event, so the exact count can under-report. `reconcile` covers the common case: if
 *     a conversation's newest message is newer than our read watermark and the count is 0, show 1.
 *     "At least one new message" is right even when "exactly four" is not.
 *   • Counts are per install, not per account-on-device — the MMKV namespace is already
 *     per-account, so switching accounts does not mix them up.
 */

const COUNTS_KEY = '@san:chat:unreadCounts';
const READ_AT_KEY = '@san:chat:readAt';

type CountMap = Record<string, number>;
type ReadAtMap = Record<string, number>;

/** Cap per conversation. Beyond this the number stops carrying information, and the pill's width
 *  starts changing the row's layout. The UI renders 99+ above this. */
const MAX_COUNT = 999;

interface ChatUnreadState {
  /** conversationId → number of messages received since it was last read. */
  counts: CountMap;
  /** conversationId → epoch ms when we last considered it read. Survives restarts, which is what
   *  lets `reconcile` tell "new since you last looked" from "old and already seen". */
  readAt: ReadAtMap;

  /**
   * A message arrived. No-op when the conversation is the thread on screen, so reading a chat live
   * never accumulates a count you then have to clear.
   */
  bump: (conversationId: string) => void;

  /** The conversation was opened/read. Clears its count and moves its watermark to now. */
  clear: (conversationId: string) => void;

  /**
   * Fill in counts for conversations whose newest message is newer than our watermark but which we
   * never saw an event for — the app-was-closed case. Only ever raises a 0 to a 1; never overwrites
   * a real observed count, and never invents unread for a message the user sent.
   *
   * Safe to call on every chat-list render pass: it returns the SAME state object when nothing
   * changed, so it cannot loop a subscriber.
   */
  reconcile: (
    rows: ReadonlyArray<{ id: string; lastMessageAt?: string; participantId?: string; lastSenderId?: string }>,
    myUserId: string | undefined,
  ) => void;
}

/** MMKV writes are cheap but not free; this is called on every arriving message. */
function persist(counts: CountMap, readAt: ReadAtMap): void {
  try {
    kvSetJSON(COUNTS_KEY, counts);
    kvSetJSON(READ_AT_KEY, readAt);
  } catch {}
}

export const useChatUnread = create<ChatUnreadState>((set, get) => ({
  counts: kvGetJSONSync<CountMap>(COUNTS_KEY, {}) || {},
  readAt: kvGetJSONSync<ReadAtMap>(READ_AT_KEY, {}) || {},

  bump: (conversationId) => {
    if (!conversationId) return;
    // The thread on screen is being read as it arrives.
    if (isActiveThread('chat', conversationId)) return;
    const { counts, readAt } = get();
    const next = Math.min((counts[conversationId] || 0) + 1, MAX_COUNT);
    if (next === counts[conversationId]) return;
    const nextCounts = { ...counts, [conversationId]: next };
    set({ counts: nextCounts });
    persist(nextCounts, readAt);
  },

  clear: (conversationId) => {
    if (!conversationId) return;
    const { counts, readAt } = get();
    const had = (counts[conversationId] || 0) > 0;
    const nextReadAt = { ...readAt, [conversationId]: Date.now() };
    // Always advance the watermark even when the count was already 0 — that is what stops
    // `reconcile` from re-raising a 1 for a conversation the user just read.
    if (!had) {
      set({ readAt: nextReadAt });
      persist(counts, nextReadAt);
      return;
    }
    const nextCounts = { ...counts };
    delete nextCounts[conversationId];
    set({ counts: nextCounts, readAt: nextReadAt });
    persist(nextCounts, nextReadAt);
  },

  reconcile: (rows, myUserId) => {
    const { counts, readAt } = get();
    let changed = false;
    const nextCounts = { ...counts };
    for (const r of rows) {
      if (!r?.id || !r.lastMessageAt) continue;
      if ((counts[r.id] || 0) > 0) continue; // already have an observed count, trust it
      // ── NEVER RAISE A BADGE FOR OUR OWN MESSAGE ─────────────────────────────
      //
      // This used to read `r.participantId === myUserId`, which cannot ever be true:
      // `participantId` is the PEER on a one-to-one row, never the signed-in user. So the guard was
      // dead code and the comment above it was a lie.
      //
      // What then let a self-sent message through: `lastMessageAt` carries the SERVER's timestamp,
      // and the read watermark is stamped from the LOCAL clock when the message is sent. If the
      // server's is even a second later — clock skew, or simply the row being created after the tap —
      // then `last > seen` and the reconcile raises a 1 for a message the user just typed. Reported
      // three times as "I write to someone and immediately get an unread indicator myself".
      //
      // `lastSenderId` is recorded on the row by the realtime bridge, on the same ping that sets
      // `lastMessageAt`, so the two describe the same message. Comparing THAT against the signed-in
      // id is the check the old line was trying and failing to be.
      if (myUserId && r.lastSenderId && r.lastSenderId === myUserId) continue;
      const last = Date.parse(r.lastMessageAt);
      if (!Number.isFinite(last)) continue;
      const seen = readAt[r.id] || 0;
      // No watermark at all means we have never opened this conversation on this install. Its
      // newest message is genuinely unread from this device's point of view.
      if (last > seen) {
        nextCounts[r.id] = 1;
        changed = true;
      }
    }
    if (!changed) return; // same object back — subscribers do not re-render
    set({ counts: nextCounts });
    persist(nextCounts, readAt);
  },
}));

/**
 * Total across conversations — for the messages tab badge, so it can show real message counts
 * rather than the notifications-feed count it uses today.
 */
export function totalChatUnread(counts: CountMap): number {
  let n = 0;
  for (const k in counts) n += counts[k] || 0;
  return n;
}
