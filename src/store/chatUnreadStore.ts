import { create } from 'zustand';
import { kvGetJSONSync, kvSetJSON } from '../services/kvStore';
import { isActiveThread } from '../services/activeThread';
import { getCacheAccount } from '../services/cacheAccount';

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
 *     per-account.
 *
 * ── THE NAMESPACE CLAIM ABOVE USED TO SAY "so switching accounts does not mix them up" ──
 *
 * It was wrong, and it was destroying data on EVERY cold start — push or no push. Reported as:
 * "messages that arrive while the app is closed are not counted, and the counts I already had get
 * reset to 1."
 *
 * The namespace is per-account, but the READ happened before the namespace was set.
 *
 *   1. This module is imported statically (CustomTabBar, RealtimeAccountBridge, messages.tsx,
 *      chatStore), so its body runs during module evaluation.
 *   2. `kvGetJSONSync` -> `kvGetStringSync` -> `accountKey(base)` -> `@acc:${activeAccountId}:...`,
 *      and `activeAccountId` starts as the literal `'anon'` (src/services/cacheAccount.ts).
 *   3. `setCacheAccount(uid)` runs in `app/_layout.tsx`, inside a useEffect gated on font loading —
 *      strictly after all module evaluation.
 *
 * So both maps hydrated from `@acc:anon:...`, which is empty for any real user. Then `reconcile`
 * ran, and with empty maps every guard in it is disarmed at once: the `counts[r.id] > 0` skip never
 * trips, `readAt[r.id] || 0` is 0, so `last > seen` is true for every conversation — including ones
 * read months ago. Every row got exactly 1.
 *
 * And then `persist(nextCounts, readAt)` wrote BOTH keys, now under the corrected namespace, over
 * the real data. So the real counts were replaced by 1s and every read watermark was wiped, which
 * compounds on the next launch.
 *
 * ── THE FIX IS AN INVARIANT, NOT A REMEMBERED CALL ──────────────────────────
 *
 * `blockedUsersStore` solves the same problem with a `hydrate()` that callers must remember to call
 * after `setCacheAccount`. That works, and it is one forgotten call site away from breaking.
 *
 * Here the account the maps were read from is RECORDED, and every mutator checks it first
 * (`ensureAccount`). If the pointer has moved since, the maps are re-read before anything is
 * written. So `bump` / `clear` / `reconcile` cannot operate on another account's data — or on
 * `anon`'s — regardless of who called what. `rehydrate()` is still exported for the explicit
 * post-`setCacheAccount` call, because that is what re-seeds the OS badge promptly rather than on
 * the first message.
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

  /**
   * Re-read both maps from the ACTIVE account's namespace, unconditionally.
   *
   * Call right after `setCacheAccount(...)`. The mutators self-heal via `ensureAccount`, so this is
   * not required for correctness — it exists so the OS icon badge is seeded from the real counts at
   * launch instead of waiting for the first message or the first chat open.
   */
  rehydrate: () => void;
}

/** MMKV writes are cheap but not free; this is called on every arriving message. */
function persist(counts: CountMap, readAt: ReadAtMap): void {
  try {
    kvSetJSON(COUNTS_KEY, counts);
    kvSetJSON(READ_AT_KEY, readAt);
  } catch {}
  syncChatOsBadge(counts);
}

// ── UNREAD DMs BELONG ON THE APP ICON TOO ────────────────────────────────────
//
// `totalChatUnread` has existed at the bottom of this file since the badge shipped, but nothing ever
// forwarded it to the OS: `setOsBadgeCount` was called only from `notificationsBadgeStore`, whose count
// comes from the notifications feed, and that feed is declared `'like' | 'comment' | 'follow'`. Messages
// are simply not in it. So the icon showed likes and follows and stayed blank for unread messages, which
// is the case the icon badge was asked for in the first place.
//
// Hooked into `persist` rather than into each mutator: every path that changes `counts` already calls it
// with the authoritative next map — `bump`, both branches of `clear`, and `reconcile` — so a future
// mutator cannot forget the icon. The dedupe in `osBadge` absorbs the one call where `counts` is
// unchanged (`clear` on a conversation that was already at 0, which still advances the watermark).
//
// Lazy `require` rather than `await import` — see the note in osBadge.ts's `flush` for why the dynamic
// form is untestable under babel-jest while working fine on device.
function syncChatOsBadge(counts: CountMap): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { setChatBadgePart } = require('../services/osBadge') as typeof import('../services/osBadge');
    setChatBadgePart(totalChatUnread(counts));
  } catch {
    // Never let the icon badge break the in-app badges.
  }
}

