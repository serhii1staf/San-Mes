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
// SINGLE animation only — LayoutAnimation interpolates the band's height
// between 0 and BAND_HEIGHT. The tab bar (which floats inside the Stack
// above us in a flex column) slides up/down in lockstep because the column
// reflows to the new height. There is no separate slide-of-content because
// running two animations in series produced a visible "ghost" frame at
// dismiss time — the layout shrunk AFTER the content faded, so a black
// rectangle was briefly left over. With a single height animation the
// content disappears together with the height and everything moves as
// one piece.
//
// The container has its top corners rounded AND a solid background so the
// rounded corners blend with the app background instead of letting the
// underlying screen show through (which the user saw as "black squares
// in the corners").

const BAND_HEIGHT = 56; // outer band height — drives the layout shift

// Enable LayoutAnimation on Android (it's iOS-only by default).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ENTER_CONFIG: LayoutAnimationConfig = {
  duration: 360,
  create:  { type: 'easeInEaseOut', property: 'opacity' },
  update:  { type: 'easeInEaseOut' },
  delete:  { type: 'easeInEaseOut', property: 'opacity' },
};
type LayoutAnimationConfig = Parameters<typeof LayoutAnimation.configureNext>[0];

const EXIT_CONFIG: LayoutAnimationConfig = {
  duration: 320,
  create:  { type: 'easeInEaseOut', property: 'opacity' },
  update:  { type: 'easeInEaseOut' },
  delete:  { type: 'easeInEaseOut', property: 'opacity' },
};

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

  // Schedule a layout animation BEFORE the next render that mounts/unmounts
  // the band. This makes the height change interpolate smoothly and the
  // tab bar above us slide along with it, in a single continuous motion.
  useEffect(() => {
    LayoutAnimation.configureNext(visible ? ENTER_CONFIG : EXIT_CONFIG);
  }, [visible]);

  if (!visible) return null;

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
    // Pre-arm the exit animation so the immediately-following unmount
    // (caused by clearMinimized → visible flips to false) animates on the
    // same frame instead of snapping.
    LayoutAnimation.configureNext(EXIT_CONFIG);
    clearMinimized();
  };

  // Negative top margin pulls the band a few pixels closer to the tab bar
  // so the gap between them feels like a small breath rather than a wide
  // empty strip. The tab bar's own marginBottom (24) still gives a clean
  // separation; we just trim it visually.
  return (
    <View
      style={{
        height: BAND_HEIGHT,
        marginTop: -10,
        backgroundColor: theme.colors.background.primary,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        borderTopWidth: 0.5,
        borderLeftWidth: 0.5,
        borderRightWidth: 0.5,
        borderColor: theme.colors.border.light,
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={handleOpen}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 18,
          paddingRight: 6,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }}>
          {isMiniApp && minimizedEmoji ? (
            <RNText style={{ fontSize: 18 }} allowFontScaling={false}>{minimizedEmoji}</RNText>
          ) : minimizedFavicon ? (
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                overflow: 'hidden',
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
              }}
            >
              <CachedImage uri={minimizedFavicon} style={{ width: 22, height: 22 }} proxyWidth={64} />
            </View>
          ) : (
            <Feather name="globe" size={18} color={theme.colors.text.tertiary} />
          )}
          <Text variant="body" weight="semibold" numberOfLines={1} style={{ flex: 1, color: theme.colors.text.primary }}>
            {minimizedDomain || 'Браузер'}
          </Text>
        </View>

        {/* Close — pulled in from the right edge so it isn't glued to the
            screen border. */}
        <Pressable
          onPress={handleClose}
          hitSlop={10}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: 6 }}
        >
          <Feather name="x" size={22} color={theme.colors.text.primary} />
        </Pressable>
      </Pressable>
    </View>
  );
}
