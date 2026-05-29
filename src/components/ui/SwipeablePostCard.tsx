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

export function SwipeablePostCard({ children }: SwipeablePostCardProps) {
  const theme = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);
  const timer = useRef<any>(null);

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

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => {
      if (isOpen.current) {
        // Any movement when open → close
        resetPosition();
        return false;
      }
      return g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy);
    },
    onPanResponderMove: (_, g) => {
      if (!isOpen.current && g.dx < 0) {
        translateX.setValue(Math.max(g.dx, -BUTTON_WIDTH));
      }
    },
    onPanResponderRelease: (_, g) => {
      if (!isOpen.current) handleEnd(g.dx);
    },
    // CRITICAL: when system steals gesture (scroll takes over), reset position
    onPanResponderTerminate: () => {
      if (!isOpen.current) {
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

      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}
