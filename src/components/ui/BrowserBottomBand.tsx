import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Line, Path } from 'react-native-svg';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { useBrowserStore } from '../../store/browserStore';
import { useMiniAppStore } from '../../store/miniAppStore';
import {
  BAND_CONTENT_HEIGHT,
  BAND_SPRING,
  BAND_TOP_GAP,
  browserBandHeight,
  useBrowserBandVisible,
} from '../../lib/browserWidget';
import { setBrowserBandHeightShared } from '../../lib/browserBandShared';
import { useT } from '../../i18n/store';
import { triggerHaptic } from '../../utils/haptics';

// ── The minimized mini app / site, at the bottom, the way Telegram shows it (Nov 2026) ──────────
//
// Asked: "такой же, как и в Телеграме на нынешний день… снизу… один в один". Built from Telegram's
// own source (Telegram-iOS, submodules/TelegramUI/Components/MinimizedContainer):
//
//   • A 56 pt row (`minimizedNavigationHeight`) on an opaque surface with 25 pt top corners, the
//     safe area under it, and 3 pt of black above (`minimizedTopMargin`).
//   • The app above ends there, with 30 pt rounded bottom corners cut out of black
//     (`bottomEdgeView`), so the app reads as a card resting on the bar.
//   • The title in bold 17 pt, centred, one line, kept 56 pt clear of each side. No icon: Telegram
//     shows it only in the expanded list.
//   • A close × on the LEFT (14 pt, 2 pt round strokes) in a 56 pt square; a tap anywhere else, or a
//     swipe up, opens the app again.
//
// ── HOW IT TAKES ITS SPACE, AND WHY THE PARKED VERSION BROKE ──────────────────────────────────
//
// Like Telegram's container, the bar shortens the app above it: a spacer of the bar's height is a
// sibling of the navigator in the root column (app/_layout.tsx) while the bar shows, so the tab bar
// and every composer sit on it instead of behind it. Never a negative margin (that clipped the
// navigation) and never `LayoutAnimation` (it animates everything in the next commit).
//
// The bar itself is NOT in that layout: it is drawn over the bottom of the root and only moves by
// transform. That is what fixes "the widget leaves smoothly, then the content drops at once": when
// it goes, the spacer goes in the same commit, the screens take their full height under the bar, and
// the bar slides down over them, uncovering them in place instead of leaving a gap behind it. The tab
// bar, the search field and the composers of pushed screens (BandFollowLayer) glide with it on the
// same spring (`BAND_LAYOUT_TRANSITION`).
//
// The screens learn about the bar from the same store the spacer follows (src/lib/browserWidget.ts),
// so their own padding changes in the same commit as the spacer.

/** Telegram's `bottomEdgeCornerRadius`: the app's bottom corners above the bar. */
const APP_CORNER = 30;
/** Telegram's header corner radius. */
const BAR_CORNER = 25;
/** The area at the left that closes, as in Telegram's tap handler (`location.x < 48`). */
const CLOSE_SIDE = 56;

/** The black outside a rounded corner of the app above: for the bottom-left corner, flip for the right. */
function cornerPath(r: number): string {
  return `M0,0 A${r},${r} 0 0 0 ${r},${r} L0,${r} Z`;
}

