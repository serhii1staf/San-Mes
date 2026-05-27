import React from 'react';
import { View, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { triggerHaptic } from '../../utils/haptics';

const ICON_NAMES: Record<string, keyof typeof Feather.glyphMap> = {
  index: 'home',
  search: 'search',
  create: 'plus-circle',
  messages: 'send',
  profile: 'user',
};

function TabBarButton({
  isFocused,
  onPress,
  onLongPress,
  routeName,
}: {
  isFocused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  routeName: string;
}) {
  const theme = useTheme();
  const iconName = ICON_NAMES[routeName] || 'circle';
  const isCreate = routeName === 'create';

  if (isCreate) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={styles.tabButton}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: theme.colors.accent.secondary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="plus" size={22} color="#FFFFFF" />
        </View>
      </Pressable>
    );
  }

  const color = isFocused ? theme.colors.accent.primary : theme.colors.text.tertiary;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.tabButton}
    >
      <View style={styles.tabIconContainer}>
        <Feather name={iconName} size={22} color={color} />
        {isFocused && (
          <View
            style={[
              styles.indicator,
              { backgroundColor: theme.colors.accent.primary },
            ]}
          />
        )}
      </View>
    </Pressable>
  );
}

export function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();

  // Colors for the gradient fade below the tab bar
  const bgColor = theme.colors.background.primary;
  const bgTransparent = theme.colors.background.primary + '00';

  const wrapperStyle: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  };

  const containerStyle: ViewStyle = {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginHorizontal: 16,
    borderRadius: 32,
    backgroundColor: theme.isDark ? 'rgba(30, 30, 30, 0.85)' : 'rgba(255, 255, 255, 0.85)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
    borderWidth: 0.5,
    borderColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
  };

  return (
    <View style={wrapperStyle} pointerEvents="box-none">
      {/* Tab bar */}
      <View style={{ marginBottom: 24 }}>
        <View style={containerStyle}>
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
              navigation.emit({
                type: 'tabLongPress',
                target: route.key,
              });
            };

            return (
              <TabBarButton
                key={route.key}
                isFocused={isFocused}
                onPress={onPress}
                onLongPress={onLongPress}
                routeName={route.name}
              />
            );
          })}
        </View>
      </View>

      {/* Gradient fade BELOW the tab bar - from transparent to solid at the very bottom */}
      <LinearGradient
        colors={[bgTransparent, bgColor]}
        locations={[0, 1]}
        style={styles.bottomGradient}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  indicator: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 4,
  },
  bottomGradient: {
    height: 24,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
});
