/**
 * A frame-paced FIFO that lets at most N list cells hydrate their heavy body per animation frame.
 *
 * ── WHY THIS EXISTS AS A SHARED MODULE ──────────────────────────────────────
 *
 * It was written inside `src/components/profile/ProfilePostCard.tsx` and it worked. The other card —
 * `src/components/ui/UserProfilePostCard.tsx`, used by other people's profiles and by the Likes tab —
 * had only a bare per-card `requestAnimationFrame`, and a device snapshot showed exactly what that
 * costs: ELEVEN `UserProfilePostCard` mounts stamped at the same millisecond, immediately followed by
 * a 208 ms long task, and a burst of fourteen image loads whose durations climbed 202 → 219 ms in
 * lockstep because they all started together.
 *
 * ── WHY A SHARED QUEUE AND NOT A PER-CARD RAF ───────────────────────────────
 *
 * This is the part that is easy to get wrong, and both cards had it wrong at some point:
 *
 *   requestAnimationFrame(() => setHydrated(true))
 *
 * only delays a card by ONE frame. It does NOT serialise cards against each other. Every card that
 * the list mounts in the same virtualization batch schedules its callback for the SAME next frame, so
 * all of their bodies commit together one frame later — N x ~20-30 ms of native shadow-tree work
 * stacked into one long task. The delay moves the storm; it does not break it up.
 *
 * The queue below grants hydration to at most `CARDS_PER_FRAME` waiters per frame, in mount order. A
 * single rAF pump releases the next waiter(s) and re-arms itself while the queue is non-empty.
 *
 * ── CANCEL ON UNMOUNT ───────────────────────────────────────────────────────
 *
 * `enqueueReveal` returns a canceller. A card that recycles during a fast scroll before its turn drops
 * its slot, so it never hydrates off-screen and never leaks a queue entry. The pump shifts past a
 * cancelled slot, so the queue cannot deadlock. Calling the canceller after the waiter already fired
 * is safe — it simply finds nothing to remove.
 */

const queue: Array<() => void> = [];
let pumpScheduled = false;

/**
 * How many card bodies may hydrate on one frame.
 *
 * Two keeps the cascade quick — a screenful reveals in a handful of frames — while guaranteeing no
 * single frame ever commits more than about two full card bodies. That is the property that removes
 * the stacked long task whether the batch lands on a cold open or mid-scroll.
 */
const CARDS_PER_FRAME = 2;

function pump(): void {
  pumpScheduled = false;
  for (let i = 0; i < CARDS_PER_FRAME; i++) {
    const fn = queue.shift();
    if (!fn) break;
    // A card can unmount between being enqueued and being pumped; its setState would then warn or
    // throw depending on the React version. Swallowing here is correct: the work is obsolete.
    try { fn(); } catch { /* card unmounted between enqueue and pump */ }
  }
  if (queue.length > 0) {
    pumpScheduled = true;
    requestAnimationFrame(pump);
  }
}

/** Enqueue a hydration waiter. Returns a canceller that drops this card's slot if it recycles first. */
export function enqueueReveal(fn: () => void): () => void {
  queue.push(fn);
  if (!pumpScheduled) {
    pumpScheduled = true;
    requestAnimationFrame(pump);
  }
  return () => {
    const i = queue.indexOf(fn);
    if (i >= 0) queue.splice(i, 1);
  };
}
