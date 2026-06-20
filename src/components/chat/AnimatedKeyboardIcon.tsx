import React, { useEffect } from 'react';
import Reanimated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import Svg, { Rect, Circle } from 'react-native-svg';

// ── Animated keyboard icon ─────────────────────────────────────────────────
//
// A crisp, custom keyboard glyph drawn in SVG (Apple/Telegram-flavoured) with a
// LIVE micro-interaction: every time it mounts (i.e. every time a media panel
// opens and this "return to keyboard" affordance appears) the whole icon
// springs in from a slightly smaller scale and the individual keys fade/pop in
// in a staggered "typing" sweep, left-to-right, top-to-bottom.
//
// Built ENTIRELY on react-native-reanimated + react-native-svg — both already
// in the current native build — so it ships over OTA with no native rebuild and
// renders identically on iOS and Android. No Lottie / native module needed.

const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);

// Key centres inside the 24×24 viewBox. Two rows of four within the keyboard
// outline, animated in reading order for the "typing" sweep.
const KEYS: { cx: number; cy: number }[] = [
  { cx: 6, cy: 10 }, { cx: 9.5, cy: 10 }, { cx: 13, cy: 10 }, { cx: 16.5, cy: 10 },
  { cx: 6, cy: 13 }, { cx: 9.5, cy: 13 }, { cx: 13, cy: 13 }, { cx: 16.5, cy: 13 },
];

function AnimatedKey({
  cx,
  cy,
  color,
  progress,
  index,
  total,
}: {
  cx: number;
  cy: number;
  color: string;
  progress: Reanimated.SharedValue<number>;
  index: number;
  total: number;
}) {
  // Each key lights up over a 0.4-wide window of the shared 0→1 progress,
  // offset by its position so they cascade. Opacity floors at 0.2 so the
  // keyboard always reads as a keyboard even at progress 0 (first frame).
  const animatedProps = useAnimatedProps(() => {
    const start = (index / total) * 0.55;
    const local = interpolate(progress.value, [start, start + 0.45], [0, 1], Extrapolation.CLAMP);
    return { opacity: 0.2 + local * 0.8 };
  });
  return <AnimatedCircle cx={cx} cy={cy} r={1.05} fill={color} animatedProps={animatedProps} />;
}

export function AnimatedKeyboardIcon({ size = 18, color }: { size?: number; color: string }) {
  const progress = useSharedValue(0);
  const scale = useSharedValue(0.7);

  useEffect(() => {
    progress.value = withTiming(1, { duration: 540, easing: Easing.out(Easing.cubic) });
    scale.value = withSpring(1, { damping: 12, stiffness: 190, mass: 0.6 });
    // run-once entrance — replays naturally each time the component remounts
    // (the affordance is conditionally rendered when a panel opens).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Reanimated.View style={containerStyle}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {/* Keyboard body outline */}
        <Rect x={2.5} y={6} width={19} height={12} rx={2.6} stroke={color} strokeWidth={1.6} />
        {/* Keys (staggered "typing" sweep) */}
        {KEYS.map((k, i) => (
          <AnimatedKey key={i} cx={k.cx} cy={k.cy} color={color} progress={progress} index={i} total={KEYS.length} />
        ))}
        {/* Space bar */}
        <Rect x={8} y={14.9} width={8} height={1.4} rx={0.7} fill={color} />
      </Svg>
    </Reanimated.View>
  );
}
