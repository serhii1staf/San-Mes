import React, { useEffect, useRef } from 'react';
import { View, Pressable, Animated, PanResponder, Text as RNText } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { useBrowserStore } from '../../store/browserStore';
import { useSettingsStore } from '../../store/settingsStore';
import { triggerHaptic } from '../../utils/haptics';

// Browser / mini-app "minimised session" pill.
//
// User-selectable position (settings → browser widget):
//   • TOP    — floats just under the status bar (legacy default).
//   • BOTTOM — docks above the floating tab bar; pill is rounder so it
//              visually sits "inside" the bar's space without touching
//              the screen edges.
//
// In both cases a tap reopens the web view and the X dismisses it. The
// gesture-to-dismiss direction tracks the pill's position: swipe UP at the
// top, swipe DOWN at the bottom — feels natural either way.
//
// Visuals: clean BlurView pill, NO accent-coloured border (the previous
// "glow" effect was visually noisy on darker themes — removed by request).

const DISMISS_DISTANCE = 50;
const DISMISS_VELOCITY = 0.4;

// The custom tab bar in app/(tabs)/_layout.tsx floats with marginBottom: 24
// and an inner height of ~60 (8 padding + 44 button + 8 padding). The pill
// sits 8 px above it.
const TAB_BAR_TOTAL_HEIGHT = 24 + 60;
const PILL_BOTTOM_GAP = 8;

