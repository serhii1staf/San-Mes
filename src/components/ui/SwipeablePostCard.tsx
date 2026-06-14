import React, { useRef, useCallback, useState, useEffect } from 'react';
import { View, Pressable, Animated, PanResponder, InteractionManager } from 'react-native';
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

  // Lazy-init the PanResponder past the navigation/scroll interaction.
  //
  // Why: every visible card was previously calling `PanResponder.create({ ... })`
  // synchronously on mount, allocating 5 closures plus the responder object.
  // For a fast scroll through 60 cards this added ~300 ms of cumulative
  // closure-allocation work to the JS thread — the dominant cost behind the
  // scroll-stutters users were reporting on (tabs)/profile. Wiring the
  // handlers in only after `runAfterInteractions` means the swipe gesture
  // becomes available a frame or two after the user lifts their finger, but
  // mounting (which runs DURING scroll) costs almost nothing. The screenshot
  // CTA still works because the user can only swipe once they've stopped
  // scrolling anyway.
  const [panHandlers, setPanHandlers] = useState<any>(null);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      const pr = PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) => {
          if (isOpen.current) {
            resetPosition();
            return false;
          }
          return g.dx < -20 && Math.abs(g.dx) > Math.abs(g.dy) * 4;
        },
        onPanResponderMove: (_, g) => {
          if (!isOpen.current && g.dx < 0) {
            translateX.setValue(Math.max(g.dx, -BUTTON_WIDTH));
          }
        },
        onPanResponderRelease: (_, g) => {
          if (!isOpen.current) handleEnd(g.dx);
        },
        onPanResponderTerminate: () => {
          if (!isOpen.current) {
            Animated.timing(translateX, { toValue: 0, duration: 150, useNativeDriver: true }).start();
          }
        },
      });
      setPanHandlers(pr.panHandlers);
    });
    return () => handle.cancel();
  }, [handleEnd, resetPosition, translateX]);

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

      <Animated.View style={{ transform: [{ translateX }] }} {...(panHandlers || {})}>
        <View ref={cardRef} collapsable={false}>
          {children}
        </View>
      </Animated.View>
    </View>
  );
}
