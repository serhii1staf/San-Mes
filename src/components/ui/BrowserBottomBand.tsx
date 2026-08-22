import React, { useEffect, useState } from 'react';
import { View, Pressable, Text as RNText } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { useBrowserStore } from '../../store/browserStore';
import { useMiniAppStore } from '../../store/miniAppStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useT } from '../../i18n/store';
import { triggerHaptic } from '../../utils/haptics';

// Floating browser / mini-app session card, docked near the bottom.
//
// ── WHY IT FLOATS INSTEAD OF DOCKING ────────────────────────────────────────
//
// It used to be a sibling of the whole navigator inside the root flex column, and
// it RESERVED its height there. Two consequences, both reported:
//
//   1. The app content was pushed up whenever a session was minimized. Requested
//      behaviour is the opposite — the card should sit OVER the content, like a
//      floating pill, and nothing below it should move.
//   2. Reserving and releasing that height re-laid out the root column twice per
//      session, and each of those passes re-laid out the Stack, the active screen
//      and everything in it. In a chat that tree holds a FlashList of live message
//      cells, glass surfaces, gradients and the Reanimated input bar, so those two
//      commits were expensive — visible as a hitch exactly when the card appeared
//      or left.
//
// Now it is absolutely positioned and reserves nothing. Layout cost per session is
// ZERO: showing and hiding is a compositor-only `translateY` + `opacity`, and no
// other view's frame ever changes. That is strictly cheaper than the previous
// "reserve once, release once" design, which was already an improvement on the
// per-frame height animation before it.
//
// Corners are rounded on ALL FOUR sides because it is a floating card now, not a
// band attached to the screen edge — a shape with two square bottom corners only
// reads as correct when it is flush with the bottom of the display.
//
// The component is ALWAYS mounted (no `return null`), so nothing unmounts
// mid-animation.

/** Card height. Slightly taller than the old 56 pt band, as requested. */
const BAND_HEIGHT = 64;
/** Gap between the card and the floating tab bar / screen bottom. */
const BOTTOM_INSET = 12;
/** Horizontal inset so the card reads as floating rather than full-bleed. */
const SIDE_INSET = 10;
/** Travel distance for the enter/exit slide. Card height plus its bottom gap. */
const SLIDE_DISTANCE = BAND_HEIGHT + BOTTOM_INSET;
const ENTER_DURATION = 380;
const EXIT_DURATION = 300;
const FADE_IN_DURATION = 240;
const FADE_OUT_DURATION = 180;
/**
 * Room left for the floating tab bar so the card sits above it rather than on it.
 *
 * The tab bar is itself absolutely positioned inside the Stack, so its height is not
 * observable from here; this is a deliberate constant matching its visual height.
 */
const TAB_BAR_CLEARANCE = 64;

