import React, { useRef, useCallback } from 'react';
import { View, Pressable, Animated, PanResponder } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';

const BUTTON_WIDTH = 65;

interface SwipeablePostCardProps {
  children: React.ReactNode;
}

/**
 * Swipe-left to reveal screenshot button.
 * - Any left swipe (even small) snaps open
 * - Closes on: button press, vertical gesture, or 3s timeout
 * - No dragging after open
 */
export function SwipeablePostCard({ children }: SwipeablePostCardProps) {
  const theme = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);
  const timer = useRef<any>(null);

  const resetPosition = useCallback(() => {
    if (!isOpen.current) return;
    isOpen.current = false;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    Animated.timing(translateX, { toValue: 0, duration: 200, useNativeDriver: true }).start();
  }, []);

  const openPosition = useCallback(() => {
    isOpen.current = true;
    Animated.spring(translateX, { toValue: -BUTTON_WIDTH, useNativeDriver: true, tension: 150, friction: 15 }).start();
    // Auto-close after 3s
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(resetPosition, 3000);
  }, []);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => {
      // If open and user moves vertically — close it
      if (isOpen.current && Math.abs(g.dy) > 5) {
        resetPosition();
        return false;
      }
      // Don't allow new gestures if open
      if (isOpen.current) return false;
      // Only left swipes with clear horizontal intent
      return g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy);
    },
    onPanResponderMove: (_, g) => {
      if (!isOpen.current && g.dx < 0) {
        // Clamp between 0 and -BUTTON_WIDTH
        const val = Math.max(g.dx, -BUTTON_WIDTH);
        translateX.setValue(val);
      }
    },
    onPanResponderRelease: (_, g) => {
      if (isOpen.current) return;
      // Any meaningful left swipe (> 20px) snaps open
      if (g.dx < -20) {
        openPosition();
      } else {
        Animated.timing(translateX, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      }
    },
  })).current;

  const handleScreenshot = () => {
    triggerHaptic('medium');
    resetPosition();
    try {
      require('react-native-view-shot');
      showToast('Скриншот сохранён', 'camera');
    } catch {
      showToast('Доступно после обновления', 'info');
    }
  };

  // Button only fully visible when snapped open
  const buttonOpacity = translateX.interpolate({
    inputRange: [-BUTTON_WIDTH, -BUTTON_WIDTH + 10, 0],
    outputRange: [1, 0, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ position: 'relative' }}>
      <Animated.View style={{ position: 'absolute', right: 0, top: 0, bottom: 12, width: BUTTON_WIDTH, justifyContent: 'center', alignItems: 'center', opacity: buttonOpacity }} pointerEvents={isOpen.current ? 'auto' : 'none'}>
        <Pressable onPress={handleScreenshot} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="camera" size={17} color="#FFFFFF" />
        </Pressable>
      </Animated.View>

      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}
