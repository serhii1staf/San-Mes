import React, { useEffect, useRef } from 'react';
import { View, Pressable, Image, Animated, PanResponder, Text as RNText, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { useBrowserStore } from '../../store/browserStore';
import { triggerHaptic } from '../../utils/haptics';

const DISMISS_DY = -50; // upward distance that commits a swipe-to-hide
const DISMISS_VY = -0.4; // fling velocity that counts as dismiss

// Browser / mini-app "minimised session" widget — floats at the top of the
// screen when the user collapses a web view. Visual treatment now uses a
// frosted BlurView pill (matching the profile screen's QR/edit buttons) so
// it reads on any page colour without competing with the page content.
//
// Interactions:
//   Tap  → reopens the web view from where it was left off.
//   ✕    → closes and forgets the session.
//   Swipe-UP → same as ✕ but gesture-driven (user requested this specifically).
//
// Performance:
//   - Native-driver spring for enter/exit.
//   - Favicon Image has a static default source to avoid placeholder flash.
//   - PanResponder only claims vertical-UP movement so horizontal gestures
//     (e.g. swiping between tabs) fall through.

export function BrowserMiniBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { minimizedUrl, minimizedDomain, minimizedFavicon, minimizedEmoji, isMiniApp, clearMinimized } = useBrowserStore();
  const slideAnim = useRef(new Animated.Value(-60)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const dismissing = useRef(false);

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
        Animated.timing(slideAnim, { toValue: -60, duration: 200, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [minimizedUrl]);

  // Swipe-UP pan responder — only claims upward vertical movement so taps
  // and horizontal swipes fall through cleanly.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy < -6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (dismissing.current) return;
        if (g.dy < 0) dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (dismissing.current) return;
        if (g.dy < DISMISS_DY || g.vy < DISMISS_VY) {
          dismissing.current = true;
          triggerHaptic('light');
          Animated.timing(dragY, { toValue: -100, duration: 150, useNativeDriver: true }).start(() => {
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
      Animated.timing(slideAnim, { toValue: -60, duration: 180, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => clearMinimized());
  };

  return (
    <Animated.View
      {...pan.panHandlers}
      style={{
        position: 'absolute',
        top: insets.top + 6,
        alignSelf: 'center',
        zIndex: 200,
        transform: [{ translateY: Animated.add(slideAnim, dragY) }],
        opacity: opacityAnim,
      }}
    >
      <Pressable onPress={handleOpen} style={{ borderRadius: 16, overflow: 'hidden' }}>
        <BlurView
          intensity={80}
          tint={theme.isDark ? 'dark' : 'light'}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            paddingVertical: 8,
            gap: 8,
            // Subtle accent border so the pill reads even on very dark pages.
            borderWidth: 1,
            borderColor: theme.colors.accent.primary + '30',
            borderRadius: 16,
            backgroundColor: theme.isDark ? 'rgba(20,20,20,0.55)' : 'rgba(255,255,255,0.55)',
          }}
        >
          {/* Emoji for mini-apps, Favicon for browser */}
          {isMiniApp && minimizedEmoji ? (
            <RNText style={{ fontSize: 15 }} allowFontScaling={false}>{minimizedEmoji}</RNText>
          ) : (
            <Image
              source={{ uri: minimizedFavicon || undefined }}
              style={{ width: 16, height: 16, borderRadius: 4 }}
              defaultSource={require('../../../assets/icon.png')}
            />
          )}
          {/* Name */}
          <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 12, maxWidth: 160 }}>
            {minimizedDomain || 'Браузер'}
          </Text>
          {/* Close */}
          <Pressable onPress={handleClose} hitSlop={8} style={{ padding: 2 }}>
            <Feather name="x" size={14} color={theme.colors.text.tertiary} />
          </Pressable>
        </BlurView>
      </Pressable>
    </Animated.View>
  );
}
