import React, { useEffect, useRef } from 'react';
import { View, Pressable, Image, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { useBrowserStore } from '../../store/browserStore';

export function BrowserMiniBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { minimizedUrl, minimizedDomain, minimizedFavicon, clearMinimized } = useBrowserStore();
  const slideAnim = useRef(new Animated.Value(-50)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (minimizedUrl) {
      // Animate in
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    } else {
      // Animate out
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: -50, duration: 200, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [minimizedUrl]);

  if (!minimizedUrl) return null;

  const handleOpen = () => {
    // If minimized domain contains emoji (mini-app), open as mini-app
    if (minimizedDomain && /[\u{1F000}-\u{1FFFF}]/u.test(minimizedDomain)) {
      router.push({ pathname: '/mini-app', params: { url: encodeURIComponent(minimizedUrl), name: minimizedDomain, emoji: '' } });
    } else {
      router.push({ pathname: '/browser', params: { url: encodeURIComponent(minimizedUrl) } });
    }
  };

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: -50, duration: 180, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => clearMinimized());
  };

  const glowColor = theme.colors.accent.primary + '30';

  return (
    <Animated.View style={{
      position: 'absolute',
      top: insets.top + 6,
      alignSelf: 'center',
      zIndex: 200,
      transform: [{ translateY: slideAnim }],
      opacity: opacityAnim,
    }}>
      <Pressable
        onPress={handleOpen}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: theme.isDark ? 'rgba(25,25,25,0.95)' : 'rgba(255,255,255,0.97)',
          borderRadius: 14,
          paddingHorizontal: 10,
          paddingVertical: 6,
          gap: 8,
          shadowColor: theme.colors.accent.primary,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 6,
          borderWidth: 1,
          borderColor: glowColor,
        }}
      >
        {/* Favicon */}
        <Image
          source={{ uri: minimizedFavicon || undefined }}
          style={{ width: 16, height: 16, borderRadius: 4 }}
          defaultSource={require('../../../assets/icon.png')}
        />
        {/* Domain */}
        <Text variant="caption" weight="medium" numberOfLines={1} style={{ fontSize: 11, maxWidth: 140 }}>
          {minimizedDomain || 'Браузер'}
        </Text>
        {/* Close */}
        <Pressable onPress={handleClose} hitSlop={8} style={{ padding: 2 }}>
          <Feather name="x" size={14} color={theme.colors.text.tertiary} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}
