import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, Platform, LayoutChangeEvent } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  SharedValue,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { triggerHaptic } from '../../utils/haptics';
import { GlassSurface, NativeGlassView, useLiquidGlassActive } from '../ui/LiquidGlass';

// ─── Constants ───────────────────────────────────────────────────────────────

// The main capsule now holds ONLY 4 tabs (index, search, create, messages).
// Profile lives in a SEPARATE detached capsule to the right, so all the
// lens/gesture slot math below operates over 4 slots, not 5.
const TAB_COUNT = 4;
// Create is still the middle button of the 4-tab main bar (index 0,1,[2],3).
const CREATE_INDEX = 2;
const TAB_BUTTON_HEIGHT = 48;
const TAB_ROW_PADDING_H = 6;
const TAB_ROW_PADDING_V = 6;

// Gap between the main capsule and the detached Profile capsule.
const BAR_GAP = 10;
// Width of the standalone Profile capsule. A perfect circle (== bar inner
// height) so it reads as a clean detached round button beside the main bar.
const PROFILE_CAPSULE_WIDTH = 60;

// Almost-zero inset so the lens fills most of its slot — bigger press surface,
// more visual presence, and more area to refract/magnify whatever icon sits
// underneath. Values tuned with the new 48 px row height so the lens still
// has a hairline of breathing room at the slot edges.
const PILL_INSET_X = 2;
const PILL_INSET_Y = 1;

const PILL_HEIGHT = TAB_BUTTON_HEIGHT - 2 * PILL_INSET_Y;
const PILL_TOP = TAB_ROW_PADDING_V + PILL_INSET_Y;

const BAR_BORDER_RADIUS = 32;
const BAR_HORIZONTAL_MARGIN = 16;
const BAR_BOTTOM_MARGIN = 24;
// Height of the bottom background-fade behind the floating bar. Mirrors the
// home header fade (~bar height + margin + a soft fade above the bar top).
const BAR_FADE_HEIGHT = 132;

// Liquid feel — pill follows finger 1:1, but stretches and never switches tabs mid-drag
const PAN_MIN_DISTANCE = 6;
const STRETCH_X_FACTOR = 0.18;
const STRETCH_X_MAX = 24;
const TRANSLATE_Y_FACTOR = 0.35;
const TRANSLATE_Y_MAX = 6;
// Press squish — slightly more pronounced than before so the lens visibly
// "presses into" the bar on touch (90 % vs the old 94 %). Combined with the
// outer ripple ring this is the larger press effect the user asked for.
const PRESS_SCALE = 0.9;
// Magnification range — when a tab icon sits under the lens its scale ramps
// up from 1.0 (lens far away) to 1.18 (lens centered on it). 18 % is enough
// to clearly read as "magnified through glass" without tipping into cartoon
// territory.
const ICON_MAGNIFY_MAX = 0.18;

const PILL_SPRING = { damping: 18, stiffness: 280, mass: 0.8 };
const PRESS_SPRING = { damping: 20, stiffness: 350, mass: 0.6 };

const ICON_NAMES: Record<string, keyof typeof Feather.glyphMap> = {
  index: 'home',
  search: 'search',
  create: 'plus-circle',
  messages: 'send',
  profile: 'user',
};

// Worklet helper — pick the standard slot closest to a given finger slot index
function snapToStandardSlot(fingerSlot: number): number {
  'worklet';
  if (fingerSlot <= 0) return 0;
  if (fingerSlot >= TAB_COUNT - 1) return TAB_COUNT - 1;
  if (fingerSlot === CREATE_INDEX) {
    return fingerSlot < CREATE_INDEX ? 1 : 3;
  }
  return fingerSlot;
}

// ─── Tab Button (with UI-thread icon magnification) ──────────────────────────
//
// Each Standard_Tab icon scales up when the lens is over it, simulating the
// "magnifying lens" you'd see if a curved piece of glass passed over flat
// content. Distance-driven, so it ramps smoothly during a drag rather than
// snapping at slot boundaries.
//
// Implementation lives entirely on the UI thread — `useAnimatedStyle` reads
// `pillX` (which the pan gesture writes synchronously) and recomputes a tiny
// scale value, and the icon view is wrapped in a `Reanimated.View`. There is
// NO per-frame JS-thread work and no parent re-render.

