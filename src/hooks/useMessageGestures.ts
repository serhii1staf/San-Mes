// useMessageGestures
// ------------------
// Owns ALL gesture + animation wiring for a single chat message bubble:
//   • swipe-left-to-reply (UI-thread Pan)
//   • press-hold-then-drag-to-select (UI-thread LongPress + drag tracking)
//   • reply-jump highlight glow
//   • the bubble translateX style + the reply-icon opacity ramp
//
// Extracted verbatim from app/chat/[id].tsx's MessageBubble so the bubble
// component stays a thin presentational view and this hard-won interaction
// choreography lives in one documented, independently-testable place. Behaviour
// is intentionally IDENTICAL to the previous inline implementation — this is a
// pure refactor (no timing, threshold, or gesture-composition changes).
//
// Everything runs on the UI thread (RNGH gesture callbacks + Reanimated shared
// values/worklets); `runOnJS` is used at most once per gesture phase (never per
// frame) for haptics, the parent scroll-lock, and the reply/menu callbacks.

import { useEffect, useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedRef,
  withTiming,
  withSequence,
  withDelay,
  withSpring,
  measure,
  runOnJS,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import { triggerHaptic } from '../utils/haptics';
import type { ActionZone } from '../components/ui/MessageContextMenu';

// Pixels of left-swipe (on release) that commit a reply. Matches the legacy
// MessageBubble constant exactly.
export const REPLY_THRESHOLD = 60;

export interface MessageGestureParams<T extends { id: string }> {
  /** The message this bubble renders — passed back to the reply/menu callbacks. */
  message: T;
  /** Reply-jump highlight flag (drives the glow pulse). */
  highlighted?: boolean;
  /** Fired (once, on release past threshold) to start a reply to this message. */
  onReply: (m: T) => void;
  /** Fired (once on activate / once on end) so the parent can lock FlatList scroll. */
  onSwipeActive: (active: boolean) => void;
  /** Fired (once, on long-press activation) to open the context menu. */
  onLongPress: (m: T) => void;
  /** Fired (once, on long-press activation) with this bubble's window rect. */
  onMeasured?: (id: string, x: number, y: number, w: number, h: number) => void;
  /** Fired (once, on release over a highlighted action row) to run that action. */
  onFireDragAction: (m: T, action: string) => void;
  // Shared values owned by the screen, written on the UI thread during a
  // press-drag so the context menu can paint the hovered row highlight.
  dragActive: SharedValue<boolean>;
  dragFingerY: SharedValue<number>;
  hoveredAction: SharedValue<string>;
  actionZones: SharedValue<ActionZone[]>;
}

export function useMessageGestures<T extends { id: string }>({
  message,
  highlighted,
  onReply,
  onSwipeActive,
  onLongPress,
  onMeasured,
  onFireDragAction,
  dragActive,
  dragFingerY,
  hoveredAction,
  actionZones,
}: MessageGestureParams<T>) {
  // Animated ref so the LongPress gesture can measure this bubble's window rect
  // on the UI thread — used to spawn the emoji "dissolve" burst at the right
  // spot when the message is deleted.
  const bubbleRef = useAnimatedRef<Animated.View>();

  // ── Reply-jump highlight: GLOW, not a border ───────────────────────────
  // An absolutely-positioned sibling halo fades in/out behind the bubble
  // (negative inset → ZERO layout impact: the bubble never moves/resizes).
  // Opacity is driven entirely on the UI thread over the parent's ~1600 ms
  // highlight window.
  const glowSV = useSharedValue(0);
  useEffect(() => {
    if (highlighted) {
      glowSV.value = withSequence(
        withTiming(1, { duration: 240 }),
        withDelay(900, withTiming(0, { duration: 440 })),
      );
    } else {
      glowSV.value = withTiming(0, { duration: 200 });
    }
  }, [highlighted, glowSV]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glowSV.value }));

  // ── Swipe-to-reply: UI-thread Pan ──────────────────────────────────────
  const translateXSV = useSharedValue(0);
  // One-shot guard so the threshold haptic fires exactly once per gesture.
  const gateFiredHapticSV = useSharedValue(false);
  // Mirror of "is this gesture currently active?" — used by onFinalize to know
  // whether to run the scroll-unlock cleanup (which fires on every pan end).
  const swipeActiveSV = useSharedValue(false);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Only horizontal LEFT motion activates: ≥12 px left; the +9999 cap
        // means right motion never activates. Any vertical motion ≥10 px fails
        // the pan, handing the gesture to the FlatList scroll responder — so
        // vertical scrolls always win and horizontal swipes never fight them.
        .activeOffsetX([-12, 9999])
        .failOffsetY([-10, 10])
        .onStart(() => {
          'worklet';
          swipeActiveSV.value = true;
          runOnJS(onSwipeActive)(true);
        })
        .onUpdate((e) => {
          'worklet';
          // Clamp to [-80, 0] — only swipe LEFT, capped at 80 px. Whole pixel
          // for predictable rendering on Android.
          const dx = Math.max(Math.min(Math.round(e.translationX), 0), -80);
          translateXSV.value = dx;
          if (!gateFiredHapticSV.value && dx <= -REPLY_THRESHOLD) {
            gateFiredHapticSV.value = true;
            runOnJS(triggerHaptic)('light');
          }
        })
        .onEnd((e) => {
          'worklet';
          if (e.translationX <= -REPLY_THRESHOLD) {
            runOnJS(onReply)(message);
          }
        })
        .onFinalize(() => {
          'worklet';
          translateXSV.value = withSpring(0, { damping: 20, stiffness: 220, mass: 0.8 });
          gateFiredHapticSV.value = false;
          if (swipeActiveSV.value) {
            swipeActiveSV.value = false;
            runOnJS(onSwipeActive)(false);
          }
        }),
    [message, onReply, onSwipeActive, translateXSV, gateFiredHapticSV, swipeActiveSV],
  );

  // ── Press-drag-release: UI-thread LongPress + drag-to-select ───────────
  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(300)
        // maxDistance gates ACTIVATION only (cancel if the finger travels past
        // it BEFORE 300 ms). Kept small so a real scroll cancels the hold while
        // minor jitter still opens the menu; post-activation drag onto the
        // action rows is never restricted.
        .maxDistance(20)
        .onStart(() => {
          'worklet';
          dragActive.value = true;
          dragFingerY.value = -1;
          hoveredAction.value = '';
          if (onMeasured) {
            const m = measure(bubbleRef);
            if (m) runOnJS(onMeasured)(message.id, m.pageX, m.pageY, m.width, m.height);
          }
          runOnJS(triggerHaptic)('medium');
          runOnJS(onLongPress)(message);
        })
        .onTouchesMove((e) => {
          'worklet';
          if (!dragActive.value) return;
          const touch = e.allTouches[0];
          if (!touch) return;
          const y = touch.absoluteY;
          dragFingerY.value = y;
          const zones = actionZones.value;
          let found = '';
          for (let i = 0; i < zones.length; i++) {
            if (y >= zones[i].top && y <= zones[i].bottom) { found = zones[i].id; break; }
          }
          if (found !== hoveredAction.value) {
            hoveredAction.value = found;
            if (found !== '') runOnJS(triggerHaptic)('light');
          }
        })
        .onEnd(() => {
          'worklet';
          const action = hoveredAction.value;
          if (action !== '') runOnJS(onFireDragAction)(message, action);
        })
        .onFinalize(() => {
          'worklet';
          dragActive.value = false;
          dragFingerY.value = -1;
          hoveredAction.value = '';
        }),
    [message, onLongPress, onMeasured, bubbleRef, onFireDragAction, dragActive, dragFingerY, hoveredAction, actionZones],
  );

  // Race: whichever activates FIRST wins and cancels the other. A clear
  // horizontal swipe (≥12 px left) → reply; a still-hold (300 ms) → menu. They
  // can never both be active, so drag-select can't fight the swipe.
  const composedGesture = useMemo(() => Gesture.Race(pan, longPress), [pan, longPress]);

  const bubbleAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateXSV.value }],
  }));
  // Reply-icon opacity ramp from -24 → -REPLY_THRESHOLD, on the UI thread.
  const replyIconAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateXSV.value,
      [-REPLY_THRESHOLD, -24, 0],
      [1, 0, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return { bubbleRef, composedGesture, glowStyle, bubbleAnimStyle, replyIconAnimStyle };
}
