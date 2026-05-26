import React from 'react';
import { View, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';

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

  const wrapperStyle: ViewStyle = {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
  };

  const containerStyle: ViewStyle = {
    flexDirection: 'row',
    backgroundColor: theme.isDark ? '#1E1E1E' : theme.colors.background.elevated,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 32,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'transparent',
  };

  return (
    <View style={wrapperStyle}>
      <View style={containerStyle}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;

          const onPress = () => {
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
});
