/**
 * Skeleton / shimmer placeholder
 * ------------------------------------------------------------------
 * A dependency-light, fully-controlled loading placeholder built on
 * `react-native-reanimated`. Used across the app (feed, comments,
 * profile, chat) so real content can fade in over a skeleton instead
 * of popping in abruptly.
 *
 * DESIGN: UI-thread-only shimmer
 * ------------------------------------------------------------------
 * The shimmer is driven by a single Reanimated shared value that is
 * looped on the UI thread via `withRepeat(withTiming(...))`. The
 * animated style is computed inside a `useAnimatedStyle` worklet, so
 * the highlight band is translated across the box entirely on the UI
 * thread. This means:
 *
 *   - ZERO JS-thread work per frame (no setInterval, no setState loop,
 *     no Animated.event listeners bouncing over the bridge).
 *   - Skeletons stay buttery even while the JS thread is busy doing
 *     scroll handling / navigation transitions on weak devices.
 *
 * The only JS work happens once: on mount (start the loop) and on
 * unmount (cancel the loop). Reduced-motion is read once in an effect.
 */

import React, { useEffect, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo,
  AppState,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme';

export interface SkeletonProps {
  /** Width of the placeholder box. Default `'100%'`. */
  width?: number | string;
  /**
   * Height of the placeholder box. Default `16`. Accepts a percentage string
   * too (callers fill image slots with `height="100%"`), matching what RN's
   * `ViewStyle` allows at runtime.
   */
  height?: number | string;
  /** Corner radius. Default `8`. */
  radius?: number;
  /** Extra style merged onto the container (last, so it can override). */
  style?: StyleProp<ViewStyle>;
  /**
   * Force a color mode. When omitted, colors are derived from the app
   * theme (`useTheme().isDark`).
   */
  colorMode?: 'light' | 'dark';
}

/**
 * Full sweep duration in ms — lively but smooth. A touch quicker than
 * a full second so the band feels alive without being frantic.
 */
const SHIMMER_DURATION = 1150;

// ─── ONE clock for every skeleton on screen ─────────────────────────────────────
//
// Each `Skeleton` used to own its own `withRepeat(…, -1)`. The header above is right that
// this costs no JS per frame — but it is one INFINITE UI-thread animation per instance, and
// instances are not rare: a loading feed is several skeleton cards, each made of several
// boxes, so a single screen could hold dozens of forever-looping animations. They also never
// stop. `cancelAnimation` runs on unmount, and nothing else does, so a skeleton scrolled
// off-screen or left behind on a backgrounded app keeps sweeping.
//
// The sweep is the same phase for every skeleton of the same age, so there is nothing to gain
// from per-instance clocks. One module-level shared value, reference-counted, gives identical
// output for one animation instead of N.
//
// Visible consequence, and it is an improvement rather than a regression: skeletons are now
// exactly in phase instead of each starting when its own cell mounted. A list whose rows
// mount progressively used to shimmer in a ragged cascade; it now sweeps as one surface,
// which is what iOS and Telegram both do.
const shimmerProgress = makeMutable(0);
let shimmerMounted = 0;
let shimmerRunning = false;

function startShimmerClock(): void {
  if (shimmerRunning) return;
  shimmerRunning = true;
  shimmerProgress.value = 0;
  shimmerProgress.value = withRepeat(
    withTiming(1, { duration: SHIMMER_DURATION, easing: Easing.inOut(Easing.ease) }),
    -1, // repeat forever — but only while at least one skeleton is mounted
    false, // don't reverse — always sweep left -> right
  );
}

function stopShimmerClock(): void {
  if (!shimmerRunning) return;
  cancelAnimation(shimmerProgress);
  shimmerRunning = false;
}

/** Mount one skeleton. Starts the shared clock on the first one. */
function acquireShimmer(): void {
  shimmerMounted += 1;
  if (shimmerMounted === 1 && !reduceMotion) startShimmerClock();
}

/** Unmount one skeleton. Stops the shared clock when the last one goes. */
function releaseShimmer(): void {
  shimmerMounted = Math.max(0, shimmerMounted - 1);
  if (shimmerMounted === 0) stopShimmerClock();
}

// Backgrounding the app stops the clock outright. An animation the user cannot see has no
// reason to hold the UI thread awake, and on return it restarts from phase 0 — which is
// invisible, because a shimmer has no meaningful position to preserve.
try {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      if (shimmerMounted > 0 && !reduceMotion) startShimmerClock();
    } else {
      stopShimmerClock();
    }
  });
} catch { /* no AppState in this environment — the clock simply never pauses */ }

