import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme';
import { triggerHaptic } from '../../utils/haptics';

const ICON_NAMES: Record<string, keyof typeof Feather.glyphMap> = {
  index: 'home',
  search: 'search',
  create: 'plus-circle',
  messages: 'send',
  profile: 'user',
};

const TabBarButton = React.memo(function TabBarButton({
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
      <Pressable onPress={onPress} onLongPress={onLongPress} style={styles.tabButton}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.accent.secondary, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="plus" size={22} color="#FFFFFF" />
        </View>
      </Pressable>
    );
  }

  const color = isFocused ? theme.colors.accent.primary : theme.colors.text.tertiary;

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={styles.tabButton}>
      <View style={styles.tabIconContainer}>
        <Feather name={iconName} size={22} color={color} />
        {isFocused && (
          <View style={[styles.indicator, { backgroundColor: theme.colors.accent.primary }]} />
        )}
      </View>
    </Pressable>
  );
});

export const CustomTabBar = React.memo(function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      {/* Gradient dissolve - fades content behind the tab bar area */}
      <LinearGradient
        colors={[bgTransparent, bgColor]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={[styles.container, {
        backgroundColor: theme.isDark ? 'rgba(22, 22, 22, 0.97)' : 'rgba(255, 255, 255, 0.97)',
        borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
      }]}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const onPress = () => {
            triggerHaptic('light');
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          const onLongPress = () => { navigation.emit({ type: 'tabLongPress', target: route.key }); };
          return <TabBarButton key={route.key} isFocused={isFocused} onPress={onPress} onLongPress={onLongPress} routeName={route.name} />;
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  container: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 24,
    marginHorizontal: 16,
    borderRadius: 32,
    borderWidth: 0.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  tabButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabIconContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  indicator: { width: 4, height: 4, borderRadius: 2, marginTop: 4 },
});
