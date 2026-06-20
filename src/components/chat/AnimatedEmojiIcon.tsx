import React, { useEffect } from 'react';
import Reanimated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

// ── Animated emoji (smiley) icon ───────────────────────────────────────────
//
// Custom SVG smiley matching the keyboard glyph's line-art style. ONE-SHOT
// animation only (zero perpetual cost): the face springs in when it mounts and
// the eyes do a single quick blink shortly after. Runs entirely on the UI
// thread (reanimated) and ships over OTA (reanimated + svg already in build).

const AnimatedRect = Reanimated.createAnimatedComponent(Rect);

const EYE_W = 1.9;
const EYE_FULL_H = 1.9;
const EYES = [
  { cx: 9, cy: 10.2 },
  { cx: 15, cy: 10.2 },
];

function AnimatedEye({ cx, cy, color, open }: { cx: number; cy: number; color: string; open: SharedValue<number> }) {
  const animatedProps = useAnimatedProps(() => {
    const h = Math.max(0.35, EYE_FULL_H * open.value);
    return { height: h, y: cy - h / 2 };
  });
  return <AnimatedRect x={cx - EYE_W / 2} width={EYE_W} rx={0.95} fill={color} animatedProps={animatedProps} />;
}

export function AnimatedEmojiIcon({ size = 22, color }: { size?: number; color: string }) {
  const scale = useSharedValue(0.6);
  const open = useSharedValue(1); // eye openness 1 = fully open

  useEffect(() => {
    scale.value = withSpring(1, { damping: 11, stiffness: 200, mass: 0.6 });
    // Single blink ~500 ms after appearing, then stay open (no looping).
    open.value = withDelay(520, withSequence(withTiming(0.12, { duration: 80 }), withTiming(1, { duration: 130 })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Reanimated.View style={containerStyle}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {/* Face */}
        <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.7} />
        {/* Eyes (blink via animated height) */}
        {EYES.map((e, i) => (
          <AnimatedEye key={i} cx={e.cx} cy={e.cy} color={color} open={open} />
        ))}
        {/* Smile */}
        <Path d="M7.8 13.4 Q12 17.2 16.2 13.4" stroke={color} strokeWidth={1.7} strokeLinecap="round" fill="none" />
      </Svg>
    </Reanimated.View>
  );
}