// ─── ONE reduce-motion subscription ─────────────────────────────────────────────
//
// This was per-instance too: every skeleton fired its own
// `AccessibilityInfo.isReduceMotionEnabled()` promise and registered its own
// `reduceMotionChanged` listener on mount. Dozens of native round-trips and dozens of
// listeners for a value that is global and changes almost never.
//
// Module-level store read through `useSyncExternalStore`, mirroring the pattern
// `src/components/ui/LiquidGlass.tsx` already uses for Reduce Transparency.
let reduceMotion = false;
const reduceMotionListeners = new Set<() => void>();

function setReduceMotion(next: boolean): void {
  if (next === reduceMotion) return;
  reduceMotion = next;
  // Honour the change immediately: stop a running clock, or start one if skeletons are up.
  if (next) stopShimmerClock();
  else if (shimmerMounted > 0) startShimmerClock();
  reduceMotionListeners.forEach((fn) => {
    try { fn(); } catch { /* a torn-down subscriber must not break the others */ }
  });
}

// Guarded because these now run at MODULE scope, i.e. on import. Per-instance they sat inside
// an effect, where a throw would have been contained to one component; here an older binary or
// a test environment without the accessibility module would take down every screen that
// imports a Skeleton. The failure mode is "shimmer stays on", which is the correct default.
try {
  AccessibilityInfo.isReduceMotionEnabled()
    .then(setReduceMotion)
    .catch(() => { /* keep the default (animated) */ });
  AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
} catch { /* accessibility API unavailable — stay animated */ }

function subscribeReduceMotion(onChange: () => void): () => void {
  reduceMotionListeners.add(onChange);
  return () => { reduceMotionListeners.delete(onChange); };
}

function getReduceMotion(): boolean {
  return reduceMotion;
}

/**
 * Resolve the base (box) and highlight (sweep band) colors for the
 * requested mode. The base is clearly tinted so the resting box reads
 * on its own, and the highlight is a bright band whose alpha ramps up
 * then back down across FIVE stops (0 -> soft -> peak -> soft -> 0) so
 * the leading/trailing edges feather into a soft glow with depth,
 * rather than a flat, hard-edged bar.
 */
function getColors(isDark: boolean): {
  base: string;
  /**
   * Gradient stops for the moving highlight band. Five stops give the
   * band a feathered glow: fully transparent at both ends, a gentle
   * shoulder on each side, and a bright peak in the middle. Typed as a
   * 2+ tuple so it satisfies `expo-linear-gradient`'s `colors` prop.
   */
  gradient: readonly [string, string, ...string[]];
} {
  if (isDark) {
    return {
      // Clearly-visible tinted base box.
      base: 'rgba(255,255,255,0.10)',
      // Bright white sweep with feathered shoulders for a glowy band.
      gradient: [
        'rgba(255,255,255,0)',
        'rgba(255,255,255,0.08)',
        'rgba(255,255,255,0.28)',
        'rgba(255,255,255,0.08)',
        'rgba(255,255,255,0)',
      ],
    };
  }
  return {
    // Darker gray base so the bright band reads as a glossy sweep.
    base: 'rgba(0,0,0,0.09)',
    // Bright white glossy band over the gray base — the classic,
    // clearly-visible "content loading" shimmer.
    gradient: [
      'rgba(255,255,255,0)',
      'rgba(255,255,255,0.18)',
      'rgba(255,255,255,0.65)',
      'rgba(255,255,255,0.18)',
      'rgba(255,255,255,0)',
    ],
  };
}

