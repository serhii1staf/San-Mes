// Content equality for lists held in stores.
//
// WHY THIS EXISTS
//   A screen renders from cache, a background fetch returns, and the store setter is
//   called unconditionally with a NEW array containing the SAME data. Every
//   subscriber re-renders and every `React.memo` on a row is busted because the item
//   identity changed. Repeat on every focus, sync tick and realtime event and it
//   reads as "the app constantly reloads and data flickers".
//
// ALLOWLIST vs DENYLIST — THE BUG THIS FILE ALREADY CAUSED ONCE
//   The first version compared an explicit list of "fields that matter". That is the
//   wrong default for a bail-out, because the two failure modes are not symmetric:
//
//     - Comparing too MUCH → an extra re-render. Wasteful, invisible, harmless.
//     - Comparing too LITTLE → the update is SWALLOWED. The store keeps stale data
//       and the screen shows content that no longer exists, or never shows content
//       that just arrived.
//
//   The allowlist omitted `imageUrls`, `isSpoilerImage`, `isRepost`, `originalPost`,
//   `authorVerified` and `authorBadge`. So a repost whose `originalPost` resolved
//   after the first paint never rendered its embed, and a post whose image set
//   changed kept the old images — reported as "content disappears" and "deleted
//   messages come back".
//
//   So the logic is inverted: compare EVERYTHING, and ignore only fields that are
//   known to be locally-owned noise. An unknown or newly-added field now breaks
//   equality, which costs one render and can never lose data.

/** Depth limit for structural comparison. */
const MAX_DEPTH = 3;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Structural equality for the kinds of values these rows hold: primitives, string
 * arrays (`imageUrls`) and flat embedded objects (`originalPost`).
 *
 * Falls back to `false` past `MAX_DEPTH` rather than to `true`: past the depth we
 * cannot prove equality, and guessing "equal" is the failure mode that loses data.
 */
export function valueEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true;
  if (depth >= MAX_DEPTH) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!valueEqual(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!valueEqual(a[k], b[k], depth + 1)) return false;
    }
    return true;
  }

  return false;
}

/**
 * Are two rows equal across every field EXCEPT the ignored ones?
 *
 * The key set is the union of both objects' own keys, so a field appearing or
 * disappearing counts as a difference.
 */
export function rowEqualIgnoring<T extends object>(
  a: T,
  b: T,
  ignore: ReadonlySet<string>,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (ignore.has(k)) continue;
    if (!valueEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

/**
 * Are two lists content-equal, ignoring the given fields?
 *
 * Order-sensitive on purpose: reordering IS a visible change (a conversation moving
 * to the top, a newer post arriving) and must re-render.
 */
export function listEqualIgnoring<T extends object>(
  a: readonly T[] | null | undefined,
  b: readonly T[] | null | undefined,
  ignore: ReadonlySet<string>,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!rowEqualIgnoring(a[i], b[i], ignore)) return false;
  }
  return true;
}

/**
 * Post fields that must NOT count as a change.
 *
 * These two are optimistic LOCAL state: the user taps like, we flip it immediately,
 * and the server keeps returning `false` because it does not track per-viewer state
 * on this payload. Counting them would make every refresh look like a change, the
 * guard would never fire, and the flicker would be exactly as bad as before while
 * appearing to be fixed.
 *
 * Nothing else belongs here. Every other field, including ones added later, is
 * compared.
 */
export const POST_VOLATILE_FIELDS: ReadonlySet<string> = new Set(['isLiked', 'isBookmarked']);

/**
 * Conversation fields that must NOT count as a change.
 *
 * Empty: `LocalConversation` carries no locally-owned optimistic state, so
 * everything is compared.
 */
export const CONVERSATION_VOLATILE_FIELDS: ReadonlySet<string> = new Set<string>();

/** Convenience wrappers so call sites read clearly. */
export function postsEqual<T extends object>(
  a: readonly T[] | null | undefined,
  b: readonly T[] | null | undefined,
): boolean {
  return listEqualIgnoring(a, b, POST_VOLATILE_FIELDS);
}

export function conversationsEqual<T extends object>(
  a: readonly T[] | null | undefined,
  b: readonly T[] | null | undefined,
): boolean {
  return listEqualIgnoring(a, b, CONVERSATION_VOLATILE_FIELDS);
}
