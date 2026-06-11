import React, { useCallback, useEffect, useRef } from 'react';
import { View, Pressable, StyleSheet, Platform, LayoutChangeEvent } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
  SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { triggerHaptic } from '../../utils/haptics';

// ─── Constants ───────────────────────────────────────────────────────────────

const TAB_COUNT = 5;
const CREATE_INDEX = 2;
const TAB_BUTTON_HEIGHT = 44;
const PILL_HEIGHT = TAB_BUTTON_HEIGHT; // match the tap target exactly
const TAB_ROW_PADDING_H = 8;
const TAB_ROW_PADDING_V = 8;
const BAR_BORDER_RADIUS = 32;
const BAR_HORIZONTAL_MARGIN = 16;
const BAR_BOTTOM_MARGIN = 24;

// Spring config — snappy with slight bounce (Apple-like)
const PILL_SPRING = { damping: 18, stiffness: 280, mass: 0.8 };

const ICON_NAMES: Record<string, keyof typeof Feather.glyphMap> = {
  index: 'home',
  search: 'search',
  create: 'plus-circle',
  messages: 'send',
  profile: 'user',
};

// Map route index (0-4) to pill slot index (skipping create at index 2)
// Standard tabs: index=0, search=1, messages=3, profile=4
// Pill positions:  slot 0,  slot 1,   slot 3,    slot 4
function getPillX(routeIndex: number, slotWidth: number): number {
  return routeIndex * slotWidth;
}

// ─── Tab Button ──────────────────────────────────────────────────────────────

const TabBarButton = React.memo(function TabBarButton({
  isFocused,
  onPress,
  onLongPress,
  routeName,
  label,
  activeColor,
  inactiveColor,
  accentSecondary,
}: {
  isFocused: boolean;
  onPress: () => void;
  onLongPress: () => void;
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
  translateX,
  slotWidth,
  visible,
  isDark,
}: {
  translateX: SharedValue<number>;
  slotWidth: number;
  visible: boolean;
  isDark: boolean;
}) {
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    width: slotWidth,
    opacity: visible ? 1 : 0,
  }));

  return (
    <Animated.View
      style={[
        styles.pill,
        animStyle,
        {
          backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.7)',
          // Simulate inset highlight via border
          borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.9)',
        },
      ]}
    />
  );
}

// ─── Glass Backdrop ──────────────────────────────────────────────────────────

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

  // Android fallback: semi-transparent gradient
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

// ─── Top Reflection (wet highlight) ─────────────────────────────────────────

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

  // Bar width tracking for pill calculation
  const barWidth = useSharedValue(0);
  const pillX = useSharedValue(0);
  const hasMounted = useRef(false);

  const slotWidth =
    barWidth.value > 0 ? (barWidth.value - 2 * TAB_ROW_PADDING_H) / TAB_COUNT : 0;

  // Measure bar
  const onBarLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    barWidth.value = w;
    const sw = (w - 2 * TAB_ROW_PADDING_H) / TAB_COUNT;
    // Set initial pill position without animation
    if (!hasMounted.current) {
      pillX.value = getPillX(state.index, sw);
      hasMounted.current = true;
    }
  }, [state.index]);

  // Animate pill on tab change
  useEffect(() => {
    if (!hasMounted.current || barWidth.value === 0) return;
    const sw = (barWidth.value - 2 * TAB_ROW_PADDING_H) / TAB_COUNT;
    const targetX = getPillX(state.index, sw);
    pillX.value = withSpring(targetX, PILL_SPRING);
  }, [state.index, barWidth.value]);

  const pillVisible = state.index !== CREATE_INDEX;

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      {/* Fade gradient above bar (dissolve content into bar area) */}
      <LinearGradient
        colors={['transparent', isDark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.3)']}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Glass container */}
      <View
        style={[
          styles.container,
          {
            borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.5)',
            // Multi-layer shadow for 3D volume
            shadowColor: isDark ? '#000' : 'rgba(0,0,0,0.15)',
          },
        ]}
        onLayout={onBarLayout}
      >
        {/* Layer 1: Glass blur/tint backdrop */}
        <GlassBackdrop isDark={isDark} />

        {/* Layer 2: Translucent tint overlay (makes it more see-through glass) */}
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

        {/* Layer 3: Top "wet" reflection highlight */}
        <TopReflection isDark={isDark} />

        {/* Layer 4 + 5: Tab row (with pill inside, so the pill respects padding and never bumps the rounded corners) */}
        <View style={styles.tabRow}>
          {slotWidth > 0 && (
            <SlidingPill
              translateX={pillX}
              slotWidth={slotWidth}
              visible={pillVisible}
              isDark={isDark}
            />
          )}
          {state.routes.map((route, index) => {
            const isFocused = state.index === index;
            const onPress = () => {
              triggerHaptic('light');
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };
            const onLongPress = () => {
              navigation.emit({ type: 'tabLongPress', target: route.key });
            };

            return (
              <TabBarButton
                key={route.key}
                isFocused={isFocused}
                onPress={onPress}
                onLongPress={onLongPress}
                routeName={route.name}
                label={route.name === 'index' ? 'Home' : route.name.charAt(0).toUpperCase() + route.name.slice(1)}
                activeColor={theme.colors.accent.primary}
                inactiveColor={theme.colors.text.tertiary}
                accentSecondary={theme.colors.accent.secondary}
              />
            );
          })}
        </View>
      </View>
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
  container: {
    position: 'relative',
    flexDirection: 'row',
    marginBottom: BAR_BOTTOM_MARGIN,
    marginHorizontal: BAR_HORIZONTAL_MARGIN,
    borderRadius: BAR_BORDER_RADIUS,
    borderWidth: 0.5,
    overflow: 'hidden',
    // Shadow for 3D volume
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
    // Raised above pill
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  pill: {
    position: 'absolute',
    top: 0,
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
