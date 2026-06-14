import React, { useEffect } from 'react';
import { View, Pressable, Text as RNText } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { useBrowserStore } from '../../store/browserStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useT } from '../../i18n/store';
import { triggerHaptic } from '../../utils/haptics';

// Bottom-docked browser/mini-app session band.
//
// Animation strategy: a SINGLE Reanimated shared value (`heightSV`) drives
// the band's outer height between 0 and BAND_HEIGHT. Because this height
// lives in a flex column above the band's parent, the surrounding layout
// reflows on every frame — the floating tab bar inside the Stack rides
// upward/downward in lockstep, with no separate animation.
//
// The component is ALWAYS mounted (no `return null`). When the session is
// dismissed the height collapses to 0 (and content fades to 0 first), so
// nothing unmounts mid-animation. That's what removed the previous
// "white flash" — LayoutAnimation was scheduling unmount slightly out of
// step with the height change, briefly leaving an empty rectangle on
// screen.
//
// All animation runs on the UI thread (Reanimated worklets), so weak
// devices stay smooth.

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

  const heightSV = useSharedValue(0);
  const opacitySV = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      heightSV.value = withTiming(BAND_HEIGHT, {
        duration: ENTER_DURATION,
        // ease-out cubic: starts fast, ends slowly — matches a sheet rising
        // from below into place, with no abrupt landing.
        easing: Easing.out(Easing.cubic),
      });
      opacitySV.value = withTiming(1, { duration: FADE_IN_DURATION, easing: Easing.out(Easing.cubic) });
    } else {
      // Fade content slightly faster than the height collapse so the moving
      // strip is empty by the time it finishes shrinking — no half-shown
      // text mid-fold.
      opacitySV.value = withTiming(0, { duration: FADE_OUT_DURATION, easing: Easing.in(Easing.cubic) });
      heightSV.value = withTiming(0, {
        duration: EXIT_DURATION,
        // ease-in cubic: starts gently, ends fast — feels like the band
        // tucks itself away under the tab bar.
        easing: Easing.in(Easing.cubic),
      });
    }
  }, [visible, heightSV, opacitySV]);

  const containerStyle = useAnimatedStyle(() => {
    // Tighten the gap to the floating tab bar — but ONLY while the band is
    // actually showing. We use translateY (a transform, handled by the
    // native compositor) instead of marginTop, because animating margin
    // causes the parent flex column to reflow on every frame, which in
    // practice produced occasional 1-pixel "white seams" between the
    // band and the tab bar mid-animation. Transforms don't affect layout
    // so the parent stays still; only the band's pixels shift.
    //
    // Outer opacity is bound to `opacitySV` too so the BAND ITSELF (the
    // solid `background.primary` rectangle) fades alongside the inner
    // content. Without this the inner content faded over 180 ms while
    // the outer background stayed at full opacity until the height
    // collapse finished (320 ms) — so for the last ~140 ms the user
    // saw a band-shaped solid colour rectangle thinning down to a
    // sliver, which on dark themes against a light parent (or on
    // light themes anywhere) read as a "white line" flickering at
    // the bottom of the screen. Driving the entire surface from one
    // opacity SV erases that residual artefact.
    const progress = heightSV.value / BAND_HEIGHT;
    return {
      height: heightSV.value,
      opacity: opacitySV.value,
      transform: [{ translateY: -14 * progress }],
    };
  });
  const innerStyle = useAnimatedStyle(() => ({
    opacity: opacitySV.value,
  }));

  const handleOpen = () => {
    if (!visible) return;
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
    if (!visible) return;
    triggerHaptic('light');
    clearMinimized();
  };

  // Negative top margin is now driven by the animation (see containerStyle
  // above) so the band only "trims" the gap while it's actually visible.
  return (
    <Animated.View
      style={[
        {
          overflow: 'hidden',
          backgroundColor: theme.colors.background.primary,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          // No hairline borders — on dark themes the light border color
          // appeared as bright UV-style streaks running down the rounded
          // corners during the collapse animation. The solid background
          // alone reads cleanly against the screen.
        },
        containerStyle,
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <Animated.View style={[{ height: BAND_HEIGHT }, innerStyle]}>
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
    </Animated.View>
  );
}
