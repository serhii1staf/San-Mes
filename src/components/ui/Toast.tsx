import React, { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { useToastStore } from '../../store/toastStore';
import { GlassBg, useLiquidGlassActive } from './LiquidGlass';
import { getTabBarHeight } from '../navigation/CustomTabBar';

// Breathing room between the toast and whatever sits below/above it.
const GAP = 12;
// Rounded surface radius — also used to clip the glass background layer.
const RADIUS = 14;
// Fallback height used before the toast has measured itself (so the very first
// frame is still parked fully off-screen).
const DEFAULT_H = 56;

/**
 * Global toast notification.
 *
 * Position: on tab screens it floats at bottom center JUST ABOVE the bottom
 * tab navigation bar; on every other screen (chat, comments, profile, …) it
 * drops down from the TOP under the status bar — that's where copy / link /
 * status confirmations read best while you're inside a conversation.
 *
 * Surface: when liquid glass is enabled it renders as a shaped, overflow-hidden
 * rounded container with a `GlassBg` BACKGROUND layer and the icon + text as
 * siblings ON TOP (never inside a GlassView — that collapses the glass).
 *
 * GLASS-SAFE ANIMATION: the reveal is a pure `translateY` SLIDE — we do NOT
 * animate `opacity` on any ancestor of the glass layer, because an animated /
 * non-1 opacity on a parent stops the native UIVisualEffectView from drawing
 * (that bug is exactly why toasts showed no glass before). The toast slides a
 * full clearing distance so it is completely off-screen when hidden, then
 * unmounts — no opacity fade required.
 */
export function Toast() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const glassActive = useLiquidGlassActive();
  // The toast is global (mounted at root over every screen), so it must work
  // out for itself whether the current route shows the floating tab bar. The
  // tab group is `(tabs)` — only those routes render <CustomTabBar/> and want
  // the toast docked at the bottom; everything else gets it at the top.
  const segments = useSegments();
  const isTabScreen = segments[0] === '(tabs)';
  const topMode = !isTabScreen;

  // Field-by-field selectors — pulling the whole toast store re-rendered
  // this top-level component on every unrelated state change.
  const message = useToastStore((s) => s.message);
  const icon = useToastStore((s) => s.icon);
  const visible = useToastStore((s) => s.visible);
  const hide = useToastStore((s) => s.hide);

  // Measured surface height → lets us compute a slide distance that parks the
  // toast fully off-screen regardless of font scaling / message length.
  const [measuredH, setMeasuredH] = useState(DEFAULT_H);

  // Resting bottom/top offset for the surface.
  const bottomOffset = isTabScreen ? getTabBarHeight(insets.bottom) + GAP : 0;
  const topOffset = Math.max(insets.top, 8) + GAP;

  // Distance needed to push the toast completely past the nearest screen edge.
  // Held in a ref so a late height measurement updates the OUT distance without
  // re-triggering the entrance animation (which would cause a visible re-slide).
  const hiddenTranslate = topMode
    ? -(measuredH + topOffset + 8)
    : measuredH + bottomOffset + 8;
  const hiddenRef = useRef(hiddenTranslate);
  hiddenRef.current = hiddenTranslate;

  // Start parked off-screen so it slides into view.
  const slideAnim = useRef(new Animated.Value(hiddenTranslate)).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(hiddenRef.current);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();

      const timer = setTimeout(() => {
        Animated.timing(slideAnim, {
          toValue: hiddenRef.current,
          duration: 220,
          useNativeDriver: true,
        }).start(() => hide());
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        ...(topMode ? { top: topOffset } : { bottom: bottomOffset }),
        alignItems: 'center',
        zIndex: 9999,
        transform: [{ translateY: slideAnim }],
      }}
    >
      <View
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (h > 0 && h !== measuredH) setMeasuredH(h);
        }}
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
