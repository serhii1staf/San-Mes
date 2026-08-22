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
