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
const PILL_INSET_X = 6; // horizontal breathing room inside each slot
const PILL_HEIGHT = TAB_BUTTON_HEIGHT;
const BAR_BORDER_RADIUS = 32;
const BAR_HORIZONTAL_MARGIN = 16;
const BAR_BOTTOM_MARGIN = 24;

// Drag/elastic params
const PAN_MIN_DISTANCE = 6;
const ELASTIC_FACTOR = 0.35;
const ELASTIC_MAX = 18;
const STRETCH_FACTOR = 0.5;
const PRESS_SCALE = 0.94;

// Spring — Apple-like snappy with slight bounce
const PILL_SPRING = { damping: 18, stiffness: 280, mass: 0.8 };
const PRESS_SPRING = { damping: 20, stiffness: 350, mass: 0.6 };

const ICON_NAMES: Record<string, keyof typeof Feather.glyphMap> = {
  index: 'home',
  search: 'search',
  create: 'plus-circle',
  messages: 'send',
  profile: 'user',
};

// Pick the standard slot closest to a given x (skip the create slot).
function nearestStandardSlot(rawSlot: number, fingerX: number, slotWidth: number): number {
  'worklet';
  if (rawSlot !== CREATE_INDEX) return rawSlot;
  // Snap to whichever standard neighbour the finger is closer to.
  const createCenter = (CREATE_INDEX + 0.5) * slotWidth;
  return fingerX < createCenter ? 1 : 3;
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
  pillScale,
  pillStretchW,
  baseWidth,
  visible,
  isDark,
}: {
  pillX: SharedValue<number>;
  pillScale: SharedValue<number>;
  pillStretchW: SharedValue<number>;
  baseWidth: number;
  visible: boolean;
  isDark: boolean;
}) {
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }, { scale: pillScale.value }],
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
  const pillScale = useSharedValue(1);
  const pillStretchW = useSharedValue(0);
  // Tracks the slot the user is currently dragging toward (for tab-switch detection inside a worklet).
  const draggingSlot = useSharedValue<number>(state.index);

  const slotToX = useCallback(
    (i: number) => i * slotWidth + PILL_INSET_X,
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
    pillStretchW.value = withSpring(0, PILL_SPRING);
    pillScale.value = withSpring(1, PRESS_SPRING);
    draggingSlot.value = state.index;
  }, [state.index, slotWidth, slotToX, pillX, pillStretchW, pillScale, draggingSlot]);

  // Bar measurement
  const onBarLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      const sw = (w - 2 * TAB_ROW_PADDING_H) / TAB_COUNT;
      if (Math.abs(sw - slotWidth) > 0.5) setSlotWidth(sw);
    },
    [slotWidth]
  );

  // Press handlers (squish on the active pill)
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

  // Tap (regular tab switch)
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

  // JS-thread navigator used from worklet via runOnJS
  const navigateToRouteName = useCallback(
    (name: string, key: string) => {
      const event = navigation.emit({ type: 'tabPress', target: key, canPreventDefault: true });
      if (!event.defaultPrevented) {
        triggerHaptic('light');
        navigation.navigate(name);
      }
    },
    [navigation]
  );

  // Build pan gesture (depends on slotWidth & current routes)
  const pan = useMemo(() => {
    if (slotWidth === 0) return Gesture.Pan().enabled(false);

    return Gesture.Pan()
      .minDistance(PAN_MIN_DISTANCE)
      .onBegin(() => {
        'worklet';
        pillScale.value = withSpring(PRESS_SCALE, PRESS_SPRING);
      })
      .onUpdate((e) => {
        'worklet';
        // e.x is in tabRow coordinates (including its left padding).
        const fingerX = e.x - TAB_ROW_PADDING_H;
        const rawSlot = Math.max(
          0,
          Math.min(TAB_COUNT - 1, Math.floor(fingerX / slotWidth))
        );
        const targetSlot = nearestStandardSlot(rawSlot, fingerX, slotWidth);

        const slotCenter = targetSlot * slotWidth + slotWidth / 2;
        const offsetFromCenter = fingerX - slotCenter;
        const sign = offsetFromCenter < 0 ? -1 : 1;
        const elastic =
          sign * Math.min(Math.abs(offsetFromCenter) * ELASTIC_FACTOR, ELASTIC_MAX);

        pillX.value = targetSlot * slotWidth + PILL_INSET_X + elastic;
        pillStretchW.value = Math.abs(elastic) * STRETCH_FACTOR;

        // Switch active tab when finger crosses a different standard slot
        if (targetSlot !== draggingSlot.value) {
          draggingSlot.value = targetSlot;
          const route = state.routes[targetSlot];
          if (route) {
            runOnJS(navigateToRouteName)(route.name, route.key);
          }
        }
      })
      .onFinalize(() => {
        'worklet';
        pillScale.value = withSpring(1, PRESS_SPRING);
        pillStretchW.value = withSpring(0, PILL_SPRING);
        // Snap pill to whichever tab is now active
        const finalSlot = draggingSlot.value;
        pillX.value = withSpring(finalSlot * slotWidth + PILL_INSET_X, PILL_SPRING);
      });
  }, [slotWidth, state.routes, navigateToRouteName, pillX, pillScale, pillStretchW, draggingSlot]);

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

          {/* Tab row + pill (pan gesture wraps just the row so it doesn't fight outside touches) */}
          <GestureDetector gesture={pan}>
            <View style={styles.tabRow}>
              {slotWidth > 0 && (
                <SlidingPill
                  pillX={pillX}
                  pillScale={pillScale}
                  pillStretchW={pillStretchW}
                  baseWidth={pillBaseWidth}
                  visible={pillVisible}
                  isDark={isDark}
                />
              )}

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
  gestureRoot: {
    // Important: keep this as a leaf wrapper so it doesn't expand the layout.
  },
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
    zIndex: 6, // above the sliding pill
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
    top: 0,
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