/** Telegram's close glyph: two 2 pt strokes with round caps in a 14 pt square. */
function CloseGlyph({ color }: { color: string }) {
  const inset = 1.35;
  return (
    <Svg width={14} height={14}>
      <Line x1={inset} y1={inset} x2={14 - inset} y2={14 - inset} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Line x1={14 - inset} y1={inset} x2={inset} y2={14 - inset} stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function BrowserBottomBand() {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const visible = useBrowserBandVisible();
  const minimizedUrl = useBrowserStore((s) => s.minimizedUrl);
  const minimizedDomain = useBrowserStore((s) => s.minimizedDomain);
  const clearMinimized = useBrowserStore((s) => s.clearMinimized);
  const minimizedMiniApp = useBrowserStore((s) => s.isMiniApp);

  const bandH = browserBandHeight(insets.bottom);
  // The whole moving piece: the corner cut-outs above, the gap, the bar and its safe area.
  const overlayH = APP_CORNER + bandH;

  // What the bar shows, kept after the session is cleared so the bar does not go blank on its way
  // down. A mini app by its name, a site by its domain.
  const [title, setTitle] = useState<string>(() => minimizedDomain || '');
  useEffect(() => {
    if (minimizedUrl) setTitle(minimizedDomain || (minimizedMiniApp ? '' : t('browser.pill_default')));
  }, [minimizedUrl, minimizedDomain, minimizedMiniApp, t]);

  // For the keyboard maths on the UI thread (src/lib/browserBandShared.ts). In a layout effect, so it
  // is in place before anything measures against it after this commit.
  useLayoutEffect(() => {
    setBrowserBandHeightShared(visible ? bandH : 0);
  }, [visible, bandH]);
  useEffect(() => () => setBrowserBandHeightShared(0), []);

  // 0: in place; overlayH: wholly below the screen.
  const slide = useSharedValue(visible ? 0 : overlayH);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      if (!visible) slide.value = overlayH;
      return;
    }
    // The same spring both ways, and the same one the tab bar's frame follows, so the bar's top edge
    // and the tab bar move together and keep their gap.
    slide.value = withSpring(visible ? 0 : overlayH, BAND_SPRING);
  }, [visible, overlayH, slide]);
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateY: slide.value }] }));

  // Opening does not clear the session here. The mini app (MiniAppHost) and the browser screen each
  // clear it once they have risen over the screen, so the space under the app is given back while it
  // is covered and nothing is seen dropping into it.
  const open = useCallback(() => {
    const state = useBrowserStore.getState();
    if (!state.minimizedUrl) return;
    triggerHaptic('light');
    if (state.isMiniApp) {
      useMiniAppStore.getState().restore();
      return;
    }
    router.push({ pathname: '/browser', params: { url: encodeURIComponent(state.minimizedUrl) } });
  }, []);

  const close = useCallback(() => {
    if (!useBrowserStore.getState().minimizedUrl) return;
    triggerHaptic('light');
    clearMinimized();
  }, [clearMinimized]);

  // Swipe up opens, like Telegram's `expandPanGesture` (translation.y < -10).
  const swipeUp = Gesture.Pan()
    .activeOffsetY(-10)
    .failOffsetX([-24, 24])
    .onStart(() => {
      'worklet';
      runOnJS(open)();
    });

  const surface = theme.isDark ? theme.colors.background.secondary : theme.colors.background.elevated;
  const ink = theme.colors.text.primary;

  return (
    <>
      {/* The space the bar takes from the screens above, in the root column. No colour of its own:
          until the bar has risen into it, it is the app's background, so only the bar moves. */}
      <View style={{ height: visible ? bandH : 0 }} pointerEvents="none" />

      <Animated.View
        pointerEvents={visible ? 'box-none' : 'none'}
        style={[styles.overlay, { height: overlayH }, slideStyle]}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      >
        {/* The app's rounded bottom corners, as black cut-outs over its last 30 pt. */}
        <View style={styles.corners} pointerEvents="none">
          <Svg width={APP_CORNER} height={APP_CORNER}>
            <Path d={cornerPath(APP_CORNER)} fill="#000" />
          </Svg>
          <Svg width={APP_CORNER} height={APP_CORNER} style={styles.flipX}>
            <Path d={cornerPath(APP_CORNER)} fill="#000" />
          </Svg>
        </View>

        <View style={[styles.band, { height: bandH }]}>
          <GestureDetector gesture={swipeUp}>
            <Pressable
              onPress={open}
              accessibilityRole="button"
              accessibilityLabel={title}
              style={[styles.bar, { backgroundColor: surface, marginTop: BAND_TOP_GAP }]}
            >
              <View style={styles.row}>
                <Text variant="body" weight="bold" numberOfLines={1} align="center" color={ink} style={styles.title}>
                  {title}
                </Text>
                <Pressable
                  onPress={close}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close')}
                  style={styles.close}
                >
                  <CloseGlyph color={ink} />
                </Pressable>
              </View>
            </Pressable>
          </GestureDetector>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  corners: { height: APP_CORNER, flexDirection: 'row', justifyContent: 'space-between' },
  flipX: { transform: [{ scaleX: -1 }] },
  band: { backgroundColor: '#000' },
  bar: {
    flex: 1,
    borderTopLeftRadius: BAR_CORNER,
    borderTopRightRadius: BAR_CORNER,
    // iOS's continuous corner, as Telegram's `applySmoothRoundedCorners`.
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  row: { height: BAND_CONTENT_HEIGHT, justifyContent: 'center' },
  title: { fontSize: 17, lineHeight: 22, marginHorizontal: CLOSE_SIDE },
  close: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CLOSE_SIDE,
    height: BAND_CONTENT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
