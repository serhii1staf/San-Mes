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

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedRef,
  makeMutable,
  withSpring,
  measure,
  runOnJS,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import { triggerHaptic } from '../utils/haptics';
import { UI_RUNTIME_MAPPERS } from '../utils/workletGuards';
import type { ActionZone } from '../components/ui/MessageContextMenu';

// Pixels of left-swipe (on release) that commit a reply. Matches the legacy
// MessageBubble constant exactly.
export const REPLY_THRESHOLD = 60;

// ── LETTING GO WITHOUT MOVING CHOOSES NOTHING (Nov 2026) ─────────────────────
//
// Reported, with a recording: hold a message, the menu opens, the finger is now on "Копировать" or
// "Переслать", and letting go runs it ("оно думает, что я нажимаю"). The recording shows the share
// sheet opening right after a plain hold. The card opens beside the item, and for an item near the
// composer that is under the finger; the finger's own jitter then counted as a drag onto that row,
// and the release fired it.
//
// Now a release chooses an action only once the finger has moved this far from where the hold
// began. Sliding onto an action and letting go still works; holding still and letting go leaves the
// menu open, to tap.
//
// ── AND THE HOLD LASTS UNTIL THE FINGER LIFTS ────────────────────────────────
//
// The hold used `maxDistance(20)` on the belief that it limits the finger only until the menu opens.
// RNGH 2.28 applies it for the whole gesture: past 20 pt an ACTIVE long press is cancelled (Android
// `LongPressGestureHandler.onHandle`, iOS `RNBetterLongPressGestureRecognizer.shouldCancelGesture`),
// and so is one whose finger leaves the bubble (`shouldCancelWhenOutside`, on by default for a long
// press). A cancel still runs `onEnd`, with `success` false, and `onEnd` fired whatever row was under
// the finger at that moment. So sliding towards an action could fire a row on the way, before the
// finger lifted, and it never reached a row further than 20 pt away.
//
// Both limits are now off for the gesture, and the 20 pt one applies only before the menu opens, in
// `onTouchesMove` (`HOLD_SLOP`), which fails the hold the way `maxDistance` used to. After the menu
// opens the finger can go anywhere on screen, and only a release (`success`) runs an action.
//
// The points and the flag are module-level, not per bubble: only one hold can be in progress, and
// every bubble's hook already avoids shared values it does not need (see the notes below).
const DRAG_ARM_DISTANCE = 12;
const HOLD_SLOP = 20;
// For RNGH's own distance check, which must never cancel an open hold (see above).
const NO_DISTANCE_LIMIT = 100000;
const holdDownX = makeMutable(0);
const holdDownY = makeMutable(0);
const holdStartX = makeMutable(0);
const holdStartY = makeMutable(0);
const holdArmed = makeMutable(false);

export interface MessageGestureParams<T extends { id: string }> {
  /** The message this bubble renders — passed back to the reply/menu callbacks. */
  message: T;
  /** Fired (once, on release past threshold) to start a reply to this message. */
  onReply: (m: T) => void;
  /** Fired (once on activate / once on end) so the parent can lock FlatList scroll. */
  onSwipeActive: (active: boolean) => void;
  /**
   * Fired (once, on long-press activation) to open the context menu, with the bubble's animated ref:
   * the menu snapshots that view when the message cannot be shown whole where it is.
   */
  onLongPress: (m: T, bubble?: unknown) => void;
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
  /** Id of the message whose menu is open (written by the screen); that bubble lifts a little. */
  heldId?: SharedValue<string>;
  /** Id of the message the menu shows as a snapshot (written by the screen); that bubble is hidden. */
  hiddenId?: SharedValue<string>;
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
  heldId,
  hiddenId,
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

