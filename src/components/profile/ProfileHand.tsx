/**
 * The hand that pulls a profile's header up as the page scrolls: it grows out of the top of the
 * screen (the Dynamic Island, or the top edge), reaches the avatar, then the name, then the buttons,
 * takes hold of each and pulls it up. The timeline is in profileHandMath.ts.
 *
 * ── COST ──────────────────────────────────────────────────────────────────────────────────────
 *
 * Only transforms and one opacity, all interpolated from the scroll offset on the native driver, so a
 * frame costs no JavaScript. The arm and the claw are two static SVG drawings (nothing in them is
 * animated); the arm is stretched by `scaleY` and turned by `rotate`, the claw only moved and turned.
 * Built once the page has told it where the name and the buttons are (`marks`, a one-off layout
 * report), and again only if those move.
 *
 * It is a layer of the SCREEN, not of the scrolling card: it has to stay where it is while the card
 * goes by. Both profile screens mount it after their scroll view.
 */
import React, { memo, useMemo, useSyncExternalStore } from 'react';
import { Animated, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../../theme';
import { buildHand } from './profileHandMath';
import type { HandMarksStore } from './profileHandMath';

/** The arm is drawn this long and stretched to the length it needs. */
const ARM_BASE = 100;
const ARM_W = 26;
const ARM_TIP_W = 16;
const CLAW = 30;

export const ProfileHand = memo(function ProfileHand({
  topInset,
  scrollY,
  marks,
}: {
  topInset: number;
  scrollY: Animated.Value;
  marks: HandMarksStore;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const m = useSyncExternalStore(marks.subscribe, marks.get);
  const island = Platform.OS === 'ios' && topInset >= 51;

  const motion = useMemo(() => {
    if (!m) return null;
    const h = buildHand({ width, topInset, island, marks: m });
    // `interpolate` needs two points at least and strictly rising inputs; the samples are both.
    const arm = h.len.map((l) => Math.max(0, l - 3) / ARM_BASE);
    return {
      shoulder: h.shoulder,
      armStyle: {
        transform: [
          { rotate: scrollY.interpolate({ inputRange: h.s, outputRange: h.angle.map((a) => `${a}rad`), extrapolate: 'clamp' }) },
          { scaleY: scrollY.interpolate({ inputRange: h.s, outputRange: arm, extrapolate: 'clamp' }) },
        ],
      },
      clawStyle: {
        opacity: scrollY.interpolate({ inputRange: h.s, outputRange: h.len.map((l) => (l > 3 ? 1 : 0)), extrapolate: 'clamp' }),
        transform: [
          { translateX: scrollY.interpolate({ inputRange: h.s, outputRange: h.x.map((x) => x - CLAW / 2), extrapolate: 'clamp' }) },
          { translateY: scrollY.interpolate({ inputRange: h.s, outputRange: h.y.map((y) => y - CLAW / 2), extrapolate: 'clamp' }) },
          { rotate: scrollY.interpolate({ inputRange: h.s, outputRange: h.angle.map((a) => `${a}rad`), extrapolate: 'clamp' }) },
        ],
      },
    };
  }, [m, width, topInset, island, scrollY]);

  if (!motion) return null;
  // Black on a light page, white on a dark one: the page's own text colour.
  const color = theme.colors.text.primary;
  const half = CLAW / 2;

  return (
    <View pointerEvents="none" style={styles.layer}>
      {/* The arm: hangs from the shoulder, turned and stretched toward the claw. */}
      <Animated.View
        style={[
          styles.arm,
          { left: motion.shoulder.x - ARM_W / 2, top: motion.shoulder.y, width: ARM_W, height: ARM_BASE },
          motion.armStyle,
        ]}
      >
        <Svg width={ARM_W} height={ARM_BASE} viewBox={`0 0 ${ARM_W} ${ARM_BASE}`}>
          <Path d={`M0 0 H${ARM_W} L${ARM_W - (ARM_W - ARM_TIP_W) / 2} ${ARM_BASE} H${(ARM_W - ARM_TIP_W) / 2} Z`} fill={color} />
        </Svg>
      </Animated.View>
      {/* The claw: a small cluster of petals at the end, as in the reference. */}
      <Animated.View style={[styles.claw, { width: CLAW, height: CLAW }, motion.clawStyle]}>
        <Svg width={CLAW} height={CLAW} viewBox={`0 0 ${CLAW} ${CLAW}`}>
          <Circle cx={half} cy={half} r={7.5} fill={color} />
          <Circle cx={half - 6.5} cy={half - 1} r={5} fill={color} />
          <Circle cx={half + 6.5} cy={half - 1} r={5} fill={color} />
          <Circle cx={half - 3.5} cy={half + 6.5} r={5} fill={color} />
          <Circle cx={half + 3.5} cy={half + 6.5} r={5} fill={color} />
        </Svg>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 90, overflow: 'hidden' },
  // Turns about its top middle (the shoulder), not about its centre.
  arm: { position: 'absolute', transformOrigin: ['50%', 0, 0] },
  claw: { position: 'absolute', left: 0, top: 0 },
});
