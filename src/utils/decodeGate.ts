// Admission control for expensive image decodes.
//
// ── THE PROBLEM, MEASURED ───────────────────────────────────────────────────
//
// One snapshot on `chat/[id]`, ten IMG marks inside a 40 ms window:
//
//   media2 275ms  media1 275ms  media0 279ms  media1 280ms  media0 245ms
//   media2 282ms  media4 283ms  media3 306ms  media4 270ms  media3 274ms
//
// Ten animated-GIF first-frame decodes started together. They did not take 275 ms each because a
// GIF costs 275 ms; they took 275 ms each BECAUSE there were ten of them competing. Started three
// at a time the same ten finish sooner in wall-clock terms, and without saturating the cores the
// UI thread needs to composite and upload bitmaps.
//
// ── WHY THIS IS NOT THE THING THAT WAS DELETED ──────────────────────────────
//
// The app used to have `useStaggeredReveal` / `useStaggeredGifReveal` — FRAME pumps that released
// one image per frame (GIFs every ~90 ms). They were deleted for cause, and the reasons are on
// record and correct: a fixed per-frame delay makes images arrive one at a time over half a second,
// the screen visibly assembles itself, and it got reported as the chat "loading everything, every
// time". Re-adding a timed pump would re-add that.
//
// This is a different mechanism with a different failure mode:
//
//   A pump asks "has enough TIME passed?" — so it delays even when nothing else is running, and
//   its total duration grows with the number of images.
//
//   A gate asks "is a slot FREE?" — so the first `MAX_CONCURRENT` decodes start with zero delay,
//   and each subsequent one starts the instant a previous one finishes. Nothing waits on a clock.
//   With fewer images than slots it is completely inert.
//
// That distinction is the whole justification. If this ever reads as staggering, it is wrong and
// should be removed rather than tuned.
//
// ── WHY IT ONLY GATES GIFS ──────────────────────────────────────────────────
//
// A static photo's decode is cheap and cached after the first one; the marks above are all giphy
// hosts. `expo-image` already bounds its own network and decode concurrency internally on
// SDWebImage / Glide, but an ANIMATED image is decoded frame-by-frame by a different path, and the
// first-frame cost is what lands in a burst. Gating photos too would add a queue in front of work
// that is already fast, which is how the pumps became a regression.

/**
 * How many gated decodes may be in flight.
 *
 * Three, not one: a single slot is a serial queue, which IS a pump by another name and would
 * reproduce the visible one-at-a-time arrival. Three keeps several images landing together — so a
 * screenful still fills in a couple of waves — while cutting peak concurrency from ten to three.
 */
const MAX_CONCURRENT = 3;

/**
 * Ceiling on how long one holder may occupy a slot.
 *
 * The release path is driven by an image's `onLoad` / `onError`, and there is no guarantee either
 * fires — a cancelled request, a view recycled mid-decode, a host that never answers. Without this
 * a lost release would permanently shrink the pool, and three lost releases would deadlock every
 * remaining GIF in the app for the rest of the session. That is a far worse failure than decoding
 * one frame too early, so the slot is reclaimed unconditionally.
 *
 * 1200 ms is comfortably longer than the worst decode observed (306 ms) even with the contention
 * this gate exists to remove, so a healthy decode never has its slot pulled out from under it.
 */
const SLOT_TIMEOUT_MS = 1200;

let inFlight = 0;
const waiting: (() => void)[] = [];

function pump(): void {
  while (inFlight < MAX_CONCURRENT && waiting.length > 0) {
    const next = waiting.shift();
    if (!next) break;
    inFlight += 1;
    next();
  }
}

/**
 * Ask for a decode slot.
 *
 * `onGranted` is called SYNCHRONOUSLY when a slot is free, so the common case — an app with fewer
 * than `MAX_CONCURRENT` images in flight — behaves exactly as if this module did not exist. No
 * frame is skipped and no timer is involved.
 *
 * Returns a canceller. Calling it releases the slot if granted, or withdraws the request if still
 * queued. Safe to call more than once.
 */
export function acquireDecodeSlot(onGranted: () => void): () => void {
  let state: 'queued' | 'granted' | 'done' = 'queued';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const finish = () => {
    if (state === 'done') return;
    if (state === 'granted') {
      inFlight -= 1;
      if (inFlight < 0) inFlight = 0;
      if (timer) { clearTimeout(timer); timer = null; }
      state = 'done';
      pump();
      return;
    }
    // Still queued — withdraw so a request whose component unmounted never takes a slot.
    const at = waiting.indexOf(grant);
    if (at >= 0) waiting.splice(at, 1);
    state = 'done';
  };

  const grant = () => {
    if (state !== 'queued') return;
    state = 'granted';
    timer = setTimeout(() => {
      // See SLOT_TIMEOUT_MS. Release the slot but leave the holder alone — it is mid-decode and
      // its own onLoad will call the canceller, which is a no-op by then.
      if (state === 'granted') {
        inFlight -= 1;
        if (inFlight < 0) inFlight = 0;
        state = 'done';
        timer = null;
        pump();
      }
    }, SLOT_TIMEOUT_MS);
    onGranted();
  };

  // The slot is counted HERE on the fast path and inside `pump` on the queued path — `grant` itself
  // never counts, so there is exactly one increment per granted request either way.
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    grant();
  } else {
    waiting.push(grant);
  }
  return finish;
}

/** Test seam: current occupancy and queue depth. */
export function __decodeGateStateForTests(): { inFlight: number; queued: number } {
  return { inFlight, queued: waiting.length };
}

/** Test seam: drop all state between tests. */
export function __resetDecodeGateForTests(): void {
  inFlight = 0;
  waiting.length = 0;
}
