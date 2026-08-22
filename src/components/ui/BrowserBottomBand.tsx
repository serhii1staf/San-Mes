import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, LayoutAnimation, StyleSheet, Text as RNText } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
import { SCRIM_LOCATIONS, scrimStops } from '../../theme/scrim';
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

/**
 * How far the band tucks up under the tab bar's bottom margin.
 *
 * The floating tab bar carries a 24 pt bottom margin of its own. Stacked in the flex
 * column that margin sat BETWEEN the navigation and this band, so the widget appeared
 * to hang well below the bar. Pulling the band up by most of that margin closes the gap
 * without touching the tab bar's own spacing on screens where no band is present.
 */
const BAND_TUCK = 16;
const ENTER_DURATION = 420;
/**
 * Exit is now LONGER than it was, and longer than the enter.
 *
 * The descent read as abrupt for two reasons that compound: it was the shorter of the
 * two directions (300 vs 380), and the released layout height snapped back the instant
 * the slide ended. A dismissal that is quicker than the corresponding arrival always
 * feels like a cut rather than a movement, so the durations are inverted — leaving is
 * the slower half.
 */
const EXIT_DURATION = 460;
const FADE_IN_DURATION = 260;
/**
 * The fade must not finish early.
 *
 * At 180 ms against a 460 ms slide the band went fully transparent while it was still
 * travelling, so the last two thirds of the motion were invisible and the eye read the
 * whole thing as "it vanished, then the layout jumped". Holding opacity until near the
 * end keeps the movement legible all the way down.
 */
const FADE_OUT_DURATION = 380;
/**
 * How long the surrounding content takes to close the gap after the band has left.
 *
 * Runs natively via `LayoutAnimation`, so this is not a per-frame JS cost.
 */
const RELEASE_EASE_MS = 280;

export function BrowserBottomBand() {
  const theme = useTheme();
  const t = useT();

  // Same ramp as the scrim behind the tab bar (see `scrimStops`), so the band reads
  // as a continuation of that treatment rather than as its own surface.
  const { top: bandFadeTop, mid: bandFadeMid, end: bandFadeBottom } = scrimStops(
    theme.isDark,
    theme.colors.background.primary,
  );
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

  /**
   * Ease the surrounding content instead of snapping it.
   *
   * `LayoutAnimation` is the right tool here and it is important to be precise about
   * why, because a previous commit removed layout animation from a panel for
   * performance and the lesson was over-generalised:
   *
   *   - What was expensive was animating a height through Reanimated, i.e. a NEW
   *     layout pass every frame driven from JS.
   *   - `LayoutAnimation.configureNext` is the opposite: ONE call that hands the
   *     interpolation to the platform's own layout animator. The frames are produced
   *     natively, with no JS involvement and no per-frame commit from our side.
   *
   * This is also what makes it match Telegram's mini-player, where the content inset
   * eases in step with the bar rather than jumping when it finishes.
   */
  const scheduleLayoutEase = useCallback((duration: number) => {
    LayoutAnimation.configureNext({
      duration,
      update: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.scaleY },
    });
  }, []);

  const releaseReserved = useCallback(() => {
    scheduleLayoutEase(RELEASE_EASE_MS);
    setReserved(false);
  }, [scheduleLayoutEase]);

  // Slide offset in points: 0 = docked, BAND_HEIGHT = fully below the clip box.
  const slideSV = useSharedValue(visible ? 0 : BAND_HEIGHT);
  const opacitySV = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible) {
      // Reserve the space first (single layout commit). The band starts fully below
      // its own clip box, so nothing is visible until the slide brings it in — no
      // flash of a solid rectangle in the reserved gap.
      scheduleLayoutEase(ENTER_DURATION);
      setReserved(true);
      slideSV.value = BAND_HEIGHT;
      slideSV.value = withTiming(0, {
        duration: ENTER_DURATION,
        // ease-out cubic: starts fast, settles gently — arriving into place.
        easing: Easing.out(Easing.cubic),
      });
      opacitySV.value = withTiming(1, { duration: FADE_IN_DURATION, easing: Easing.out(Easing.cubic) });
    } else {
      // Held opaque for most of the travel, then eased off — see FADE_OUT_DURATION.
      opacitySV.value = withTiming(0, { duration: FADE_OUT_DURATION, easing: Easing.in(Easing.quad) });
      slideSV.value = withTiming(
        BAND_HEIGHT,
        {
          duration: EXIT_DURATION,
          // Gentle start, long decelerating tail. `Easing.in` (the original) reached
          // maximum speed exactly as the band left, which reads as a snap — the same
          // mistake that made the mini-app overlay feel abrupt. A symmetric
          // ease-in-out was better but still had a fast middle; this curve spends
          // most of its time slowing down, which is what "descends smoothly" means.
          easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        },
        (finished) => {
          // Release the reserved height once the band is off-screen — but EASED, not
          // snapped. Releasing it as a bare state change made the input bar and tab
          // bar drop the full band height in a single frame while the band itself had
          // faded out smoothly: "the widget disappears smoothly, the content drops
          // abruptly".
          if (finished) runOnJS(releaseReserved)();
        },
      );
    }
  }, [visible, slideSV, opacitySV, scheduleLayoutEase, releaseReserved]);

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
      style={{
        height: reserved ? BAND_HEIGHT : 0,
        overflow: 'hidden',
        // Tuck upward under the tab bar's own bottom margin (24 pt), which was
        // otherwise added on top of the band and left a visibly wide gap between the
        // navigation and the widget. Negative margin costs nothing — it does not
        // animate and is resolved in the same single layout commit as the height.
        marginTop: reserved ? -BAND_TUCK : 0,
      }}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      {/* Backing scrim, UNROUNDED, filling the whole strip.
          
          The band itself has rounded top corners with `overflow: hidden`, so its two
          corner triangles are transparent. On a chat that goes unnoticed because the
          chat already paints a scrim there; on the feed, search, create and profile
          there is nothing behind it, so raw list content showed through the corners
          and read as a stray strip along the top edge.
          
          Filling the strip behind the band with the same ramp means the corners
          reveal scrim instead of content, so the rounding stays visible without an
          artefact. */}
      <LinearGradient
        colors={[bandFadeTop, bandFadeMid, bandFadeBottom]}
        locations={SCRIM_LOCATIONS}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <Animated.View
        style={[
          {
            height: BAND_HEIGHT,
            // TOP corners only. It is docked to the screen edge, so rounding the
            // bottom corners would leave visible notches against the display edge.
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            overflow: 'hidden',
            // No hairline borders — on dark themes the light border color
            // appeared as bright UV-style streaks running down the rounded
            // corners during the collapse animation.
          },
          innerStyle,
        ]}
      >
        {/* ── Surface: the app's scrim, nothing else ─────────────────────────
            History, because this has now been wrong twice in opposite directions:

              1. A flat opaque `background.primary` fill. Fine in a chat, where a
                 scrim already sits behind the input bar for it to land on; an
                 opaque slab with a hard edge everywhere else.
              2. Gradient PLUS a frosted `FadingBlurHeader` on top. That made it a
                 blur panel of its own — a third visual language competing with
                 both the content and the scrim, described as "some kind of
                 incomprehensible thing".

            What was asked for is simpler than either: it should look like the
            scrim, the way it does in chats. So it is exactly the scrim ramp and
            nothing more — same colours and stops as the fade behind the tab bar,
            so wherever it appears it continues that treatment instead of
            introducing a surface. */}
        <LinearGradient
          colors={[bandFadeTop, bandFadeMid, bandFadeBottom]}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
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
