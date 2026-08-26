import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Pressable, Modal, Dimensions, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { ModalStatusBar } from './ModalStatusBar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

/** Collapsed detent: the card floats, clear of every screen edge. */
const INSET_X = 8;
const INSET_BOTTOM = 16;
const CORNER = 28;

/** Lift needed before releasing expands the sheet to the edges. */
const EXPAND_LIFT = 24;
/** How far the finger can actually lift the card. Resistance past this. */
const MAX_LIFT = 60;
/** Downward travel that dismisses from the collapsed detent. */
const DISMISS_TRAVEL = 100;
const DISMISS_VELOCITY = 800;
/** Downward travel that collapses an expanded sheet back to floating. */
const COLLAPSE_TRAVEL = 40;

interface SlideUpSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Leave in a SINGLE commit, with no exit animation, for a handoff to another screen.
   *
   * ── WHY A HANDOFF GETS NO FAREWELL ────────────────────────────────────────
   *
   * This started as `exitUpRef` — slide up instead of down, on the reasoning that direction carries
   * meaning: down means "finished with this", up means "this is becoming something else". The reasoning
   * is fine and the result was not. Reported as: "it disappears, hangs for a millisecond, hangs again,
   * disappears again."
   *
   * That is what two simultaneous transitions look like when one of them is an RN `<Modal>`. Presenting
   * a route while a Modal is up makes iOS re-composite the window: the new screen appears behind the
   * Modal, the Modal then animates out on a JS-driven value, and the `visible || mounted` bookkeeping
   * below commits twice more on the way. Several visual events for one tap.
   *
   * Dropping the sheet immediately leaves exactly ONE animation — the navigator's — with nothing to
   * fight it. The sheet is being replaced by a whole screen, so there is nothing for its exit to
   * communicate that the incoming screen does not already say.
   *
   * A ref rather than a prop, because the choice belongs to WHICH control was pressed at the moment it
   * is pressed; a prop would have to be set in a prior render and would still be set on the next
   * ordinary close. Consumed on use, so one arming grants exactly one instant exit.
   */
  exitInstantRef?: React.MutableRefObject<boolean>;
  /**
   * Opt OUT of the drag-to-expand detent, for sheets whose content must keep a fixed width.
   * Default is on. The grabber still drags to dismiss either way.
   */
  expandable?: boolean;
}

/**
 * Bottom sheet with two detents, matching the feed's three-dots menu (PostMenuModal) on open and
 * close: spring slide-up, a 0.4 black backdrop over 200 ms, 250 ms slide-down on close.
 *
 * ── THE GRABBER USED TO BE DECORATION ─────────────────────────────────────────
 *
 * Requested: the sheet should not touch the screen edges, and dragging it up should expand it so
 * that it does.
 *
 * Half of that was already true and had been for a long time — the card sits at `INSET_X` from the
 * sides and `INSET_BOTTOM` from the bottom with 28 pt corners, so it floats. What was missing was
 * the gesture. There was a 40x5 pill drawn at the top of every sheet in the app and NO pan handler
 * anywhere near it: it looked draggable and was not. Ten surfaces inherited that.
 *
 * ── WHY THE INSET SNAPS INSTEAD OF FOLLOWING THE FINGER ───────────────────────
 *
 * The collapsed/expanded difference is `marginHorizontal`, `marginBottom` and the bottom corner
 * radii. Those are LAYOUT properties: every frame they change, the card and everything inside it
 * re-measures. Several of these sheets host a FlatList (`FollowsListModal`) or a ScrollView
 * (`TranslationSheet`), so following the finger with the inset would re-measure a list on every
 * frame of the drag — the exact class of cost this app has spent a long time removing.
 *
 * So the two channels are split by what they cost:
 *
 *   `lift`   transform only, free, follows the finger live with rubber-band resistance.
 *   `expand` layout, so it SNAPS with one 220 ms timing on release, never per frame.
 *
 * The drag still feels live because the finger is always moving something (`lift`), and the layout
 * pass happens once per detent change rather than sixty times a second.
 *
 * ── WHY THE PAN IS ON THE GRABBER, NOT THE CARD ───────────────────────────────
 *
 * A pan across the whole card would compete with the inner ScrollView/FlatList for the same vertical
 * drag, and which one wins differs per platform. Scoping it to the grabber strip means no sheet in
 * the app has to know this exists, and no inner list changes behaviour.
 *
 * Reanimated + gesture-handler rather than RN `Animated`: layout props cannot go through
 * `useNativeDriver`, so this would otherwise have to animate on the JS thread.
 */