interface TabBarButtonProps {
  index: number;
  isFocused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onPressIn: () => void;
  onPressOut: () => void;
  routeName: string;
  label: string;
  activeColor: string;
  inactiveColor: string;
  accentSecondary: string;
  pillX: SharedValue<number>;
  pillStretchW: SharedValue<number>;
  pillBaseWidth: number;
  slotWidth: number;
}

const TabBarButton = React.memo(function TabBarButton({
  index,
  isFocused,
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  routeName,
  label,
  activeColor,
  inactiveColor,
  accentSecondary,
  pillX,
  pillStretchW,
  pillBaseWidth,
  slotWidth,
}: TabBarButtonProps) {
  const iconName = ICON_NAMES[routeName] || 'circle';
  const isCreate = routeName === 'create';

  // Center x of THIS button's icon in the same coordinate space as `pillX`
  // (which is "x of the pill's left edge inside the bar container").
  const buttonCenterX = TAB_ROW_PADDING_H + (index + 0.5) * slotWidth;

  const iconAnimStyle = useAnimatedStyle(() => {
    'worklet';
    if (isCreate) return { transform: [{ scale: 1 }] };
    // Effective lens center — accounts for stretch (the lens grows wider
    // during a drag, so its center shifts).
    const lensWidth = pillBaseWidth + pillStretchW.value;
    const lensCenterX = pillX.value + lensWidth / 2;
    const distance = Math.abs(buttonCenterX - lensCenterX);
    // Magnification falls off with distance. Beyond ~0.55 of a slot width
    // there's no magnification — keeps the effect localized to the lens.
    const falloff = slotWidth > 0 ? slotWidth * 0.55 : 1;
    const magnify = interpolate(
      distance,
      [0, falloff],
      [ICON_MAGNIFY_MAX, 0],
      Extrapolation.CLAMP,
    );
    return { transform: [{ scale: 1 + magnify }] };
  }, [buttonCenterX, pillBaseWidth, slotWidth, isCreate]);

  if (isCreate) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={styles.tabButton}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: isFocused }}
      >
        <View style={[styles.createCircle, { backgroundColor: accentSecondary }]}>
          <Feather name="plus" size={22} color="#FFFFFF" />
        </View>
      </Pressable>
    );
  }

  const color = isFocused ? activeColor : inactiveColor;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={styles.tabButton}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isFocused }}
    >
      <Animated.View style={iconAnimStyle}>
        <Feather name={iconName} size={22} color={color} />
      </Animated.View>
    </Pressable>
  );
});

// ─── Sliding Lens (translucent pill) ─────────────────────────────────────────
//
// The lens used to be a second `BlurView` (`systemThickMaterial*`) drawn on
// top of the bar's `systemChromeMaterial*` BlurView. Two stacked BlurViews on
// iOS = two `UIVisualEffectView`s that the GPU must re-rasterize whenever
// anything moves behind them. Crucially, this tab bar lives on the root
// `Stack` (see app/_layout.tsx) so it stays mounted underneath every
// `chat/[id]` slide-in — during the ~300 ms transition the lens BlurView was
// re-blending against the moving chat screen on every frame, draining
// frame-budget and showing up as the "lag the moment I open any chat" the
// user reported. Same cost during profile scroll: every render pass for the
// list contents had to also re-composite both BlurViews underneath.
//
// We now render the lens as a translucent fill, brighter than the bar's
// tint. The bar's own BlurView still provides the actual blur of the
// content behind, so the lens area still reads as glass — just one
// composition pass per frame instead of two. Top reflection / bottom dim /
// hairline border are unchanged, which is what gives the pill its rounded
// optical volume; combined with the icon-magnify worklet that lives on the
// UI thread, the "magnifying lens" cue is preserved without the GPU cost.
//
// Visual delta: the lens is very slightly less "frosted" than before — the
// magnification cue now comes mainly from the icon-scale worklet plus the
// brighter pill tint over the bar's blurred backdrop. The user explicitly
// signed off on the lens look as "fine, not bad", so we trade a sliver of
// frostiness for a buttery transition.

