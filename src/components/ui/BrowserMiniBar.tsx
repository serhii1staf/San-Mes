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
import { useT } from '../../i18n/store';
import { triggerHaptic } from '../../utils/haptics';

// Browser / mini-app "minimised session" pill.
//
// This component renders the TOP-position floating glass pill that overlays
// the rest of the UI just under the status bar. It is rendered as an absolute
// overlay so it never affects the layout of any screen below.
//
// The BOTTOM-position variant lives in a separate component
// (BrowserBottomBand) because that variant must occupy real layout space and
// push the rest of the app upward, not float on top of it. The settings
// toggle in app/settings/appearance.tsx selects which one is rendered.

const DISMISS_DY = -50;
const DISMISS_VY = -0.4;

export function BrowserMiniBar() {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const minimizedUrl = useBrowserStore((s) => s.minimizedUrl);
  const minimizedDomain = useBrowserStore((s) => s.minimizedDomain);
  const minimizedFavicon = useBrowserStore((s) => s.minimizedFavicon);
  const minimizedEmoji = useBrowserStore((s) => s.minimizedEmoji);
  const isMiniApp = useBrowserStore((s) => s.isMiniApp);
  const clearMinimized = useBrowserStore((s) => s.clearMinimized);
  // The bottom variant has its own component — bail out here so the absolute
  // overlay doesn't double up while the bottom band is also showing.
  const position = useSettingsStore((s) => s.browserWidgetPosition);

  const slideAnim = useRef(new Animated.Value(-60)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const dismissing = useRef(false);

  useEffect(() => {
    if (minimizedUrl && position === 'top') {
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
  }, [minimizedUrl, position]);

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

  if (!minimizedUrl || position !== 'top') return null;

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
            borderRadius: 16,
            backgroundColor: theme.isDark ? 'rgba(20,20,20,0.55)' : 'rgba(255,255,255,0.55)',
          }}
        >
          {isMiniApp && minimizedEmoji ? (
            <RNText style={{ fontSize: 15 }} allowFontScaling={false}>{minimizedEmoji}</RNText>
          ) : minimizedFavicon ? (
            <View style={{ width: 16, height: 16, borderRadius: 4, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
              <CachedImage uri={minimizedFavicon} style={{ width: 16, height: 16 }} proxyWidth={48} />
            </View>
          ) : (
            <Feather name="globe" size={14} color={theme.colors.text.tertiary} />
          )}
          <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 12, maxWidth: 180 }}>
            {minimizedDomain || t('browser.pill_default')}
          </Text>
          <Pressable onPress={handleClose} hitSlop={8} style={{ padding: 2 }}>
            <Feather name="x" size={14} color={theme.colors.text.tertiary} />
          </Pressable>
        </BlurView>
      </Pressable>
    </Animated.View>
  );
}
