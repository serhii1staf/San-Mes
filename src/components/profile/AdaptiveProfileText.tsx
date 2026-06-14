import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, TextStyle } from 'react-native';

// Smooth-crossfade text wrapper for the @username + display-name labels
// that sit on top of the profile banner. Driven by `isLight` (resolved
// from the banner's bottom-region luminance via useBannerBrightness),
// which the parent computes once per render — when it flips, the
// component animates a single Animated.Value driver from 0 → 1 (or 1 → 0)
// over 250 ms and uses JS-driver colour interpolation between the
// dark- and light-variant colours.
//
// Why a single Animated.Text + colour interpolation instead of two
// stacked Animated.Texts crossfading via opacity:
//   - Colour interpolation never causes layout reflow. Two stacked
//     Texts would either need absolute-positioning over a hidden
//     layout-driver (extra DOM and a third measurement) or risk
//     bumping the row's intrinsic size mid-fade.
//   - Banner brightness is sticky once resolved (cached per URL).
//     The transition fires at most ONCE per profile open, when the
//     fetch-deferred brightness lands and tips the threshold. JS-
//     driver colour animation for one short hop is well within
//     budget; we are not animating per-frame for hours.
//
// Layout / shadow rules:
//   - The component only swaps `color`; it does NOT swap textShadow,
//     fontSize, fontWeight, or any layout-affecting style. Those stay
//     on the parent <Animated.Text> via the `style` prop.
//   - The parent passes a `style` that already includes textShadow
//     (white text on dark gradient gets the shadow; on light
//     backgrounds the shadow is barely visible and never harms
//     legibility). Keeping the shadow always-on is the user-visible
//     "guarantee minimum contrast on every banner" the spec calls
//     for, layered on top of the existing dark gradient backdrop.

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
   * here — the component overrides `color` with its animated value.
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
  // Driver: 0 → dark-banner (white text), 1 → light-banner (dark text).
  // Initial value matches `isLight` on first paint so the very first
  // frame already shows the right colour for cached brightness.
  const driver = useRef(new Animated.Value(isLight ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(driver, {
      toValue: isLight ? 1 : 0,
      duration: 250,
      // Colour interpolation is not supported by the native driver in
      // RN's Animated; we drive it from JS. Fine because this animation
      // fires at most once per banner-brightness resolution.
      useNativeDriver: false,
    }).start();
  }, [isLight, driver]);

  const color = driver.interpolate({
    inputRange: [0, 1],
    outputRange: [darkBgColor, lightBgColor],
  });

  return (
    <Animated.Text numberOfLines={numberOfLines} style={[style, { color }]}>
      {children}
    </Animated.Text>
  );
}
