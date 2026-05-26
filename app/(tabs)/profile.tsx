import React, { useState, useEffect } from 'react';
import { View, ScrollView, Pressable, Image, ViewStyle, FlatList, Dimensions } from 'react-native';
import Animated, {
  FadeIn,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  interpolate,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme';
import { Text, Avatar, Button } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { currentUser, mockPosts } from '../../src/utils/mockData';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_SIZE = (SCREEN_WIDTH - 48 - 8) / 3;

type TabName = 'posts' | 'saved' | 'tagged';

function AnimatedCounter({ value }: { value: number }) {
  const theme = useTheme();
  return (
    <Animated.View entering={FadeInUp.duration(500)}>
      <Text variant="subheading" weight="bold" align="center">
        {value.toLocaleString()}
      </Text>
    </Animated.View>
  );
}

function StatItem({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <AnimatedCounter value={value} />
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

  const indicatorPosition = useSharedValue(0);

  useEffect(() => {
    const index = tabs.findIndex((t) => t.key === activeTab);
    indicatorPosition.value = withTiming(index, { duration: 250 });
  }, [activeTab]);

  const indicatorStyle = useAnimatedStyle(() => {
    const tabWidth = (SCREEN_WIDTH - 48) / 3;
    return {
      transform: [{ translateX: interpolate(indicatorPosition.value, [0, 1, 2], [0, tabWidth, tabWidth * 2]) }],
      width: tabWidth,
    };
  });

  return (
    <View style={{ marginTop: theme.spacing.lg }}>
      <View style={{ flexDirection: 'row', position: 'relative' }}>
        {tabs.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => onTabChange(tab.key)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: theme.spacing.md }}
          >
            <Feather
              name={tab.icon as keyof typeof Feather.glyphMap}
              size={20}
              color={activeTab === tab.key ? theme.colors.accent.primary : theme.colors.text.tertiary}
            />
          </Pressable>
        ))}
        <Animated.View
          style={[
            indicatorStyle,
            {
              position: 'absolute',
              bottom: 0,
              height: 2,
              backgroundColor: theme.colors.accent.primary,
              borderRadius: 1,
            },
          ]}
        />
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  const { user, login } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabName>('posts');

  useEffect(() => {
    if (!user) {
      login({
        id: currentUser.id,
        username: currentUser.username,
        displayName: currentUser.displayName,
        avatar: currentUser.avatar,
        bio: currentUser.bio,
      });
    }
  }, []);

  const displayUser = user || currentUser;
  const userPosts = mockPosts.filter((p) => p.imageUrl).slice(0, 6);

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
    paddingTop: theme.spacing['2xl'],
  };

  return (
    <ScrollView style={containerStyle} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.base }}>
        <Text variant="subheading" weight="bold">@{displayUser.username}</Text>
        <Pressable onPress={() => router.push('/settings')}>
          <Feather name="settings" size={22} color={theme.colors.text.primary} />
        </Pressable>
      </View>

      {/* Avatar & Stats */}
      <Animated.View entering={FadeIn.duration(500)} style={{ alignItems: 'center', marginTop: theme.spacing.lg }}>
        <View style={{ position: 'relative' }}>
          <Avatar source={displayUser.avatar} name={displayUser.displayName} size="xl" />
          <Pressable
            onPress={() => router.push('/profile/edit')}
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: theme.colors.accent.primary,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: theme.colors.background.primary,
            }}
          >
            <Feather name="camera" size={14} color={theme.colors.text.inverse} />
          </Pressable>
        </View>

        <Text variant="subheading" weight="bold" style={{ marginTop: theme.spacing.md }}>
          {displayUser.displayName}
        </Text>
        {displayUser.bio && (
          <Text
            variant="body"
            color={theme.colors.text.secondary}
            align="center"
            style={{ marginTop: theme.spacing.xs, paddingHorizontal: theme.spacing.xl }}
          >
            {displayUser.bio}
          </Text>
        )}
      </Animated.View>

      {/* Stats */}
      <Animated.View
        entering={FadeInUp.duration(500).delay(200)}
        style={{
          flexDirection: 'row',
          marginTop: theme.spacing.lg,
          paddingHorizontal: theme.spacing.xl,
        }}
      >
        <StatItem label="Posts" value={currentUser.postsCount} />
        <StatItem label="Followers" value={currentUser.followersCount} />
        <StatItem label="Following" value={currentUser.followingCount} />
      </Animated.View>

      {/* Edit Profile Button */}
      <View style={{ paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.lg }}>
        <Button title="Edit Profile" variant="outline" onPress={() => router.push('/profile/edit')} />
      </View>

      {/* Tabs */}
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <ProfileTabs activeTab={activeTab} onTabChange={setActiveTab} />
      </View>

      {/* Post Grid */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          paddingHorizontal: theme.spacing.lg,
          marginTop: theme.spacing.base,
          gap: 4,
        }}
      >
        {userPosts.map((post, index) => (
          <Animated.View key={post.id} entering={FadeIn.delay(index * 80).duration(300)}>
            <Image
              source={{ uri: post.imageUrl }}
              style={{
                width: GRID_SIZE,
                height: GRID_SIZE,
                borderRadius: theme.borderRadius.sm,
              }}
            />
          </Animated.View>
        ))}
      </View>
    </ScrollView>
  );
}
