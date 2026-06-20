import React, { useEffect } from 'react';
import { Text, StyleSheet } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  withDelay,
} from 'react-native-reanimated';

// ── Animated GIF wordmark ──────────────────────────────────────────────────
//
// The universal "GIF" wordmark (same affordance Telegram/WhatsApp use) but with
// a tasteful ONE-SHOT entrance: it springs in, then does a single subtle bob.
// No perpetual animation → zero idle cost. Pure RN Text + reanimated transform
// on the UI thread, so it's featherweight and ships over OTA.

export function AnimatedGifIcon({ color, fontSize = 11 }: { color: string; fontSize?: number }) {
  const scale = useSharedValue(0.7);

  useEffect(() => {
    scale.value = withSequence(
      withSpring(1, { damping: 12, stiffness: 210, mass: 0.6 }),
      withDelay(420, withSequence(withTiming(1.12, { duration: 130 }), withSpring(1, { damping: 9, stiffness: 240 }))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Reanimated.View style={style}>
      <Text allowFontScaling={false} style={[styles.text, { color, fontSize }]}>GIF</Text>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  text: { fontWeight: '800', letterSpacing: 0.3 },
});
