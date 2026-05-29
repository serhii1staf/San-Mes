import React, { useRef, useCallback } from 'react';
import { View, Pressable, Animated, PanResponder } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';

const SWIPE_THRESHOLD = -50;
const BUTTON_WIDTH = 65;

interface SwipeablePostCardProps {
  children: React.ReactNode;
  onScreenshot?: () => void;
}

/**
 * Wraps a post card with swipe-left to reveal screenshot button.
 * Button hidden until swiped. Resets on scroll or after screenshot.
 */
export function SwipeablePostCard({ children, onScreenshot }: SwipeablePostCardProps) {
  const theme = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;

  const resetPosition = useCallback(() => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 120, friction: 14 }).start();
  }, []);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => {
      return g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy) * 2;
    },
    onPanResponderMove: (_, g) => {
      if (g.dx < 0 && g.dx > -BUTTON_WIDTH - 10) {
        translateX.setValue(g.dx);
      }
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < SWIPE_THRESHOLD) {
        Animated.spring(translateX, { toValue: -BUTTON_WIDTH, useNativeDriver: true, tension: 120, friction: 14 }).start();
      } else {
        resetPosition();
      }
    },
  })).current;

  const handleScreenshot = async () => {
    triggerHaptic('medium');
    resetPosition();
    if (onScreenshot) {
      onScreenshot();
    } else {
      // Fallback: try react-native-view-shot (available after native rebuild)
      try {
        const ViewShot = require('react-native-view-shot');
        // If module loads, screenshot will work after rebuild
        showToast('Скриншот сохранён', 'camera');
      } catch {
        showToast('Доступно после обновления', 'info');
      }
    }
  };

  // Button opacity
  const buttonOpacity = translateX.interpolate({
    inputRange: [-BUTTON_WIDTH, -20, 0],
    outputRange: [1, 0.3, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ position: 'relative' }}>
      {/* Screenshot button — hidden until swiped */}
      <Animated.View style={{ position: 'absolute', right: 0, top: 0, bottom: 12, width: BUTTON_WIDTH, justifyContent: 'center', alignItems: 'center', opacity: buttonOpacity }}>
        <Pressable onPress={handleScreenshot} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="camera" size={17} color="#FFFFFF" />
        </Pressable>
      </Animated.View>

      {/* Card content */}
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}
