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

// Bottom-docked browser/mini-app session band.
//
// ── ANIMATION STRATEGY (rewritten — this was the "widget lags horribly when it
//    rises in a chat" bug) ────────────────────────────────────────────────────
//
// This band is a sibling of the whole navigator inside the root flex column
// (see app/_layout.tsx), so its height is what pushes the app content up. The
// previous version ANIMATED that height from 0 → 56 over 380 ms. Every frame of
// that animation therefore invalidated the root column's layout, which re-laid
// out the Stack, the active screen and everything inside it — roughly 23 full
// layout+commit passes over the entire tree. On a light screen that is survivable;
// in a chat, where the tree contains a FlashList of live message cells, glass
// surfaces, gradients and the Reanimated input bar, it is not, and the rise
// stuttered badly. The height animation was never about the band itself — it was
// there so the surrounding layout would "ride along" — but the ride is exactly
// what cost the frames.
//
// Now the layout changes EXACTLY TWICE per session: once when the band is shown
// (0 → 56) and once when it has finished leaving (56 → 0). That is owned by React
// state (`reserved`). The visible motion is a pure `translateY` on an inner view
// inside an `overflow: hidden` box, which is compositor-only — no layout, no
// shadow-tree churn, so it holds 60 fps regardless of what screen is behind it.
// Apple Music's own mini player behaves the same way: the content inset changes
// in one step and the bar slides into the reserved space.
//
// The solid background + rounded corners live on the INNER (sliding) view, so the
// outer box is an invisible clip window. That removes the old "white line at the
// bottom" artefact by construction rather than by racing two opacity timings.
//
// The component is ALWAYS mounted (no `return null`), so nothing unmounts
// mid-animation — the original reason LayoutAnimation was dropped.

const BAND_HEIGHT = 56;
const ENTER_DURATION = 380;
const EXIT_DURATION = 320;
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
  // column; it is set on show and cleared only after the exit slide has finished,
  // so the gap never collapses out from under a still-visible band.
  const [reserved, setReserved] = useState(visible);

  // Slide offset in points: 0 = docked, BAND_HEIGHT = fully below the clip box.
  const slideSV = useSharedValue(visible ? 0 : BAND_HEIGHT);
  const opacitySV = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible) {
      // Reserve the space first (single layout commit). The band starts fully
      // below its own clip box, so nothing is visible until the slide brings it
      // in — no flash of a solid rectangle in the reserved gap.
      setReserved(true);
      slideSV.value = BAND_HEIGHT;
      slideSV.value = withTiming(0, {
        duration: ENTER_DURATION,
        // ease-out cubic: starts fast, ends slowly — matches a sheet rising into
        // place with no abrupt landing.
        easing: Easing.out(Easing.cubic),
      });
      opacitySV.value = withTiming(1, { duration: FADE_IN_DURATION, easing: Easing.out(Easing.cubic) });
    } else {
      opacitySV.value = withTiming(0, { duration: FADE_OUT_DURATION, easing: Easing.in(Easing.cubic) });
      slideSV.value = withTiming(
        BAND_HEIGHT,
        {
          duration: EXIT_DURATION,
          // ease-in cubic: gentle start, fast finish — the band tucks itself away.
          easing: Easing.in(Easing.cubic),
        },
        (finished) => {
          // Release the reserved height only once the band is off-screen, so the
          // app content settles back down in a single step instead of chasing the
          // slide.
          if (finished) runOnJS(setReserved)(false);
        },
      );
    }
  }, [visible, slideSV, opacitySV]);

  const innerStyle = useAnimatedStyle(() => {
    // `-14` tightens the gap to the floating tab bar once docked, scaled by how
    // far in the band is so it never overlaps mid-slide. Transform only: the
    // parent column's layout is untouched, which is the whole point of this
    // rewrite.
    const progress = 1 - slideSV.value / BAND_HEIGHT;
    return {
      opacity: opacitySV.value,
      transform: [{ translateY: slideSV.value - 14 * progress }],
    };
  });

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
    // Outer box: pure layout + clip window. No background, no radius, no
    // animation — its height is plain React state so it commits once per
    // transition instead of once per frame.
    <View
      style={{ height: reserved ? BAND_HEIGHT : 0, overflow: 'hidden' }}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <Animated.View
        style={[
          {
            height: BAND_HEIGHT,
            backgroundColor: theme.colors.background.primary,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            // No hairline borders — on dark themes the light border color
            // appeared as bright UV-style streaks running down the rounded
            // corners during the collapse animation. The solid background
            // alone reads cleanly against the screen.
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
