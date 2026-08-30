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
  // ── A WINDOW THAT SPANS A PAUSE IS NOT A MEASUREMENT ──────────────────────
  //
  // The JS sampler in perfMonitor has two guards against exactly this — a
  // post-stall suppression window and a "drop the sample if any single frame in
  // it took over 50 ms" test — and both exist because catch-up bursts were
  // producing readings of 120 and 150 fps. This worklet had neither, and it
  // feeds the SAME per-route `worstFps` accumulator and the SAME sub-30fps
  // `jankCount` that the hotspot score is built from.
  //
  // The failure is structural, not marginal. `useFrameCallback` is armed on
  // `enabled && isForeground`, and `uiLastSampleAt` is a SharedValue that
  // survives the disarm — so the first window published after any pause (app
  // inactive, a screen transition starving the UI thread, the monitor being
  // toggled) measures a handful of frames against a wall-clock interval that
  // includes the whole pause. What comes out is arithmetically impossible as a
  // frame rate, and it is attributed to whatever route happens to be current
  // when the callback resumes rather than to the pause.
  //
  // A device snapshot shows both halves of the damage. `settings` — zero long
  // tasks, zero mounts, zero images, an idle form — reported `worstFps: 3` and
  // two jank samples, which was 9.5 of its 13.5 score and ranked a static
  // screen second-worst in the app. `chat/[id]` reported `worstFps: 1`, worth
  // another 9.8 points on a route whose real problem is 31 long tasks. Neither
  // number can be produced by rendering: 3 fps means ~333 ms between frames,
  // and no gap that size was ever recorded as a stall.
  //
  // So: track the largest gap between consecutive frames within the window and
  // discard the whole window if it exceeds 120 ms — the same bar the long-task
  // detector uses to say "that was a stall, not a frame". This is deliberately a
  // PAUSE filter and not a jank filter. A window of steady 40 ms frames still
  // publishes 25 fps and still raises `jankCount`, because that is real jank the
  // user felt; a window containing one 1000 ms void publishes nothing, because
  // averaging across a void describes neither the void nor the frames.
  const uiPrevFrameAt = useSharedValue(0);
  const uiMaxGap = useSharedValue(0);
  // ── THE WORKLET IS MEMOIZED ─────────────────────────────────────────────────
  //
  // Reanimated's performance guide states this directly: a `useFrameCallback`
  // worklet should be wrapped in `useCallback`, otherwise it is re-created and
  // therefore re-REGISTERED on every render of the host component.
  //
  // That mattered here more than it would in most places. This component
  // re-renders on its own FPS label (twice a second, by design), on every
  // `perfMonitorEnabled` / position / filter change, and on foreground
  // transitions — and each of those renders was tearing down and re-installing
  // a callback on the UI thread's frame loop. The bubble that exists to measure
  // frame cost was paying a re-registration out of the frame budget it reports.
  //
  // Every value the worklet closes over is already reference-stable: the six
  // `uiX` shared values are `useSharedValue` handles, and `reportUiFps` is a
  // `useCallback` with an empty dep list (see the note on it above, which was
  // written for exactly this reason). So the dep list below is honest AND the
  // callback is created once for the lifetime of the component.
  const sampleUiFps = useCallback(
    (frame: { timestamp: number }) => {
      'worklet';
      if (uiLastSampleAt.value === 0) {
        uiLastSampleAt.value = frame.timestamp;
        uiPrevFrameAt.value = frame.timestamp;
        return;
      }
      const gap = frame.timestamp - uiPrevFrameAt.value;
      uiPrevFrameAt.value = frame.timestamp;
      if (gap > uiMaxGap.value) uiMaxGap.value = gap;
      uiFrameCount.value += 1;
      const elapsed = frame.timestamp - uiLastSampleAt.value;
      if (elapsed >= 500) {
        // ── THE 120 ms DISCARD THREW AWAY EXACTLY WHAT IT WAS BUILT TO FIND ────
        //
        // This used to drop the whole window when `uiMaxGap > 120`, on the reasoning that a window
        // spanning a pause is not a measurement. The concern is real; the threshold made it useless.
        //
        // 120 ms is the same bar the long-task detector uses for "the thread was blocked". So a
        // window in which the UI thread genuinely stalled — a burst of GIF decodes uploading
        // bitmaps, a heavy commit — was silently discarded, and only calm windows were ever
        // published. That is the identical mistake as the JS sampler's suppression guards removed in
        // #212: a filter meant to prevent over-reporting caused systematic UNDER-reporting of the
        // one condition the tool exists to detect. Here it went further and produced NOTHING, so
        // `uiFps` sat at its initial 0 through three snapshots and read as a value rather than as an
        // absent instrument.
        //
        // The legitimate case — a window straddling a disarm, an app backgrounding, a screen
        // transition that parked the frame loop — is handled at the source instead: the effect below
        // zeroes `uiLastSampleAt` whenever the callback is armed or disarmed, so the next window
        // starts from a fresh frame rather than measuring across the gap. That removes the need to
        // guess from inside the worklet.
        //
        // The bar that remains is deliberately absurd: 2000 ms cannot be a rendering stall, only a
        // pause the reset above failed to catch. Anything below it is published, so a 300 ms UI
        // block now shows up as the low frame rate it is.
        const spansPause = uiMaxGap.value > 2000;
        const fps = Math.round((uiFrameCount.value * 1000) / elapsed);
        // Reset the accumulators either way, so the NEXT window starts clean from
        // this frame rather than inheriting the discarded one's span.
        uiFrameCount.value = 0;
        uiLastSampleAt.value = frame.timestamp;
        uiMaxGap.value = 0;
        if (!spansPause) runOnJS(reportUiFps)(fps);
      }
    },
    [reportUiFps, uiFrameCount, uiLastSampleAt, uiMaxGap, uiPrevFrameAt],
  );
  const uiArmed = enabled && isForeground;
  // ── WHY `uiSampleCount` WAS 0 FOR THE WHOLE SESSION ────────────────────────
  //
  // This was `useFrameCallback(sampleUiFps, uiArmed)`, passing the armed flag as `autostart`. That
  // does not work, and the reason is in the installed source —
  // `node_modules/react-native-reanimated/lib/module/hook/useFrameCallback.js`:
  //
  //     export function useFrameCallback(callback, autostart = true) {
  //       const ref = useRef({
  //         setActive: isActive => { ...; ref.current.isActive = isActive; },
  //         isActive: autostart,          // <-- captured in the useRef INITIALISER
  //         callbackId: -1,
  //       });
  //       useEffect(() => {
  //         ref.current.callbackId = frameCallbackRegistry.registerFrameCallback(callback);
  //         ref.current.setActive(ref.current.isActive);   // <-- the FROZEN value, not `autostart`
  //         ...
  //       }, [callback, autostart]);
  //
  // A `useRef` initialiser runs on the first render only, so `isActive` is frozen at whatever
  // `autostart` was AT MOUNT. The effect does re-run when `autostart` changes — and then calls
  // `setActive(ref.current.isActive)`, i.e. the stale frozen value. So a `false` at mount can never
  // become `true` through the prop.
  //
  // `perfMonitorEnabled` defaults to false and is forced false for every existing install by the
  // settings-store migration, so the bubble ALWAYS mounts disarmed. Turning the monitor on afterwards
  // re-ran that effect and re-applied `false`. The UI sampler was therefore permanently inert on
  // every device, which is exactly the `uiSampleCount: 0` / `uiFps: 0` reported in four consecutive
  // snapshots — and the reason I spent this session optimising the one thread I could still see.
  //
  // So `autostart` is pinned to a literal `false` (honest: it never starts by itself) and arming is
  // done through the documented imperative handle, which reads the value at call time and cannot go
  // stale. The hook's own effect still fires once on mount and applies `false`; the effect below then
  // applies the real state, and because `setActive` also WRITES `ref.current.isActive`, any later
  // re-registration preserves it instead of reverting.
  const uiFrameCb = useFrameCallback(sampleUiFps, false);
  useEffect(() => {
    uiFrameCb.setActive(uiArmed);
  }, [uiArmed, uiFrameCb]);
  // ── RESET AT THE ARM/DISARM BOUNDARY, WHICH IS WHERE THE PAUSE ACTUALLY IS ──
  //
  // `uiLastSampleAt` is a SharedValue, so it SURVIVES a disarm. Without this, the first window after
  // any resume measured a handful of frames against a wall-clock interval containing the entire
  // pause — arithmetically impossible as a frame rate, and attributed to whichever route happened to
  // be current when the loop restarted. That is what the worklet's old 120 ms discard was trying to
  // paper over from the inside, at the cost of also discarding every genuine UI stall.
  //
  // Zeroing it here is the honest fix: the worklet's own `uiLastSampleAt.value === 0` branch then
  // re-initialises from the first real frame after arming, so no window ever spans the boundary and
  // the worklet no longer has to guess which large gaps were pauses.
  useEffect(() => {
    uiLastSampleAt.value = 0;
    uiPrevFrameAt.value = 0;
    uiFrameCount.value = 0;
    uiMaxGap.value = 0;
  }, [uiArmed, uiLastSampleAt, uiPrevFrameAt, uiFrameCount, uiMaxGap]);

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
