import React, { useEffect } from 'react';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
} from 'react-native-reanimated';

/**
 * The halo that pulses behind a chat bubble when you jump to it from a reply quote.
 *
 * ── WHY THIS IS A COMPONENT AND NOT PART OF `useMessageGestures` ────────────
 *
 * It used to live in that hook, which every mounted bubble calls. So every bubble allocated a
 * `useSharedValue`, registered a `useAnimatedStyle` worklet mapper and ran a `useEffect` for an
 * animation that fires on AT MOST ONE bubble in the entire lifetime of the screen — the one the user
 * jumped to. FlashList keeps roughly two dozen bubbles in its recycle pool, so that was two dozen
 * shared values and two dozen animated-style mappers standing by to do nothing.
 *
 * The halo VIEW was already gated on `highlighted` (with a good comment explaining that an
 * always-mounted invisible glow costs an offscreen pass per row on the scroll frame). Gating the view
 * but not the hooks that drive it left most of the cost in place. Moving the whole mechanism behind
 * the same gate is what actually removes it: mounted only while highlighted, so an ordinary bubble
 * pays nothing at all.
 *
 * ── WHY THERE IS NO EXIT ANIMATION, AND WHY THAT IS SAFE ────────────────────
 *
 * The sequence below runs 240 + 900 + 440 = 1580 ms. The screen clears `jumpHighlightId` at 1600 ms
 * (see `scrollToMessageId` in app/chat/[id].tsx). So opacity has already reached 0 twenty
 * milliseconds before this unmounts, and there is no fade-out to lose. That ordering is load-bearing:
 * if either number is ever changed, the sequence must still finish first.
 *
 * Because the component only exists while highlighted, the effect has no dependency on a flag — it
 * runs once, on mount, which IS the moment the highlight begins.
 */
export const ReplyJumpGlow = React.memo(function ReplyJumpGlow({
  bubbleRadius,
  isOwn,
  accentColor,
  isDark,
}: {
  bubbleRadius: number;
  isOwn: boolean;
  accentColor: string;
  isDark: boolean;
}) {
  const glow = useSharedValue(0);

  useEffect(() => {
    glow.value = withSequence(
      withTiming(1, { duration: 240 }),
      withDelay(900, withTiming(0, { duration: 440 })),
    );
  }, [glow]);

  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Reanimated.View
      pointerEvents="none"
      style={[
        glowStyle,
        {
          position: 'absolute',
          top: -3,
          left: -3,
          right: -3,
          bottom: -3,
          borderRadius: bubbleRadius + 3,
          borderBottomRightRadius: (isOwn ? 4 : bubbleRadius) + 3,
          borderBottomLeftRadius: (isOwn ? bubbleRadius : 4) + 3,
          backgroundColor: accentColor + (isDark ? '40' : '33'),
          // iOS soft coloured glow. Android ignores coloured shadows, so the tinted halo above
          // carries the effect there instead.
          shadowColor: accentColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.9,
          shadowRadius: 10,
        },
      ]}
    />
  );
});
