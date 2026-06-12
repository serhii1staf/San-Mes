/**
 * Floating draggable performance monitor bubble.
 *
 * Default ON, sits in the bottom-right corner above the tab bar. Drag to
 * move; release where you want it (position persisted via settingsStore).
 * Tap (no drag) opens the full panel.
 *
 * Performance notes:
 * - Position is animated via Reanimated SharedValues so dragging doesn't
 *   trigger any React re-renders.
 * - The label text re-renders at most twice per second, driven by a
 *   throttled subscription to `perfMonitor`.
 * - UI FPS is sampled inside a `useFrameCallback` worklet (UI thread). The
 *   worklet only crosses to JS once per 500 ms, batching frame counts.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, Modal } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  runOnJS,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSettingsStore } from '../../store/settingsStore';
import { perfMonitor, type PerfSnapshot } from '../../services/perfMonitor';
import { PerfMonitorPanel } from './PerfMonitorPanel';

const BUBBLE_SIZE = 56;
const EDGE_PADDING = 8;
const TAP_SLOP = 6; // movement (px) below this = tap, not drag

export function PerfMonitorBubble() {
  const enabled = useSettingsStore((s) => s.perfMonitorEnabled);
  const storedX = useSettingsStore((s) => s.perfMonitorPosX);
  const storedY = useSettingsStore((s) => s.perfMonitorPosY);
  const setPos = useSettingsStore((s) => s.setPerfMonitorPosition);
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();

  // Compute a sensible initial position the first time the bubble mounts —
  // bottom-right, above the floating tab bar (≈ 100 px tall).
  const initialX = useMemo(
    () => (storedX >= 0 ? storedX : screenW - BUBBLE_SIZE - EDGE_PADDING - 8),
    // Only use storedX/screenW once on mount; later changes don't re-init
    // (we don't want to teleport the bubble when the user rotates).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const initialY = useMemo(
    () => (storedY >= 0 ? storedY : screenH - BUBBLE_SIZE - 110 - insets.bottom),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const x = useSharedValue(initialX);
  const y = useSharedValue(initialY);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const [panelOpen, setPanelOpen] = useState(false);
  const [snap, setSnap] = useState<PerfSnapshot>(() => perfMonitor.snapshot());

  // Keep sampler running while the bubble is mounted.
  useEffect(() => {
    perfMonitor.start();
    return () => {
      // Don't stop on unmount — the user might toggle the bubble off but
      // still want to see history when they re-enable it. Stopping is only
      // appropriate if we're sure no consumer will read fps later.
    };
  }, []);

  // Throttled subscription so the label re-renders at most twice per second.
  useEffect(() => {
    let last = 0;
    const unsub = perfMonitor.subscribe((s) => {
      const now = Date.now();
      if (now - last < 480) return;
      last = now;
      setSnap(s);
    });
    return unsub;
  }, []);

  // UI-thread FPS: count frames inside a worklet, batch-publish every 500 ms.
  const uiFrameCount = useSharedValue(0);
  const uiLastSampleAt = useSharedValue(0);
  useFrameCallback((frame) => {
    'worklet';
    if (uiLastSampleAt.value === 0) {
      uiLastSampleAt.value = frame.timestamp;
      return;
    }
    uiFrameCount.value += 1;
    const elapsed = frame.timestamp - uiLastSampleAt.value;
    if (elapsed >= 500) {
      const fps = Math.round((uiFrameCount.value * 1000) / elapsed);
      uiFrameCount.value = 0;
      uiLastSampleAt.value = frame.timestamp;
      runOnJS(perfMonitor.pushUiFps.bind(perfMonitor))(fps);
    }
  }, enabled);

  // Drag gesture. Tap (no drag) opens the panel. Movement above TAP_SLOP
  // suppresses tap so a flick doesn't accidentally open the panel.
  const movedAbsX = useSharedValue(0);
  const movedAbsY = useSharedValue(0);
  const openPanel = () => setPanelOpen(true);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onStart(() => {
          startX.value = x.value;
          startY.value = y.value;
          movedAbsX.value = 0;
          movedAbsY.value = 0;
        })
        .onUpdate((e) => {
          movedAbsX.value = Math.abs(e.translationX);
          movedAbsY.value = Math.abs(e.translationY);
          // Live constrain to the screen bounds so the bubble can't escape.
          const maxX = screenW - BUBBLE_SIZE - EDGE_PADDING;
          const maxY = screenH - BUBBLE_SIZE - EDGE_PADDING - insets.bottom;
          const minX = EDGE_PADDING;
          const minY = EDGE_PADDING + insets.top;
          x.value = Math.min(maxX, Math.max(minX, startX.value + e.translationX));
          y.value = Math.min(maxY, Math.max(minY, startY.value + e.translationY));
        })
        .onEnd(() => {
          // Snap horizontally to whichever screen edge is closer — Telegram-
          // style behaviour, prevents the bubble from sitting in the middle
          // of content.
          const targetX =
            x.value + BUBBLE_SIZE / 2 < screenW / 2
              ? EDGE_PADDING
              : screenW - BUBBLE_SIZE - EDGE_PADDING;
          x.value = withSpring(targetX, { damping: 18, stiffness: 220 });
          // If movement was below the tap slop, treat as a tap.
          if (movedAbsX.value < TAP_SLOP && movedAbsY.value < TAP_SLOP) {
            runOnJS(openPanel)();
          } else {
            runOnJS(setPos)(targetX, y.value);
          }
        }),
    // pan handler holds layout-dependent constants; rebuild only when the
    // screen size changes (e.g. rotation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [screenW, screenH, insets.bottom, insets.top],
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  if (!enabled) return null;

  // Colour-code by the worse of the two streams so a UI-thread stutter is
  // just as visible as a JS-thread stutter.
  const minFps = Math.min(snap.jsFps || 60, snap.uiFps || 60);
  const tint =
    minFps >= 50 ? '#22c55e' /* green */ : minFps >= 30 ? '#f59e0b' /* amber */ : '#ef4444';

  return (
    <>
      <Animated.View pointerEvents="box-none" style={[styles.container, animStyle]}>
        <GestureDetector gesture={pan}>
          <View style={[styles.bubble, { borderColor: tint, shadowColor: tint }]}>
            <Text style={[styles.fps, { color: tint }]} numberOfLines={1}>
              {snap.jsFps || 0}
            </Text>
            <Text style={styles.label} numberOfLines={1}>
              {snap.uiFps || 0}ui
            </Text>
          </View>
        </GestureDetector>
      </Animated.View>

      <Modal
        visible={panelOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPanelOpen(false)}
      >
        <PerfMonitorPanel onClose={() => setPanelOpen(false)} />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Absolutely positioned at (0,0); the actual location is driven entirely
  // by the animated transform so dragging never causes a layout pass.
  container: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    zIndex: 9999,
  },
  bubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    backgroundColor: 'rgba(20, 20, 20, 0.85)',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  fps: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    lineHeight: 18,
  },
  label: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
});
