/**
 * Closing a chat or a profile by dragging it away, the way current Telegram does it.
 *
 * Grabbed at the left or right edge or by the header, the screen comes unstuck and follows the
 * finger in any direction. It shrinks toward the point that was grabbed and rounds its corners,
 * and the screen it was opened from shows through underneath, dimmed less the further the card
 * goes. Let go before the threshold and it springs back; past it, or with a flick, it flies off at
 * the finger's own speed and the stack pops.
 *
 * ── HOW THE SCREEN BELOW BECOMES VISIBLE ────────────────────────────────────────────────────────
 *
 * A native stack keeps only its top screen attached. react-native-screens ships a JSI object for
 * custom swipe transitions, `global.RNScreensTurboModule`, installed by RNSModule on both platforms
 * (the module is required at import, src/fabric/NativeScreensModule.ts):
 *
 *   startTransition(stackTag)          Android: ScreenContainer.attachBelowTop() re-attaches the
 *                                      screen below under the top one. iOS: starts an interactive
 *                                      pop whose animator does nothing (`animateWithNoAnimation`).
 *   finishTransition(tag, cancelled)   Cancelled: the screen below is detached again. Otherwise the
 *                                      pop completes, which reaches React Navigation as `onDismissed`
 *                                      and removes the route.
 *
 * Everything that moves is ours: the card is a Reanimated view inside the top screen, over a dim
 * layer, and the route's `contentStyle` is transparent (app/_layout.tsx) so the screen below shows
 * around it. The native side only has to attach and detach.
 *
 * Not react-native-screens' own `goBackGesture` presets: their release rule is fixed (half the
 * screen, velocity capped at 100 pt), their progress is per axis, and React Navigation's native
 * stack does not pass the props they need anyway (NativeStackView.native.tsx renders a bare
 * `<ScreenStack>`).
 *
 * ── WHERE THE STACK TAG COMES FROM ──────────────────────────────────────────────────────────────
 *
 * `startTransition` takes the native tag of the stack. ScreenStack renders whatever component
 * `GHContext` holds around its native view, and calls `gestureDetectorBridge.current
 * .stackUseEffectCallback(ref)` from an effect on every render (src/components/ScreenStack.tsx).
 * `RootStackTagProvider` puts `GHWrapper` there, which only records the tag. It hands the default
 * pass-through to everything under it, so a nested stack ((auth)) cannot overwrite the root's.
 *
 * ── COST ────────────────────────────────────────────────────────────────────────────────────────
 *
 * The drag runs on the UI thread from the first frame: no JS per frame, one commit per frame with
 * the card's transform and the dim's opacity. The corner radius is written twice per gesture, at
 * the grab and after landing. The one heavy moment is the start, when Android attaches the screen
 * below.
 */
