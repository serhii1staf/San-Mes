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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, Text, View, useWindowDimensions, Modal } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  runOnJS,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSettingsStore } from '../../store/settingsStore';
import { usePerfPanelStore } from '../../store/perfPanelStore';
import { perfMonitor, type PerfSnapshot } from '../../services/perfMonitor';
import { PerfMonitorPanel } from './PerfMonitorPanel';

const BUBBLE_SIZE = 56;
const EDGE_PADDING = 8;

/**
 * Tiny error boundary so a regression in the perf monitor never takes the
 * whole app down. If `PerfMonitorBubble` throws on mount or during a render
 * we silently swallow the error and render nothing — the rest of the screen
 * keeps working.
 */
class PerfMonitorErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    // eslint-disable-next-line no-console
    console.warn('[PerfMonitorBubble] crashed and was disabled:', err);
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export function PerfMonitorBubble() {
  return (
    <PerfMonitorErrorBoundary>
      <PerfMonitorBubbleInner />
    </PerfMonitorErrorBoundary>
  );
}

function PerfMonitorBubbleInner() {
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

  const [panelOpen, setPanelOpenLocal] = useState(false);

  // Foreground flag. Drives whether the JS rAF sampler and the UI-thread
  // frame-callback worklet are allowed to run at all. Initialised from the
  // current AppState so a cold start while foregrounded begins active.
  const [isForeground, setIsForeground] = useState(
    () => AppState.currentState === 'active',
  );

  // Allow the panel to be opened externally (e.g. from the Dynamic Island
  // companion overlay's FPS tile) via a tiny external store. We mirror the
  // local `panelOpen` flag with the store so legacy callers (the bubble's
  // own tap handler) keep working unchanged. This is one-way: the store
  // is the source of truth, the local state is a render trigger.
  const externalOpen = usePerfPanelStore((s) => s.open);
  const setExternalOpen = usePerfPanelStore((s) => s.setOpen);
  useEffect(() => {
    if (externalOpen !== panelOpen) setPanelOpenLocal(externalOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalOpen]);
  const setPanelOpen = useCallback(
    (next: boolean) => {
      setExternalOpen(next);
      setPanelOpenLocal(next);
    },
    [setExternalOpen],
  );
  const [snap, setSnap] = useState<PerfSnapshot>(() => perfMonitor.snapshot());

  // Hoisted, stable JS callback for the worklet to call via runOnJS. Doing
  // `perfMonitor.pushUiFps.bind(perfMonitor)` inside a worklet was crashing
  // the app at startup on the iOS native build because `Function.prototype.
  // bind` is not always safe to invoke from a worklet's runtime — it
  // allocates a fresh function every frame and the worklet→JS bridge can
  // deadlock under load. A plain top-level callback avoids both problems.
  const reportUiFps = useCallback((fps: number) => {
    try {
      perfMonitor.pushUiFps(fps);
    } catch {
      // Never let monitor failures take the app down.
    }
  }, []);

  // Single AppState listener: pause everything when the app goes to the
  // background, resume when it returns to the foreground. Added once on
  // mount, removed on unmount. We only flip the `isForeground` flag here;
  // the start/stop effect below reacts to it so there's one source of truth.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setIsForeground(next === 'active');
    });
    return () => {
      sub.remove();
    };
  }, []);

  // Run the JS rAF sampler ONLY while the monitor is enabled AND the app is
  // foregrounded. `start()` is idempotent and `stop()` fully cancels the rAF
  // chain, so this effect can fire freely on every enabled/foreground change:
  //  - enabled + foreground  → start()  (resume)
  //  - disabled OR background → stop()   (zero per-frame work)
  // On unmount we always stop so no rAF loop outlives the bubble.
  useEffect(() => {
    if (enabled && isForeground) {
      try {
        perfMonitor.start();
      } catch {}
    } else {
      try {
        perfMonitor.stop();
      } catch {}
    }
    return () => {
      try {
        perfMonitor.stop();
      } catch {}
    };
  }, [enabled, isForeground]);

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
  // We deliberately keep this worklet small and free of method-bind / object
  // dereferences — only SharedValue reads/writes and a single runOnJS hop.
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
      runOnJS(reportUiFps)(fps);
    }
  }, enabled && isForeground);

  // Drag gesture moves the bubble; tap gesture opens the panel. They live in
  // a Race composition so a quick press resolves cleanly to "tap" without
  // waiting for Pan to fail. Earlier we tried to detect a tap as "Pan that
  // ended with no movement", but RNGH's Pan does not always fire `onEnd`
  // for a press without activation, which is why the bubble appeared
  // unresponsive when tapped.
  const movedAbsX = useSharedValue(0);
  const movedAbsY = useSharedValue(0);
  const openPanel = () => setPanelOpen(true);

  const composedGesture = useMemo(() => {
    const tap = Gesture.Tap()
      .maxDuration(300)
      .onEnd(() => {
        runOnJS(openPanel)();
      });

    const pan = Gesture.Pan()
      // Activate only on a real drag so the gesture doesn't steal taps.
      .minDistance(6)
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
        runOnJS(setPos)(targetX, y.value);
      });

    return Gesture.Race(tap, pan);
    // Layout-dependent constants only; rebuild on rotation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenW, screenH, insets.bottom, insets.top]);

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
        {/* GestureHandlerRootView is required around any <GestureDetector>.
            The app root isn't wrapped in one (this codebase wraps gesture
            components individually — see CustomTabBar and profile/edit), so
            without this the bubble throws "GestureDetector must be used as a
            descendant of GestureHandlerRootView" and the whole monitor gets
            disabled by its error boundary. Sized to the bubble so it never
            intercepts touches anywhere else on screen. */}
        <GestureHandlerRootView style={styles.gestureRoot}>
          <GestureDetector gesture={composedGesture}>
            <View style={[styles.bubble, { borderColor: tint, shadowColor: tint }]}>
              <Text style={[styles.fps, { color: tint }]} numberOfLines={1}>
                {snap.jsFps || 0}
              </Text>
              <Text style={styles.label} numberOfLines={1}>
                {snap.uiFps || 0}ui
              </Text>
            </View>
          </GestureDetector>
        </GestureHandlerRootView>
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
  gestureRoot: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
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
