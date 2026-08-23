/**
 * Locally-remembered message deletions ("tombstones").
 *
 * ── THE BUG THIS EXISTS TO FIX ───────────────────────────────────────────────
 *
 * Reported as: delete a message, wait one or two seconds, and it comes back — for the person
 * who deleted it AND for the peer. Delete it again and it comes back again.
 *
 * There is no server-side delete for messages. None. There is no `DELETE /v1/messages/:id`
 * route in the Worker, and the `messages` table has no `deleted_at` column, so a "delete" was
 * only ever two local acts:
 *
 *   1. filter the row out of the in-memory array, and
 *   2. publish `msg.delete` on `chat:<id>` so the peer filters it out of theirs.
 *
 * The row stays in D1 for ever. That was survivable while nothing re-read the server's copy,
 * and it stopped being survivable the moment the chat screen started polling
 * `GET /v1/conversations/:id/messages` every six seconds: the poll fetches the row, the merge
 * does not recognise it as known (it was removed from local), and it is added straight back.
 * Both devices poll, so both resurrect it independently — which is exactly the symptom.
 *
 * `mergeHistory` deliberately refuses to solve this. Its doc block says so:
 *
 *     Deliberately NOT handled here: deletions. [...] If tombstones are ever needed, they
 *     belong in the store as explicit deleted-ids, not as a special case in a merge.
 *
 * That is right, and this module is that place. Keeping it out of the merge means the merge
 * stays a pure function of its two arguments, and the "what did the user delete" question has
 * exactly one owner.
 *
 * ── WHY THIS IS NOT THE WHOLE FIX ───────────────────────────────────────────
 *
 * A tombstone is a local record. It makes deletion *stick* on every device that learns about
 * it, which is both devices in a 1:1 chat (the deleter records it directly, the peer records
 * it when the `msg.delete` event arrives). It does NOT remove the row from the server, so:
 *
 *   - a fresh install, or a device that was offline for the whole exchange, will still fetch
 *     the message and has no tombstone to suppress it;
 *   - the row keeps consuming storage for ever.
 *
 * The real fix is a `DELETE /v1/messages/:id` route on the Worker, and the client now calls
 * it (tolerating a 404 so this ships before the Worker does). Once that route is deployed the
 * server stops serving deleted rows and tombstones become a belt-and-braces guard against a
 * poll response that was already in flight when the delete happened — which is a real race
 * worth guarding regardless.
 *
 * ── BOUNDS ──────────────────────────────────────────────────────────────────
 *
 * Per conversation, capped at `MAX_TOMBSTONES` newest ids. Unbounded growth here would be a
 * slow leak in a key that is read on every poll tick. The cap is generous: it is a count of
 * DELETED messages in one conversation, not of messages.
 */

import { kvGetJSONSync, kvSetJSON } from './kvStore';

/** Storage key for one conversation's tombstones. */
const tombstoneKey = (conversationId: string) => `msg_tombstones:${conversationId}`;

/**
 * Hard cap on remembered deletions per conversation.
 *
 * Ids are kept newest-last and the oldest are dropped first. Losing the oldest tombstone can
 * only matter if the server still has that row AND the user scrolls back far enough to refetch
 * it, which stops being possible once the Worker delete route lands.
 */
const MAX_TOMBSTONES = 400;

/**
 * Parsed tombstone sets, keyed by conversation id.
 *
 * The poll reads these every six seconds and the merge path reads them per fetch, so parsing
 * JSON out of MMKV each time would be pointless repeated work on a timer. Writes go through
 * this cache too, so it never disagrees with disk.
 */
const cache = new Map<string, Set<string>>();

/** Read one conversation's tombstones, hydrating the cache from disk on first use. */
export function getTombstones(conversationId: string): Set<string> {
  if (!conversationId) return new Set();
  const cached = cache.get(conversationId);
  if (cached) return cached;
  let ids: string[] = [];
  try {
    ids = kvGetJSONSync<string[]>(tombstoneKey(conversationId), []);
  } catch {
    ids = [];
  }
  const set = new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string' && x.length > 0) : []);
  cache.set(conversationId, set);
  return set;
}

/**
 * Record one or more ids as deleted.
 *
 * Callers pass BOTH identities of a message (`id` and `serverId`) because the same logical
 * message is known under a local `m-<ts>` id on the device that sent it and under the server
 * uuid everywhere else — see the note on `ChatMessage.serverId`. Recording only one of them
 * would leave the other free to come back from a poll. `undefined` entries are ignored so
 * callers can pass `message.serverId` without a guard.
 */
export function addTombstones(conversationId: string, ids: readonly (string | undefined | null)[]): void {
  if (!conversationId) return;
  const set = getTombstones(conversationId);
  let changed = false;
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) continue;
    if (set.has(id)) continue;
    set.add(id);
    changed = true;
  }
  if (!changed) return;
  // Insertion order is preserved by Set, so slicing from the front drops the oldest.
  let arr = [...set];
  if (arr.length > MAX_TOMBSTONES) {
    arr = arr.slice(arr.length - MAX_TOMBSTONES);
    cache.set(conversationId, new Set(arr));
  }
  try {
    kvSetJSON(tombstoneKey(conversationId), arr);
  } catch {
    // Disk write failed; the in-memory set still suppresses the row for this session.
  }
}

/** Is this id known to have been deleted? */
export function isTombstoned(conversationId: string, id: string | undefined | null): boolean {
  if (!conversationId || typeof id !== 'string' || id.length === 0) return false;
  return getTombstones(conversationId).has(id);
}

/**
 * Drop every tombstoned item from `items`, matching on EITHER identity.
 *
 * Returns the SAME array reference when nothing was removed, so callers can use it directly in
 * a store-write bail-out without allocating or re-rendering on the common path (no deletions,
 * or none of them present in this batch).
 */
export function filterTombstoned<T extends { id: string; serverId?: string }>(
  conversationId: string,
  items: readonly T[],
): readonly T[] {
  if (!conversationId || !Array.isArray(items) || items.length === 0) return items;
  const set = getTombstones(conversationId);
  if (set.size === 0) return items;
  let hit = false;
  for (const item of items) {
    if (set.has(item.id) || (item.serverId && set.has(item.serverId))) {
      hit = true;
      break;
    }
  }
  if (!hit) return items;
  return items.filter((item) => !set.has(item.id) && !(item.serverId && set.has(item.serverId)));
}

/**
 * Forget a conversation's cached set (not its stored one).
 *
 * Used by tests to reset module state between cases. Deliberately does NOT delete from disk:
 * forgetting a tombstone is how a deleted message comes back, so there is no legitimate
 * product reason to erase one.
 */
export function __resetTombstoneCache(): void {
  cache.clear();
}
