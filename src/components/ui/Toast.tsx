import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { useToastStore } from '../../store/toastStore';
import { GlassBg, useLiquidGlassActive } from './LiquidGlass';
import { getTabBarHeight } from '../navigation/CustomTabBar';

// Distance the toast travels while sliding in/out (from below).
const SLIDE_DISTANCE = 60;
// Breathing room between the toast and whatever sits below it (tab bar / safe area).
const GAP = 12;
// Rounded surface radius — also used to clip the glass background layer.
const RADIUS = 14;

/**
 * Global toast notification — floats at bottom center, JUST ABOVE the bottom
 * tab navigation bar, and auto-hides after 2s. Slides + fades up from the
 * bottom. On screens that have no tab bar it sits above the safe-area bottom
 * instead.
 *
 * Surface: when liquid glass is enabled it renders as a shaped, overflow-hidden
 * rounded container with a `GlassBg` BACKGROUND layer and the icon + text as
 * siblings ON TOP (never inside a GlassView — that collapses/warps the glass,
 * see LiquidGlass.tsx). When glass is off it falls back to the solid tinted
 * surface.
 */
export function Toast() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const glassActive = useLiquidGlassActive();
  // The toast is global (mounted at root over every screen), so it must work
  // out for itself whether the current route shows the floating tab bar. The
  // tab group is `(tabs)` — only those routes render <CustomTabBar/>.
  const segments = useSegments();
  const isTabScreen = segments[0] === '(tabs)';

  // Field-by-field selectors — pulling the whole toast store re-rendered
  // this top-level component on every unrelated state change.
  const message = useToastStore((s) => s.message);
  const icon = useToastStore((s) => s.icon);
  const visible = useToastStore((s) => s.visible);
  const hide = useToastStore((s) => s.hide);
  // Start BELOW the resting position so the toast slides up into view.
  const slideAnim = useRef(new Animated.Value(SLIDE_DISTANCE)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();

      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(slideAnim, { toValue: SLIDE_DISTANCE, duration: 200, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start(() => hide());
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!visible) return null;

  // Position the toast just above the tab bar on tab screens; otherwise just
  // above the safe-area bottom. Offset = reserved-space + gap.
  const bottomOffset = isTabScreen
    ? getTabBarHeight(insets.bottom) + GAP
    : Math.max(insets.bottom, 8) + 16;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: bottomOffset,
        alignItems: 'center',
        zIndex: 9999,
        transform: [{ translateY: slideAnim }],
        opacity: opacityAnim,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderRadius: RADIUS,
          paddingHorizontal: 14,
          paddingVertical: 8,
          // Clip the glass background layer to the rounded corners. Always on
          // so the corners stay crisp in both glass and solid modes.
          overflow: 'hidden',
          // Glass mode: transparent base — the GlassBg sibling below supplies
          // the surface. Solid mode: the established dark/light fill.
          backgroundColor: glassActive
            ? 'transparent'
            : theme.isDark
              ? 'rgba(30,30,30,0.95)'
              : 'rgba(255,255,255,0.97)',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: glassActive ? 0.18 : 0.12,
          shadowRadius: 8,
          elevation: 6,
          borderWidth: 0.5,
          borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
        }}
      >
        {/* Liquid-glass BACKGROUND layer — first child, absolute-fill, with the
            icon + text rendered as SIBLINGS on top. A subtle tint keeps it
            readable in dark mode. Renders nothing when glass is off. */}
        {glassActive && (
          <GlassBg
            borderRadius={RADIUS}
            glassStyle="regular"
            colorScheme={theme.isDark ? 'dark' : 'light'}
            // Static surface — a transient toast shouldn't morph on touch
            // (it's also non-interactive via pointerEvents on the wrapper).
            interactive={false}
            tintColor={
              theme.isDark ? 'rgba(28,28,30,0.55)' : 'rgba(255,255,255,0.5)'
            }
          />
        )}
        <Feather name={(icon || 'check') as any} size={14} color={theme.colors.accent.primary} />
        <Text variant="caption" weight="medium" style={{ fontSize: 12 }}>{message}</Text>
      </View>
    </Animated.View>
  );
}
