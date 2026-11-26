import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { Text } from './Text';
import { useTheme } from '../../theme';
import { BAND_CONTENT_HEIGHT, BAND_TOP_GAP } from '../../lib/browserWidget';

// ── The minimized bar's pieces, drawn by the bar and by the mini app turning into it ─────────────
//
// The bar at the bottom (BrowserBottomBand) and the copy of it that the mini app's panel carries on
// its top edge while it shrinks into the bar or grows out of it (MiniAppHost) are built from these,
// so where one hands over to the other they are the same pixels.

/** Telegram's header corner radius, for the bar's top corners. */
export const BAR_CORNER = 25;
/** Telegram's `bottomEdgeCornerRadius`: the bottom corners of the screen resting on the bar. */
export const APP_CORNER = 30;
/** The area at the left that closes, as in Telegram's tap handler (`location.x < 48`). */
const CLOSE_SIDE = 56;

/** Telegram's close glyph: two 2 pt strokes with round caps in a 14 pt square. */
function CloseGlyph({ color }: { color: string }) {
  const inset = 1.35;
  return (
    <Svg width={14} height={14}>
      <Line x1={inset} y1={inset} x2={14 - inset} y2={14 - inset} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Line x1={14 - inset} y1={inset} x2={inset} y2={14 - inset} stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** The bar's colours: its surface and its ink. */
export function useMinimizedBarColors(): { surface: string; ink: string } {
  const theme = useTheme();
  return {
    surface: theme.isDark ? theme.colors.background.secondary : theme.colors.background.elevated,
    ink: theme.colors.text.primary,
  };
}

/**
 * The bar's 56 pt row: the title bold and centred, the × on the left.
 *
 * Without `onClose` the × is only drawn, for the panel's copy.
 */
export function MinimizedBarRow({ title, ink, onClose, closeLabel }: {
  title: string;
  ink: string;
  onClose?: () => void;
  closeLabel?: string;
}) {
  return (
    <View style={styles.row}>
      <Text variant="body" weight="bold" numberOfLines={1} align="center" color={ink} style={styles.title}>
        {title}
      </Text>
      {onClose ? (
        <Pressable onPress={onClose} hitSlop={4} accessibilityRole="button" accessibilityLabel={closeLabel} style={styles.close}>
          <CloseGlyph color={ink} />
        </Pressable>
      ) : (
        <View style={styles.close} pointerEvents="none">
          <CloseGlyph color={ink} />
        </View>
      )}
    </View>
  );
}

/** The black outside a rounded corner of the screen above: for the bottom-left corner, flip for the right. */
function cornerPath(r: number): string {
  return `M0,0 A${r},${r} 0 0 0 ${r},${r} L0,${r} Z`;
}

/**
 * The bottom corners of the screen above the bar, rounded by drawing the black outside them over its
 * last APP_CORNER points (Telegram's `bottomEdgeView`), so the screen reads as a card resting on the bar.
 */
export function AppCornerCutouts() {
  return (
    <View style={styles.corners} pointerEvents="none">
      <Svg width={APP_CORNER} height={APP_CORNER}>
        <Path d={cornerPath(APP_CORNER)} fill="#000" />
      </Svg>
      <Svg width={APP_CORNER} height={APP_CORNER} style={styles.flipX}>
        <Path d={cornerPath(APP_CORNER)} fill="#000" />
      </Svg>
    </View>
  );
}

export const minimizedBarStyles = StyleSheet.create({
  /** The bar's band: black, as tall as `browserBandHeight` (the caller sets it). */
  band: { backgroundColor: '#000' },
  /**
   * The bar's surface in its band: below the black gap, rounded on top, iOS's continuous corner as
   * Telegram's `applySmoothRoundedCorners`. The caller adds the colour.
   */
  surface: {
    flex: 1,
    marginTop: BAND_TOP_GAP,
    borderTopLeftRadius: BAR_CORNER,
    borderTopRightRadius: BAR_CORNER,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
});

const styles = StyleSheet.create({
  row: { height: BAND_CONTENT_HEIGHT, justifyContent: 'center' },
  title: { fontSize: 17, lineHeight: 22, marginHorizontal: CLOSE_SIDE },
  close: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CLOSE_SIDE,
    height: BAND_CONTENT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  corners: { height: APP_CORNER, flexDirection: 'row', justifyContent: 'space-between' },
  flipX: { transform: [{ scaleX: -1 }] },
});