function SkeletonBase({
  width = '100%',
  height = 16,
  radius = 8,
  style,
  colorMode,
}: SkeletonProps) {
  const theme = useTheme();
  const isDark = colorMode ? colorMode === 'dark' : theme.isDark;
  const { base, gradient } = getColors(isDark);

  // Measured box width (px). Used to drive a NUMERIC translateX in the
  // sweep worklet — a string-percentage translateX can throw
  // "translateX must be a number" on some Reanimated versions. Stays 0
  // until the first `onLayout`, which makes the first frame a no-op
  // translate (harmless) until the real width is known.
  const boxW = useSharedValue(0);

  // Reduced-motion, read from the ONE module-level subscription rather than each skeleton
  // opening its own. See the note beside `subscribeReduceMotion`.
  const reduceMotion = useSyncExternalStore(subscribeReduceMotion, getReduceMotion, getReduceMotion);

  // Join / leave the shared shimmer clock. The clock itself runs at module scope and is
  // reference-counted, so this is a counter bump rather than starting an animation.
  useEffect(() => {
    acquireShimmer();
    return releaseShimmer;
  }, []);

  // Translate the highlight band across the box. The gradient layer is
  // 2x the box width (`width: '200%'`) and starts shifted one box-width
  // to the left (`left: '-50%'`), so sweeping it by ±one box-width takes
  // it from fully off-left to fully off-right. We drive this with a
  // NUMERIC translateX derived from the measured box width
  // (`boxW.value`, px) rather than a percentage string, because a
  // string-percentage translateX inside a worklet throws
  // "translateX must be a number" on some Reanimated versions/configs.
  // When `boxW.value` is 0 (not measured yet) the offset is 0 — a safe
  // no-op for the first frame. Computed in a worklet — no JS thread
  // involvement per frame.
  const sweepStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: (shimmerProgress.value * 2 - 1) * boxW.value }],
    };
  });

  return (
    <View
      style={[
        styles.container,
        // Cast: RN's ViewStyle accepts `number | string` for width at
        // runtime; the public prop type mirrors that flexibility.
        {
          width: width as ViewStyle['width'],
          height: height as ViewStyle['height'],
          borderRadius: radius,
          backgroundColor: base,
        },
        style,
      ]}
      // Measure the box so the sweep worklet can use a numeric
      // translateX (px) instead of a percentage string.
      onLayout={(e) => {
        boxW.value = e.nativeEvent.layout.width;
      }}
      // Decorative placeholder — hide from the accessibility tree.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {!reduceMotion && (
        <Animated.View style={[StyleSheet.absoluteFill, styles.sweep, sweepStyle]}>
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden', // clip the translated highlight band
  },
  sweep: {
    // The gradient layer is twice as wide as the box so the highlight
    // can travel a full box-width on either side without showing seams.
    width: '200%',
    left: '-50%',
  },
});

/**
 * Default skeleton box. Wrapped in `React.memo` because props are
 * primitive/stable and the heavy lifting lives on the UI thread — no
 * need to re-render on unrelated parent updates.
 */
const Skeleton = React.memo(SkeletonBase);
Skeleton.displayName = 'Skeleton';

export default Skeleton;

export interface SkeletonCircleProps
  extends Omit<SkeletonProps, 'width' | 'height' | 'radius'> {
  /** Diameter of the circle (sets width, height and radius). */
  size: number;
}

/**
 * Convenience circular skeleton for avatars: width = height = size and
 * radius = size / 2.
 */
export const SkeletonCircle = React.memo(function SkeletonCircle({
  size,
  ...rest
}: SkeletonCircleProps) {
  return <Skeleton {...rest} width={size} height={size} radius={size / 2} />;
});
SkeletonCircle.displayName = 'SkeletonCircle';
