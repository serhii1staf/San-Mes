import React, { useEffect } from 'react';
import Reanimated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  Easing,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';

// ── Animated keyboard icon ─────────────────────────────────────────────────
//
// Symmetric keyboard glyph (Apple/Telegram-flavoured) drawn in SVG.
//
// PERFORMANCE: the highlight "wave" is BOUNDED — it sweeps left→right a couple
// of times when the affordance appears, then settles into a clean, uniform,
// fully-lit keyboard with NO ongoing animation. So there is zero perpetual
// UI-thread cost while the panel sits open (important on weak Android). The
// whole animation runs on the UI thread (reanimated worklets) and never touches
// the JS thread, so it can't compete with the emoji/GIF grid scroll. Built on
// reanimated + react-native-svg (already in the build) → ships over OTA.

const AnimatedRect = Reanimated.createAnimatedComponent(Rect);

// 24×24 viewBox. Body centred on (12,12). Four key COLUMNS centred on x=12 with
// even spacing, two rows — fully symmetric.
const COL_X = [6.9, 10.3, 13.7, 17.1];
const ROW_Y = [9.9, 12.5];
const KEYS: { x: number; y: number; col: number }[] = [];
ROW_Y.forEach((y) => COL_X.forEach((x, col) => KEYS.push({ x, y, col })));

const KEY_W = 1.8;
const KEY_H = 1.6;

function AnimatedKey({
  x,
  y,
  col,
  color,
  wave,
  base,
}: {
  x: number;
  y: number;
  col: number;
  color: string;
  wave: SharedValue<number>;
  base: SharedValue<number>;
}) {
  const phase = col / COL_X.length; // 0, .25, .5, .75
  const animatedProps = useAnimatedProps(() => {
    // Travelling highlight (wrap-around distance from this column's phase).
    let d = Math.abs(wave.value - phase);
    d = Math.min(d, 1 - d);
    const pulse = interpolate(d, [0, 0.16, 0.5], [1, 0.4, 0.32], Extrapolation.CLAMP);
    // `base` ramps 0.4 → 1 over the intro; once it reaches 1 every key is fully
    // lit and the (now-stopped) wave is invisible → clean uniform rest state.
    const opacity = Math.max(base.value, pulse);
    return { opacity };
  });
  return (
    <AnimatedRect
      x={x - KEY_W / 2}
      y={y - KEY_H / 2}
      width={KEY_W}
      height={KEY_H}
      rx={0.45}
      fill={color}
      animatedProps={animatedProps}
    />
  );
}

export function AnimatedKeyboardIcon({ size = 22, color }: { size?: number; color: string }) {
  const wave = useSharedValue(0);
  const base = useSharedValue(0.4);
  const scale = useSharedValue(0.6);

  useEffect(() => {
    // Two sweeps (~2.2 s total) then the wave STOPS — no perpetual animation.
    wave.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }), 2, false);
    // Keys fill to uniform full opacity over the same window → clean rest.
    base.value = withTiming(1, { duration: 2200, easing: Easing.out(Easing.cubic) });
    // Spring entrance each time the affordance mounts (panel opens).
    scale.value = withSpring(1, { damping: 11, stiffness: 200, mass: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Reanimated.View style={containerStyle}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {/* Keyboard body — centred on (12,12) */}
        <Rect x={2.5} y={6.5} width={19} height={11} rx={2.6} stroke={color} strokeWidth={1.7} />
        {/* Keys — symmetric 4×2 grid */}
        {KEYS.map((k, i) => (
          <AnimatedKey key={i} x={k.x} y={k.y} col={k.col} color={color} wave={wave} base={base} />
        ))}
        {/* Space bar */}
        <Rect x={8} y={14.6} width={8} height={1.5} rx={0.75} fill={color} />
      </Svg>
    </Reanimated.View>
  );
}