  // ── THE GESTURES DO NOT CLOSE OVER THE MESSAGE ─────────────────────────────
  //
  // Both gestures used to list `message` in their memo deps and capture it in their worklets. So any
  // new message object — a recycled cell showing another message, an edit, a store write that rebuilt
  // the row — built two new Gesture objects. GestureDetector then reattached them: a native
  // `updateGestureHandler` per gesture plus a rewrite of the shared value holding the handlers, which
  // serialises every worklet closure, the whole message included, to the UI runtime
  // (`createSerializableObject`, 55-73 ms per chat open in the emulator profiles).
  //
  // The worklets now call stable JS callbacks, and those read the current message from a ref. The
  // ref is updated in a layout effect, which runs in the same commit, before anything can be touched
  // on screen; a recycled cell is off screen while it changes message, so no gesture can be running
  // on it.
  const messageRef = useRef(message);
  // The id `liftStyle` compares against `heldId`, kept in a shared value so the style's worklet does
  // not capture `message.id`. Reanimated restarts a style mapper whenever a value its worklet captures
  // changes, so a captured id meant a mapper teardown and a re-serialisation to the UI runtime on
  // every recycle. Written from JS only when the id actually changes: the write is an async hop, and
  // READING `.value` on the JS thread is a synchronous one, which is never done here.
  const idSV = useSharedValue(message.id);
  const lastIdRef = useRef(message.id);
  useLayoutEffect(() => {
    messageRef.current = message;
    if (lastIdRef.current !== message.id) {
      lastIdRef.current = message.id;
      idSV.value = message.id;
    }
  }, [message, idSV]);
  const fireReply = useCallback(() => onReply(messageRef.current), [onReply]);
  const fireLongPress = useCallback(() => onLongPress(messageRef.current, bubbleRef), [onLongPress, bubbleRef]);
  const fireMeasured = useCallback(
    (x: number, y: number, w: number, h: number) => onMeasured?.(messageRef.current.id, x, y, w, h),
    [onMeasured],
  );
  const fireDragAction = useCallback((action: string) => onFireDragAction(messageRef.current, action), [onFireDragAction]);
  const measures = !!onMeasured;

