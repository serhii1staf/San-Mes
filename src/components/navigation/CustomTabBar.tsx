import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, Platform, LayoutChangeEvent } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
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
} from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { triggerHaptic } from '../../utils/haptics';

// ─── Constants ───────────────────────────────────────────────────────────────

const TAB_COUNT = 5;
const CREATE_INDEX = 2;
const TAB_BUTTON_HEIGHT = 44;
const TAB_ROW_PADDING_H = 8;
const TAB_ROW_PADDING_V = 8;

// Breathing room INSIDE each button slot — the pill never touches any edge of the navigation,
// but it's now noticeably bigger than before.
const PILL_INSET_X = 4;
const PILL_INSET_Y = 2;

const PILL_HEIGHT = TAB_BUTTON_HEIGHT - 2 * PILL_INSET_Y;
const PILL_TOP = TAB_ROW_PADDING_V + PILL_INSET_Y;

const BAR_BORDER_RADIUS = 32;
const BAR_HORIZONTAL_MARGIN = 16;
const BAR_BOTTOM_MARGIN = 24;

// Liquid feel — pill follows finger 1:1, but stretches and never switches tabs mid-drag
const PAN_MIN_DISTANCE = 6;
const STRETCH_X_FACTOR = 0.18;
const STRETCH_X_MAX = 24;
const TRANSLATE_Y_FACTOR = 0.35;
const TRANSLATE_Y_MAX = 6;
const PRESS_SCALE = 0.94;

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

// ─── Tab Button ──────────────────────────────────────────────────────────────

const TabBarButton = React.memo(function TabBarButton({
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
}: {
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
}) {
  const iconName = ICON_NAMES[routeName] || 'circle';
  const isCreate = routeName === 'create';

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
      <Feather name={iconName} size={22} color={color} />
    </Pressable>
  );
});

// ─── Sliding Pill ────────────────────────────────────────────────────────────

function SlidingPill({
  pillX,
  pillY,
  pillScale,
  pillStretchW,
  baseWidth,
  visible,
  isDark,
}: {
  pillX: SharedValue<number>;
  pillY: SharedValue<number>;
  pillScale: SharedValue<number>;
  pillStretchW: SharedValue<number>;
  baseWidth: number;
  visible: boolean;
  isDark: boolean;
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

  return (
    <Animated.View
      style={[
        styles.pill,
        animStyle,
        {
          backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.7)',
          borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.9)',
        },
      ]}
      pointerEvents="none"
    />
  );
}

// ─── Glass Backdrop & Reflection ─────────────────────────────────────────────

function GlassBackdrop({ isDark }: { isDark: boolean }) {
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={isDark ? 40 : 60}
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
    );
  }
  return (
    <LinearGradient
      colors={
        isDark
          ? ['rgba(20,20,25,0.75)', 'rgba(30,30,35,0.85)']
          : ['rgba(255,255,255,0.6)', 'rgba(255,255,255,0.75)']
      }
      style={StyleSheet.absoluteFill}
    />
  );
}

function TopReflection({ isDark }: { isDark: boolean }) {
  return (
    <LinearGradient
      colors={
        isDark
          ? ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.0)']
          : ['rgba(255,255,255,0.6)', 'rgba(255,255,255,0.0)']
      }
      style={styles.reflection}
      pointerEvents="none"
    />
  );
}

// ─── Main Tab Bar ────────────────────────────────────────────────────────────