function SlidingLens({
  pillX,
  pillY,
  pillScale,
  pillStretchW,
  baseWidth,
  visible,
  isDark,
  glassActive,
}: {
  pillX: SharedValue<number>;
  pillY: SharedValue<number>;
  pillScale: SharedValue<number>;
  pillStretchW: SharedValue<number>;
  baseWidth: number;
  visible: boolean;
  isDark: boolean;
  glassActive: boolean;
}) {
  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: pillX.value },
      { translateY: pillY.value },
      { scale: pillScale.value },
    ],
    width: baseWidth + pillStretchW.value,
    opacity: visible ? 1 : 0,
  }));

  // Tint values picked so the lens stays clearly visible against the bar's
  // own blurred tint without going opaque. iOS dark mode is darker than
  // Android dark mode (the systemChromeMaterial bar already absorbs a lot
  // of light), so we lift the alpha a touch on iOS dark.
  //
  // When the REAL native glass backdrop is active we deliberately go much
  // subtler: a faint selection capsule over genuine liquid glass — no heavy
  // white fill, no stacked gradients, no contour. Real glass already supplies
  // the highlight + refraction, so piling our fake-glass layers on top is what
  // made the bar read as "combined with my own nav". The stretch / magnify
  // animation (driven by animStyle above) is untouched — only the painted
  // decoration changes.
  const lensFill = glassActive
    ? isDark
      ? 'rgba(255,255,255,0.12)'
      : 'rgba(255,255,255,0.28)'
    : Platform.OS === 'ios'
      ? isDark
        ? 'rgba(255,255,255,0.20)'
        : 'rgba(255,255,255,0.55)'
      : isDark
        ? 'rgba(255,255,255,0.16)'
        : 'rgba(255,255,255,0.85)';

  return (
    <Animated.View style={[styles.pill, animStyle]} pointerEvents="none">
      {glassActive ? (
        // Real native liquid-glass selection capsule. It rides the SAME
        // animStyle transform (translateX/Y, scale, width) as the fake-glass
        // path, so the existing pill-stretch animation drives a genuine glass
        // blob that stretches when switching tabs. `clear` keeps it light over
        // the glass backdrop. NOT interactive — `isInteractive` lensed/warped
        // the content and is removed everywhere; the stretch/scale here is
        // driven purely by the shared-value animStyle transform above.
        <NativeGlassView
          glassStyle="clear"
          colorScheme={isDark ? 'dark' : 'light'}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: PILL_HEIGHT / 2 },
          ]}
        />
      ) : (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: PILL_HEIGHT / 2,
              backgroundColor: lensFill,
            },
          ]}
        />
      )}

      {/* The fake-glass decoration (top reflection crescent, bottom dim,
          hairline contour) only renders when we DON'T have real native glass.
          On real glass it would fight the genuine highlights and is exactly
          what made the bar look "combined". */}
      {!glassActive && (
        <>
          {/* Top reflection — the bright crescent that sells the curved-glass
              look. A linear gradient is enough; an arc would require SVG and
              we deliberately avoid that for perf. */}
          <LinearGradient
            colors={
              isDark
                ? ['rgba(255,255,255,0.25)', 'rgba(255,255,255,0)']
                : ['rgba(255,255,255,0.7)', 'rgba(255,255,255,0)']
            }
            style={[
              StyleSheet.absoluteFill,
              { borderRadius: PILL_HEIGHT / 2, height: '55%' },
            ]}
            pointerEvents="none"
          />

          {/* Bottom dim — the thin shadow under the lens edge. Together with
              the top highlight this is what reads as "rounded" rather than "flat". */}
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '40%',
              borderBottomLeftRadius: PILL_HEIGHT / 2,
              borderBottomRightRadius: PILL_HEIGHT / 2,
              backgroundColor: isDark ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.04)',
            }}
            pointerEvents="none"
          />

          {/* Hairline border — Apple's glass surfaces always have a faint
              contour. Drawn on top of all layers so it isn't washed out by
              the blur or the gradients. */}
          <View
            style={{
              ...StyleSheet.absoluteFillObject,
              borderRadius: PILL_HEIGHT / 2,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.9)',
            }}
            pointerEvents="none"
          />
        </>
      )}
    </Animated.View>
  );
}

// ─── Glass Backdrop & Reflection ─────────────────────────────────────────────

