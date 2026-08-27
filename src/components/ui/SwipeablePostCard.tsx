import React, { useRef, useState, useCallback, useEffect, useMemo, memo } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  interpolate,
  Extrapolation,
  runOnJS,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { View, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';
import { t } from '../../i18n/store';

const BUTTON_WIDTH = 65;

// ── Hoisted out of render ───────────────────────────────────────────────────
//
// This component is mounted ONCE PER POST ROW by both profile cards, and every view in it was taking
// an inline style object literal. A profile screen with forty rows minted four fresh objects per row
// per commit for styles that never vary. The two theme-dependent values are the only ones that have
// to stay dynamic, and they are the button's fill and nothing else.
const swipeStyles = StyleSheet.create({
  root: { position: 'relative' },
  buttonWrap: { position: 'absolute', right: 0, top: 0, bottom: 12, width: BUTTON_WIDTH, justifyContent: 'center', alignItems: 'center' },
  button: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});

interface SwipeablePostCardProps {
  children: React.ReactNode;
}

function SwipeablePostCardBase({ children }: SwipeablePostCardProps) {
  const theme = useTheme();
  // ── The swipe runs entirely on the UI thread ────────────────────────────────
  //
  // It did not. `translateX` was a legacy `Animated.Value` and the pan's `onUpdate`
  // worklet called `runOnJS(handleGestureUpdate)(e.translationX)`, which then did
  // `translateX.setValue(...)`. So every frame of every swipe made this trip:
  //
  //     UI thread (gesture) → JS thread (setValue) → native (view update)
  //
  // That is the exact shape the architecture is supposed to avoid, and it is worse here
  // than it looks: this component is mounted PER POST ROW (ProfilePostCard,
  // UserProfilePostCard), the JS thread is the one already busy rendering cards during a
  // scroll, and `setValue` on a native-driver value still has to cross the boundary.
  // A swipe that starts while cards are mounting drops frames for that reason alone.
  //
  // Now `translateX` is a shared value written directly by the worklet, so the finger
  // tracking never leaves the UI thread. `runOnJS` survives only at phase boundaries
  // (arming and clearing the 3 s auto-close timer, which is genuinely JS state).
  //
  // Spring mapping note: legacy `{ tension: 150, friction: 15 }` maps to Reanimated's
  // `{ stiffness: 150, damping: 15 }` — same underlying model, so the snap feels the same.
  const translateX = useSharedValue(0);
  // UI-thread mirrors of the two flags the gesture needs to consult per frame. Reading a
  // React ref from a worklet is not allowed, and marshalling to JS to read it is the very
  // thing being removed.
  const isOpenSV = useSharedValue(false);
  const ignoreGestureSV = useSharedValue(false);
  // JS-side mirror, kept only for `handleScreenshot` (which is already a JS-thread async
  // function). Updated at phase boundaries, never per frame.
  const isOpen = useRef(false);
  const timer = useRef<any>(null);
  const cardRef = useRef<View>(null);

  // ── THE CAMERA BUTTON IS NOT MOUNTED UNTIL A SWIPE STARTS ─────────────────
  //
  // It used to be mounted unconditionally on every row, sitting at `opacity: 0` because `buttonStyle`
  // interpolates to zero at rest. That is three native views (Reanimated.View, Pressable, the Feather
  // glyph) plus an animated-props node, per row, for something the user cannot see and on most rows
  // never will. On a forty-row profile that is a hundred and twenty native views of pure overhead.
  //
  // `false → true` and it stays true for the row's lifetime, so the button never disappears mid-swipe
  // and a second swipe pays nothing.
  //
  // Where it is armed matters. `onStart` is the right place because the pan only activates after 12 pt
  // of deliberate LEFT movement (`activeOffsetX([-12, 9999])`), and `buttonStyle` keeps the opacity at
  // zero until the row has travelled 55 pt (`[-BUTTON_WIDTH, -BUTTON_WIDTH + 10, 0] -> [1, 0, 0]`). So
  // there are ~43 pt of finger travel between mounting it and the first frame it is visible on — the
  // commit lands well before anything needs to be on screen.
  //
  // It does cost one re-render of this row at the instant a swipe begins. That is the correct side of
  // the trade: mount cost is paid on every row on every open and scroll, which is what the user feels
  // as the screen assembling itself, whereas this is one commit on a deliberate and rare gesture.
  const [buttonArmed, setButtonArmed] = useState(false);
  const armButton = useCallback(() => setButtonArmed(true), []);

  const clearAutoClose = useCallback(() => {
    isOpen.current = false;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  // Fired by the 3 s timer. Writing a shared value from the JS thread is fine — it is one
  // write, not a per-frame stream.
  const closeFromTimer = useCallback(() => {
    isOpen.current = false;
    timer.current = null;
    isOpenSV.value = false;
    translateX.value = withTiming(0, { duration: 200 });
  }, [isOpenSV, translateX]);

  const armAutoClose = useCallback(() => {
    isOpen.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(closeFromTimer, 3000);
  }, [closeFromTimer]);

  // Clear the 3-second auto-reset timer on unmount. Without this, if a
  // user swipes a card open then scrolls fast enough to recycle the row
  // before the timer fires, the closure keeps Animated.Value references
  // alive and resetPosition runs on a torn-down view — harmless but a
  // small leak that adds up across a long scroll session.
  useEffect(() => {
    return () => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    };
  }, []);

  // Horizontal swipe-left to reveal the screenshot button, built on
  // react-native-gesture-handler (same mechanism as the chat message swipe in
  // useMessageGestures). This replaces the old PanResponder, which the parent
  // vertical FlatList kept stealing — making the swipe very hard to trigger.
  //
  // The thresholds now mirror useMessageGestures EXACTLY, so the post-card
  // swipe feels identical to the chat message swipe:
  //   • activeOffsetX([-12, 9999]) → only a deliberate LEFT pull (>= 12 px)
  //     activates the pan; rightward motion never activates it at all, so the
  //     gesture is reserved purely for the left swipe-to-screenshot action.
  //   • failOffsetY([-10, 10])     → the pan FAILS the moment >= 10 px of
  //     VERTICAL movement occurs, cleanly handing the gesture back to the
  //     FlatList so vertical scrolling always wins over a diagonal drag.
  //
  // Constructing the gesture unconditionally (RNGH gestures are far cheaper
  // than the per-card PanResponder closures we used to allocate) also closes
  // the old lazy-init gap where the swipe was unavailable for a frame or two
  // right after a scroll settled.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 9999])
        .failOffsetY([-10, 10])
        .onStart(() => {
          'worklet';
          // Mount the affordance now — see the note on `buttonArmed`. Unconditional, because both
          // branches below can leave the row in a state where the button needs to be on screen.
          runOnJS(armButton)();
          if (isOpenSV.value) {
            // Swiping a row that is already open just closes it, and the rest of this
            // gesture is swallowed — same behaviour as before.
            ignoreGestureSV.value = true;
            isOpenSV.value = false;
            translateX.value = withTiming(0, { duration: 200 });
            runOnJS(clearAutoClose)();
          } else {
            ignoreGestureSV.value = false;
          }
        })
        .onUpdate((e) => {
          'worklet';
          if (ignoreGestureSV.value || isOpenSV.value) return;
          // Left only, clamped to the button width. No JS involvement.
          if (e.translationX < 0) {
            translateX.value = Math.max(e.translationX, -BUTTON_WIDTH);
          }
        })
        .onEnd((e) => {
          'worklet';
          if (ignoreGestureSV.value) {
            ignoreGestureSV.value = false;
            return;
          }
          if (e.translationX < -20) {
            isOpenSV.value = true;
            translateX.value = withSpring(-BUTTON_WIDTH, { stiffness: 150, damping: 15 });
            runOnJS(armAutoClose)();
          } else {
            isOpenSV.value = false;
            translateX.value = withTiming(0, { duration: 200 });
            runOnJS(clearAutoClose)();
          }
        }),
    [isOpenSV, ignoreGestureSV, translateX, clearAutoClose, armAutoClose, armButton],
  );

  // The only style in here that depends on anything. Memoised so it is one object per theme flip
  // rather than one per row per commit.
  const buttonFill = useMemo(
    () => ({ backgroundColor: theme.colors.accent.primary }),
    [theme.colors.accent.primary],
  );

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  // Same ramp the legacy `translateX.interpolate` produced, now evaluated on the UI thread.
  const buttonStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [-BUTTON_WIDTH, -BUTTON_WIDTH + 10, 0],
      [1, 0, 0],
      Extrapolation.CLAMP,
    ),
  }));

  // Memoised so the Pressable below gets a stable `onPress` identity. It was a fresh async closure per
  // render, capturing the whole MediaLibrary / Sharing capture chain, allocated for every row on every
  // commit — including all the rows whose button is now never mounted at all.
  const handleScreenshot = useCallback(async () => {
    triggerHaptic('medium');

    // First reset position so screenshot shows full card
    isOpen.current = false;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    isOpenSV.value = false;
    translateX.value = withTiming(0, { duration: 150 });

    // Wait for animation to complete
    await new Promise(resolve => setTimeout(resolve, 200));

    try {
      // Capture the card view
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 });

      // Save to gallery
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status === 'granted') {
        await MediaLibrary.saveToLibraryAsync(uri);
        showToast(t('swipeable.saved_to_gallery'), 'camera');
      } else {
        // Fallback: share
        await Sharing.shareAsync(uri);
      }
    } catch (e) {
      showToast(t('swipeable.save_failed'), 'x');
    }
  }, [isOpenSV, translateX, t]);

  return (
    <View style={swipeStyles.root}>
      {buttonArmed ? (
        <Reanimated.View style={[swipeStyles.buttonWrap, buttonStyle]}>
          <Pressable onPress={handleScreenshot} style={[swipeStyles.button, buttonFill]}>
            <Feather name="camera" size={17} color="#FFFFFF" />
          </Pressable>
        </Reanimated.View>
      ) : null}

      <GestureDetector gesture={panGesture}>
        <Reanimated.View style={cardStyle}>
          <View ref={cardRef} collapsable={false}>
            {children}
          </View>
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

// ── memo, BECAUSE THIS IS THE HEAVIEST THING ON A PROFILE ROW ───────────────
//
// It was a plain function component while both cards that use it are carefully memoised, so every
// parent commit re-ran this entire hook stack per row: three shared values, an RNGH pan gesture with
// four worklets, and two animated-style mappers. That is far more machinery than the card body it
// wraps, and it was the one piece of the row nothing guarded.
//
// children is the only prop, and both call sites build it inside an already-memoised card, so a
// plain shallow comparison is exactly right: identical children element means nothing here can differ.
export const SwipeablePostCard = memo(SwipeablePostCardBase);
