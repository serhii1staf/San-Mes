// useStaggeredReveal
// ------------------
// A frame-paced "reveal permit" shared across all callers. When many media
// cells (chat image/GIF bubbles) want to mount on the SAME frame — e.g. right
// after a chat opens and `imagesReady` flips — decoding them all at once piles
// ~10 simultaneous bitmap decodes + onLoad handlers into a single JS long task
// (the perf monitor flagged a 369 ms freeze / fps→39 on a GIF-heavy chat).
//
// Instead, each cell asks this shared FIFO for a permit; the pump grants ONE
// per animation frame, so the decodes kick off one-per-frame and the burst is
// spread across ~N frames instead of landing as one stall. Visually the images
// cascade in over a few frames (Telegram-like) rather than popping all at once.
//
// Same proven pattern as `scheduleRowArm` in app/(tabs)/messages.tsx. Once a
// cell is revealed it STAYS revealed (a re-render never re-queues it); a cell
// that unmounts before its turn cancels its slot.

import { useEffect, useState } from 'react';

const queue: Array<() => void> = [];
let pumpScheduled = false;

function pump() {
  pumpScheduled = false;
  const fn = queue.shift();
  if (fn) {
    try { fn(); } catch { /* caller unmounted between schedule + pump */ }
  }
  if (queue.length > 0) {
    pumpScheduled = true;
    requestAnimationFrame(pump);
  }
}

function enqueueReveal(fn: () => void): () => void {
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

/**
 * Returns `false` until this caller is granted its frame-paced reveal permit,
 * then `true` forever. Pass `active=false` to opt out (always returns the
 * current state; never queues). When `active` first becomes true the caller
 * joins the shared queue and flips to `true` on its turn (one grant per frame).
 */
export function useStaggeredReveal(active: boolean): boolean {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!active || revealed) return;
    const cancel = enqueueReveal(() => setRevealed(true));
    return cancel;
  }, [active, revealed]);
  return revealed;
}