export function BrowserBottomBand() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const minimizedUrl = useBrowserStore((s) => s.minimizedUrl);
  const minimizedDomain = useBrowserStore((s) => s.minimizedDomain);
  const minimizedFavicon = useBrowserStore((s) => s.minimizedFavicon);
  const minimizedEmoji = useBrowserStore((s) => s.minimizedEmoji);
  const isMiniApp = useBrowserStore((s) => s.isMiniApp);
  const clearMinimized = useBrowserStore((s) => s.clearMinimized);
  const position = useSettingsStore((s) => s.browserWidgetPosition);

  const visible = !!minimizedUrl && position === 'bottom';

  // Kept mounted but non-interactive while hidden, so nothing unmounts mid-slide.
  // There is no layout state any more — the card reserves no space at all.
  const [interactive, setInteractive] = useState(visible);

  // Slide offset in points: 0 = docked, SLIDE_DISTANCE = fully off the bottom.
  const slideSV = useSharedValue(visible ? 0 : SLIDE_DISTANCE);
  const opacitySV = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible) {
      setInteractive(true);
      slideSV.value = SLIDE_DISTANCE;
      slideSV.value = withTiming(0, {
        duration: ENTER_DURATION,
        // ease-out cubic: starts fast, settles gently — a card arriving into place.
        easing: Easing.out(Easing.cubic),
      });
      opacitySV.value = withTiming(1, { duration: FADE_IN_DURATION, easing: Easing.out(Easing.cubic) });
    } else {
      opacitySV.value = withTiming(0, { duration: FADE_OUT_DURATION, easing: Easing.out(Easing.cubic) });
      slideSV.value = withTiming(
        SLIDE_DISTANCE,
        {
          duration: EXIT_DURATION,
          // Symmetric ease-in-out rather than `Easing.in`. `Easing.in` reaches its
          // maximum speed exactly as the card leaves, which reads as a snap; the
          // same mistake was behind the mini-app overlay feeling abrupt.
          easing: Easing.bezier(0.33, 0, 0.67, 1),
        },
        (finished) => {
          if (finished) runOnJS(setInteractive)(false);
        },
      );
    }
  }, [visible, slideSV, opacitySV]);

  // Compositor-only: opacity + translateY. No view's frame changes, so showing or
  // hiding the card costs no layout pass anywhere in the tree.
  const innerStyle = useAnimatedStyle(() => ({
    opacity: opacitySV.value,
    transform: [{ translateY: slideSV.value }],
  }));

  const handleOpen = () => {
    if (!visible) return;
    triggerHaptic('light');
    const state = useBrowserStore.getState();
    if (state.isMiniApp) {
      // Restore the LIVE persistent mini-app (no reload). The host clears
      // browserStore as it goes full.
      useMiniAppStore.getState().restore();
      return;
    }
    router.push({ pathname: '/browser', params: { url: encodeURIComponent(state.minimizedUrl || '') } });
    clearMinimized();
  };

  const handleClose = () => {
    if (!visible) return;
    triggerHaptic('light');
    clearMinimized();
  };

  return (
    // Absolutely positioned: occupies no space in any layout, so the app content
    // never moves when a session is minimized or dismissed.
    <View
      style={{
        position: 'absolute',
        left: SIDE_INSET,
        right: SIDE_INSET,
        bottom: BOTTOM_INSET + insets.bottom + TAB_BAR_CLEARANCE,
        height: BAND_HEIGHT,
        zIndex: 150,
      }}
      pointerEvents={interactive ? 'box-none' : 'none'}
    >
      <Animated.View
        style={[
          {
            height: BAND_HEIGHT,
            backgroundColor: theme.colors.background.elevated,
            // All four corners: this is a floating card, not a band flush with the
            // screen edge. Square bottom corners only read as correct when the
            // shape actually touches the bottom of the display.
            borderRadius: 24,
            // A soft shadow separates the card from whatever is behind it now that
            // it overlays content instead of sitting in its own reserved strip.
            shadowColor: '#000',
            shadowOpacity: theme.isDark ? 0.45 : 0.16,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
            // No hairline borders — on dark themes the light border color
            // appeared as bright UV-style streaks running down the rounded
            // corners during the collapse animation.
          },
          innerStyle,
        ]}
      >
        <Pressable
          onPress={handleOpen}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            // Symmetric horizontal padding so the centered title sits
            // visually in the middle without being shoved by the close
            // button on the right.
            paddingHorizontal: 12,
          }}
        >
          {/* Left spacer matches close-button width so the absolutely
              centered title is visually centered between them. */}
          <View style={{ width: 36 }} />

          {/* Title + favicon — absolutely centered in the band, ignoring
              the side controls so it stays dead-center regardless of
              domain length (truncates with ellipsis). */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              paddingHorizontal: 60,
            }}
          >
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
            ) : null}
            <Text variant="body" weight="semibold" numberOfLines={1} style={{ color: theme.colors.text.primary, maxWidth: 220 }}>
              {minimizedDomain || t('browser.pill_default')}
            </Text>
          </View>

          {/* Close button — pulled in from the right edge. */}
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={handleClose}
            hitSlop={10}
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}
          >
            <Feather name="x" size={22} color={theme.colors.text.primary} />
          </Pressable>
        </Pressable>
      </Animated.View>
    </View>
  );
}
