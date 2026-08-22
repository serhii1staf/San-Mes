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
