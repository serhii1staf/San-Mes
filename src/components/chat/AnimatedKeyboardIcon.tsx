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
// A crisp, SYMMETRIC keyboard glyph drawn in SVG (Apple/Telegram-flavoured)
// with a continuously visible micro-animation: a soft highlight "wave" sweeps
// left-to-right across the key columns (like a scan), looping forever while the
// affordance is on screen, and the whole icon springs in when it appears.
//
// Built on react-native-reanimated + react-native-svg (both already in the
// native build) → ships over OTA, no rebuild, identical on iOS and Android.

const AnimatedRect = Reanimated.createAnimatedComponent(Rect);

// 24×24 viewBox. Body is centred on (12,12). Four key COLUMNS centred on x=12
// with even 3.4 spacing, two rows — so everything is symmetric (no more
// "crooked dots"). `col` drives the wave phase so each vertical column lights
// as the wave passes it.
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
}: {
  x: number;
  y: number;
  col: number;
  color: string;
  wave: SharedValue<number>;
}) {
  const phase = col / COL_X.length; // 0, .25, .5, .75
  const animatedProps = useAnimatedProps(() => {
    // Wrap-around distance between the travelling wave and this column's phase.
    let d = Math.abs(wave.value - phase);
    d = Math.min(d, 1 - d);
    // Sharp, bright highlight as the wave passes; dim baseline otherwise.
    const opacity = interpolate(d, [0, 0.16, 0.5], [1, 0.4, 0.32], Extrapolation.CLAMP);
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
  const scale = useSharedValue(0.6);

  useEffect(() => {
    // Continuous left→right sweep (looping). 1.6 s per pass — lively but calm.
    wave.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, false);
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
        {/* Keys — symmetric 4×2 grid, animated by the sweeping wave */}
        {KEYS.map((k, i) => (
          <AnimatedKey key={i} x={k.x} y={k.y} col={k.col} color={color} wave={wave} />
        ))}
        {/* Space bar */}
        <Rect x={8} y={14.6} width={8} height={1.5} rx={0.75} fill={color} />
      </Svg>
    </Reanimated.View>
  );
}
