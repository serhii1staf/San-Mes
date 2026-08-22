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

// Bottom-docked browser / mini-app session band.
//
// ── SHAPE: DOCKED, NOT FLOATING ─────────────────────────────────────────────
//
// I briefly turned this into a floating card with all four corners rounded, inset
// from both edges and carrying a shadow. That was not what was asked for and it is
// reverted. The band belongs flush with the bottom of the screen, full width, with
// only its TOP corners rounded — sitting under the bottom navigation / input field
// exactly as it did before. Only two things were actually requested: make it a
// little taller, and stop it pushing the app content upward.
//
// ── LAYOUT: OVERLAYS, DOES NOT PUSH ────────────────────────────────────────
//
// It used to be a sibling of the navigator inside the root flex column and RESERVED
// its height there, so minimizing a session lifted the whole app. It is now
// absolutely positioned and reserves nothing, which fixes that and also removes a
// real cost: reserving and releasing the height re-laid out the root column twice
// per session, and each pass re-laid out the Stack, the active screen and everything
// inside it. In a chat that tree holds a live FlashList of message cells, glass
// surfaces, gradients and the Reanimated input bar, so those two commits were
// expensive — a hitch exactly when the band appeared or left.
//
// Showing and hiding is now compositor-only (`translateY` + `opacity`); no view's
// frame ever changes.
//
// The component is ALWAYS mounted (no `return null`), so nothing unmounts
// mid-animation.

/** Band height. Slightly taller than the original 56, which is what was asked for. */
const BAND_HEIGHT = 64;
/**
 * Travel distance for the enter/exit slide, computed from the real box height.
 *
 * Must cover the safe-area padding as well as the band itself: the clip box is
 * `BAND_HEIGHT + insets.bottom` tall, and sliding by only `BAND_HEIGHT` would leave
 * a strip of background visible along the bottom edge when hidden.
 */
function slideDistanceFor(bottomInset: number): number {
  return BAND_HEIGHT + bottomInset;
}
const ENTER_DURATION = 380;
const EXIT_DURATION = 300;
const FADE_IN_DURATION = 240;
const FADE_OUT_DURATION = 180;

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
  // There is no layout state any more — the band reserves no space at all.
  const [interactive, setInteractive] = useState(visible);

  const slideDistance = slideDistanceFor(insets.bottom);

  // Slide offset in points: 0 = docked, `slideDistance` = fully off the bottom.
  const slideSV = useSharedValue(visible ? 0 : slideDistance);
  const opacitySV = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible) {
      setInteractive(true);
      slideSV.value = slideDistance;
      slideSV.value = withTiming(0, {
        duration: ENTER_DURATION,
        // ease-out cubic: starts fast, settles gently — arriving into place.
        easing: Easing.out(Easing.cubic),
      });
      opacitySV.value = withTiming(1, { duration: FADE_IN_DURATION, easing: Easing.out(Easing.cubic) });
    } else {
      opacitySV.value = withTiming(0, { duration: FADE_OUT_DURATION, easing: Easing.out(Easing.cubic) });
      slideSV.value = withTiming(
        slideDistance,
        {
          duration: EXIT_DURATION,
          // Symmetric ease-in-out rather than `Easing.in`. `Easing.in` reaches its
          // maximum speed exactly as the band leaves, which reads as a snap; the
          // same mistake was behind the mini-app overlay feeling abrupt.
          easing: Easing.bezier(0.33, 0, 0.67, 1),
        },
        (finished) => {
          if (finished) runOnJS(setInteractive)(false);
        },
      );
    }
  }, [visible, slideSV, opacitySV, slideDistance]);

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
        left: 0,
        right: 0,
        // Flush with the bottom of the screen, under the bottom navigation, as it
        // was. The safe-area inset is handled by the padding inside the band so the
        // background still bleeds to the physical edge.
        bottom: 0,
        height: BAND_HEIGHT + insets.bottom,
        overflow: 'hidden',
        zIndex: 150,
      }}
      pointerEvents={interactive ? 'box-none' : 'none'}
    >
      <Animated.View
        style={[
          {
            height: BAND_HEIGHT + insets.bottom,
            paddingBottom: insets.bottom,
            backgroundColor: theme.colors.background.primary,
            // TOP corners only. It is docked to the screen edge, so rounding the
            // bottom corners would leave visible notches against the display edge.
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
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