/** Read both maps from whatever namespace is active right now. */
function readMaps(): { counts: CountMap; readAt: ReadAtMap } {
  return {
    counts: kvGetJSONSync<CountMap>(COUNTS_KEY, {}) || {},
    readAt: kvGetJSONSync<ReadAtMap>(READ_AT_KEY, {}) || {},
  };
}

/**
 * The account whose namespace the in-memory maps were read from.
 *
 * At module evaluation this is necessarily `'anon'` — see the header. Recording it is what lets
 * every mutator notice that the pointer has moved and re-read before writing.
 */
let hydratedAccount: string | null = null;

export const useChatUnread = create<ChatUnreadState>((set, get) => {
  const initial = readMaps();
  hydratedAccount = getCacheAccount();

  /**
   * Guard at the top of every mutator.
   *
   * Cheap: one string compare in the overwhelmingly common case. It only does work on the first
   * mutation after `setCacheAccount` moves the pointer — i.e. once per launch and once per account
   * switch. That is the exact window in which the old code corrupted the store.
   */
  const ensureAccount = (): void => {
    const active = getCacheAccount();
    if (active === hydratedAccount) return;
    hydratedAccount = active;
    const m = readMaps();
    set({ counts: m.counts, readAt: m.readAt });
    syncChatOsBadge(m.counts);
  };

  return {
  counts: initial.counts,
  readAt: initial.readAt,

  rehydrate: () => {
    hydratedAccount = null;
    ensureAccount();
  },

  bump: (conversationId) => {
    if (!conversationId) return;
    // The thread on screen is being read as it arrives.
    if (isActiveThread('chat', conversationId)) return;
    ensureAccount();
    const { counts, readAt } = get();
    const next = Math.min((counts[conversationId] || 0) + 1, MAX_COUNT);
    if (next === counts[conversationId]) return;
    const nextCounts = { ...counts, [conversationId]: next };
    set({ counts: nextCounts });
    persist(nextCounts, readAt);
  },

  clear: (conversationId) => {
    if (!conversationId) return;
    ensureAccount();
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
    // FIRST LINE, and the most important of the three. This is the function that turned an empty
    // anon-namespace hydration into an all-1s map written over the real data.
    ensureAccount();
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
      // ── NEVER RAISE A BADGE FOR THE CHAT THE USER IS LOOKING AT ─────────────
      //
      // `bump` has always had this check and this function never did, which is the difference that
      // let the badge appear while the chat was open on screen. Whatever the timestamps say, a
      // conversation being read right now has no unread messages — that is the same judgement the
      // push path makes when it declines to banner the thread you are in.
      //
      // Kept as a SECOND line of defence rather than the fix: the author comparison above is the
      // fix, and this is what stops any future path that forgets to record an author from being
      // visible in the one place the user would definitely see it.
      if (isActiveThread('chat', r.id)) continue;
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
  };
});

// ── THE IMPORT-TIME BADGE SEED IS GONE, AND IT WAS CLEARING THE REAL NUMBER ──
//
// This used to be `syncChatOsBadge(useChatUnread.getState().counts)`, with the intent "seed the icon
// from what MMKV restored, once, at import". Under the namespace race that intent inverted: at import
// the counts are the empty `anon` map, so the total is 0, and `osBadge`'s `lastWritten` starts at -1 so
// the write always lands. The first thing the app did on launch was therefore actively CLEAR whatever
// number the launcher was correctly showing from the last session.
//
// Seeding now happens in `rehydrate()`, called right after `setCacheAccount(...)`, which is the first
// moment the real counts can be read at all.

/**
 * Total across conversations — for the messages tab badge, so it can show real message counts
 * rather than the notifications-feed count it uses today.
 */
export function totalChatUnread(counts: CountMap): number {
  let n = 0;
  for (const k in counts) n += counts[k] || 0;
  return n;
}
