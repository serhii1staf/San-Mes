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
    <View style={{ alignItems: 'center' }}>
      <Text variant="subheading" weight="bold" align="center">
        {value.toLocaleString()}
      </Text>
      <Text variant="caption" color={theme.colors.text.secondary}>{label}</Text>
    </View>
  );
}

// Link icon component for displaying user's social links
function LinkIcon({ type, url }: { type: string; url: string }) {
  const theme = useTheme();
  const iconMap: Record<string, string> = {
    github: 'github',
    twitter: 'twitter',
    instagram: 'instagram',
    website: 'globe',
    youtube: 'youtube',
    telegram: 'send',
    default: 'link',
  };
  const iconName = iconMap[type] || iconMap.default;

  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: theme.colors.background.secondary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Feather name={iconName as any} size={15} color={theme.colors.text.secondary} />
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

  // Parse links from user profile (stored as JSON string in bio metadata or separate field)
  const userLinks: { type: string; url: string }[] = (user as any).links || [];

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
        {/* Discord-style layout: Avatar + Stats on same row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginTop: 16 }}>
          {/* Avatar emoji */}
          <Avatar emoji={displayUser.emoji} size="xl" />
          {/* Stats next to avatar */}
          <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around', marginLeft: 20 }}>
            <StatItem label="Посты" value={0} />
            <StatItem label="Подписчики" value={0} />
            <StatItem label="Подписки" value={0} />
          </View>
        </View>

        {/* Display name */}
        <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
          <Text variant="subheading" weight="bold">
            {displayUser.displayName}
          </Text>
        </View>

        {/* Bio */}
        {displayUser.bio ? (
          <View style={{ paddingHorizontal: 24, marginTop: 4 }}>
            <Text variant="body" color={theme.colors.text.secondary}>
              {displayUser.bio}
            </Text>
          </View>
        ) : null}

        {/* Link icons (shown only if user has links) */}
        {userLinks.length > 0 && (
          <View style={{ flexDirection: 'row', paddingHorizontal: 24, marginTop: 10, gap: 8 }}>
            {userLinks.map((link, idx) => (
              <LinkIcon key={idx} type={link.type} url={link.url} />
            ))}
          </View>
        )}

        {/* Tabs */}
        <View style={{ marginTop: 24, borderTopWidth: 1, borderTopColor: theme.colors.border.light }}>
          <View style={{ flexDirection: 'row' }}>
            {([
              { key: 'posts' as TabName, icon: 'grid' },
              { key: 'saved' as TabName, icon: 'bookmark' },
              { key: 'tagged' as TabName, icon: 'tag' },
            ]).map((tab) => (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}
              >
                <Feather
                  name={tab.icon as any}
                  size={20}
                  color={activeTab === tab.key ? theme.colors.accent.primary : theme.colors.text.tertiary}
                />
              </Pressable>
            ))}
          </View>
          {/* Active tab indicator */}
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              height: 2,
              backgroundColor: theme.colors.accent.primary,
              borderRadius: 1,
              width: (SCREEN_WIDTH - 48) / 3,
              left: (['posts', 'saved', 'tagged'].indexOf(activeTab)) * ((SCREEN_WIDTH - 48) / 3),
              marginLeft: 24,
            }}
          />
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
