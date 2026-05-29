import React, { useRef } from 'react';
import { View, Pressable, Animated, PanResponder, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ViewShot from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../../theme';
import { showToast } from '../../store/toastStore';
import { triggerHaptic } from '../../utils/haptics';

const SWIPE_THRESHOLD = -60;
const SCREEN_WIDTH = Dimensions.get('window').width;

interface SwipeablePostCardProps {
  children: React.ReactNode;
}

export function SwipeablePostCard({ children }: SwipeablePostCardProps) {
  const theme = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const viewShotRef = useRef<ViewShot>(null);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) && g.dx < 0,
    onPanResponderMove: (_, g) => {
      if (g.dx < 0 && g.dx > -100) {
        translateX.setValue(g.dx);
      }
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < SWIPE_THRESHOLD) {
        // Snap to show button
        Animated.spring(translateX, { toValue: -70, useNativeDriver: true, tension: 100, friction: 12 }).start();
      } else {
        // Snap back
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 100, friction: 12 }).start();
      }
    },
  })).current;

  const handleScreenshot = async () => {
    try {
      triggerHaptic('medium');
      // Snap card back first
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 100, friction: 12 }).start();

      // Capture the view
      if (viewShotRef.current) {
        const uri = await (viewShotRef.current as any).capture();
        if (uri) {
          // Save to gallery
          const { status } = await MediaLibrary.requestPermissionsAsync();
          if (status === 'granted') {
            await MediaLibrary.saveToLibraryAsync(uri);
            showToast('Сохранено в галерею', 'camera');
          } else {
            // Fallback: share
            await Sharing.shareAsync(uri);
          }
        }
      }
    } catch {
      showToast('Не удалось сохранить', 'x');
    }
  };

  return (
    <View style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Screenshot button behind */}
      <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 70, justifyContent: 'center', alignItems: 'center' }}>
        <Pressable onPress={handleScreenshot} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="camera" size={20} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Swipeable card */}
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <ViewShot ref={viewShotRef} options={{ format: 'png', quality: 1 }}>
          {children}
        </ViewShot>
      </Animated.View>
    </View>
  );
}