  // ── Swipe-to-reply: UI-thread Pan ──────────────────────────────────────
  const translateXSV = useSharedValue(0);
  // The cell's flags in one shared value (every shared value is created on the UI runtime when a
  // bubble mounts, so they used to cost one each). Two last one gesture: `SWIPE_HAPTIC_FIRED` makes
  // the threshold haptic fire once, `SWIPE_ACTIVE` tells `onFinalize` to run the scroll unlock. Two
  // stay set for the cell's lifetime, `SWIPE_MOVED` and `LIFTED`; see "A BUBBLE AT REST WRITES NO
  // PROPS" below.
  const swipeFlagsSV = useSharedValue(0);

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
          swipeFlagsSV.value = (swipeFlagsSV.value & (LIFTED | HIDDEN)) | SWIPE_MOVED | SWIPE_ACTIVE;
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
          const flags = swipeFlagsSV.value;
          if ((flags & SWIPE_HAPTIC_FIRED) === 0 && dx <= -REPLY_THRESHOLD) {
            swipeFlagsSV.value = flags | SWIPE_HAPTIC_FIRED;
            runOnJS(triggerHaptic)('light');
          }
        })
        .onEnd((e) => {
          'worklet';
          if (e.translationX <= -REPLY_THRESHOLD) {
            runOnJS(fireReply)();
          }
        })
        .onFinalize(() => {
          'worklet';
          // `onFinalize` also runs for every pan that never activated, which is every vertical scroll
          // that starts on a row. Those have nothing to settle, and the spring and the flag write used
          // to wake both of this row's style mappers on each one.
          if (translateXSV.value !== 0) {
            translateXSV.value = withSpring(0, { damping: 20, stiffness: 220, mass: 0.8 });
          }
          const flags = swipeFlagsSV.value;
          const kept = flags & (SWIPE_MOVED | LIFTED | HIDDEN);
          if (kept !== flags) swipeFlagsSV.value = kept;
          if ((flags & SWIPE_ACTIVE) !== 0) runOnJS(onSwipeActive)(false);
        }),
    [fireReply, onSwipeActive, translateXSV, swipeFlagsSV, armReplyIcon],
  );

  // ── Press-drag-release: UI-thread LongPress + drag-to-select ───────────
  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(300)
        // RNGH would cancel the open hold past either of these; the limit before the menu opens is
        // `HOLD_SLOP`, in `onTouchesMove` (see "THE HOLD LASTS UNTIL THE FINGER LIFTS").
        .maxDistance(NO_DISTANCE_LIMIT)
        .shouldCancelWhenOutside(false)
        .onTouchesDown((e) => {
          'worklet';
          const touch = e.allTouches[0];
          if (!touch) return;
          holdDownX.value = touch.absoluteX;
          holdDownY.value = touch.absoluteY;
        })
        .onStart((e) => {
          'worklet';
          dragActive.value = true;
          dragFingerY.value = -1;
          hoveredAction.value = '';
          holdStartX.value = e.absoluteX;
          holdStartY.value = e.absoluteY;
          holdArmed.value = false;
          if (measures) {
            const m = measure(bubbleRef);
            if (m) runOnJS(fireMeasured)(m.pageX, m.pageY, m.width, m.height);
          }
          runOnJS(triggerHaptic)('medium');
          runOnJS(fireLongPress)();
        })
        .onTouchesMove((e, manager) => {
          'worklet';
          const touch = e.allTouches[0];
          if (!touch) return;
          const y = touch.absoluteY;
          const x = touch.absoluteX;
          if (!dragActive.value) {
            // The menu is not open yet: a finger that travels is a scroll or a swipe, not a hold.
            const dx = x - holdDownX.value;
            const dy = y - holdDownY.value;
            if (dx * dx + dy * dy > HOLD_SLOP * HOLD_SLOP) manager.fail();
            return;
          }
          dragFingerY.value = y;
          // Not choosing anything until the finger has actually moved (see `DRAG_ARM_DISTANCE`).
          if (!holdArmed.value) {
            const dx = x - holdStartX.value;
            const dy = y - holdStartY.value;
            if (dx * dx + dy * dy < DRAG_ARM_DISTANCE * DRAG_ARM_DISTANCE) return;
            holdArmed.value = true;
          }
          const zones = actionZones.value;
          let found = '';
          for (let i = 0; i < zones.length; i++) {
            const z = zones[i];
            // The menu's top actions sit side by side, so their zones also carry left/right.
            if (y >= z.top && y <= z.bottom && (z.left === undefined || z.right === undefined || (x >= z.left && x <= z.right))) {
              found = z.id;
              break;
            }
          }
          if (found !== hoveredAction.value) {
            hoveredAction.value = found;
            if (found !== '') runOnJS(triggerHaptic)('light');
          }
        })
        .onEnd((_e, success) => {
          'worklet';
          // A release over a row, after the finger moved. A cancelled hold (the system took the touch)
          // chooses nothing.
          if (!success || !holdArmed.value) return;
          const action = hoveredAction.value;
          if (action !== '') runOnJS(fireDragAction)(action);
        })
        .onFinalize(() => {
          'worklet';
          dragActive.value = false;
          dragFingerY.value = -1;
          hoveredAction.value = '';
          holdArmed.value = false;
        }),
    [fireLongPress, fireMeasured, measures, bubbleRef, fireDragAction, dragActive, dragFingerY, hoveredAction, actionZones],
  );

  // Race: whichever activates FIRST wins and cancels the other. A clear
  // horizontal swipe (≥12 px left) → reply; a still-hold (300 ms) → menu. They
  // can never both be active, so drag-select can't fight the swipe.
  const composedGesture = useMemo(() => Gesture.Race(pan, longPress), [pan, longPress]);

  // ── NO SHARED-VALUE READS IN THE FIRST RUN ──────────────────────────────────
  //
  // Reanimated runs a style worklet on the JS thread to get the first style (`initialUpdaterRun`):
  // once when `useAnimatedStyle` first runs, and again when each animated view using it first renders
  // (`PropsFilter`). In Reanimated 4.1 every `.value` read there is `executeOnUIRuntimeSync`: the JS
  // thread stops until the UI thread has answered. A bubble mount did that five times, and during a
  // fling the UI thread is the busy one, so the JS thread sat waiting on it. While scrolling, these
  // and the skeleton's were the only synchronous JS-to-UI calls in the chat (`initialUpdaterRun` ->
  // `get value`: 18 to 71 ms in emulator runs of one open and twenty flings).
  //
  // On the JS thread (`_WORKLET` is false there and true on the UI runtime) the worklets return the
  // resting style, which is what a freshly mounted bubble shows anyway: not swiped, not held. The
  // mapper Reanimated starts right after mount runs on the UI thread and applies the real values.
  // `UI_RUNTIME_MAPPERS` keeps web and jest, where the mapper itself runs on the JS thread, out of it.
  //
  // ── A BUBBLE AT REST WRITES NO PROPS ───────────────────────────────────────
  //
  // The resting style is `{}`, not `translateX: 0` / `scale: 1`, and that is what makes it free.
  // Reanimated 4.1 keeps every prop a mapper ever wrote in a registry, per view, until the view
  // unmounts, and on EVERY React commit its commit hook copies that registry and re-clones each of
  // those views with those props (`ReanimatedCommitHook::shadowTreeWillCommit` ->
  // `cloneShadowTreeWithNewProps`). A mapper writes whenever its result is not shallow-equal to the
  // previous one, and a `transform` array is a new object on every run, so both styles wrote on their
  // first UI run: two registry entries for every mounted bubble, recycle pool included, re-applied in
  // every commit of the transcript. In the emulator profile of opening the long chat and
  // fast-scrolling it, returning `{}` at rest cut `completeRoot` from 5429 to 4251 ms.
  //
  // `{}` stays `{}` (shallow-equal), so nothing is written until a bubble actually moves. A bubble
  // that has moved keeps returning its transform for the rest of the cell's life (`SWIPE_MOVED`,
  // `LIFTED`): dropping the key would not reset the view on iOS, where Reanimated does not revert a
  // prop that disappears from a style, so the last frame of a spring would stay applied.
  const bubbleAnimStyle = useAnimatedStyle(() => {
    if (UI_RUNTIME_MAPPERS && !globalThis._WORKLET) return {};
    if ((swipeFlagsSV.value & SWIPE_MOVED) === 0) return {};
    return { transform: [{ translateX: translateXSV.value }] };
  });
  // The held bubble lifts slightly while its menu is open, inside the menu's lit cut-out. UI thread
  // only: the screen flips one shared value, no bubble re-renders. Every mounted bubble's mapper
  // runs once on open and once on close, which is a handful of comparisons. Compares against `idSV`
  // rather than a captured id; see the note there.
  //
  // `LIFTED` is set here, the first time the bubble is held, rather than by the long-press gesture:
  // `heldId` follows the menu, and the menu decides whether a hold counts. Writing it re-runs the
  // mappers once, and the second run returns the same spring.
  //
  // `hiddenId`: while the menu shows a snapshot of this bubble (a message that could not be shown
  // whole where it is), the bubble itself is hidden, at once, so the snapshot is the only copy on
  // screen. Same once-set rule, flag `HIDDEN`: from then on the style always carries `opacity`.
  //
  // ── THE FIRST LIFT OF A CELL SNAPPED (Nov 2026) ───────────────────────────────────────────────
  //
  // Reported: right after launch the first hold on a message animates "fast, as if broken", and the
  // second one is smooth. At rest this style is `{}`, so the first time a cell is held Reanimated has
  // no previous `transform` to start the spring from, and a spring with no start value begins at its
  // target: the bubble jumped to 1.04 in one frame. From then on the cell has a last value (1, after
  // the release), so every later hold sprang from it. Right after launch no cell has been held, which
  // is why it was always the first hold. So the first lift of a cell writes a plain 1, and the run that
  // the flag write below causes on the next frame starts the spring from it.
  const liftStyle = useAnimatedStyle(() => {
    if (UI_RUNTIME_MAPPERS && !globalThis._WORKLET) return {};
    const held = !!heldId && heldId.value === idSV.value;
    const hidden = !!hiddenId && hiddenId.value === idSV.value;
    let flags = swipeFlagsSV.value;
    if ((flags & (LIFTED | HIDDEN)) === 0 && !held && !hidden) return {};
    const want = flags | (held ? LIFTED : 0) | (hidden ? HIDDEN : 0);
    const firstLift = (flags & LIFTED) === 0 && (want & LIFTED) !== 0;
    if (want !== flags) {
      swipeFlagsSV.value = want;
      flags = want;
    }
    const style: { transform?: { scale: number }[]; opacity?: number } = {};
    if ((flags & LIFTED) !== 0) {
      style.transform = [{ scale: firstLift ? 1 : withSpring(held ? 1.04 : 1, { damping: 15, stiffness: 260, mass: 0.7 }) }];
    }
    if ((flags & HIDDEN) !== 0) style.opacity = hidden ? 0 : 1;
    return style;
  });
  // The reply icon's opacity ramp is built by `useReplyIconStyle`, inside the icon, which is only
  // mounted once a swipe has armed it (`replyIconArmed`). It used to be built here, so every bubble
  // carried a third style mapper for an icon most bubbles never show.

  return { bubbleRef, composedGesture, bubbleAnimStyle, translateX: translateXSV, replyIconArmed, liftStyle };
}

