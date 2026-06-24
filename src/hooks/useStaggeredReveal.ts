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
// Spacing between photo reveals (ms). Wider than a frame so overlapping photo
// decodes don't pile into a burst on chat/feed open. ~45 ms ≈ one decode at a
// time on a mid device while still cascading in fast enough to feel instant.
const PHOTO_REVEAL_INTERVAL_MS = 45;

// ── Scroll-pause gate (shared by BOTH the photo and GIF pumps) ──────────────
// While the user is actively scrolling/flinging a media list, granting reveal
// permits would kick off bitmap decodes ON the scroll frames — the per-image
// "freeze when a photo/GIF scrolls into view" the perf snapshots and the user
// both reported. So both pumps HALT while `scrollPaused` is true and drain once
// the list settles (the screen wires this to its scroll idle timer). Images
// already revealed stay revealed; only NOT-yet-decoded media waits for the
// scroll to stop — exactly Telegram's "media loads when you stop scrolling".
let scrollPaused = false;

/**
 * Pause/resume ALL staggered media reveals (photos + GIFs) globally. Screens
 * call `setRevealScrollPaused(true)` on every scroll event and
 * `setRevealScrollPaused(false)` a short idle after scrolling stops. While
 * paused, no new image/GIF decode is kicked off, so scroll frames stay free.
 */
export function setRevealScrollPaused(paused: boolean): void {
  if (paused === scrollPaused) return;
  scrollPaused = paused;
  if (!paused) {
    // Resume: re-arm whichever pump has pending work.
    if (!pumpScheduled && queue.length > 0) {
      pumpScheduled = true;
      requestAnimationFrame(pump);
    }
    if (!gifPumpScheduled && gifQueue.length > 0) {
      gifPumpScheduled = true;
      requestAnimationFrame(gifPump);
    }
  }
}

function pump() {
  pumpScheduled = false;
  // Halt while scrolling — do NOT grant or reschedule. `setRevealScrollPaused`
  // re-arms the pump when the list settles.
  if (scrollPaused) return;
  const fn = queue.shift();
  if (fn) {
    try { fn(); } catch { /* caller unmounted between schedule + pump */ }
  }
  if (queue.length > 0) {
    pumpScheduled = true;
    // Space photo reveals ~PHOTO_REVEAL_INTERVAL_MS apart instead of one-per-
    // FRAME. A static photo decode is ~80-170 ms; granting one per 16 ms frame
    // started 5-6 decodes before the first finished, so a screenful (or the
    // chat-open window) landed a BURST of overlapping decodes that each
    // reported ~220-270 ms (contention) and froze the frame. Spacing them out
    // keeps at most ~2 decoding at once — the burst disappears.
    setTimeout(pump, PHOTO_REVEAL_INTERVAL_MS);
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

// ─────────────────────────────────────────────────────────────────────────────
// Animated-GIF reveal pump (concurrency-aware via time spacing)
// ─────────────────────────────────────────────────────────────────────────────
// Animated GIFs are MUCH heavier to decode than a static photo: expo-image
// decodes frames continuously, and the FIRST decode on a weak Android 10 device
// measures ~100-180 ms per GIF (the perf monitor caught media{0..4}.giphy.com
// loads clustering ~100-182 ms each). The photo pump above grants one reveal
// PER FRAME (~16 ms apart), which is fine for cheap static decodes but starts
// GIF decodes far faster than they finish — so a fast scroll through a GIF-heavy
// history (or the window filling on open) kicks off 5-8 OVERLAPPING GIF decodes
// and lands a ~500 ms long task / fps dip, recurring on every new window of rows.
//
// This sibling pump grants one GIF reveal per `GIF_REVEAL_INTERVAL_MS`, chosen
// to be wider than a single GIF decode takes, so decode STARTS never stack up:
// at most ~2 GIFs decode concurrently instead of a whole screenful at once.
//
// It is deliberately TIME-based, not decode-completion-based: a GIF always
// reveals on schedule and can never get stuck waiting on an onLoad signal that
// might not fire (broken URL, recycled cell). The only visible effect is that a
// screenful of GIFs cascades in over a few hundred ms instead of popping all at
// once — the same Telegram-style cascade the photo pump already produces, and
// imperceptible for the 2-3 GIFs actually on-screen at any moment.
const GIF_REVEAL_INTERVAL_MS = 90;
const gifQueue: Array<() => void> = [];
let gifPumpScheduled = false;

function gifPump() {
  gifPumpScheduled = false;
  // Same scroll-pause halt as the photo pump — never start a GIF decode mid-scroll.
  if (scrollPaused) return;
  const fn = gifQueue.shift();
  if (fn) {
    try { fn(); } catch { /* caller unmounted between schedule + pump */ }
  }
  if (gifQueue.length > 0) {
    gifPumpScheduled = true;
    setTimeout(gifPump, GIF_REVEAL_INTERVAL_MS);
  }
}

function enqueueGifReveal(fn: () => void): () => void {
  gifQueue.push(fn);
  if (!gifPumpScheduled) {
    gifPumpScheduled = true;
    // First GIF reveals on the next frame (a lone GIF pays no delay);
    // subsequent ones are spaced by GIF_REVEAL_INTERVAL_MS.
    requestAnimationFrame(gifPump);
  }
  return () => {
    const i = gifQueue.indexOf(fn);
    if (i >= 0) gifQueue.splice(i, 1);
  };
}

/**
 * Like {@link useStaggeredReveal} but paced for animated GIFs: reveals are
 * granted on a wider time interval so heavy GIF decodes don't overlap into a
 * burst. Same `false → true (forever)` contract; pass `active=false` to opt out.
 */
export function useStaggeredGifReveal(active: boolean): boolean {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!active || revealed) return;
    const cancel = enqueueGifReveal(() => setRevealed(true));
    return cancel;
  }, [active, revealed]);
  return revealed;
}