function GlassBackdrop({ isDark }: { isDark: boolean }) {
  // Native iOS-26 liquid glass when the user has it enabled and the device
  // supports it; otherwise the existing BlurView (iOS) / gradient (Android).
  // The GlassView fully replaces the backdrop — when the toggle is off it is
  // never mounted, so there's zero residual cost.
  const iosFallback = (
    <BlurView
      // System material tints render the real iOS Liquid-Glass look —
      // they're processed by UIVisualEffectView and include the proper
      // saturation boost + slight vibrancy that flat dark/light tints lack.
      // `systemChromeMaterial` is the stock Apple chrome (tab bars,
      // navigation bars) — the closest thing to "real" floating glass
      // available without iOS 26 private APIs.
      intensity={isDark ? 70 : 80}
      tint={isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
      style={StyleSheet.absoluteFill}
    />
  );
  const androidFallback = (
    <LinearGradient
      colors={
        isDark
          ? ['rgba(20,20,25,0.75)', 'rgba(30,30,35,0.85)']
          : ['rgba(255,255,255,0.6)', 'rgba(255,255,255,0.75)']
      }
      style={StyleSheet.absoluteFill}
    />
  );
  return (
    <GlassSurface
      style={StyleSheet.absoluteFill}
      glassStyle="regular"
      colorScheme={isDark ? 'dark' : 'light'}
      fallback={Platform.OS === 'ios' ? iosFallback : androidFallback}
    />
  );
}

function TopReflection({ isDark }: { isDark: boolean }) {
  return (
    <LinearGradient
      colors={
        isDark
          ? ['rgba(255,255,255,0.14)', 'rgba(255,255,255,0.0)']
          : ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.0)']
      }
      style={styles.reflection}
      pointerEvents="none"
    />
  );
}

// ─── Profile Capsule (detached, standalone glass button) ─────────────────────
//
// The Profile tab is no longer part of the main bar's tab row. It's a separate
// rounded capsule floating to the RIGHT of the main bar with its own glass
// backdrop, border and shadow. It is NOT part of the draggable-lens system —
// it's a plain tappable button that navigates to the profile route and shows
// an active state (accent-colored icon + subtle active fill) when focused.

function ProfileCapsule({
  isFocused,
  onPress,
  onLongPress,
  isDark,
  glassActive,
  activeColor,
  inactiveColor,
  marginBottom,
}: {
  isFocused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  isDark: boolean;
  glassActive: boolean;
  activeColor: string;
  inactiveColor: string;
  marginBottom: number;
}) {
  const color = isFocused ? activeColor : inactiveColor;
  // Press-squish — mirrors the main bar's pill press feel so the detached
  // profile button has the same tactile response. UI-thread shared value.
  const pressScale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: pressScale.value }] }));
  // Subtle active background — only when focused, and only when we're NOT on
  // real native glass (the genuine glass supplies its own selection feel, so
  // a painted fill on top would look "combined" like the lens did).
  const activeBg =
    isFocused && !glassActive
      ? isDark
        ? 'rgba(255,255,255,0.10)'
        : 'rgba(255,255,255,0.45)'
      : 'transparent';

  return (
    <Animated.View
      style={[
        styles.profileCapsule,
        {
          marginBottom,
          borderColor: glassActive
            ? 'transparent'
            : isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.5)',
          shadowColor: isDark ? '#000' : 'rgba(0,0,0,0.15)',
        },
        pressStyle,
      ]}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={() => { pressScale.value = withSpring(PRESS_SCALE, PRESS_SPRING); }}
        onPressOut={() => { pressScale.value = withSpring(1, PRESS_SPRING); }}
        accessibilityRole="button"
        accessibilityLabel="Profile"
        accessibilityState={{ selected: isFocused }}
        style={styles.profileInner}
      >
        {/* Same glass stack as the main bar so both capsules match: native
            liquid glass when enabled, BlurView/gradient fallback otherwise. */}
        <GlassBackdrop isDark={isDark} />
        {!glassActive && <TopReflection isDark={isDark} />}
        {/* Active selection fill sits above the glass but below the icon. */}
        {activeBg !== 'transparent' && (
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: activeBg }]}
            pointerEvents="none"
          />
        )}
        <Feather name="user" size={22} color={color} />
      </Pressable>
    </Animated.View>
  );
}

// ─── Main Tab Bar ────────────────────────────────────────────────────────────