/** Bits of `swipeFlagsSV`. The first two are cleared when a swipe ends, the others never. */
const SWIPE_HAPTIC_FIRED = 1;
const SWIPE_ACTIVE = 2;
/** The row has been swiped, so its style writes `translateX` from now on. */
const SWIPE_MOVED = 4;
/** The bubble has been lifted by a held menu, so its style writes `scale` from now on. */
const LIFTED = 8;
/** The bubble has been hidden behind a menu's snapshot of it, so its style writes `opacity` from now on. */
const HIDDEN = 16;

/**
 * The swipe-to-reply icon's opacity ramp: invisible until 24 px of travel, fully opaque at the commit
 * threshold. For the icon component, which mounts only after a swipe started, so a bubble that is
 * never swiped never builds it. `translateX` is the bubble's `translateX` from `useMessageGestures`.
 */
export function useReplyIconStyle(translateX: SharedValue<number>) {
  return useAnimatedStyle(() => {
    // The icon mounts at the start of a swipe, about 12 px in, where the ramp is still at 0. Same
    // first-run guard as the bubble styles: no synchronous read while the finger is moving.
    if (UI_RUNTIME_MAPPERS && !globalThis._WORKLET) return { opacity: 0 };
    return { opacity: interpolate(translateX.value, [-REPLY_THRESHOLD, -24, 0], [1, 0, 0], Extrapolation.CLAMP) };
  });
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
  enabled = true,
}: {
  item: T;
  onReply: (m: T) => void;
  /** Optional: lets the screen lock list scrolling for the duration, as the chat does. */
  onSwipeActive?: (active: boolean) => void;
  /** False where nothing can be replied (a thread whose comments are closed): the row does not move. */
  enabled?: boolean;
}) {
  // ── THE SAME COSTS THE CHAT BUBBLES HAD, AND THE SAME FIXES ─────────────────
  //
  // Every comment row paid, on mount: three shared values, two style mappers with four synchronous
  // JS-to-UI reads between them (`initialUpdaterRun`, run again per view by `PropsFilter`), and an
  // always-mounted reply icon. In the emulator profile of opening a 31-comment thread, those reads
  // were 33 ms of `executeOnUIRuntimeSync` inside one 314 ms task. Each row's resting `translateX: 0`
  // also went into Reanimated's prop registry, which every React commit re-applies, and the gesture
  // captured `item`, so a FlashList cell recycled onto another comment rebuilt and re-serialised it.
  // See `useMessageGestures` for the measured account of each; this is the same treatment:
  //
  //   - the gesture calls a stable callback that reads the item from a ref;
  //   - one flags shared value instead of two booleans;
  //   - the resting style is `{}` until the row has been swiped (`SWIPE_MOVED`), and the first run
  //     on the JS thread reads nothing;
  //   - the reply icon is mounted when a swipe starts (`replyIconArmed`), with its style built by
  //     `useReplyIconStyle` inside it, and stays for the cell's life.
  const itemRef = useRef(item);
  useLayoutEffect(() => {
    itemRef.current = item;
  }, [item]);
  const fireReply = useCallback(() => onReply(itemRef.current), [onReply]);
  const [replyIconArmed, setReplyIconArmed] = useState(false);
  const armReplyIcon = useCallback(() => setReplyIconArmed(true), []);

  const translateXSV = useSharedValue(0);
  const swipeFlagsSV = useSharedValue(0);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX([-12, 9999])
        .failOffsetY([-10, 10])
        .onStart(() => {
          'worklet';
          swipeFlagsSV.value = SWIPE_MOVED | SWIPE_ACTIVE;
          runOnJS(armReplyIcon)();
          if (onSwipeActive) runOnJS(onSwipeActive)(true);
        })
        .onUpdate((e) => {
          'worklet';
          const dx = Math.max(Math.min(Math.round(e.translationX), 0), -80);
          translateXSV.value = dx;
          const flags = swipeFlagsSV.value;
          if ((flags & SWIPE_HAPTIC_FIRED) === 0 && dx <= -REPLY_THRESHOLD) {
            swipeFlagsSV.value = flags | SWIPE_HAPTIC_FIRED;
            runOnJS(triggerHaptic)('light');
          }
        })
        .onEnd((e) => {
          'worklet';
          if (e.translationX <= -REPLY_THRESHOLD) {
            runOnJS(fireReply)();
          }
        })
        .onFinalize(() => {
          'worklet';
          // A pan that never activated (every vertical scroll starting on a row) has nothing to settle.
          if (translateXSV.value !== 0) {
            translateXSV.value = withSpring(0, { damping: 20, stiffness: 220, mass: 0.8 });
          }
          const flags = swipeFlagsSV.value;
          const kept = flags & SWIPE_MOVED;
          if (kept !== flags) swipeFlagsSV.value = kept;
          if ((flags & SWIPE_ACTIVE) !== 0 && onSwipeActive) runOnJS(onSwipeActive)(false);
        }),
    [fireReply, onSwipeActive, translateXSV, swipeFlagsSV, armReplyIcon, enabled],
  );

  const rowAnimStyle = useAnimatedStyle(() => {
    if (UI_RUNTIME_MAPPERS && !globalThis._WORKLET) return {};
    if ((swipeFlagsSV.value & SWIPE_MOVED) === 0) return {};
    return { transform: [{ translateX: translateXSV.value }] };
  });

  return { gesture, rowAnimStyle, translateX: translateXSV, replyIconArmed };
}
