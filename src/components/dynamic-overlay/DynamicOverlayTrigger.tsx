/**
 * DynamicOverlayTrigger — invisible long-press catcher at the top of the
 * screen that summons the Dynamic Island companion overlay.
 *
 * Why long-press, not shake?
 *  - `expo-sensors` (Accelerometer) requires a native rebuild. The user is
 *    on the OTA-only workflow (eas update) so installing it would break
 *    that pipeline. A 600 ms long-press at the top of the screen needs
 *    zero new native modules and works on every Expo SDK 54 build that
 *    already ships expo-haptics + react-native-gesture-handler.
 *
 *  - Once a native rebuild is on the table, swap this component's gesture
 *    for a real shake watcher with a single hook. The end of the file has
 *    a TODO recipe.
 *
 * Layout: a transparent strip across the very top of the screen, height
 * `insets.top + 30 px`. The wrapper uses `pointerEvents="box-none"` so it
 * does not block a tap that happens to fall in the same region — the
 * gesture detector only activates on a sustained 600 ms press, leaving
 * regular taps to pass through to whatever screen is mounted underneath.
 *
 * Performance: this component is ALWAYS mounted at the app root. To keep
 * its idle cost negligible:
 *  - No state, no theme subscription, no React re-renders.
 *  - A single `Gesture.LongPress()` plus a transparent View. RNGH attaches
 *    a single native gesture recognizer; nothing else.
 *  - The activation callback hops to JS exactly once per trigger to fire
 *    the haptic and flip the visibility store.
 */

import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDynamicOverlayStore } from '../../store/dynamicOverlayStore';
import { triggerHaptic } from '../../utils/haptics';

// Tuned to match iOS "press and hold to peek" feel — 600 ms is short enough
// that it doesn't feel like the screen is unresponsive but long enough that
// scrolls / accidental drags don't trigger it.
const LONG_PRESS_DURATION_MS = 600;
// 30 px below the safe-area inset is enough catchment for the user's thumb
// without painting over big chunks of screen UI underneath. The notch area
// itself (above `insets.top`) is system-owned and should NEVER be drawn into.
const TOUCH_HEIGHT_BELOW_INSET = 30;

function DynamicOverlayTriggerInner() {
  const insets = useSafeAreaInsets();
  const show = useDynamicOverlayStore((s) => s.show);

  // Hoisted JS callback so the gesture worklet calls a stable reference.
  const onLongPress = useCallback(() => {
    try {
      triggerHaptic('light');
    } catch {}
    show();
  }, [show]);

  // Build the gesture once per `show` reference change. RNGH stores the
  // worklet by identity, so memoising here keeps the native handler stable.
  const longPress = React.useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(LONG_PRESS_DURATION_MS)
        // Don't fire if the user drags off — feels closer to iOS behaviour.
        .maxDistance(20)
        .onStart(() => {
          'worklet';
          runOnJS(onLongPress)();
        }),
    [onLongPress],
  );

  return (
    // `box-none` lets touches that don't activate the long-press fall
    // through to whatever screen sits behind us. RNGH's LongPress monitors
    // the touch from `onTouchesDown` onward but only claims it on
    // activation — so a regular tap on a button at the top of the screen
    // still works.
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { height: insets.top + TOUCH_HEIGHT_BELOW_INSET },
      ]}
    >
      <GestureDetector gesture={longPress}>
        <View style={StyleSheet.absoluteFill} />
      </GestureDetector>
    </View>
  );
}

export const DynamicOverlayTrigger = memo(DynamicOverlayTriggerInner);

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Sit below the host overlay (zIndex 9998 there) and below the perf
    // bubble (zIndex 9999) so neither obscures actual touchable UI.
    zIndex: 1,
  },
});

/*
 * ─── Future: swap to a real shake-to-trigger when expo-sensors lands ─────
 *
 * Replace the body of `DynamicOverlayTriggerInner` with a one-shot
 * accelerometer listener. The component then renders nothing at all
 * (no view in the tree). Drop-in recipe:
 *
 *   import { Accelerometer } from 'expo-sensors';
 *   useEffect(() => {
 *     Accelerometer.setUpdateInterval(100);
 *     const sub = Accelerometer.addListener(({ x, y, z }) => {
 *       const g = Math.sqrt(x*x + y*y + z*z);
 *       if (g > 1.7) { triggerHaptic('light'); show(); }
 *     });
 *     return () => sub.remove();
 *   }, [show]);
 *   return null;
 *
 * That requires `expo install expo-sensors` AND a native rebuild — i.e.
 * a fresh EAS build of the app. The current long-press path is the
 * OTA-safe fallback until then.
 */
