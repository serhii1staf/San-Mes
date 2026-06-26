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

import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
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
  /** Height of the placeholder box. Default `16`. */
  height?: number;
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

/** Full sweep duration in ms — kept subtle / Telegram-like. */
const SHIMMER_DURATION = 1200;

/**
 * Resolve the base (box) and highlight (sweep band) colors for the
 * requested mode. Base is intentionally very subtle; the highlight is
 * a slightly brighter band that fades in and back out at its edges so
 * the sweep reads as a soft glow rather than a hard bar.
 */
function getColors(isDark: boolean): {
  base: string;
  /** Gradient stops: transparent -> highlight -> transparent. */
  gradient: readonly [string, string, string];
} {
  if (isDark) {
    return {
      base: 'rgba(255,255,255,0.06)',
      gradient: [
        'rgba(255,255,255,0)',
        'rgba(255,255,255,0.10)',
        'rgba(255,255,255,0)',
      ],
    };
  }
  return {
    base: 'rgba(0,0,0,0.06)',
    gradient: [
      'rgba(0,0,0,0)',
      'rgba(0,0,0,0.07)',
      'rgba(0,0,0,0)',
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

  // `progress` drives the sweep: 0 -> 1 maps to the highlight band
  // travelling from fully off the left edge to fully off the right.
  // It is mutated only on the UI thread by the Reanimated runtime.
  const progress = useSharedValue(0);

  // Measured box width (px). Used to drive a NUMERIC translateX in the
  // sweep worklet — a string-percentage translateX can throw
  // "translateX must be a number" on some Reanimated versions. Stays 0
  // until the first `onLayout`, which makes the first frame a no-op
  // translate (harmless) until the real width is known.
  const boxW = useSharedValue(0);

  // Reduced-motion: default to animated, then flip to static if the OS
  // setting is enabled. Read once on mount (plus a subscription so a
  // mid-session toggle is respected). `undefined` = not yet resolved.
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        if (mounted) setReduceMotion(enabled);
      }
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  // Start / stop the UI-thread loop. When reduced-motion is on we never
  // start it (static base box). Cleanup cancels the animation so the
  // worklet loop is torn down on unmount.
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, {
        duration: SHIMMER_DURATION,
        easing: Easing.inOut(Easing.ease),
      }),
      -1, // repeat forever
      false // don't reverse — always sweep left -> right
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [reduceMotion, progress]);

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
      transform: [{ translateX: (progress.value * 2 - 1) * boxW.value }],
    };
  });

  return (
    <View
      style={[
        styles.container,
        // Cast: RN's ViewStyle accepts `number | string` for width at
        // runtime; the public prop type mirrors that flexibility.
        { width: width as ViewStyle['width'], height, borderRadius: radius, backgroundColor: base },
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
