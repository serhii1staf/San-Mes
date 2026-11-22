/**
 * The deep backdrop of the sign-in screen: near-black, lit by three soft coloured glows that rise with
 * the sheet, more slowly than the wordmark (parallax), when a form opens, and fade in with the screen.
 *
 * Cheap by construction. Each glow is the same 256 px texture (assets/brand/glow.png, dithered so a big
 * dark copy does not band), tinted and scaled by the GPU; nothing is ever redrawn. They do not drift on
 * their own: a measured idle drift on the Android emulator kept a frame in flight every 16 ms with a
 * 12.6 ms UI-thread part while the user only typed, so they move only while the sheet does. All three
 * move as one view, on React Native's native driver (see the note in app/(auth)/welcome.tsx).
 */
import React, { useMemo } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { AUTH } from './AuthControls';

const GLOW = require('../../../assets/brand/glow.png');

type Glow = {
  color: string;
  opacity: number;
  /** Diameter, as a fraction of the screen width. */
  size: number;
  /** Centre: x as a fraction of the width; y as an offset from the wordmark's centre, in widths. */
  x: number;
  y: number;
};

const GLOWS: Glow[] = [
  { color: '#6C4DFF', opacity: 0.8, size: 1.35, x: 0.32, y: -0.06 },
  { color: '#2F6BFF', opacity: 0.55, size: 1.15, x: 0.98, y: 0.22 },
  { color: '#C447FF', opacity: 0.32, size: 0.9, x: 0.04, y: 0.5 },
];

/** The glows rise at this share of the wordmark's rise: slower, so they read as further away. */
const RISE = 0.7;

export function AuthBackdrop({
  width, focusY, riseBy, open, intro,
}: {
  /** 0 until the screen has been measured: then only the base colour is drawn. */
  width: number;
  /** The wordmark's centre on the welcome screen. */
  focusY: number;
  /** How far the wordmark rises when a form opens. */
  riseBy: number;
  /** 0 welcome, 1 a form open (native-driven). */
  open: Animated.Value;
  /** The screen's entrance, 0 to 1 (native-driven): the glows fade in with it. */
  intro: Animated.Value;
}) {
  const style = useMemo(() => ({
    opacity: intro,
    transform: [{ translateY: open.interpolate({ inputRange: [0, 1], outputRange: [0, -RISE * riseBy] }) }],
  }), [open, intro, riseBy]);
  return (
    <View style={[StyleSheet.absoluteFill, styles.base]} pointerEvents="none">
      {width ? (
        <Animated.View style={[StyleSheet.absoluteFill, style]}>
          {GLOWS.map((glow, i) => {
            const d = glow.size * width;
            return (
              <Image
                key={i}
                source={GLOW}
                style={[
                  styles.glow,
                  {
                    left: glow.x * width - d / 2,
                    top: focusY + glow.y * width - d / 2,
                    width: d,
                    height: d,
                    tintColor: glow.color,
                    opacity: glow.opacity,
                  },
                ]}
              />
            );
          })}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: AUTH.backdrop, overflow: 'hidden' },
  glow: { position: 'absolute' },
});
