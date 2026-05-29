import React, { useRef } from 'react';
import { View, Pressable, Animated, PanResponder, Share } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';

const SWIPE_THRESHOLD = -60;

interface SwipeablePostCardProps {
  children: React.ReactNode;
  shareText?: string;
}

/**
 * Wraps a post card with swipe-left-to-share functionality.
 * No native modules — uses only Animated + PanResponder + Share API.
 */
export function SwipeablePostCard({ children, shareText }: SwipeablePostCardProps) {
  const theme = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => {
      // Only activate for horizontal left swipes
      return g.dx < -10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
    },
    onPanResponderMove: (_, g) => {
      if (g.dx < 0 && g.dx > -100) {
        translateX.setValue(g.dx);
      }
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < SWIPE_THRESHOLD) {
        Animated.spring(translateX, { toValue: -70, useNativeDriver: true, tension: 100, friction: 12 }).start();
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 100, friction: 12 }).start();
      }
    },
  })).current;

  const handleShare = async () => {
    triggerHaptic('light');
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 100, friction: 12 }).start();
    try {
      await Share.share({ message: shareText || 'Пост из San' });
      showToast('Поделились', 'share');
    } catch {}
  };

  return (
    <View style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Share button behind the card */}
      <View style={{ position: 'absolute', right: 0, top: 0, bottom: 12, width: 70, justifyContent: 'center', alignItems: 'center' }}>
        <Pressable onPress={handleShare} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="share" size={18} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Swipeable content */}
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}
