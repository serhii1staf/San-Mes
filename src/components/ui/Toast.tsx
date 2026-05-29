import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { useToastStore } from '../../store/toastStore';

/**
 * Global toast notification — appears at top center, auto-hides after 2s.
 * Like browser mini-bar style but for action confirmations.
 */
export function Toast() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { message, icon, visible, hide } = useToastStore();
  const slideAnim = useRef(new Animated.Value(-60)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();

      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(slideAnim, { toValue: -60, duration: 200, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start(() => hide());
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View style={{
      position: 'absolute',
      top: insets.top + 8,
      alignSelf: 'center',
      zIndex: 9999,
      transform: [{ translateY: slideAnim }],
      opacity: opacityAnim,
    }}>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: theme.isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.97)',
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
        elevation: 6,
        borderWidth: 0.5,
        borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
      }}>
        <Feather name={(icon || 'check') as any} size={14} color={theme.colors.accent.primary} />
        <Text variant="caption" weight="medium" style={{ fontSize: 12 }}>{message}</Text>
      </View>
    </Animated.View>
  );
}
