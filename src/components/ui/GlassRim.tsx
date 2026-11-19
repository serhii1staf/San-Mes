/**
 * The light of a glass edge, for surfaces that cannot have Apple's liquid glass (iOS before 26, the
 * liquid-glass toggle off, Android). It sits on top of the surface's blur.
 *
 * Requested: "a tester's iPhone has no liquid glass, yet Telegram shows glass on it". Telegram draws
 * its own. The real thing, refraction of whatever is behind the panel, needs the backdrop as a
 * texture on every frame: on iOS before 26 that means either Apple's private `CABackdropLayer`
 * (App Review 2.5.1 risk) or rendering the root view on the CPU every frame (the App Store-safe mode
 * of LiquidGlassKit, which its author describes as more CPU-intensive). Both cost the frames this app
 * is short of. What makes glass read as glass is mostly its edge: a bright rim strongest at the top
 * and bottom corners, a sheen across the upper half, and depth along the lower edge. That is what
 * this draws, as one static SVG rasterised once per size. No animation and no per-frame work.
 */
import React, { memo, useCallback, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

export const GlassRim = memo(function GlassRim({ radius, isDark }: { radius: number; isDark: boolean }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    const h = Math.round(e.nativeEvent.layout.height);
    setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
  }, []);
  const r = size ? Math.min(radius, size.h / 2, size.w / 2) : radius;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {size && size.w > 2 && size.h > 2 ? (
        <Svg width={size.w} height={size.h}>
          <Defs>
            {/* Rim: bright at the top-left and bottom-right corners, almost gone along the sides. */}
            <LinearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={isDark ? 0.55 : 0.95} />
              <Stop offset="0.3" stopColor="#FFFFFF" stopOpacity={isDark ? 0.1 : 0.25} />
              <Stop offset="0.7" stopColor="#FFFFFF" stopOpacity={isDark ? 0.06 : 0.15} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={isDark ? 0.35 : 0.7} />
            </LinearGradient>
            {/* Sheen: light caught across the upper half of a curved surface. */}
            <RadialGradient id="sheen" cx="50%" cy="0%" rx="70%" ry="100%" fx="50%" fy="0%">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={isDark ? 0.16 : 0.4} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </RadialGradient>
            {/* Depth: the lower edge a little darker, so the surface reads as thick. */}
            <LinearGradient id="depth" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0.55" stopColor="#000000" stopOpacity={0} />
              <Stop offset="1" stopColor="#000000" stopOpacity={isDark ? 0.22 : 0.07} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={size.w} height={size.h} rx={r} ry={r} fill="url(#sheen)" />
          <Rect x={0} y={0} width={size.w} height={size.h} rx={r} ry={r} fill="url(#depth)" />
          <Rect
            x={0.75}
            y={0.75}
            width={size.w - 1.5}
            height={size.h - 1.5}
            rx={Math.max(0, r - 0.75)}
            ry={Math.max(0, r - 0.75)}
            fill="none"
            stroke="url(#rim)"
            strokeWidth={1.5}
          />
        </Svg>
      ) : null}
    </View>
  );
});
