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

import { useCallback, useMemo, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedRef,

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

  // ── THE REPLY-JUMP GLOW HAS MOVED OUT OF THIS HOOK ─────────────────────────
  //
  // It was a `useSharedValue`, a `useEffect` and a `useAnimatedStyle` right here — paid by EVERY
  // mounted bubble, for an animation that fires on at most ONE bubble in the whole lifetime of the
  // screen. FlashList keeps roughly two dozen bubbles in its recycle pool, so that was two dozen
  // shared values and two dozen animated-style mappers standing by to do nothing, allocated on the
  // chat-open commit.
  //
  // It now lives in `src/components/chat/ReplyJumpGlow.tsx`, which the bubble mounts only while
  // `highlighted` is true — the same gate the halo VIEW already had. Gating the view but not the hooks
  // driving it had left most of the cost in place.
  //
  // `highlighted` is consequently no longer a parameter of this hook.

  // ── THE REPLY ICON IS NOT MOUNTED UNTIL A SWIPE STARTS ────────────────────
  //
  // The icon is three native views — a `Reanimated.View` carrying an animated opacity, a tinted
  // circle, and a `MaterialIcons` glyph — and it was mounted on EVERY row, permanently, held
  // invisible by `replyIconAnimStyle` interpolating to 0 at rest. It is only ever seen mid-swipe.
  //
  // With `maxItemsInRecyclePool={24}` that is 72 native views plus 24 UI-thread style mappers
  // standing by to show nothing, all allocated on the chat-open commit — which is the commit that
  // measures 257-383 ms.
  //
  // This is not a new idea, it is the third application of one this file and its neighbours already
  // established and measured:
  //
  //   `ReplyJumpGlow` — same argument, same file. Its own note: mounted on every row at opacity 0,
  //   carrying a shadow that forced an offscreen rasterisation pass per bubble, for an animation
  //   that fires on at most ONE bubble in the screen's lifetime.
  //
  //   `buttonArmed` in `SwipeablePostCard` — the camera affordance, gated on pan start for exactly
  //   this reason: "three native views plus an animated-props node, per row, for something the user
  //   cannot see and on most rows never will."
  //
  // Armed in `onStart`, which is safe by the same margin `buttonArmed` relies on: the pan only
  // activates after 12 pt of deliberate LEFT travel (`activeOffsetX([-12, 9999])`), and the opacity
  // ramp keeps the icon invisible until 24 pt (`[-REPLY_THRESHOLD, -24, 0] -> [1, 0, 0]`). So the
  // commit lands with ~12 pt of finger travel to spare before the first frame it could be seen on.
  //
  // Latched for the row's lifetime — it never disappears mid-gesture, and a second swipe on the same
  // row pays nothing. The cost is one re-render of one row at the instant a deliberate swipe begins,
  // against a mount cost every row pays on every open and every recycle.
  const [replyIconArmed, setReplyIconArmed] = useState(false);
  const armReplyIcon = useCallback(() => setReplyIconArmed(true), []);

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
          // Mount the reply icon now — see the note on `replyIconArmed`. One hop per gesture, not
          // per frame, and it lands ~12 pt of travel before the icon's opacity ramp leaves zero.
          runOnJS(armReplyIcon)();
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
    [message, onReply, onSwipeActive, translateXSV, gateFiredHapticSV, swipeActiveSV, armReplyIcon],
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

  return { bubbleRef, composedGesture, bubbleAnimStyle, replyIconAnimStyle, replyIconArmed };
}

/**
 * Swipe-left-to-reply, on its own.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM `useMessageGestures` ────────────────────
 *
 * Comments needed swipe-to-reply "with the same mechanism as chat, and it must not conflict with
 * anything". `useMessageGestures` is the wrong thing to reuse wholesale: it also owns the
 * press-hold-then-drag-to-select choreography, which needs four SharedValues written from the
 * screen (`dragActive`, `dragFingerY`, `hoveredAction`, `actionZones`), an `onFireDragAction`
 * callback, and a measured action-zone map published by a context menu. Comments have none of
 * that — they open `CommentContextMenu` from a plain `onLongPress` Pressable — so importing the
 * whole hook would mean inventing dead shared values just to satisfy its signature.
 *
 * So the SWIPE half is extracted here and the numbers are shared rather than copied:
 * `REPLY_THRESHOLD`, the [-80, 0] clamp, `activeOffsetX([-12, 9999])`, `failOffsetY([-10, 10])`
 * and the spring are the exact values the chat uses. Same feel, by construction — if the chat's
 * threshold is ever tuned, this follows it, because it reads the same constant.
 *
 * ── WHY IT CANNOT CONFLICT ─────────────────────────────────────────────────
 *
 *   Vertical scrolling wins: `failOffsetY([-10, 10])` fails the pan as soon as the finger moves
 *   10 px vertically, handing the gesture to the list's scroll responder. So a scroll never
 *   becomes a swipe.
 *
 *   Right-swipes never activate: `activeOffsetX([-12, 9999])` needs 12 px LEFT to begin, and the
 *   +9999 upper bound means rightward motion cannot reach the activation threshold. That keeps
 *   the OS back-gesture and any horizontal pager free.
 *
 *   Taps still work: a Pan gesture that never activates does not consume the touch, so the
 *   Pressables inside the row (open profile, open image, tap-to-reply) still receive it. And a
 *   long-press is not a pan, so the existing `onLongPress` menu is untouched.
 *
 * Everything runs on the UI thread; `runOnJS` fires at most once per gesture phase — for the
 * threshold haptic and the reply callback — never per frame.
 */
export function useSwipeToReply<T extends { id: string }>({
  item,
  onReply,
  onSwipeActive,
}: {
  item: T;
  onReply: (m: T) => void;
  /** Optional: lets the screen lock list scrolling for the duration, as the chat does. */
  onSwipeActive?: (active: boolean) => void;
}) {
  const translateXSV = useSharedValue(0);
  const gateFiredHapticSV = useSharedValue(false);
  const activeSV = useSharedValue(false);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 9999])
        .failOffsetY([-10, 10])
        .onStart(() => {
          'worklet';
          activeSV.value = true;
          if (onSwipeActive) runOnJS(onSwipeActive)(true);
        })
        .onUpdate((e) => {
          'worklet';
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
            runOnJS(onReply)(item);
          }
        })
        .onFinalize(() => {
          'worklet';
          translateXSV.value = withSpring(0, { damping: 20, stiffness: 220, mass: 0.8 });
          gateFiredHapticSV.value = false;
          if (activeSV.value) {
            activeSV.value = false;
            if (onSwipeActive) runOnJS(onSwipeActive)(false);
          }
        }),
    [item, onReply, onSwipeActive, translateXSV, gateFiredHapticSV, activeSV],
  );

  const rowAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateXSV.value }],
  }));

  // Reply-icon opacity ramp, identical to the chat's: invisible until 24 px, fully opaque at the
  // commit threshold, so the icon appearing IS the signal that releasing will reply.
  const replyIconAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateXSV.value,
      [-REPLY_THRESHOLD, -24, 0],
      [1, 0, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return { gesture, rowAnimStyle, replyIconAnimStyle };
}
