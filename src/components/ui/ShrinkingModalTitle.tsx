/**
 * ShrinkingModalTitle — wraps a bottom-sheet modal's header title and, a few
 * seconds after the screen mounts, performs a subtle one-time shrink (scale
 * 1.0 → 0.85 by default). Purely decorative polish for the slide-up sheets.
 *
 * Implementation notes:
 * - The shrink is a `transform: [{ scale }]` animation on an Animated.View,
 *   so it runs entirely on the native driver (we deliberately do NOT animate
 *   fontSize, which can't be native-driven and would jank on weak devices).
 * - The scale animates around the view's centre, so the title nudges down a
 *   notch in place without shifting the surrounding header layout.
 * - Fires exactly once: a single timer is armed on mount and cleared on
 *   unmount, so re-renders never restack timers.
 * - Children keep their own colour / weight / i18n / numberOfLines styling —
 *   this component only contributes the transform wrapper.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, ViewStyle } from 'react-native';

interface ShrinkingModalTitleProps {
  children: React.ReactNode;
  /** Delay before the shrink fires, in ms. */
  delay?: number;
  /** Duration of the shrink animation, in ms. */
  duration?: number;
  /** Target scale the title shrinks to. */
  toScale?: number;
  style?: StyleProp<ViewStyle>;
}

export function ShrinkingModalTitle({
  children,
  delay = 4000,
  duration = 300,
  toScale = 0.85,
  style,
}: ShrinkingModalTitleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(scale, {
        toValue: toScale,
        duration,
        useNativeDriver: true,
      }).start();
    }, delay);
    return () => clearTimeout(timer);
  }, [scale, delay, duration, toScale]);

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      {children}
    </Animated.View>
  );
}
