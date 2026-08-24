/**
 * mergeHistory — folding a server's copy of a conversation into the local one.
 *
 * ── WHY THIS IS A SHARED UTILITY AND NOT INLINE IN THE CHAT SCREEN ─────────────
 *
 * Direct messages had no server-history fetch at all: the transcript was local cache plus
 * live Ably, so anything published while the app was not subscribed was unreachable — push
 * arrives, chat is empty. The fix needs a merge, and a merge has exactly the sharp edges you
 * would expect: duplicate your own sends, or drop the ones that have not reached the server
 * yet. Getting it right once and property-testing it is worth more than getting it right
 * three times.
 *
 * Three surfaces need the same guarantee, which is why this is not a private helper:
 *
 *     1:1 chats        app/chat/[id].tsx           (uses this today)
 *     group chats      not built yet               (will have the identical problem)
 *     any future feed of server-owned rows with optimistic local writes
 *
 * ── THE TWO RECONCILIATION POLICIES, AND WHY BOTH EXIST ───────────────────────
 *
 * This file implements ADDITIVE merge: the union of local and remote, local wins on conflict.
 *
 * `reconcileComments` in app/comments/[id].tsx implements SERVER-WINS-MEMBERSHIP: the result
 * is exactly the server's array, reusing previous object references for unchanged rows. That
 * is deliberate and correct THERE — its job is to let memoized rows bail out of re-render,
 * and comments are always created through a request-then-refetch cycle, so the server is
 * never behind.
 *
 * They must NOT be unified. Applying server-wins to messages would delete every queued,
 * sending, or failed message the moment a fetch landed — the offline queue exists precisely
 * because sends outlive the request that started them. Applying additive to comments would
 * keep rows the author deleted elsewhere.
 *
 * If group chats reuse the DM transport (optimistic local write, server catches up), they
 * want this file. If they render a purely server-owned list, they want the comments policy.
 */

/** The minimum an item must expose to be mergeable. */
export interface MergeableItem {
  /** The id this item is stored under locally. */
  id: string;
  /**
   * The server's canonical id, when it differs from `id`.
   *
   * This field is the whole reason the merge is not a one-liner. An optimistic send is
   * created locally as `m-<timestamp>` and later learns its server uuid, which is recorded
   * here rather than by rewriting `id` (rewriting the id would break every reply, jump and
   * scroll anchor already pointing at it). So the same logical message can be known under
   * two different strings, and a merge that compares only `id` will happily add a second
   * copy of everything this device ever sent.
   */
  serverId?: string;
  /** ISO-8601 timestamp. Sorted as a STRING — see `sortByCreatedAt`. */
  createdAt: string;
}

/**
 * Every id a local item answers to.
 *
 * Both `id` and `serverId` are claimed, so a remote row matching either is recognised as
 * already present.
 */
export function knownIds<T extends MergeableItem>(local: readonly T[]): Set<string> {
  const ids = new Set<string>();
  for (const item of local) {
    if (item?.id) ids.add(item.id);
    if (item?.serverId) ids.add(item.serverId);
  }
  return ids;
}

/**
 * Chronological order, comparing ISO-8601 timestamps as strings.
 *
 * ISO-8601 in a fixed-width, big-endian, zero-padded form (which is what every timestamp in
 * this app is) orders identically under lexicographic and chronological comparison. So this
 * avoids two `Date` allocations and two `getTime()` calls per comparison — on a 1000-message
 * transcript that is a few thousand allocations saved per merge.
 *
 * Ties break on `id` so the result is a total order and the merge is deterministic: without
 * it, two messages sent in the same millisecond could swap places between merges and make
 * the list appear to shuffle.
 */