import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { findNodeHandle, Keyboard, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type {
  GestureStateChangeEvent,
  GestureUpdateEvent,
  PanGesture,
  PanGestureHandlerEventPayload,
} from 'react-native-gesture-handler';
import Reanimated, {
  cancelAnimation,
  Easing,
  makeMutable,
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { NavigationContext } from '@react-navigation/native';
import { useTransitionSettled } from '../../hooks/useTransitionSettled';
import { CARD_EDGE_LEFT, CARD_EDGE_RIGHT } from './cardDismissEdges';

// ── react-native-screens internals ──────────────────────────────────────────────────────────────

type StackBridge = { current: { stackUseEffectCallback: (stackRef: { current: unknown }) => void } };
type WrapperProps = { children?: React.ReactNode; gestureDetectorBridge: StackBridge };
type Wrapper = (props: WrapperProps) => React.JSX.Element;

// Not part of the public API, so it is looked up defensively: without it there is no tag, and every
// grab is a no-op instead of a crash. Metro resolves the package through its `react-native` field
// (src/), so this is the same module instance ScreenStack reads.
let GHContext: React.Context<Wrapper> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  GHContext = (require('react-native-screens/src/contexts') as { GHContext?: React.Context<Wrapper> }).GHContext ?? null;
} catch {
  GHContext = null;
}

type ScreenTransitions = {
  startTransition: (stackTag: number) => { topScreenTag: number; belowTopScreenTag: number; canStartTransition: boolean };
  finishTransition: (stackTag: number, canceled: boolean) => void;
};

function screenTransitions(): ScreenTransitions | null {
  const m = (globalThis as { RNScreensTurboModule?: ScreenTransitions }).RNScreensTurboModule;
  return m && typeof m.startTransition === 'function' && typeof m.finishTransition === 'function' ? m : null;
}

/** Native tag of the app's root stack. Written from JS by `GHWrapper`, read by the grab worklet. */
const rootStackTag = makeMutable(-1);
let rootStackTagJS = -1;

function captureRootStack(stackRef: { current: unknown }) {
  const tag = findNodeHandle(stackRef.current as Parameters<typeof findNodeHandle>[0]);
  if (typeof tag === 'number' && tag > 0 && tag !== rootStackTagJS) {
    rootStackTagJS = tag;
    rootStackTag.value = tag;
  }
}

function Passthrough({ children }: WrapperProps) {
  return <>{children}</>;
}

// The name matters: ScreenStack warns unless the component in GHContext is called `GHWrapper`
// (only when `goBackGesture` is set, which it never is here, but the check reads the name).
function GHWrapper({ children, gestureDetectorBridge }: WrapperProps) {
  // A layout effect, so it is in place before ScreenStack's passive effect calls it.
  useLayoutEffect(() => {
    gestureDetectorBridge.current.stackUseEffectCallback = captureRootStack;
  }, [gestureDetectorBridge]);
  const Ctx = GHContext;
  return Ctx ? <Ctx.Provider value={Passthrough}>{children}</Ctx.Provider> : <>{children}</>;
}

/** Wrap the root `<Stack>` with this. Renders no view. */
export function RootStackTagProvider({ children }: { children: React.ReactNode }) {
  const Ctx = GHContext;
  return Ctx ? <Ctx.Provider value={GHWrapper}>{children}</Ctx.Provider> : <>{children}</>;
}

// ── The card ────────────────────────────────────────────────────────────────────────────────────

const IDLE = 0;
const DRAG = 1;
const SETTLE = 2;
const FLY = 3;
const DONE = 4;

const EDGE_LEFT = CARD_EDGE_LEFT;
// Swipe-to-reply does not start inside this one (useMessageGestures), so a leftward drag there is
// always the chat's.
const EDGE_RIGHT = CARD_EDGE_RIGHT;
/** Travel before the card comes unstuck. */
const ACTIVATE = 10;
/** Vertical travel that hands an edge touch back to the list's scroll. */
const EDGE_FAIL_Y = 20;
/** Smallest the card gets, reached at 90% of the screen width of travel. */
const MIN_SCALE = 0.84;
/** Set once when the card is grabbed and cleared once it has landed: a radius change redraws the card. */
const RADIUS = 44;
/** Black over the screen below while the card is still close. */
const DIM = 0.32;
/** Seconds of release velocity added to the release point when deciding. */
const PROJECTION = 0.16;
/** Release past this share of the shorter screen side closes. */
const DISMISS_FRACTION = 0.36;
/** A flick this fast away from the start closes from any distance past `MIN_TRAVEL`. */
const FLING_SPEED = 900;
const MIN_TRAVEL = 24;
/** Slowest the card leaves at, for a slow release past the threshold. */
const FLY_SPEED = 1700;
/** Past the screen edge before the pop is completed. */
const OFFSCREEN_MARGIN = 24;
const SPRING = { damping: 28, stiffness: 280, mass: 1 } as const;

function scaleAt(x: number, y: number, reach: number) {
  'worklet';
  const p = Math.min(1, Math.sqrt(x * x + y * y) / reach);
  // Ease-out, so the card visibly lets go in the first centimetre instead of shrinking linearly.
  return 1 - (1 - MIN_SCALE) * (1 - (1 - p) * (1 - p));
}

export type CardDismissMode = 'chat' | 'profile';

export function CardDismissSurface({
  mode,
  topZone,
  enabled = true,
  backgroundColor,
  onGrab,
  onLand,
  children,
}: {
  /**
   * `chat`: the left and right edges, and the header strip in any direction (that is where the
   * avatar and the name are). `profile`: a sideways swipe to the right from anywhere, the right
   * edge, and a pull down from the top strip. The profile scrolls under its top strip, so an
   * upward drag there stays a scroll.
   */
  mode: CardDismissMode;
  /** Height of the top strip that grabs the card: status bar plus the header row. */
  topZone: number;
  /** Off while something drawn inside the screen owns the touches (the photo viewer, the hold menu). */
  enabled?: boolean;
  /** The card is opaque on its own: the scene behind it is transparent. */
  backgroundColor: string;
  /** JS thread, when a drag has taken the touch (the press under the finger is being cancelled). */
  onGrab?: () => void;
  /** JS thread, when the card is back in place after a drag that did not close it. */
  onLand?: () => void;
  children: React.ReactNode;
}) {
  const { width: W, height: H } = useWindowDimensions();
  // Not during the push: the stack is still animating, and a pop started now would fight it.
  const settled = useTransitionSettled();
  const navigation = useContext(NavigationContext);
  const rns = useMemo(screenTransitions, []);
  const live = enabled && settled && rns !== null && GHContext !== null;

  // Finger travel since the grab; the card's offset is derived from it.
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  // The grabbed point relative to the card's centre, so it stays under the finger as the card shrinks.
  const ax = useSharedValue(0);
  const ay = useSharedValue(0);
  const baseX = useSharedValue(0);
  const baseY = useSharedValue(0);
  const phase = useSharedValue(IDLE);
  const grabbing = useSharedValue(false);
  const openTag = useSharedValue(-1);
  const springsLeft = useSharedValue(0);

  const reach = Math.max(1, Math.min(W, H) * 0.9);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── ANDROID: THE LIFTED CARD IS ONE TEXTURE ─────────────────────────────────
  //
  // Measured on the Android emulator (dumpsys gfxinfo, same chat): a transcript scroll had 10% janky
  // frames, this drag 20-24%. Each frame of the drag composites two whole screens, and without a
  // layer the card's every display list (wallpaper, bubbles, photos) is replayed under the new
  // transform. A hardware layer while the card is off its place renders the chat once and moves a
  // texture. Only then: as a permanent layer every scroll and keystroke would redraw it as well.
  // iOS composites the moved layer tree itself, and `shouldRasterizeIOS` would freeze the blur views.
  const [lifted, setLifted] = useState(false);
  const onGrabRef = useRef(onGrab);
  const onLandRef = useRef(onLand);
  useEffect(() => {
    onGrabRef.current = onGrab;
    onLandRef.current = onLand;
  });
  const grabbed = useCallback(() => {
    Keyboard.dismiss();
    if (Platform.OS === 'android') setLifted(true);
    onGrabRef.current?.();
  }, []);
  const landedJS = useCallback(() => {
    setLifted(false);
    onLandRef.current?.();
  }, []);

  // Safety net for a pop that did not happen (the native side refused it): the card would stay
  // off-screen over a screen that never left. If the route is still focused well after the throw,
  // bring the card back.
  const onThrown = useCallback(() => {
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = setTimeout(() => {
      fallback.current = null;
      if (!navigation?.isFocused()) return;
      runOnUI(() => {
        'worklet';
        if (phase.value !== DONE) return;
        phase.value = IDLE;
        dx.value = withSpring(0, SPRING);
        dy.value = withSpring(0, SPRING);
      })();
      setLifted(false);
      onLandRef.current?.();
    }, 1500);
  }, [navigation, phase, dx, dy]);

  const { gesture, completeDismiss } = useMemo(() => {
    const dismissDistance = Math.min(W, H) * DISMISS_FRACTION;
    const far = W + H;
    const cx = W / 2;
    const cy = H / 2;

    const finish = (cancelled: boolean) => {
      'worklet';
      const tag = openTag.value;
      openTag.value = -1;
      if (tag < 0 || rns === null) return;
      try {
        rns.finishTransition(tag, cancelled);
      } catch {
        // Android throws if the stack changed under the drag (fewer than two screens left).
      }
    };

    const completeDismiss = () => {
      'worklet';
      if (phase.value !== FLY) return;
      phase.value = DONE;
      finish(false);
    };

    const onStart = (e: GestureStateChangeEvent<PanGestureHandlerEventPayload>) => {
      'worklet';
      grabbing.value = false;
      const ph = phase.value;
      if (ph === FLY || ph === DONE) return;
      if (ph === SETTLE) {
        // Caught on its way back: the transition is still open, so carry on from where it is.
        cancelAnimation(dx);
        cancelAnimation(dy);
        baseX.value = dx.value - e.translationX;
        baseY.value = dy.value - e.translationY;
        phase.value = DRAG;
        grabbing.value = true;
        return;
      }
      const stack = rootStackTag.value;
      if (stack < 0 || rns === null) return;
      let started = false;
      try {
        started = rns.startTransition(stack).canStartTransition === true;
      } catch {
        started = false;
      }
      // Nothing below (a chat opened straight from a link), or a transition already running.
      if (!started) return;
      openTag.value = stack;
      ax.value = e.absoluteX - cx;
      ay.value = e.absoluteY - cy;
      // From where the finger is now, not from the touch-down: no jump by the activation distance.
      baseX.value = -e.translationX;
      baseY.value = -e.translationY;
      dx.value = 0;
      dy.value = 0;
      phase.value = DRAG;
      grabbing.value = true;
      runOnJS(grabbed)();
    };

    const onUpdate = (e: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
      'worklet';
      if (!grabbing.value) return;
      dx.value = baseX.value + e.translationX;
      dy.value = baseY.value + e.translationY;
    };

    const onEnd = (e: GestureStateChangeEvent<PanGestureHandlerEventPayload>, success: boolean) => {
      'worklet';
      if (!grabbing.value) return;
      grabbing.value = false;
      const x = dx.value;
      const y = dy.value;
      const vx = e.velocityX;
      const vy = e.velocityY;
      const dist = Math.sqrt(x * x + y * y);
      const speed = Math.sqrt(vx * vx + vy * vy);
      const outward = vx * x + vy * y > 0;
      const px = x + vx * PROJECTION;
      const py = y + vy * PROJECTION;
      const projected = Math.sqrt(px * px + py * py);
      const dismiss = success && dist > MIN_TRAVEL && (projected > dismissDistance || (outward && speed > FLING_SPEED));

      if (dismiss) {
        // Along the flick if there is one, else straight on from where it was let go.
        let ux = 1;
        let uy = 0;
        if (outward && speed > 300) {
          ux = vx / speed;
          uy = vy / speed;
        } else if (dist > 0.5) {
          ux = x / dist;
          uy = y / dist;
        }
        // Constant speed: the finger's own, so the card keeps the momentum it was thrown with.
        const duration = (far / Math.max(speed, FLY_SPEED)) * 1000;
        phase.value = FLY;
        dx.value = withTiming(x + ux * far, { duration, easing: Easing.linear }, (finished) => {
          if (finished) completeDismiss();
        });
        dy.value = withTiming(y + uy * far, { duration, easing: Easing.linear });
        runOnJS(onThrown)();
        return;
      }

      // Back into place, starting at the finger's velocity. The screen below stays attached until
      // the card has landed, so nothing blinks out around it on the way.
      phase.value = SETTLE;
      springsLeft.value = 2;
      const landed = (finished?: boolean) => {
        'worklet';
        if (!finished || phase.value !== SETTLE) return;
        springsLeft.value -= 1;
        if (springsLeft.value > 0) return;
        phase.value = IDLE;
        finish(true);
        runOnJS(landedJS)();
      };
      dx.value = withSpring(0, { ...SPRING, velocity: vx }, landed);
      dy.value = withSpring(0, { ...SPRING, velocity: vy }, landed);
    };

    const attach = (g: PanGesture) => g.enabled(live).onStart(onStart).onUpdate(onUpdate).onEnd(onEnd);

    const rightEdge = attach(
      Gesture.Pan().hitSlop({ right: 0, width: EDGE_RIGHT }).activeOffsetX(-ACTIVATE).failOffsetY([-EDGE_FAIL_Y, EDGE_FAIL_Y]),
    );
    const g =
      mode === 'chat'
        ? Gesture.Race(
            attach(Gesture.Pan().hitSlop({ left: 0, width: EDGE_LEFT }).activeOffsetX(ACTIVATE).failOffsetY([-EDGE_FAIL_Y, EDGE_FAIL_Y])),
            rightEdge,
            attach(Gesture.Pan().hitSlop({ top: 0, height: topZone }).minDistance(ACTIVATE)),
          )
        : Gesture.Race(
            attach(Gesture.Pan().activeOffsetX(12).failOffsetY([-14, 14])),
            rightEdge,
            attach(
              Gesture.Pan().hitSlop({ top: 0, height: topZone }).activeOffsetY(ACTIVATE).activeOffsetX([-ACTIVATE, ACTIVATE]).failOffsetY(-8),
            ),
          );
    return { gesture: g, completeDismiss };
  }, [W, H, mode, topZone, live, rns, grabbed, landedJS, onThrown, dx, dy, ax, ay, baseX, baseY, phase, grabbing, openTag, springsLeft]);

  // Complete the pop as soon as the card is out of sight, not when its timing ends.
  useAnimatedReaction(
    () => {
      if (phase.value !== FLY) return false;
      const x = dx.value;
      const y = dy.value;
      const s = scaleAt(x, y, reach);
      const left = W / 2 + x + ax.value * (1 - s) - (W / 2) * s;
      const top = H / 2 + y + ay.value * (1 - s) - (H / 2) * s;
      const m = OFFSCREEN_MARGIN;
      return left > W + m || left + W * s < -m || top > H + m || top + H * s < -m;
    },
    (gone, wasGone) => {
      if (gone && !wasGone) completeDismiss();
    },
    [W, H, reach, completeDismiss],
  );

  const cardStyle = useAnimatedStyle(() => {
    const x = dx.value;
    const y = dy.value;
    const s = scaleAt(x, y, reach);
    return {
      // Rounded from the grab, square again once it has landed: two radius writes per gesture.
      borderRadius: phase.value === IDLE ? 0 : RADIUS,
      transform: [{ translateX: x + ax.value * (1 - s) }, { translateY: y + ay.value * (1 - s) }, { scale: s }],
    };
  }, [reach]);

  const dimStyle = useAnimatedStyle(() => {
    const x = dx.value;
    const y = dy.value;
    const d = Math.sqrt(x * x + y * y);
    return { opacity: d < 0.5 ? 0 : DIM * (1 - Math.min(1, d / reach)) };
  }, [reach]);

  useEffect(
    () => () => {
      if (fallback.current) clearTimeout(fallback.current);
      // iOS only. Unmounted mid-drag (the route was removed by something else): an interactive pop
      // left open would hold every later stack update, so cancel it. Not on Android, where the stack
      // has already changed and `detachBelowTop` would act on the wrong screen.
      if (Platform.OS !== 'ios' || rns === null) return;
      runOnUI(() => {
        'worklet';
        const ph = phase.value;
        if (ph !== DRAG && ph !== SETTLE && ph !== FLY) return;
        const tag = openTag.value;
        openTag.value = -1;
        if (tag < 0) return;
        try {
          rns.finishTransition(tag, true);
        } catch {}
      })();
    },
    [rns, phase, openTag],
  );

  return (
    <>
      <Reanimated.View pointerEvents="none" style={[styles.dim, dimStyle]} />
      <GestureDetector gesture={gesture}>
        <Reanimated.View
          collapsable={false}
          renderToHardwareTextureAndroid={lifted}
          style={[styles.card, { backgroundColor }, cardStyle]}
        >
          {children}
        </Reanimated.View>
      </GestureDetector>
    </>
  );
}

const styles = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', opacity: 0 },
  card: { flex: 1, overflow: 'hidden', borderCurve: 'continuous' },
});
