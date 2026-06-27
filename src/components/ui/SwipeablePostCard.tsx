import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Pressable, Animated } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../../theme';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';
import { useT } from '../../i18n/store';

const BUTTON_WIDTH = 65;

interface SwipeablePostCardProps {
  children: React.ReactNode;
}

export function SwipeablePostCard({ children }: SwipeablePostCardProps) {
  const theme = useTheme();
  const t = useT();
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);
  const timer = useRef<any>(null);
  const cardRef = useRef<View>(null);
  // Set on gesture start when the row was already open: we then just reset and
  // swallow the rest of that gesture (matches the legacy PanResponder, which
  // returned `false` from onMoveShouldSetPanResponder while open).
  const ignoreGesture = useRef(false);

  const resetPosition = useCallback(() => {
    isOpen.current = false;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    Animated.timing(translateX, { toValue: 0, duration: 200, useNativeDriver: true }).start();
  }, []);

  const snapOpen = useCallback(() => {
    isOpen.current = true;
    Animated.spring(translateX, { toValue: -BUTTON_WIDTH, useNativeDriver: true, tension: 150, friction: 15 }).start();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(resetPosition, 3000);
  }, []);

  const handleEnd = useCallback((dx: number) => {
    if (dx < -20) {
      snapOpen();
    } else {
      resetPosition();
    }
  }, []);

  // JS-side gesture handlers. The RNGH Pan worklet marshals to these via
  // runOnJS because they touch the (JS-driven) Animated.Value, the auto-reset
  // timer, and the open/closed ref state.
  const handleGestureStart = useCallback(() => {
    if (isOpen.current) {
      // Swiping/tapping a row that's already open just closes it.
      ignoreGesture.current = true;
      resetPosition();
    } else {
      ignoreGesture.current = false;
    }
  }, [resetPosition]);

  const handleGestureUpdate = useCallback((dx: number) => {
    if (ignoreGesture.current || isOpen.current) return;
    if (dx < 0) {
      translateX.setValue(Math.max(dx, -BUTTON_WIDTH));
    }
  }, [translateX]);

  const handleGestureEnd = useCallback((dx: number) => {
    if (ignoreGesture.current) {
      ignoreGesture.current = false;
      return;
    }
    handleEnd(dx);
  }, [handleEnd]);

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
          runOnJS(handleGestureStart)();
        })
        .onUpdate((e) => {
          'worklet';
          runOnJS(handleGestureUpdate)(e.translationX);
        })
        .onEnd((e) => {
          'worklet';
          runOnJS(handleGestureEnd)(e.translationX);
        }),
    [handleGestureStart, handleGestureUpdate, handleGestureEnd],
  );

  const handleScreenshot = async () => {
    triggerHaptic('medium');

    // First reset position so screenshot shows full card
    isOpen.current = false;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    Animated.timing(translateX, { toValue: 0, duration: 150, useNativeDriver: true }).start();

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
  };

  const buttonOpacity = translateX.interpolate({
    inputRange: [-BUTTON_WIDTH, -BUTTON_WIDTH + 10, 0],
    outputRange: [1, 0, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ position: 'relative' }}>
      <Animated.View style={{ position: 'absolute', right: 0, top: 0, bottom: 12, width: BUTTON_WIDTH, justifyContent: 'center', alignItems: 'center', opacity: buttonOpacity }}>
        <Pressable onPress={handleScreenshot} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="camera" size={17} color="#FFFFFF" />
        </Pressable>
      </Animated.View>

      <GestureDetector gesture={panGesture}>
        <Animated.View style={{ transform: [{ translateX }] }}>
          <View ref={cardRef} collapsable={false}>
            {children}
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
