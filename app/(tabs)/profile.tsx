import React, { useState } from 'react';
import { View, ScrollView, Pressable, Image, ViewStyle, Dimensions, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar, Button } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { currentUser, mockPosts } from '../../src/utils/mockData';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_SIZE = (SCREEN_WIDTH - 48 - 8) / 3;

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

  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={theme.colors.accent.primary} />
      </View>
    );
  }

  const displayUser = user;
  const userPosts = mockPosts.filter((p) => p.imageUrl).slice(0, 6);

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const bgColor = theme.isDark ? 'rgba(26,26,26,1)' : 'rgba(255,248,240,1)';
  const bgTransparent = theme.isDark ? 'rgba(26,26,26,0)' : 'rgba(255,248,240,0)';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  return (
    <View style={containerStyle}>
      {/* Gradient fade header - username + settings */}
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
            paddingHorizontal: theme.spacing.lg,
            paddingTop: insets.top + 8,
            paddingBottom: 8,
          }}
          pointerEvents="auto"
        >
          <Text variant="subheading" weight="bold">@{displayUser.username}</Text>
          <Pressable onPress={() => router.push('/settings')}>
            <Feather name="settings" size={22} color={theme.colors.text.primary} />
          </Pressable>
        </View>
      </View>

      {/* Scrollable Content */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100, paddingTop: headerContentHeight }}>
        {/* Avatar & Stats */}
        <View style={{ alignItems: 'center', marginTop: theme.spacing.base }}>
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
        </View>

        {/* Stats */}
        <View
          style={{
            flexDirection: 'row',
            marginTop: theme.spacing.lg,
            paddingHorizontal: theme.spacing.xl,
          }}
        >
          <StatItem label="Posts" value={currentUser.postsCount} />
          <StatItem label="Followers" value={currentUser.followersCount} />
          <StatItem label="Following" value={currentUser.followingCount} />
        </View>

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
          {userPosts.map((post) => (
            <View key={post.id}>
              <Image
                source={{ uri: post.imageUrl }}
                style={{
                  width: GRID_SIZE,
                  height: GRID_SIZE,
                  borderRadius: theme.borderRadius.sm,
                }}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
