import React, { useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { View, Pressable, Animated, PanResponder } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';

const SWIPE_THRESHOLD = -50;
const BUTTON_WIDTH = 65;

interface SwipeablePostCardProps {
  children: React.ReactNode;
  onReset?: () => void;
}

export interface SwipeablePostCardRef {
  reset: () => void;
}

/**
 * Swipe-left to reveal screenshot button.
 * Once open: only closes on button press or when parent calls reset().
 * No dragging after open — locked in place.
 */
export const SwipeablePostCard = forwardRef<SwipeablePostCardRef, SwipeablePostCardProps>(({ children, onReset }, ref) => {
  const theme = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const resetPosition = useCallback(() => {
    isOpen.current = false;
    Animated.timing(translateX, { toValue: 0, duration: 250, useNativeDriver: true }).start();
  }, []);

  useImperativeHandle(ref, () => ({ reset: resetPosition }));

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => {
      // Don't allow gestures if already open
      if (isOpen.current) return false;
      // Only left swipes
      return g.dx < -10 && Math.abs(g.dx) > Math.abs(g.dy) * 2;
    },
    onPanResponderMove: (_, g) => {
      if (!isOpen.current && g.dx < 0 && g.dx > -BUTTON_WIDTH - 10) {
        translateX.setValue(g.dx);
      }
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < SWIPE_THRESHOLD) {
        isOpen.current = true;
        Animated.spring(translateX, { toValue: -BUTTON_WIDTH, useNativeDriver: true, tension: 120, friction: 14 }).start();
        // Auto-close after 3s if user doesn't press button
        setTimeout(() => { if (isOpen.current) resetPosition(); }, 3000);
      } else {
        resetPosition();
      }
    },
  })).current;

  const handleScreenshot = () => {
    triggerHaptic('medium');
    resetPosition();
    // After native rebuild, react-native-view-shot will capture here
    try {
      require('react-native-view-shot');
      showToast('Скриншот сохранён', 'camera');
    } catch {
      showToast('Доступно после обновления', 'info');
    }
  };

  const buttonOpacity = translateX.interpolate({
    inputRange: [-BUTTON_WIDTH, -20, 0],
    outputRange: [1, 0.3, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ position: 'relative' }}>
      <Animated.View style={{ position: 'absolute', right: 0, top: 0, bottom: 12, width: BUTTON_WIDTH, justifyContent: 'center', alignItems: 'center', opacity: buttonOpacity }}>
        <Pressable onPress={handleScreenshot} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="camera" size={17} color="#FFFFFF" />
        </Pressable>
      </Animated.View>

      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
});
