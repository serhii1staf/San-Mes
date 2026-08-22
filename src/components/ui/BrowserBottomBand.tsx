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
// from both edges and carrying a shadow. That was not asked for and is reverted. The
// band is flush with the bottom of the screen, full width, top corners only.
//
// ── LAYOUT: IT RESERVES ITS HEIGHT, ON PURPOSE ─────────────────────────────
//
// I also briefly made it absolutely positioned so it would not push the app content
// up. That was wrong, and the reason is worth writing down so it does not get
// "optimised" again: this band lives at the BOTTOM of the screen, and so do the chat
// input bar and the tab bar. If it reserves no space it necessarily covers one of
// them — which is exactly what happened, and the report was "I can't see what I'm
// tapping".
//
// So it is a sibling of the navigator inside the root flex column and occupies its
// own height there. The input bar and tab bar are pushed up by exactly that height
// and stay fully visible and tappable, with the band sitting UNDER them.
//
// The cost is bounded and acceptable: layout commits EXACTLY TWICE per session, once
// when the band is shown and once after it has finished leaving, both owned by React
// state (`reserved`). What must never come back is the original version, which
// ANIMATED that height frame by frame — roughly 23 full layout passes over the whole
// tree, and in a chat that tree holds a live message list, glass surfaces, gradients
// and the Reanimated input bar. Two commits is fine; two per frame is not.
//
// The visible motion is a pure `translateY` on an inner view inside an
// `overflow: hidden` box — compositor-only, so the slide itself costs no layout.
//
// The component is ALWAYS mounted (no `return null`), so nothing unmounts
// mid-animation.

/**
 * Band height. Back down from the 64 I raised it to — the request after seeing it
 * docked was for it to be slightly smaller again.
 */
const BAND_HEIGHT = 56;
const ENTER_DURATION = 380;
const EXIT_DURATION = 300;
const FADE_IN_DURATION = 240;
const FADE_OUT_DURATION = 180;

export function BrowserBottomBand() {
  const theme = useTheme();
  const t = useT();
  const minimizedUrl = useBrowserStore((s) => s.minimizedUrl);
  const minimizedDomain = useBrowserStore((s) => s.minimizedDomain);
  const minimizedFavicon = useBrowserStore((s) => s.minimizedFavicon);
  const minimizedEmoji = useBrowserStore((s) => s.minimizedEmoji);
  const isMiniApp = useBrowserStore((s) => s.isMiniApp);
  const clearMinimized = useBrowserStore((s) => s.clearMinimized);
  const position = useSettingsStore((s) => s.browserWidgetPosition);

  const visible = !!minimizedUrl && position === 'bottom';

  // The ONE piece of layout state. `true` reserves BAND_HEIGHT in the root flex
  // column; set on show, cleared only after the exit slide has finished, so the gap
  // never collapses out from under a still-visible band.
  const [reserved, setReserved] = useState(visible);

  // Slide offset in points: 0 = docked, BAND_HEIGHT = fully below the clip box.
  const slideSV = useSharedValue(visible ? 0 : BAND_HEIGHT);
  const opacitySV = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible) {
      // Reserve the space first (single layout commit). The band starts fully below
      // its own clip box, so nothing is visible until the slide brings it in — no
      // flash of a solid rectangle in the reserved gap.
      setReserved(true);
      slideSV.value = BAND_HEIGHT;
      slideSV.value = withTiming(0, {
        duration: ENTER_DURATION,
        // ease-out cubic: starts fast, settles gently — arriving into place.
        easing: Easing.out(Easing.cubic),
      });
      opacitySV.value = withTiming(1, { duration: FADE_IN_DURATION, easing: Easing.out(Easing.cubic) });
    } else {
      opacitySV.value = withTiming(0, { duration: FADE_OUT_DURATION, easing: Easing.out(Easing.cubic) });
      slideSV.value = withTiming(
        BAND_HEIGHT,
        {
          duration: EXIT_DURATION,
          // Symmetric ease-in-out rather than `Easing.in`. `Easing.in` reaches its
          // maximum speed exactly as the band leaves, which reads as a snap — the
          // same mistake that made the mini-app overlay feel abrupt.
          easing: Easing.bezier(0.33, 0, 0.67, 1),
        },
        (finished) => {
          // Release the reserved height only once the band is off-screen, so the app
          // content settles back down in one step instead of chasing the slide.
          if (finished) runOnJS(setReserved)(false);
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
    // Outer box: pure layout + clip window. No background, no radius, no animation —
    // its height is plain React state so it commits once per transition rather than
    // once per frame.
    <View
      style={{ height: reserved ? BAND_HEIGHT : 0, overflow: 'hidden' }}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <Animated.View
        style={[
          {
            height: BAND_HEIGHT,
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