export const CustomTabBar = React.memo(function CustomTabBar({
  state,
  navigation,
}: BottomTabBarProps) {
  const theme = useTheme();
  const isDark = theme.isDark;
  // Real native liquid glass on the bar? Drives whether we drop our fake-glass
  // overlay layers (top reflection, lens decoration) so the genuine glass
  // isn't muddied by them.
  const glassActive = useLiquidGlassActive();
  // Bottom safe-area inset = height of the Android system navigation bar
  // (or the iOS home-indicator). Under edge-to-edge the app draws behind
  // that bar, so without this the floating pill would sit partially BEHIND
  // the system back/home/recents buttons. Adding the inset lifts the bar so
  // it always floats ABOVE the system nav bar on every device.
  const insets = useSafeAreaInsets();
  // Theme background for the bottom fade — mirrors the home header's
  // top fade so feed content dissolves into the background under the bar.
  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';

  // ─── Split the routes: 4 main tabs vs the detached profile tab ───────────
  //
  // Profile is found by NAME (not a hardcoded index) so a future reorder of
  // the <Tabs.Screen> declarations can't silently break this. `mainRoutes`
  // are the 4 tabs rendered inside the main capsule, IN ORDER, and their
  // array index IS their lens slot index (0..3). `profileRoute` is rendered
  // in the standalone capsule on the right.
  const { mainRoutes, profileRoute } = useMemo(() => {
    const main: typeof state.routes = [];
    let profile: (typeof state.routes)[number] | undefined;
    for (const r of state.routes) {
      if (r.name === 'profile') profile = r;
      else main.push(r);
    }
    return { mainRoutes: main, profileRoute: profile };
  }, [state.routes]);

  // Currently-focused route (in the full routes array).
  const focusedRoute = state.routes[state.index];
  const isProfileFocused = focusedRoute?.name === 'profile';
  // Active slot WITHIN the main bar (0..3), or -1 when profile is focused.
  // All pill/lens positioning keys off this — never off state.index — so the
  // slot math can never index out of the 4-slot range when profile is active.
  const activeMainSlot = useMemo(
    () =>
      isProfileFocused
        ? -1
        : mainRoutes.findIndex((r) => r.key === focusedRoute?.key),
    [mainRoutes, focusedRoute, isProfileFocused]
  );

  const [slotWidth, setSlotWidth] = useState(0);
  const hasMounted = useRef(false);

  // Animated state — all on UI thread
  const pillX = useSharedValue(0);
  const pillY = useSharedValue(0);
  const pillScale = useSharedValue(1);
  const pillStretchW = useSharedValue(0);

  // SharedValue mirrors of JS state — safe to read inside worklets without TDZ surprises.
  // `activeSlotSV` holds the active MAIN-bar slot (0..3) or -1 when profile is
  // focused, so worklets never reference an out-of-range slot.
  const activeSlotSV = useSharedValue(activeMainSlot);
  const slotWidthSV = useSharedValue(0);
  const dragAnchorSlot = useSharedValue(activeMainSlot < 0 ? 0 : activeMainSlot);
  const releaseSlot = useSharedValue(activeMainSlot < 0 ? 0 : activeMainSlot);

  // Keep shared mirror in sync with React state
  useEffect(() => {
    activeSlotSV.value = activeMainSlot;
  }, [activeMainSlot, activeSlotSV]);

  useEffect(() => {
    slotWidthSV.value = slotWidth;
  }, [slotWidth, slotWidthSV]);

  // Convert standard slot index → pill X (relative to the container's border edge).
  const slotToX = useCallback(
    (i: number) => TAB_ROW_PADDING_H + i * slotWidth + PILL_INSET_X,
    [slotWidth]
  );

  // Initial position + react to tab changes.
  // Only the 4 main tabs drive the pill. When profile is focused
  // (activeMainSlot === -1) we leave the pill where it is (it's hidden via
  // `pillVisible` anyway) and DON'T try to position it at an out-of-range
  // slot. Anchors are clamped to a valid slot so a subsequent drag starts sane.
  useEffect(() => {
    if (slotWidth === 0) return;
    const safeSlot = activeMainSlot < 0 ? 0 : activeMainSlot;
    dragAnchorSlot.value = safeSlot;
    releaseSlot.value = safeSlot;
    if (activeMainSlot < 0) {
      // Profile focused — pill is hidden; skip repositioning entirely.
      return;
    }
    const target = slotToX(activeMainSlot);
    if (!hasMounted.current) {
      pillX.value = target;
      hasMounted.current = true;
    } else {
      pillX.value = withSpring(target, PILL_SPRING);
    }
    pillY.value = withSpring(0, PILL_SPRING);
    pillStretchW.value = withSpring(0, PILL_SPRING);
    pillScale.value = withSpring(1, PRESS_SPRING);
  }, [
    activeMainSlot,
    slotWidth,
    slotToX,
    pillX,
    pillY,
    pillStretchW,
    pillScale,
    dragAnchorSlot,
    releaseSlot,
  ]);

  const onBarLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      const sw = (w - 2 * TAB_ROW_PADDING_H) / TAB_COUNT;
      if (Math.abs(sw - slotWidth) > 0.5) setSlotWidth(sw);
    },
    [slotWidth]
  );

  // Squish on press — no expanding ring, just a clean compress. `slot` is the
  // main-bar slot index (0..3); only squish when pressing the already-active tab.
  const onTabPressIn = useCallback(
    (slot: number) => {
      if (slot === activeMainSlot) {
        pillScale.value = withSpring(PRESS_SCALE, PRESS_SPRING);
      }
    },
    [activeMainSlot, pillScale]
  );
  const onTabPressOut = useCallback(() => {
    pillScale.value = withSpring(1, PRESS_SPRING);
  }, [pillScale]);

  const handleTabPress = useCallback(
    (route: { key: string; name: string }, isFocused: boolean) => {
      triggerHaptic('light');
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
    },
    [navigation]
  );

  // ─── JS-thread navigation triggered from the gesture (declared BEFORE pan
  //     so the worklet captures a defined function and not a TDZ binding). ─
  //     `slotIdx` is a MAIN-bar slot (0..3) → maps into `mainRoutes`, which
  //     never contains the profile route, so a drag can never land on profile.
  const navigateOnRelease = useCallback(
    (slotIdx: number) => {
      try {
        const route = mainRoutes[slotIdx];
        if (!route) return;
        const event = navigation.emit({
          type: 'tabPress',
          target: route.key,
          canPreventDefault: true,
        });
        if (event.defaultPrevented) return;
        triggerHaptic('light');
        navigation.navigate(route.name);
      } catch {
        // Defensive — never crash the gesture from a JS error
      }
    },
    [mainRoutes, navigation]
  );

  // ─── Build pan gesture — uses ONLY shared values inside worklets ───────
  const pan = useMemo(() => {
    return Gesture.Pan()
      .minDistance(PAN_MIN_DISTANCE)
      .onBegin(() => {
        'worklet';
        if (slotWidthSV.value <= 0) return;
        // Clamp the anchor to a valid slot — when profile is focused
        // (activeSlotSV === -1) start the drag from slot 0 so anchor math
        // stays in range. The pill is hidden in that case anyway.
        const startSlot = activeSlotSV.value < 0 ? 0 : activeSlotSV.value;
        dragAnchorSlot.value = startSlot;
        releaseSlot.value = startSlot;
        pillScale.value = withSpring(PRESS_SCALE, PRESS_SPRING);
      })
      .onUpdate((e) => {
        'worklet';
        const sw = slotWidthSV.value;
        if (sw <= 0) return;

        // 1) Pill follows finger horizontally 1:1, anchored at the slot the drag started from
        const anchorX = TAB_ROW_PADDING_H + dragAnchorSlot.value * sw + PILL_INSET_X;
        pillX.value = anchorX + e.translationX;

        // 2) Vertical wobble — small, capped, so pill never leaves the bar
        const dy = e.translationY * TRANSLATE_Y_FACTOR;
        pillY.value = Math.max(-TRANSLATE_Y_MAX, Math.min(TRANSLATE_Y_MAX, dy));

        // 3) Width stretch in proportion to horizontal motion
        pillStretchW.value = Math.min(
          STRETCH_X_MAX,
          Math.abs(e.translationX) * STRETCH_X_FACTOR
        );

        // 4) Track which slot the finger is currently over — used at release time only
        const fingerXInRow = e.x - TAB_ROW_PADDING_H;
        const fingerSlotF = fingerXInRow / sw;
        const fingerSlotI = Math.max(
          0,
          Math.min(TAB_COUNT - 1, Math.round(fingerSlotF))
        );
        releaseSlot.value = snapToStandardSlot(fingerSlotI);
      })
      .onFinalize(() => {
        'worklet';
        const sw = slotWidthSV.value;

        pillScale.value = withSpring(1, PRESS_SPRING);
        pillStretchW.value = withSpring(0, PILL_SPRING);
        pillY.value = withSpring(0, PILL_SPRING);

        if (sw <= 0) return;

        const target = releaseSlot.value;
        const targetX = TAB_ROW_PADDING_H + target * sw + PILL_INSET_X;
        pillX.value = withSpring(targetX, PILL_SPRING);

        // Navigate only if the finger ended over a DIFFERENT main slot. When
        // profile is focused (activeSlotSV === -1) any 0..3 target differs, so
        // a drag correctly pulls focus back into the main bar.
        if (target !== activeSlotSV.value) {
          runOnJS(navigateOnRelease)(target);
        }
      });
  }, [
    pillX,
    pillY,
    pillScale,
    pillStretchW,
    dragAnchorSlot,
    releaseSlot,
    slotWidthSV,
    activeSlotSV,
    navigateOnRelease,
  ]);

  // Pill is shown only when an ACTUAL main tab is focused AND it isn't the
  // create button. Hidden on create (no highlight for the plus button) and on
  // profile (activeMainSlot === -1, profile lives in its own capsule).
  const pillVisible = activeMainSlot >= 0 && activeMainSlot !== CREATE_INDEX;
  const pillBaseWidth = Math.max(0, slotWidth - 2 * PILL_INSET_X);
  const barMarginBottom =
    BAR_BOTTOM_MARGIN + (Platform.OS === 'android' ? insets.bottom : 0);

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      {/* Bottom fade — the mirror of the home feed's top header fade, but it
          never reaches full opacity: the bottom stop is ~80% so feed content
          stays faintly visible THROUGH the fade all the way down to the
          screen edge (the user wants content to show through to the very
          end, not be covered by a solid slab). transparent → light → ~80%
          background. On Android we extend it by the system-nav inset. */}
      <LinearGradient
        colors={[bgTransparent, bgColor + '80', bgColor + 'D9']}
        locations={[0, 0.45, 1]}
        style={[
          styles.bottomFade,
          { height: BAR_FADE_HEIGHT + (Platform.OS === 'android' ? insets.bottom : 0) },
        ]}
        pointerEvents="none"
      />

      {/* Split navigation row: main capsule (flex:1) + gap + detached profile
          capsule. `box-none` lets taps fall through the gap between them. The
          row carries the bottom margin / safe-area lift so BOTH capsules float
          at the same level. */}
      <GestureHandlerRootView
        style={[styles.row, { marginBottom: barMarginBottom }]}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.container,
            {
              borderColor: glassActive
                ? 'transparent'
                : isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.5)',
              shadowColor: isDark ? '#000' : 'rgba(0,0,0,0.15)',
            },
          ]}
          onLayout={onBarLayout}
        >
          {/* Glass layers */}
          <GlassBackdrop isDark={isDark} />
          {/* The extra reflection gradient only helps the FAKE glass read as
              curved. On real native glass it just dulls the genuine highlight,
              so we skip it entirely. */}
          {!glassActive && <TopReflection isDark={isDark} />}

          {/* Lens sits between the backdrop and the tab row so the icons
              render on top. The lens itself no longer carries its own
              BlurView — the bar's GlassBackdrop already blurs the content
              behind, and the lens is a brighter translucent fill that
              reads as glass over that blurred backdrop. */}
          {slotWidth > 0 && (
            <SlidingLens
              pillX={pillX}
              pillY={pillY}
              pillScale={pillScale}
              pillStretchW={pillStretchW}
              baseWidth={pillBaseWidth}
              visible={pillVisible}
              isDark={isDark}
              glassActive={glassActive}
            />
          )}

          <GestureDetector gesture={pan}>
            <View style={styles.tabRow}>
              {/* ONLY the 4 main routes (profile excluded). Array index === lens
                  slot index (0..3), which is exactly what the gesture math and
                  icon-magnify worklet expect. */}
              {mainRoutes.map((route, index) => {
                // Focused when the globally-focused route is THIS main route.
                // (Compared by key, not by index, since mainRoutes is a subset
                // of state.routes with different indices.)
                const isFocused = focusedRoute?.key === route.key;
                return (
                  <TabBarButton
                    key={route.key}
                    index={index}
                    isFocused={isFocused}
                    onPress={() => handleTabPress(route, isFocused)}
                    onLongPress={() =>
                      navigation.emit({ type: 'tabLongPress', target: route.key })
                    }
                    onPressIn={() => onTabPressIn(index)}
                    onPressOut={onTabPressOut}
                    routeName={route.name}
                    label={
                      route.name === 'index'
                        ? 'Home'
                        : route.name.charAt(0).toUpperCase() + route.name.slice(1)
                    }
                    activeColor={theme.colors.accent.primary}
                    inactiveColor={theme.colors.text.tertiary}
                    accentSecondary={theme.colors.accent.secondary}
                    pillX={pillX}
                    pillStretchW={pillStretchW}
                    pillBaseWidth={pillBaseWidth}
                    slotWidth={slotWidth}
                  />
                );
              })}
            </View>
          </GestureDetector>
        </View>

        {/* Gap between the two capsules */}
        <View style={{ width: BAR_GAP }} pointerEvents="none" />

        {/* Detached Profile capsule — only rendered if the profile route exists. */}
        {profileRoute && (
          <ProfileCapsule
            isFocused={isProfileFocused}
            onPress={() => handleTabPress(profileRoute, isProfileFocused)}
            onLongPress={() =>
              navigation.emit({ type: 'tabLongPress', target: profileRoute.key })
            }
            isDark={isDark}
            glassActive={glassActive}
            activeColor={theme.colors.accent.primary}
            inactiveColor={theme.colors.text.tertiary}
            marginBottom={0}
          />
        )}
      </GestureHandlerRootView>
    </View>
  );
});

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  // Horizontal split-nav row: main capsule (flex:1) + gap + profile capsule.
  // Bottom-aligned so both capsules sit at the same baseline. Horizontal
  // padding replaces the old per-capsule marginHorizontal.
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: BAR_HORIZONTAL_MARGIN,
  },
  bottomFade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  container: {
    position: 'relative',
    flex: 1,
    flexDirection: 'row',
    borderRadius: BAR_BORDER_RADIUS,
    borderWidth: 0.5,
    overflow: 'hidden',
    // Tightened from a 24-pt / 0.25 / elevation 12 drop shadow. The previous
    // values gave the bar a strong floating look but cost real per-frame
    // composition work — particularly on weak Android, where `elevation`
    // recomputes every frame regardless of whether the bar is moving.
    // Pulled in so the bar still reads as floating but the GPU has less to
    // do during chat-screen transitions and profile scroll.
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.20,
    shadowRadius: 18,
    elevation: 8,
  },
  // Standalone profile capsule — same height as the main bar's inner row
  // (TAB_BUTTON_HEIGHT + 2*TAB_ROW_PADDING_V), same border/shadow/radius so it
  // reads as a detached sibling floating beside the main bar.
  profileCapsule: {
    position: 'relative',
    width: PROFILE_CAPSULE_WIDTH,
    height: TAB_BUTTON_HEIGHT + 2 * TAB_ROW_PADDING_V,
    borderRadius: (TAB_BUTTON_HEIGHT + 2 * TAB_ROW_PADDING_V) / 2,
    borderWidth: 0.5,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.20,
    shadowRadius: 18,
    elevation: 8,
  },
  profileInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  tabRow: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: TAB_ROW_PADDING_V,
    paddingHorizontal: TAB_ROW_PADDING_H,
    zIndex: 10,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: TAB_BUTTON_HEIGHT,
    zIndex: 6,
  },
  createCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  pill: {
    position: 'absolute',
    top: PILL_TOP,
    left: 0,
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    overflow: 'hidden',
    zIndex: 5,
  },
  reflection: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '46%',
    borderTopLeftRadius: BAR_BORDER_RADIUS,
    borderTopRightRadius: BAR_BORDER_RADIUS,
    zIndex: 2,
  },
});