export function sortByCreatedAt<T extends MergeableItem>(items: T[]): T[] {
  return items.sort((a, b) => {
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

/**
 * Fold a server-fetched array into the local one.
 *
 * GUARANTEES, all property-tested:
 *
 *   - ADDITIVE. Every local item is present in the result, unchanged and by reference. Local
 *     state is never overwritten or removed, so pending sends, failed sends and local-only
 *     edits survive a merge with a server that has not caught up.
 *   - NO DUPLICATES. A remote item is added only when neither its id nor any local item's
 *     `id`/`serverId` already claims it.
 *   - CHRONOLOGICAL and DETERMINISTIC **when something is added**. A merged result is sorted
 *     by `createdAt`, ties broken by `id`, so merging the same inputs twice gives the same
 *     array. When nothing is added the caller's array comes back untouched and is NOT
 *     re-sorted — reordering an array the caller owns as a side effect of "check for updates"
 *     would be a surprise, and leaving it alone is what makes the reference-stability
 *     guarantee below usable. The property test asserts exactly this disjunction; asserting
 *     unconditional sortedness is wrong and fast-check catches it in ~16 runs.
 *   - NEVER MUTATES `local`. `sortByCreatedAt` sorts in place, so both call sites below hand
 *     it a fresh array.
 *   - IDEMPOTENT. Merging a second time with the same remote array is a no-op.
 *   - REFERENCE-STABLE WHEN NOTHING IS NEW. Returns the `local` array itself when there is
 *     nothing to add, so callers can skip a store write and the re-render it would cause.
 *
 * Deliberately NOT handled here: deletions. A message the user removed locally that the
 * server still has will come back. That is a symptom of a delete failing to propagate, and
 * silently swallowing it here would hide the real bug. If tombstones are ever needed, they
 * belong in the store as explicit deleted-ids, not as a special case in a merge.
 */
export function mergeHistory<T extends MergeableItem>(local: readonly T[], remote: readonly T[]): T[] {
  const localArr: readonly T[] = Array.isArray(local) ? local : [];
  if (!Array.isArray(remote) || remote.length === 0) return localArr as T[];

  // ── ONE PATH, NO EMPTY-LOCAL SHORTCUT ───────────────────────────────────────
  //
  // This used to short-circuit with `sortByCreatedAt([...remote])` when `local` was empty,
  // as an "obvious" fast path. The property tests rejected it on the seventh case, and they
  // were right: that branch skipped both of the filters below, so a first-ever fetch — the
  // single most common case, since an empty transcript is exactly what a fresh install has —
  // could admit a row with no id, or the same id twice if the server repeated it.
  //
  // The filters are the whole point of the function, so they cannot sit on one branch only.
  const known = knownIds(localArr);
  const additions: T[] = [];
  for (const item of remote) {
    if (!item?.id) continue;
    if (known.has(item.id)) continue;
    // Claim it immediately, which also guards against a remote array that repeats an id.
    known.add(item.id);
    additions.push(item);
  }
  // Nothing new: hand back the exact same array so the caller can bail out.
  if (additions.length === 0) return localArr as T[];
  return sortByCreatedAt([...localArr, ...additions]);
}

/**
 * pruneServerDeleted — the other half of reconciliation: rows the server no longer has.
 *
 * ── THE BUG THIS FIXES ──────────────────────────────────────────────────────
 *
 * Reported as: "I deleted messages on one device. I open the same chat on my other phone, scroll up,
 * and they are still there — and on the first phone they are gone."
 *
 * Exactly what the code did. Deleting a message hard-deletes it on the server and publishes
 * `msg.delete` on the conversation channel, and the deleting device records a local tombstone. The
 * OTHER device only learns about it from that realtime event, which requires it to be subscribed at
 * that instant — app open, this chat on screen. Miss it (app closed, different screen, no network,
 * asleep) and nothing ever tells it again:
 *
 *   • `mergeHistory` is additive by design, so a poll cannot remove anything;
 *   • its tombstone store is empty, because tombstones are local to whoever pressed delete;
 *   • the row is in its own MMKV history blob, so it survives restarts indefinitely.
 *
 * So the two devices disagree permanently. This is the function that lets a poll notice.
 *
 * ── WHY IT IS SEPARATE FROM `mergeHistory` AND NOT A FLAG ON IT ─────────────
 *
 * `mergeHistory`'s additive guarantee is load-bearing: it is what lets a queued, sending or failed
 * message survive a fetch from a server that has not caught up. Making it capable of removal — even
 * behind an option — would put "delete the user's pending message" one bad argument away from
 * happening, in the function every history path calls. The file's own note says deletions belong
 * outside it. They do.
 *
 * Keeping them separate also keeps the SAFETY PRECONDITION where the caller can actually evaluate
 * it, which matters more than the tidiness. "The server did not return this row" only means "it was
 * deleted" if the server was asked a question whose answer covers that row. A page capped by `limit`
 * does not qualify: half the transcript is missing from it by construction, and pruning on that
 * would wipe most of the conversation. So the caller must state, explicitly, that the response was
 * complete — hence `complete`, which is not a flag with a sensible default.
 *
 * ── WHAT IT WILL NOT TOUCH ──────────────────────────────────────────────────
 *
 *   • Anything when `complete` is false, or when the remote array is empty. An empty response cannot
 *     establish a range, and is anyway indistinguishable from a fetch that failed or was filtered.
 *   • Rows with no `serverId`. Those were never confirmed by the server, so its silence about them
 *     is expected, not evidence — this is what protects an optimistic send that is still in flight,
 *     a queued offline send, and a send that failed and is awaiting retry.
 *   • Rows outside the timestamp span the remote array actually covers. A message newer than the
 *     newest row in the response is one the response predates (our own send, a beat ago). A message
 *     older than the oldest is outside what the server spoke about at all, which is the conservative
 *     reading when server-side history may itself have been trimmed.
 *
 * Reference-stable: returns `local` itself when nothing is dropped, so the caller can skip the store
 * write and the re-render.
 */
export function pruneServerDeleted<T extends MergeableItem>(
  local: readonly T[],
  remote: readonly T[],
  complete: boolean,
): { kept: T[]; removedIds: string[] } {
  const localArr: readonly T[] = Array.isArray(local) ? local : [];
  const none = { kept: localArr as T[], removedIds: [] as string[] };

  if (!complete) return none;
  if (!Array.isArray(remote) || remote.length === 0) return none;
  if (localArr.length === 0) return none;

  // The span the server's answer actually covers. Computed rather than assuming the array is
  // sorted, because that is the caller's business and a wrong assumption here deletes messages.
  let oldest = remote[0]?.createdAt;
  let newest = remote[0]?.createdAt;
  const remoteIds = new Set<string>();
  for (const r of remote) {
    if (!r?.id) continue;
    remoteIds.add(r.id);
    if (r.serverId) remoteIds.add(r.serverId);
    const at = r.createdAt;
    if (typeof at !== 'string') continue;
    if (!oldest || at < oldest) oldest = at;
    if (!newest || at > newest) newest = at;
  }
  if (!oldest || !newest || remoteIds.size === 0) return none;

  const kept: T[] = [];
  const removedIds: string[] = [];
  for (const item of localArr) {
    const confirmed = !!item?.serverId;
    const at = item?.createdAt;
    const inSpan = typeof at === 'string' && at >= oldest && at <= newest;
    const claimed =
      (item?.id && remoteIds.has(item.id)) || (item?.serverId && remoteIds.has(item.serverId));
    if (confirmed && inSpan && !claimed) {
      // Report the local id: that is what the store, the tombstone list and the on-disk blob are
      // all keyed by. Reporting the server id would purge the store and leave the cache intact.
      removedIds.push(item.id);
      continue;
    }
    kept.push(item);
  }

  if (removedIds.length === 0) return none;
  return { kept, removedIds };
}
