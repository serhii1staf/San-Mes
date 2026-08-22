// Content equality for lists held in stores.
//
// WHY THIS EXISTS
//   A screen renders from cache, a background fetch returns, and the store setter
//   is called unconditionally with a NEW array containing the SAME data. Every
//   subscriber re-renders, every `React.memo` on a row is busted because the item
//   object identity changed, and the user sees the screen blink and rebuild for no
//   reason. Repeat that on every focus, every realtime event and every sync tick and
//   it reads as "the app constantly reloads and data flickers".
//
//   The feed already guarded against this with a local `postsShallowEqual`. Every
//   other screen — the conversation list, profile posts, comments — did not.
//
// WHY THE GUARD BELONGS IN THE STORE SETTER
//   Putting it at each call site means it must be remembered at each call site, and
//   `setConversations` alone is called from four places (sync service, realtime
//   bridge, chat screen, chat list). Guarding inside the setter makes the no-op
//   impossible to reintroduce: if nothing changed, the setter returns the previous
//   reference and React bails out for everyone.

/** Fields whose value must match for two rows to count as unchanged. */
export type FieldList<T> = readonly (keyof T)[];

/**
 * Are two rows equal across the given fields?
 *
 * Shallow per field: values are compared with `!==`, so nested objects must be
 * referentially stable or listed via a field that summarises them.
 */
export function rowEqualOn<T extends object>(a: T, b: T, fields: FieldList<T>): boolean {
  if (a === b) return true;
  for (const f of fields) {
    if (a[f] !== b[f]) return false;
  }
  return true;
}

/**
 * Are two lists content-equal across the given fields?
 *
 * Order-sensitive on purpose: reordering IS a visible change (a conversation moving
 * to the top of the list, a new newest post) and must re-render.
 */
export function listEqualOn<T extends object>(
  a: readonly T[] | null | undefined,
  b: readonly T[] | null | undefined,
  fields: FieldList<T>,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!rowEqualOn(a[i], b[i], fields)) return false;
  }
  return true;
}

/**
 * Fields that decide whether a conversation row looks different.
 *
 * `unreadCount` and `lastMessage*` are included because they are visible. Anything
 * not listed here cannot cause the list to repaint, which is the point.
 */
export const CONVERSATION_FIELDS = [
  'id',
  'participantId',
  'participantName',
  'participantUsername',
  'participantEmoji',
  'participantVerified',
  'participantBadge',
  'lastMessage',
  'lastMessageAt',
] as const;

/**
 * Fields that decide whether a post row looks different.
 *
 * `isLiked` / `isBookmarked` are DELIBERATELY excluded: they are optimistic local
 * state that the server returns as `false`, so including them would make every
 * refresh look like a change and defeat the whole guard. This mirrors the
 * reasoning already documented in the feed's local comparator.
 */
export const POST_FIELDS = [
  'id',
  'content',
  'imageUrl',
  'likesCount',
  'commentsCount',
  'sharesCount',
  'createdAt',
  'authorName',
  'authorUsername',
  'authorEmoji',
] as const;