export function SlideUpSheet({ visible, onClose, children, exitInstantRef, expandable = true }: SlideUpSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  /** Vertical offset from the resting detent. 0 = at rest, SCREEN_HEIGHT = off screen. */
  const translateY = useSharedValue(SCREEN_HEIGHT);
  /** 0 = floating clear of the edges, 1 = flush with them. Layout, so it only ever snaps. */
  const expand = useSharedValue(0);
  const backdrop = useSharedValue(0);
  /** Read inside the gesture so a drag knows which detent it started from. */
  const startExpand = useSharedValue(0);
  const isClosing = useRef(false);
  const [mounted, setMounted] = useState(false);

  const finish = useCallback(() => {
    // Preserved from the original: the 30 ms gap after the exit before `onClose`. Consumers depend
    // on the sheet being visually gone before the parent reacts — see the handoff notes in
    // AddGifModal and MediaPanel.
    setTimeout(() => { setMounted(false); onClose(); }, 30);
  }, [onClose]);

  const dismiss = useCallback(() => {
    if (isClosing.current) return;
    isClosing.current = true;
    // Handoff: gone in one commit, no animation, no timer. Consumed here so one arming grants exactly
    // one instant exit and an ordinary close afterwards still animates. See `exitInstantRef`.
    if (exitInstantRef?.current) {
      exitInstantRef.current = false;
      translateY.value = SCREEN_HEIGHT;
      backdrop.value = 0;
      expand.value = 0;
      setMounted(false);
      onClose();
      return;
    }
    translateY.value = withTiming(SCREEN_HEIGHT, { duration: 250, easing: Easing.in(Easing.cubic) });
    backdrop.value = withTiming(0, { duration: 250 }, (done) => {
      if (done) runOnJS(finish)();
    });
  }, [backdrop, exitInstantRef, expand, finish, onClose, translateY]);

  // A worklet-callable dismiss. The gesture runs on the UI thread and cannot touch the refs above.
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const dismissFromGesture = useCallback(() => { dismissRef.current(); }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      isClosing.current = false;
      translateY.value = SCREEN_HEIGHT;
      backdrop.value = 0;
      // Always open at the floating detent, so a sheet left expanded does not reopen expanded.
      expand.value = 0;
      // ── NO OVERSHOOT ON OPEN ──────────────────────────────────────────────
      //
      // Reported: the sheet "moves up a bit, then a bit back down" on open, and it should just
      // open normally.
      //
      // That is the spring, and it is not a tuning accident — it is arithmetic. The numbers were
      // `stiffness: 50, damping: 9, mass: 1`, carried over from PostMenuModal's RN `Animated`
      // `tension: 50, friction: 9`. Damping ratio is `damping / (2 * sqrt(stiffness * mass))`
      // = 9 / 14.1 = 0.64. Anything below 1 is under-damped and MUST overshoot and settle back;
      // the bounce was guaranteed by the constants, on both the old API and the new one, and no
      // amount of adjusting the duration would have removed it.
      //
      // A timing curve instead of a stiffer spring, because the requirement is "just opens" and a
      // decelerating ease is exactly that with nothing to reason about: monotonic, arrives once,
      // never passes its target. 300 ms matches the media viewer's rise so the two read as the
      // same system.
      translateY.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });
      backdrop.value = withTiming(1, { duration: 200 });
    } else if (mounted && !isClosing.current) {
      // External close (parent set visible=false without going through the backdrop press /
      // onRequestClose): run the same dismiss animation so the sheet doesn't get stuck visible while
      // React thinks it's closed. This was the "category tap plays haptic but the sheet doesn't
      // dismiss" bug in the mini-app report flow.
      dismiss();
    }
    // We deliberately depend only on `visible`; `mounted` and `isClosing` are refs / state that
    // don't need to retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const grabberGesture = React.useMemo(
    () =>
      Gesture.Pan()
        // Widens the drag target from the 19 pt strip to roughly 55 pt without touching layout. A
        // 5 pt pill is not a grabbable target, and this is the only way to fix that without moving
        // every sheet's content down. Taps on the content below still reach it: hitSlop only extends
        // where this pan can BEGIN, and a pan needs movement to activate, so a press still wins.
        .hitSlop({ top: 12, bottom: 24, left: 0, right: 0 })
        .onBegin(() => {
          startExpand.value = expand.value;
        })
        .onUpdate((e) => {
          const d = e.translationY;
          if (d >= 0) {
            // Downward always follows the finger one to one: this is either a collapse or a dismiss,
            // and both want the card attached to the touch.
            translateY.value = d;
            return;
          }
          // Upward is a hint, not a drag: the sheet has nowhere to go above its resting position, so
          // travel is damped and capped. Without the cap the card would follow the finger off the top
          // of the screen and the release would look like it snapped back from nowhere.
          if (startExpand.value === 1 || !expandable) {
            translateY.value = Math.max(d * 0.12, -12);
            return;
          }
          translateY.value = Math.max(d * 0.35, -MAX_LIFT);
        })
        .onEnd((e) => {
          const d = e.translationY;
          const fast = e.velocityY > DISMISS_VELOCITY;

          if (startExpand.value === 1) {
            // From the expanded detent: a small pull collapses, a big one closes.
            if (d > DISMISS_TRAVEL + COLLAPSE_TRAVEL || fast) {
              runOnJS(dismissFromGesture)();
              return;
            }
            if (d > COLLAPSE_TRAVEL) {
              expand.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
            }
            // Damping raised 20 -> 26 here and below. At 20 the ratio was 0.74, so releasing a drag
            // bounced too — the same under-damped settle as the open, just smaller. 26 puts the ratio
            // at ~0.96: it still decelerates like a spring, it just never passes the target.
            translateY.value = withSpring(0, { damping: 26, stiffness: 260, mass: 0.7 });
            return;
          }

          if (d > DISMISS_TRAVEL || fast) {
            runOnJS(dismissFromGesture)();
            return;
          }
          if (expandable && (d < -EXPAND_LIFT || e.velocityY < -500)) {
            expand.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
          }
          translateY.value = withSpring(0, { damping: 26, stiffness: 260, mass: 0.7 });
        }),
    [dismissFromGesture, expand, expandable, startExpand, translateY],
  );

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    marginHorizontal: interpolate(expand.value, [0, 1], [INSET_X, 0], Extrapolation.CLAMP),
    marginBottom: interpolate(expand.value, [0, 1], [INSET_BOTTOM, 0], Extrapolation.CLAMP),
    // Top corners are constant. Only the BOTTOM pair squares off, because that is the pair that
    // reaches the screen edge when the sheet expands — rounding a corner that touches the bezel is
    // what makes a sheet look like it is floating, so it has to go.
    borderBottomLeftRadius: interpolate(expand.value, [0, 1], [CORNER, 0], Extrapolation.CLAMP),
    borderBottomRightRadius: interpolate(expand.value, [0, 1], [CORNER, 0], Extrapolation.CLAMP),
  }));

  if (!visible && !mounted) return null;

  return (
    <Modal visible={visible || mounted} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <ModalStatusBar />
      {/* Mandatory inside a Modal: RN portals modal contents outside the app's root gesture view, so
          handlers attached to <GestureDetector> never fire without a root of their own here. The same
          requirement is recorded at length in app/profile/edit.tsx, which hit it first. */}
      <GestureHandlerRootView style={styles.fill}>
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {/* Backdrop sits BELOW the content. Without an explicit zIndex on the content wrapper
              React Native's tap routing can let the backdrop's full-screen Pressable swallow taps on
              the card itself on some configurations (Modal + absolute backdrop + Animated child),
              which is exactly the "buttons don't react" symptom users reported on the mini-app
              report sheet. */}
          <Animated.View
            pointerEvents={visible ? 'auto' : 'none'}
            style={[styles.backdrop, backdropStyle]}
          >
            <Pressable style={styles.fill} onPress={dismiss} />
          </Animated.View>

          <View style={styles.cardHost} pointerEvents="box-none">
            <Animated.View
              style={[
                styles.card,
                {
                  backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF',
                },
                cardStyle,
              ]}
            >
              {/* The grabber strip is the drag surface, at the original 19 pt of layout with the
                  touch target widened by the gesture's `hitSlop`. */}
              <GestureDetector gesture={grabberGesture}>
                <View style={styles.grabberStrip}>
                  <View
                    style={[
                      styles.grabber,
                      { backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' },
                    ]}
                  />
                </View>
              </GestureDetector>
              {children}
              <View style={{ height: 10 + insets.bottom }} />
            </Animated.View>
          </View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 1,
  },
  cardHost: { flex: 1, justifyContent: 'flex-end', zIndex: 2 },
  // Margins and the bottom corners are animated in `cardStyle`; only the constant half lives here.
  // Earlier 40 pt corners + a safe-area bottom made the same component look like a different sheet
  // family, which is what users were comparing against.
  card: {
    borderTopLeftRadius: CORNER,
    borderTopRightRadius: CORNER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
  },
  // Layout is byte-for-byte the original (paddingTop 10 / pill 5 / paddingBottom 4 = 19 pt) so none
  // of the ten sheets shifts by a pixel. The drag target is widened with the gesture's own `hitSlop`
  // instead of with height, because growing this strip would push every sheet's content down, and a
  // negative margin to compensate would park the pill UNDERNEATH the content, where children win the
  // touch and the gesture would never start.
  grabberStrip: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  grabber: { width: 40, height: 5, borderRadius: 3 },
});
