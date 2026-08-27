// useStaggeredReveal
// ------------------
// Reveal permits, now granted IMMEDIATELY. This file used to be two frame-paced
// pumps (one photo reveal per 45 ms, one GIF reveal per 90 ms) plus a global
// latch that halted both while any list was scrolling. All three are gone. The
// hooks keep their signatures and their `false → true (forever)` contract so
// every call site compiles unchanged, and reverting is one commit.
//
// ── WHY THE PUMPS WERE REMOVED ──────────────────────────────────────────────
//
// The case for them was a metric, and the metric was measuring the wrong thing.
// It read: image load durations climbing 290 → 331 → 442 → 448 → 533 → 542 →
// 599 ms as concurrency rose, therefore concurrency is expensive, therefore
// serialise the starts. Two problems with that inference.
//
// FIRST, a monotonically climbing series like that is the signature of a REQUEST
// QUEUE, not of CPU contention. CPU contention degrades roughly in proportion to
// the overcommit and recovers as items finish; a queue makes the Nth item's
// wall-clock time include the wait for the N-1 ahead of it, which is precisely a
// straight climb. Every one of those images was fetched through an external
// proxy (`images.weserv.nl`, see `proxiedImageUrl` in CachedImage) over a shared
// connection pool, so the queue was on the network, off-device. Serialising
// starts does not shorten the total; it makes each individual number look good
// while the screen takes strictly longer to fill. The gauge rewarded the change
// that made the user experience worse, which is why each round added more
// spacing and the app kept feeling slower.
//
// SECOND, the decode this was protecting the JS thread from does not happen on
// the JS thread. `expo-image` is SDWebImage on iOS and Glide on Android, and
// both maintain their own bounded decode queues on background threads. The
// concurrency cap this file was imposing already existed one layer down,
// implemented by libraries whose entire purpose is that cap. We were paying a
// React state update and a commit per image to duplicate it.
//
// This file's own history records the metric failing once already: pacing made
// reported durations climb to 2367 ms because the timer included queue wait, and
// the fix at the time was to correct the timer and KEEP the stagger. The timer
// was indeed wrong. So was the stagger.
//
// ── WHY THE SCROLL LATCH WAS REMOVED ────────────────────────────────────────
//
// `setRevealScrollPaused(true)` stopped BOTH pumps globally for as long as any
// list reported scrolling, plus a 200 ms idle tail. The intent was "media loads
// when you stop scrolling, like Telegram". The effect was: scroll, see empty
// boxes, stop, then watch photos appear one at a time 45 ms apart. That is the
// literal shape of the "everything is loading, something is being drawn every
// millisecond" report this whole effort is chasing. It was also GLOBAL, so a
// scroll on one screen withheld images on another.
//
// Telegram does not do this. It decodes off the main thread and paints when
// ready; it does not withhold a decoded bitmap it already has because a finger
// is down.
//
// ── WHAT REPLACES THEM ──────────────────────────────────────────────────────
//
// Nothing at this layer, deliberately. The real fixes for image cost are one
// layer out and are not scheduling tricks: correct `proxyWidth` so the bytes are
// thumbnail-sized, `Cache-Control: immutable` so a revisit is a disk hit, and
// getting off the third-party proxy so the connection pool is ours. Those make
// the work small. Spacing it out only made it late.

import { useEffect, useState } from 'react';

/**
 * No-op. Kept as an export so the screens that call it on every scroll event
 * keep compiling; see the header for why the global pause was removed.
 *
 * Intentionally not deleted-and-inlined at the call sites in the same commit:
 * those sites also drive `gifTracker.setScrolling`, which is a separate and
 * still-valid mechanism (it pauses GIF ANIMATION off-screen, which is real work
 * on a real thread, rather than withholding a decode).
 */
export function setRevealScrollPaused(_paused: boolean): void {
  /* no-op — the pumps this gated no longer exist */
}

/**
 * Latches `true` as soon as `active` is true and stays true, matching the
 * previous contract exactly — minus the wait. `active=false` still opts out.
 *
 * The latch is what makes a recycled FlashList cell keep the reveal it already
 * earned instead of flickering back to a placeholder, so it is kept even though
 * no current caller flips `active` back to false.
 */
export function useStaggeredReveal(active: boolean): boolean {
  const [latched, setLatched] = useState(active);
  useEffect(() => {
    if (active && !latched) setLatched(true);
  }, [active, latched]);
  // `active ||` rather than `latched` alone: true on the FIRST render where the
  // caller is active, so there is no one-render placeholder before the effect
  // runs. Without it this hook would still cost a blank frame per image.
  return active || latched;
}

/**
 * Previously a wider-spaced sibling for animated GIFs. Now identical to
 * {@link useStaggeredReveal}; kept as a separate export so call sites that
 * distinguish photo from GIF read the same as before and so the distinction can
 * be reintroduced at one place if a measurement ever justifies it.
 *
 * Note the thing that made GIFs genuinely different is still handled elsewhere
 * and was never this pump's job: `gifPlaybackTracker` stops ANIMATION for
 * off-screen GIFs, which is continuous per-frame work, unlike a one-time decode.
 */
export function useStaggeredGifReveal(active: boolean): boolean {
  return useStaggeredReveal(active);
}