export const CustomTabBar = React.memo(function CustomTabBar({
  state,
  navigation,
}: BottomTabBarProps) {
  const theme = useTheme();
  const isDark = theme.isDark;

  const [slotWidth, setSlotWidth] = useState(0);
  const hasMounted = useRef(false);

  // Animated state — all on UI thread
  const pillX = useSharedValue(0);
  const pillY = useSharedValue(0);
  const pillScale = useSharedValue(1);
  const pillStretchW = useSharedValue(0);

  // SharedValue mirrors of JS state — safe to read inside worklets without TDZ surprises
  const stateIndexSV = useSharedValue(state.index);
  const slotWidthSV = useSharedValue(0);
  const dragAnchorSlot = useSharedValue(state.index);
  const releaseSlot = useSharedValue(state.index);

  // Keep shared mirror in sync with React state
  useEffect(() => {
    stateIndexSV.value = state.index;
  }, [state.index, stateIndexSV]);

  useEffect(() => {
    slotWidthSV.value = slotWidth;
  }, [slotWidth, slotWidthSV]);

  // Convert standard slot index → pill X (relative to the container's border edge).
  const slotToX = useCallback(
    (i: number) => TAB_ROW_PADDING_H + i * slotWidth + PILL_INSET_X,
    [slotWidth]
  );

  // Initial position + react to tab changes
  useEffect(() => {
    if (slotWidth === 0) return;
    const target = slotToX(state.index);
    if (!hasMounted.current) {
      pillX.value = target;
      hasMounted.current = true;
    } else {
      pillX.value = withSpring(target, PILL_SPRING);
    }
    pillY.value = withSpring(0, PILL_SPRING);
    pillStretchW.value = withSpring(0, PILL_SPRING);
    pillScale.value = withSpring(1, PRESS_SPRING);
    dragAnchorSlot.value = state.index;
    releaseSlot.value = state.index;
  }, [
    state.index,
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

  // Squish on press (only on the active pill)
  const onTabPressIn = useCallback(
    (idx: number) => {
      if (idx === state.index) {
        pillScale.value = withSpring(PRESS_SCALE, PRESS_SPRING);
      }
    },
    [state.index, pillScale]
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
  const navigateOnRelease = useCallback(
    (slotIdx: number) => {
      try {
        const route = state.routes[slotIdx];
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
    [state.routes, navigation]
  );

  // ─── Build pan gesture — uses ONLY shared values inside worklets ───────
  const pan = useMemo(() => {
    return Gesture.Pan()
      .minDistance(PAN_MIN_DISTANCE)
      .onBegin(() => {
        'worklet';
        if (slotWidthSV.value <= 0) return;
        dragAnchorSlot.value = stateIndexSV.value;
        releaseSlot.value = stateIndexSV.value;
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

        // Navigate only if the finger ended over a different tab — only on release
        if (target !== stateIndexSV.value) {
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
    stateIndexSV,
    navigateOnRelease,
  ]);

  const pillVisible = state.index !== CREATE_INDEX;
  const pillBaseWidth = Math.max(0, slotWidth - 2 * PILL_INSET_X);

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      {/* Soft fade above the bar so content dissolves into glass */}
      <LinearGradient
        colors={['transparent', isDark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.3)']}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <GestureHandlerRootView style={styles.gestureRoot}>
        <View
          style={[
            styles.container,
            {
              borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.5)',
              shadowColor: isDark ? '#000' : 'rgba(0,0,0,0.15)',
            },
          ]}
          onLayout={onBarLayout}
        >
          {/* Glass layers */}
          <GlassBackdrop isDark={isDark} />
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: isDark
                  ? 'rgba(30, 30, 35, 0.3)'
                  : 'rgba(255, 255, 255, 0.15)',
              },
            ]}
            pointerEvents="none"
          />
          <TopReflection isDark={isDark} />

          {/* Pill is a sibling of the tab row so its top is relative to the container's
              border edge — full control over vertical placement. */}
          {slotWidth > 0 && (
            <SlidingPill
              pillX={pillX}
              pillY={pillY}
              pillScale={pillScale}
              pillStretchW={pillStretchW}
              baseWidth={pillBaseWidth}
              visible={pillVisible}
              isDark={isDark}
            />
          )}

          <GestureDetector gesture={pan}>
            <View style={styles.tabRow}>
              {state.routes.map((route, index) => {
                const isFocused = state.index === index;
                return (
                  <TabBarButton
                    key={route.key}
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
                  />
                );
              })}
            </View>
          </GestureDetector>
        </View>
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
  gestureRoot: {},
  container: {
    position: 'relative',
    flexDirection: 'row',
    marginBottom: BAR_BOTTOM_MARGIN,
    marginHorizontal: BAR_HORIZONTAL_MARGIN,
    borderRadius: BAR_BORDER_RADIUS,
    borderWidth: 0.5,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
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
    borderWidth: 0.5,
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
