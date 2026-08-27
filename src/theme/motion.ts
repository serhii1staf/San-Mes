// Shared motion constants.
//
// WHY THIS FILE EXISTS
//   The chat list's selection mode swaps two pieces of bottom chrome: the floating tab bar
//   slides DOWN out of the way while the contextual action bar slides UP into its place.
//   They live in different trees — the tab bar is mounted by the navigator, the action bar
//   by the screen — so the only way they can move as one gesture is for both to read the
//   same curve from the same place.
//
//   They previously each ran their own `withTiming(220, out(cubic))`. Identical numbers,
//   but two independent clocks started by two different effects, and a linear-in-time
//   curve on chrome that appears from off-screen reads as mechanical: it starts at full
//   speed the instant it is armed. That is the "it shifts too abruptly" report.
//
// WHY A SPRING RATHER THAN A LONGER TIMING
//   Slowing the timing curve down makes the same motion take longer; it does not change
//   the fact that the bar arrives at constant-ish speed and then stops. A spring has the
//   property that matters here — it decelerates into its target from its own momentum, so
//   the bar settles rather than halting.
//
//   `damping: 22, stiffness: 180, mass: 0.9` puts the damping ratio at ~0.86: just inside
//   underdamped, so there is a trace of settle without a visible bounce. Chrome that
//   bounces reads as a toy; chrome that lands dead reads as a jump.

/**
 * The spring both bottom-chrome surfaces use, in opposite directions.
 *
 * Consumers: `SelectionActionBar` in `app/(tabs)/messages.tsx` (slides up) and the hide
 * transform in `src/components/navigation/CustomTabBar.tsx` (slides down). If you change
 * this, you are changing both — which is the point.
 */
export const BOTTOM_CHROME_SPRING = {
  damping: 22,
  stiffness: 180,
  mass: 0.9,
} as const;

// ─── The profile's pinned category tabs, revealed on scroll ────────────────────
//
// WHY THIS IS SHARED
//   `app/(tabs)/profile.tsx` and `app/profile/[id].tsx` both slide a pinned tab bar
//   in from above as the inline tabs row scrolls up to meet it, and both had this
//   arithmetic written out longhand. Same drift problem the scrim ramp had: a
//   correction lands on one screen and not the other. One definition, two callers.
//
// WHAT WAS WRONG WITH IT
//   Reported: swipe up, the categories go and the header arrives, and it arrives
//   too abruptly — it lacks smoothness.
//
//   Both screens ramped the reveal over a **24 px** scroll window:
//
//       const start = Math.max(0, end - 24);
//       scrollY.interpolate({ inputRange: [start, end], outputRange: [-(pinnedBarTop + 64), 0] })
//
//   The bar's travel is `pinnedBarTop + 64`, which is about 110-120 px on a notched
//   phone. So 24 px of finger movement drove ~115 px of bar movement: a roughly 5x
//   amplification, linear in scroll, starting and stopping instantly. That is not a
//   tuning nuance — at any scroll speed the bar crosses its whole travel in the time
//   the finger covers 24 px, so it necessarily reads as a slam.
//
//   The 24 was not arbitrary either; it was small so the bar would not hang around
//   half-visible. But the fix for "don't linger" is easing, not a short window.
//
// THE TWO CHANGES
//   1. A longer window (96 px), which brings the amplification down to ~1.2x — the
//      bar now moves at roughly the same speed as the finger instead of five times it.
//   2. A `smoothstep` shape instead of a straight line, so the velocity is zero at
//      BOTH ends. A linear ramp has a velocity discontinuity where it begins and
//      another where it clamps, and those two corners are what the eye reads as
//      abruptness. `t * t * (3 - 2 * t)` removes both.
//
//   The window still ENDS exactly at `end`. That is deliberate and load-bearing: both
//   screens document that `end === tabsOffsetY - pinnedBarTop` is the moment the
//   inline tabs row arrives at the pinned bar's position, so finishing there is what
//   keeps the inline-to-pinned handoff pixel-aligned. Only the approach changed.
//
//   Six samples, not two, because RN's `interpolate` is piecewise-linear between the
//   points it is given — the curve has to be sampled to exist at all. Six is enough
//   that the residual straight segments are well under a pixel of error across ~115 px.
//
// WHY NOT A SPRING OR A TIMING
//   This motion is not time-driven, it is scroll-driven: the bar's position is a pure
//   function of the finger. `BOTTOM_CHROME_SPRING` above is right for chrome that is
//   *triggered* and then animates on its own clock. Handing a scroll-linked transform
//   to a clock would make it lag the finger, which is a different and worse complaint.

/** Scroll distance over which the pinned tab bar completes its reveal. */
export const PINNED_TABS_REVEAL_SCROLL = 96;

/** Points the smoothstep curve is sampled at. Endpoints included. */
const REVEAL_SAMPLES = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;

/**
 * Build the `scrollY.interpolate` config for the profile's pinned tab bar.
 *
 * @param end          Scroll offset at which the bar is fully in place — the callers'
 *                     `tabsOffsetY - pinnedBarTop`. Callers signal "not measured yet"
 *                     with a huge sentinel; that is handled here.
 * @param hiddenOffset The bar's off-screen translateY, i.e. a NEGATIVE number such as
 *                     `-(pinnedBarTop + 64)`.
 */
export function pinnedTabsRevealConfig(
  end: number,
  hiddenOffset: number,
): { inputRange: number[]; outputRange: number[] } {
  // Not measured yet (callers pass `Number.MAX_SAFE_INTEGER`), or a degenerate
  // measurement. Park the bar off-screen with a minimal, strictly-increasing range.
  //
  // Handled explicitly rather than by letting the arithmetic below run: near
  // `Number.MAX_SAFE_INTEGER` the gap between representable doubles is 2, so adding
  // fractions of the window can round two samples onto the same value, and RN
  // requires a strictly increasing `inputRange`.
  if (!Number.isFinite(end) || end <= 0 || end > 1e7) {
    return { inputRange: [0, 1], outputRange: [hiddenOffset, hiddenOffset] };
  }

  const start = Math.max(0, end - PINNED_TABS_REVEAL_SCROLL);
  const span = end - start;
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (const t of REVEAL_SAMPLES) {
    inputRange.push(start + span * t);
    // smoothstep: 0 at t=0, 1 at t=1, zero derivative at both ends.
    const progress = t * t * (3 - 2 * t);
    // Fully hidden at progress 0, fully in place at progress 1.
    outputRange.push(hiddenOffset * (1 - progress));
  }
  return { inputRange, outputRange };
}
