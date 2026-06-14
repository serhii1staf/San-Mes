import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleProp, TextStyle } from 'react-native';

// Adaptive @username + display-name labels that sit on top of the profile
// banner. Driven by `isLight` (resolved from the banner's bottom-region
// luminance via useBannerBrightness): when the banner reads dark we render
// near-white text; when it reads light we render near-black.
//
// Implementation note (perf):
//   The previous version drove a JS-thread Animated colour interpolation
//   between the dark and light variants on every `isLight` change. That
//   meant 4 Text trees rendering on the profile screen (×2 for own + other
//   profile), each with a JS-driver value chained off the shared scrollY
//   driver — and JS-driver Animated values pump every frame on the JS
//   thread, contributing to the 10–15 fps drop the user reported on tab
//   switching.
//
//   The current approach uses ONE Animated.Text per identity element with
//   plain React-state colour (set imperatively the moment `isLight` flips)
//   and a SHARED Animated.Value-driven opacity nudge. The opacity sits at
//   1 in steady state; on `isLight` change, snap to 0 then animate back to
//   1 over 200 ms with `useNativeDriver: true`. Native-driver opacity is
//   GPU-cheap and never touches the JS thread mid-animation. The colour
//   itself is a plain string on `style.color`, so there is no per-frame
//   bridge traffic during steady-state scroll.
//
// Layout / shadow rules:
//   - The component only swaps `color`; it does NOT swap textShadow,
//     fontSize, fontWeight, or any layout-affecting style. Those stay on
//     the parent <Animated.Text> via the `style` prop.
//   - The parent passes a `style` that already includes textShadow (white
//     text on dark gradient gets the shadow; on light backgrounds the
//     shadow is barely visible and never harms legibility). Always-on
//     shadow plus the dark gradient backdrop is the user-visible
//     "guarantee minimum contrast on every banner" the original spec
//     called for.

interface AdaptiveProfileTextProps {
  /** True when the banner reads as light → use dark text colour. */
  isLight: boolean;
  /** Colour to use when the banner is dark (white-on-banner default). */
  darkBgColor: string;
  /** Colour to use when the banner is light (dark text on a bright surface). */
  lightBgColor: string;
  numberOfLines?: number;
  /**
   * Style applied to the Animated.Text. Pass everything except colour
   * here — the component overrides `color` with its imperative value.
   */
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
}

export function AdaptiveProfileText({
  isLight,
  darkBgColor,
  lightBgColor,
  numberOfLines,
  style,
  children,
}: AdaptiveProfileTextProps) {
  // Plain React state for the colour. Reads correctly on the very first
  // paint (matches `isLight` initial value) and only changes when the
  // brightness flips.
  const [resolvedColor, setResolvedColor] = useState(isLight ? lightBgColor : darkBgColor);
  // Steady-state opacity = 1. On flip, snap to 0 → animate back to 1.
  const opacity = useRef(new Animated.Value(1)).current;
  // Track previous `isLight` so we don't run the nudge on the very first
  // mount (the initial colour already matches and there is nothing to
  // crossfade away from).
  const prevIsLight = useRef(isLight);

  useEffect(() => {
    if (prevIsLight.current === isLight) return;
    prevIsLight.current = isLight;
    // Snap, swap colour, fade back. The colour swap happens between
    // `setValue(0)` and the `Animated.timing` start so the user never
    // sees the old colour at full opacity bleeding into the new colour.
    opacity.setValue(0);
    setResolvedColor(isLight ? lightBgColor : darkBgColor);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isLight, lightBgColor, darkBgColor, opacity]);

  return (
    <Animated.Text
      numberOfLines={numberOfLines}
      style={[style, { color: resolvedColor, opacity }]}
    >
      {children}
    </Animated.Text>
  );
}
