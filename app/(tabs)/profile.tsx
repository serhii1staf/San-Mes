import React, { useState, useRef } from 'react';
import { View, Pressable, ViewStyle, ActivityIndicator, StyleSheet, Animated, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';

const SCREEN_WIDTH = Dimensions.get('window').width;

type TabName = 'posts' | 'saved' | 'tagged';

function StatItem({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text variant="subheading" weight="bold" align="center">
        {value.toLocaleString()}
      </Text>
      <Text variant="caption" color={theme.colors.text.secondary}>{label}</Text>
    </View>
  );
}

function ProfileTabs({ activeTab, onTabChange }: { activeTab: TabName; onTabChange: (tab: TabName) => void }) {
  const theme = useTheme();
  const tabs: { key: TabName; icon: string }[] = [
    { key: 'posts', icon: 'grid' },
    { key: 'saved', icon: 'bookmark' },
    { key: 'tagged', icon: 'tag' },
  ];

  const activeIndex = tabs.findIndex((t) => t.key === activeTab);
  const tabWidth = (SCREEN_WIDTH - 48) / 3;

  return (
    <View style={{ marginTop: 24 }}>
      <View style={{ flexDirection: 'row', position: 'relative' }}>
        {tabs.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => onTabChange(tab.key)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}
          >
            <Feather
              name={tab.icon as keyof typeof Feather.glyphMap}
              size={20}
              color={activeTab === tab.key ? theme.colors.accent.primary : theme.colors.text.tertiary}
            />
          </Pressable>
        ))}
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            height: 2,
            backgroundColor: theme.colors.accent.primary,
            borderRadius: 1,
            width: tabWidth,
            left: activeIndex * tabWidth,
          }}
        />
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabName>('posts');
  const scrollY = useRef(new Animated.Value(0)).current;

  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={theme.colors.accent.primary} />
      </View>
    );
  }

  const displayUser = user;

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const bgColor = theme.colors.background.primary;
  const bgTransparent = theme.colors.background.primary + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  // Avatar appears in header after scrolling past 120px
  const headerEmojiOpacity = scrollY.interpolate({
    inputRange: [80, 140],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { useNativeDriver: false }
  );

  return (
    <View style={containerStyle}>
      {/* Gradient fade header - username + settings + edit icon + animated emoji */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, height: headerGradientHeight }} pointerEvents="box-none">
        <LinearGradient
          colors={[bgColor, bgColor, bgTransparent]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 24,
            paddingTop: insets.top + 8,
            paddingBottom: 8,
          }}
          pointerEvents="auto"
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="subheading" weight="bold">@{displayUser.username}</Text>
            {/* Emoji that fades in on scroll - RIGHT side of username */}
            <Animated.View style={{ opacity: headerEmojiOpacity, marginLeft: 8 }}>
              <Avatar emoji={displayUser.emoji} size="xs" />
            </Animated.View>
          </View>
          {/* Task 4: Edit icon next to settings */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Pressable onPress={() => router.push('/profile/edit')}>
              <Feather name="edit-2" size={20} color={theme.colors.text.primary} />
            </Pressable>
            <Pressable onPress={() => router.push('/settings')}>
              <Feather name="settings" size={22} color={theme.colors.text.primary} />
            </Pressable>
          </View>
        </View>
      </View>

      {/* Scrollable Content */}
      <Animated.ScrollView
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100, paddingTop: headerContentHeight }}
      >
        {/* Task 5: Discord-style layout - Avatar RIGHT, Name/Bio LEFT */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 24, marginTop: 16 }}>
          {/* Left side: name, bio */}
          <View style={{ flex: 1, paddingRight: 16 }}>
            <Text variant="subheading" weight="bold">
              {displayUser.displayName}
            </Text>
            {displayUser.bio && (
              <Text
                variant="body"
                color={theme.colors.text.secondary}
                style={{ marginTop: 4 }}
              >
                {displayUser.bio}
              </Text>
            )}
            {/* Links section placeholder */}
            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="link" size={14} color={theme.colors.text.tertiary} />
                <Text variant="caption" color={theme.colors.text.tertiary}>
                  Добавить ссылки
                </Text>
              </View>
            </View>
          </View>
          {/* Right side: avatar emoji */}
          <Avatar emoji={displayUser.emoji} size="xl" />
        </View>

        {/* Stats */}
        <View style={{ flexDirection: 'row', marginTop: 24, paddingHorizontal: 32 }}>
          <StatItem label="Posts" value={0} />
          <StatItem label="Followers" value={0} />
          <StatItem label="Following" value={0} />
        </View>

        {/* Post Grid - Empty State */}
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <Text style={{ fontSize: 32 }}>📷</Text>
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 8 }}>
            Ещё нет публикаций
          </Text>
        </View>
      </Animated.ScrollView>
    </View>
  );
}
