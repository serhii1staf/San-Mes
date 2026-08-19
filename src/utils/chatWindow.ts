/**
 * chatWindow — where the chat transcript's rendered window starts.
 *
 * The chat screen feeds FlashList only the most recent `renderWindow` messages of a
 * possibly-huge history. This module owns the one rule that makes that safe.
 *
 * ── THE RULE: THE FRONT EDGE NEVER MOVES FORWARD ──────────────────────────────
 *
 * The obvious implementation — `start = length - renderWindow`, recomputed every
 * render — is subtly broken, and was the root cause of a reported "a message
 * disappears, then suddenly appears, and it teleports me".
 *
 * With that formula, appending ONE message while `renderWindow` is unchanged moves
 * the start from 0 to 1: the oldest row is spliced off the FRONT in the same commit
 * that a new row is appended at the back. The screen compensated for this with a
 * post-commit effect that grew `renderWindow`, which restored the row — one frame
 * later. So every incoming or sent message produced two commits, each changing the
 * content height ABOVE the viewport, and `maintainVisibleContentPosition` applied
 * two opposite corrections back to back. mvcp cannot help with the first one at all:
 * removing an item from the front is not a prepend, and `startRenderingFromBottom`
 * re-anchors on the bottom.
 *
 * Making the start NON-INCREASING removes the problem at the source instead of
 * compensating for it. The window can only ever grow backwards — revealing older
 * history when `renderWindow` grows (scroll-up, hydration, a jump) — and an append
 * can never drop a row off the front, so no compensating second commit is needed.
 *
 * Kept as a pure function so the invariant can be property-tested; the screen holds
 * the previous value in a ref and passes it back in.
 */

export interface ChatWindowInput {
  /** Total messages currently in the transcript (oldest → newest). */
  total: number;
  /** How many of the newest messages the screen wants rendered. */
  renderWindow: number;
  /**
   * The start index this window had on the previous render, or `null` when the
   * conversation just changed (in which case there is nothing to preserve and the
   * window starts fresh).
   */
  previousStart: number | null;
}

/**
 * Compute the slice start for the rendered window.
 *
 * Guarantees, all pinned by tests:
 *  - the result is always a valid index into a `total`-length array (or 0 when empty);
 *  - it never EXCEEDS `previousStart` for the same conversation, so rows already on
 *    screen are never removed from the front;
 *  - it decreases when `renderWindow` grows, so more history becomes visible;
 *  - growing `total` alone (an append) never changes it.
 */
export function computeWindowStart({ total, renderWindow, previousStart }: ChatWindowInput): number {
  if (total <= 0) return 0;

  // Where the window would begin if computed from scratch.
  const raw = Math.max(0, total - Math.max(0, renderWindow));

  // Fresh conversation → take `raw`. Otherwise never move the front edge forward.
  const candidate = previousStart === null ? raw : Math.min(previousStart, raw);

  // Clamp into the array. `total - 1` rather than `total` so the window always
  // contains at least the newest message even if a delete shrank the array below the
  // previous start.
  return Math.max(0, Math.min(candidate, total - 1));
}
