import React, { useEffect, useRef } from 'react';
import { View, Pressable, Platform, UIManager, LayoutAnimation, Text as RNText, Animated, Easing } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { useBrowserStore } from '../../store/browserStore';
import { useSettingsStore } from '../../store/settingsStore';
import { triggerHaptic } from '../../utils/haptics';

// Bottom-docked browser/mini-app session band.
//
// Rendered INLINE in the root layout (not absolute), so when a session is
// minimised the band occupies real layout height and pushes the entire app
// (including the floating tab bar inside the Stack) upward by exactly that
// amount. When dismissed the band collapses back to zero — the tab bar and
// every screen slide back down. Both transitions ride on LayoutAnimation so
// nothing teleports.
//
// The band itself is animated with Reanimated for the slide-in / slide-out
// of its inner content — translateY from full height (entering from below)
// to zero, fading at the same time. The band's outer height is what
// LayoutAnimation interpolates so the layout column adjusts smoothly.

const BAND_HEIGHT = 64; // outer band height (the "step" the layout grows by)

// Enable LayoutAnimation on Android (it's iOS-only by default).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export function BrowserBottomBand() {
  const theme = useTheme();
  const minimizedUrl = useBrowserStore((s) => s.minimizedUrl);
  const minimizedDomain = useBrowserStore((s) => s.minimizedDomain);
  const minimizedFavicon = useBrowserStore((s) => s.minimizedFavicon);
  const minimizedEmoji = useBrowserStore((s) => s.minimizedEmoji);
  const isMiniApp = useBrowserStore((s) => s.isMiniApp);
  const clearMinimized = useBrowserStore((s) => s.clearMinimized);
  const position = useSettingsStore((s) => s.browserWidgetPosition);

  const visible = !!minimizedUrl && position === 'bottom';

  // Inner slide-in / slide-out for the band's content. translateY goes from
  // BAND_HEIGHT (off-screen below) to 0 (anchored). Native-driver so it's
  // buttery on weak devices.
  const slideY = useRef(new Animated.Value(BAND_HEIGHT)).current;
  const fade = useRef(new Animated.Value(0)).current;

  // Tell the parent column to animate its size change BEFORE the band is
  // actually mounted/unmounted, so the layout slide is in lockstep with the
  // tab bar sliding up/down.
  useEffect(() => {
    LayoutAnimation.configureNext({
      duration: 320,
      create:  { type: 'easeInEaseOut', property: 'opacity' },
      update:  { type: 'easeInEaseOut' },
      delete:  { type: 'easeInEaseOut', property: 'opacity' },
    });
    if (visible) {
      slideY.setValue(BAND_HEIGHT);
      fade.setValue(0);
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fade,   { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  const handleOpen = () => {
    triggerHaptic('light');
    const state = useBrowserStore.getState();
    const open = () => {
      if (state.isMiniApp) {
        router.push({ pathname: '/mini-app', params: { url: state.minimizedUrl || '', name: state.minimizedDomain || '', emoji: state.minimizedEmoji || '' } });
      } else {
        router.push({ pathname: '/browser', params: { url: encodeURIComponent(state.minimizedUrl || '') } });
      }
      clearMinimized();
    };
    open();
  };

  const handleClose = () => {
    triggerHaptic('light');
    // Slide the inner content down + fade out, then schedule the layout
    // animation that collapses the band's height. Result: tab bar and the
    // band move together as one continuous motion downward.
    Animated.parallel([
      Animated.timing(slideY, { toValue: BAND_HEIGHT, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade,   { toValue: 0,           duration: 180, useNativeDriver: true }),
    ]).start(() => {
      LayoutAnimation.configureNext({
        duration: 280,
        create:  { type: 'easeInEaseOut', property: 'opacity' },
        update:  { type: 'easeInEaseOut' },
        delete:  { type: 'easeInEaseOut', property: 'opacity' },
      });
      clearMinimized();
    });
  };

  return (
    <View style={{ height: BAND_HEIGHT, overflow: 'hidden' }} pointerEvents="box-none">
      <Animated.View
        style={{
          flex: 1,
          transform: [{ translateY: slideY }],
          opacity: fade,
        }}
      >
        <Pressable
          onPress={handleOpen}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            // Top corners only — bottom flush with the screen edge.
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingLeft: 18,
            paddingRight: 6,
            backgroundColor: theme.colors.background.primary,
            borderTopWidth: 0.5,
            borderLeftWidth: 0.5,
            borderRightWidth: 0.5,
            borderColor: theme.colors.border.light,
          }}
        >
          {/* Title block on the left — favicon + domain. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }}>
            {isMiniApp && minimizedEmoji ? (
              <RNText style={{ fontSize: 18 }} allowFontScaling={false}>{minimizedEmoji}</RNText>
            ) : minimizedFavicon ? (
              <View style={{ width: 22, height: 22, borderRadius: 5, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                <CachedImage uri={minimizedFavicon} style={{ width: 22, height: 22 }} proxyWidth={64} />
              </View>
            ) : (
              <Feather name="globe" size={18} color={theme.colors.text.tertiary} />
            )}
            <Text variant="body" weight="semibold" numberOfLines={1} style={{ flex: 1, color: theme.colors.text.primary }}>
              {minimizedDomain || 'Браузер'}
            </Text>
          </View>

          {/* Close button on the right (per the screenshot). */}
          <Pressable
            onPress={handleClose}
            hitSlop={10}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Feather name="x" size={22} color={theme.colors.text.primary} />
          </Pressable>
        </Pressable>
      </Animated.View>
    </View>
  );
}
