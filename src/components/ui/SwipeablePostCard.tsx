import React, { useRef, useCallback } from 'react';
import { View, Pressable, Animated, PanResponder, Share } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';

const SWIPE_THRESHOLD = -50;
const BUTTON_WIDTH = 65;

interface SwipeablePostCardProps {
  children: React.ReactNode;
  shareText?: string;
}

/**
 * Wraps a post card with swipe-left-to-share.
 * Button hidden by default, appears on swipe.
 * Auto-resets after action or 3 seconds.
 */
export function SwipeablePostCard({ children, shareText }: SwipeablePostCardProps) {
  const theme = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);
  const autoCloseTimer = useRef<any>(null);

  const resetPosition = useCallback(() => {
    isOpen.current = false;
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 120, friction: 14 }).start();
    if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
  }, []);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => {
      // Only left swipes, ignore vertical
      return g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy) * 2;
    },
    onPanResponderGrant: () => {
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
    },
    onPanResponderMove: (_, g) => {
      if (g.dx < 0 && g.dx > -BUTTON_WIDTH - 10) {
        translateX.setValue(g.dx);
      }
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < SWIPE_THRESHOLD) {
        // Open
        isOpen.current = true;
        Animated.spring(translateX, { toValue: -BUTTON_WIDTH, useNativeDriver: true, tension: 120, friction: 14 }).start();
        // Auto-close after 3 seconds
        autoCloseTimer.current = setTimeout(resetPosition, 3000);
      } else {
        // Close
        resetPosition();
      }
    },
  })).current;

  const handleShare = async () => {
    triggerHaptic('light');
    resetPosition();
    try {
      await Share.share({ message: shareText || '' });
    } catch {}
  };

  // Button opacity based on translateX
  const buttonOpacity = translateX.interpolate({
    inputRange: [-BUTTON_WIDTH, -20, 0],
    outputRange: [1, 0.5, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ position: 'relative' }}>
      {/* Share button — hidden until swiped */}
      <Animated.View style={{ position: 'absolute', right: 0, top: 0, bottom: 12, width: BUTTON_WIDTH, justifyContent: 'center', alignItems: 'center', opacity: buttonOpacity }}>
        <Pressable onPress={handleShare} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="share" size={17} color="#FFFFFF" />
        </Pressable>
      </Animated.View>

      {/* Card content */}
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}