export function BrowserMiniBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const minimizedUrl = useBrowserStore((s) => s.minimizedUrl);
  const minimizedDomain = useBrowserStore((s) => s.minimizedDomain);
  const minimizedFavicon = useBrowserStore((s) => s.minimizedFavicon);
  const minimizedEmoji = useBrowserStore((s) => s.minimizedEmoji);
  const isMiniApp = useBrowserStore((s) => s.isMiniApp);
  const clearMinimized = useBrowserStore((s) => s.clearMinimized);
  const position = useSettingsStore((s) => s.browserWidgetPosition);
  const isBottom = position === 'bottom';

  // Slide direction: top → enter from above (negative Y); bottom → enter from
  // below (positive Y). Same magnitude, sign flipped.
  const HIDDEN_OFFSET = isBottom ? 80 : -60;

  const slideAnim = useRef(new Animated.Value(HIDDEN_OFFSET)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const dismissing = useRef(false);

  // Re-snap to hidden when the user toggles position so the pill can't end
  // up animating from the wrong side after a settings change.
  useEffect(() => {
    if (!minimizedUrl) {
      slideAnim.setValue(HIDDEN_OFFSET);
    }
  }, [position]);

  useEffect(() => {
    if (minimizedUrl) {
      dismissing.current = false;
      dragY.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: HIDDEN_OFFSET, duration: 200, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [minimizedUrl, isBottom]);

  // Swipe to dismiss in the direction that feels right for each anchor.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => {
        const goesAway = isBottom ? g.dy > 6 : g.dy < -6;
        return goesAway && Math.abs(g.dy) > Math.abs(g.dx);
      },
      onPanResponderMove: (_, g) => {
        if (dismissing.current) return;
        if (isBottom ? g.dy > 0 : g.dy < 0) dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (dismissing.current) return;
        const flickedAway = isBottom
          ? g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY
          : g.dy < -DISMISS_DISTANCE || g.vy < -DISMISS_VELOCITY;
        if (flickedAway) {
          dismissing.current = true;
          triggerHaptic('light');
          Animated.timing(dragY, {
            toValue: isBottom ? 120 : -120,
            duration: 150,
            useNativeDriver: true,
          }).start(() => {
            clearMinimized();
            dragY.setValue(0);
            dismissing.current = false;
          });
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 120, friction: 10 }).start();
        }
      },
      onPanResponderTerminate: () => {
        if (!dismissing.current) Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 120, friction: 10 }).start();
      },
    }),
  ).current;

  if (!minimizedUrl) return null;

  const handleOpen = () => {
    const state = useBrowserStore.getState();
    if (state.isMiniApp) {
      router.push({ pathname: '/mini-app', params: { url: state.minimizedUrl || '', name: state.minimizedDomain || '', emoji: state.minimizedEmoji || '' } });
    } else {
      router.push({ pathname: '/browser', params: { url: encodeURIComponent(state.minimizedUrl || '') } });
    }
    clearMinimized();
  };

  const handleClose = () => {
    triggerHaptic('light');
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: HIDDEN_OFFSET, duration: 180, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => clearMinimized());
  };

  const containerPosStyle = isBottom
    ? {
        position: 'absolute' as const,
        // Full-width strip docked directly under the floating tab bar.
        // Matches the Telegram-style "minimised session" reminder bar that
        // sits as a separate band, not a floating pill.
        left: 0,
        right: 0,
        bottom: insets.bottom,
        zIndex: 200,
      }
    : {
        position: 'absolute' as const,
        top: insets.top + 6,
        alignSelf: 'center' as const,
        zIndex: 200,
      };

  if (isBottom) {
    // Docked full-width band: rectangle with rounded top corners only, X on
    // the left, title centered. Pure surface (no blur halo) so it reads as
    // an extension of the tab-bar layer rather than a separate pill.
    const bandBg = theme.isDark ? 'rgba(20,20,20,0.95)' : 'rgba(255,255,255,0.95)';
    const titleColor = theme.colors.text.primary;
    const subColor = theme.colors.text.tertiary;
    return (
      <Animated.View
        {...pan.panHandlers}
        style={{
          ...containerPosStyle,
          transform: [{ translateY: Animated.add(slideAnim, dragY) }],
          opacity: opacityAnim,
        }}
      >
        <Pressable onPress={handleOpen} style={{ overflow: 'hidden', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingLeft: 8,
              paddingRight: 16,
              paddingVertical: 14,
              backgroundColor: bandBg,
              borderTopWidth: 0.5,
              borderTopColor: theme.colors.border.light,
            }}
          >
            <Pressable
              onPress={handleClose}
              hitSlop={10}
              style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
            >
              <Feather name="x" size={20} color={titleColor} />
            </Pressable>
            <View style={{ flex: 1, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
              {isMiniApp && minimizedEmoji ? (
                <RNText style={{ fontSize: 14 }} allowFontScaling={false}>{minimizedEmoji}</RNText>
              ) : minimizedFavicon ? (
                <View style={{ width: 16, height: 16, borderRadius: 4, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                  <CachedImage uri={minimizedFavicon} style={{ width: 16, height: 16 }} proxyWidth={48} />
                </View>
              ) : null}
              <Text variant="body" weight="semibold" numberOfLines={1} style={{ color: titleColor }}>
                {minimizedDomain || 'Браузер'}
              </Text>
            </View>
            <View style={{ width: 36 }} />
          </View>
        </Pressable>
      </Animated.View>
    );
  }

  // Top variant — small floating pill (legacy default).
  const PILL_RADIUS = 16;
  const PILL_PAD_H = 12;
  const PILL_PAD_V = 8;

  return (
    <Animated.View
      {...pan.panHandlers}
      style={{
        ...containerPosStyle,
        transform: [{ translateY: Animated.add(slideAnim, dragY) }],
        opacity: opacityAnim,
      }}
    >
      <Pressable onPress={handleOpen} style={{ borderRadius: PILL_RADIUS, overflow: 'hidden' }}>
        <BlurView
          intensity={80}
          tint={theme.isDark ? 'dark' : 'light'}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: PILL_PAD_H,
            paddingVertical: PILL_PAD_V,
            gap: 8,
            // No accent-coloured border — the previous glow was visually noisy.
            borderRadius: PILL_RADIUS,
            backgroundColor: theme.isDark ? 'rgba(20,20,20,0.55)' : 'rgba(255,255,255,0.55)',
          }}
        >
          {isMiniApp && minimizedEmoji ? (
            <RNText style={{ fontSize: 15 }} allowFontScaling={false}>{minimizedEmoji}</RNText>
          ) : minimizedFavicon ? (
            // expo-image with disk+memory cache + proxy fallback → no flicker,
            // instant on subsequent re-opens.
            <View style={{ width: 16, height: 16, borderRadius: 4, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
              <CachedImage uri={minimizedFavicon} style={{ width: 16, height: 16 }} proxyWidth={48} />
            </View>
          ) : (
            <Feather name="globe" size={14} color={theme.colors.text.tertiary} />
          )}
          <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 12, maxWidth: 180 }}>
            {minimizedDomain || 'Браузер'}
          </Text>
          <Pressable onPress={handleClose} hitSlop={8} style={{ padding: 2 }}>
            <Feather name="x" size={14} color={theme.colors.text.tertiary} />
          </Pressable>
        </BlurView>
      </Pressable>
    </Animated.View>
  );
}
