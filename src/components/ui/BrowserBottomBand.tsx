import React, { useEffect } from 'react';
import { View, Pressable, Platform, UIManager, LayoutAnimation, Text as RNText } from 'react-native';
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
// CRITICAL: this component is rendered INLINE in the root layout (not as an
// absolute overlay). When a session is minimised it occupies real layout
// height — that height is added to the bottom of the layout column so the
// rest of the app (Stack + the floating tab bar inside it) is naturally
// pushed upward. Tapping reopens the session, the X dismisses it. When
// dismissed the band collapses back to zero height and the app slides
// back down — all coordinated through LayoutAnimation so nothing teleports.
//
// The band visually blends with the app background (theme.background.primary)
// and sits flush with the bottom of the safe area, just like the screenshot
// the user provided.

const BAND_HEIGHT = 56;

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

  // Animate height changes so the rest of the layout slides smoothly when
  // the band appears or collapses, instead of snapping by 56px.
  useEffect(() => {
    LayoutAnimation.configureNext({
      duration: 240,
      create: { type: 'easeOut', property: 'opacity' },
      update: { type: 'easeInEaseOut' },
      delete: { type: 'easeIn', property: 'opacity' },
    });
  }, [visible]);

  if (!visible) {
    // Render nothing — the absence of this view means zero layout height,
    // so the parent column collapses back to its full screen height.
    return null;
  }

  const handleOpen = () => {
    triggerHaptic('light');
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
    clearMinimized();
  };

  return (
    <Pressable
      onPress={handleOpen}
      style={{
        height: BAND_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 4,
        paddingRight: 16,
        backgroundColor: theme.colors.background.primary,
        borderTopWidth: 0.5,
        borderTopColor: theme.colors.border.light,
      }}
    >
      <Pressable
        onPress={handleClose}
        hitSlop={10}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Feather name="x" size={22} color={theme.colors.text.primary} />
      </Pressable>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {isMiniApp && minimizedEmoji ? (
          <RNText style={{ fontSize: 15 }} allowFontScaling={false}>{minimizedEmoji}</RNText>
        ) : minimizedFavicon ? (
          <View style={{ width: 18, height: 18, borderRadius: 4, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
            <CachedImage uri={minimizedFavicon} style={{ width: 18, height: 18 }} proxyWidth={48} />
          </View>
        ) : null}
        <Text variant="body" weight="semibold" numberOfLines={1} style={{ color: theme.colors.text.primary }}>
          {minimizedDomain || 'Браузер'}
        </Text>
      </View>
      <View style={{ width: 44 }} />
    </Pressable>
  );
}
