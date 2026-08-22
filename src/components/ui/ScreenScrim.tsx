import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { bottomScrimColors, SCRIM_LOCATIONS, topScrimColors } from '../../theme/scrim';

// Top and/or bottom edge scrim for a screen.
//
// WHY A COMPONENT AND NOT A COPY PER SCREEN
//   These gradients were hand-written on each screen, with slightly different stops,
//   heights and locations. The result was that they drifted apart, corrections landed
//   on some screens and not others, and several screens ended up with no scrim at all —
//   which is exactly the "why isn't it everywhere" problem. One component, one ramp
//   (src/theme/scrim.ts), applied identically.
//
// LAYERING — THE PART THAT MATTERS
//   The scrim must sit ABOVE the scrolling content and BELOW the chrome (title row,
//   buttons, tab bar, input bar). If it lands above the chrome it dims the very
//   controls it exists to make legible, which was the reported "it covers the
//   navigation".
//
//   So it takes a deliberately LOW `zIndex` (1) and must be rendered as a sibling
//   BEFORE the chrome in the same parent. It never wraps the chrome.
//
// COST
//   Two `LinearGradient` views with `pointerEvents: none`, both static — no animated
//   values, no layout participation (absolutely positioned), nothing recomputed on
//   scroll. A gradient is a single GPU-composited quad, so this does not compete with
//   list scrolling the way a live blur would. That is why it is a gradient and not a
//   `BlurView`: the same reason the codebase already renders blur only on iOS and only
//   where a native masked view is available.

export interface ScreenScrimProps {
  /** Height of the top scrim. Omit or 0 to skip it. */
  topHeight?: number;
  /** Height of the bottom scrim. Omit or 0 to skip it. */
  bottomHeight?: number;
  /**
   * Add the safe-area insets to the requested heights.
   *
   * On by default: a scrim exists to cover content passing under the status bar and
   * the home indicator, so it has to reach the physical edges of the display.
   */
  includeInsets?: boolean;
}

export const ScreenScrim = React.memo(function ScreenScrim({
  topHeight = 0,
  bottomHeight = 0,
  includeInsets = true,
}: ScreenScrimProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const bg = theme.colors.background.primary;
  const top = topScrimColors(theme.isDark, bg);
  const bottom = bottomScrimColors(theme.isDark, bg);

  const resolvedTop = topHeight > 0 ? topHeight + (includeInsets ? insets.top : 0) : 0;
  const resolvedBottom = bottomHeight > 0 ? bottomHeight + (includeInsets ? insets.bottom : 0) : 0;

  return (
    // `box-none` so neither this wrapper nor the gradients can swallow a touch meant
    // for the list underneath.
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="none">
      {resolvedTop > 0 ? (
        <LinearGradient
          colors={top}
          locations={SCRIM_LOCATIONS}
          style={[styles.top, { height: resolvedTop }]}
          pointerEvents="none"
        />
      ) : null}
      {resolvedBottom > 0 ? (
        <LinearGradient
          colors={bottom}
          locations={SCRIM_LOCATIONS}
          style={[styles.bottom, { height: resolvedBottom }]}
          pointerEvents="none"
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  // Low, so screen chrome rendered after this sibling paints on top of it.
  layer: { zIndex: 1 },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },
});
