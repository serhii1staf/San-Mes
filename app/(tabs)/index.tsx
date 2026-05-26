import React, { useEffect, useCallback } from 'react';
import { View, FlatList, RefreshControl, ViewStyle, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { PostCard } from '../../src/components/feed/PostCard';
import { TrendingSection } from '../../src/components/feed/TrendingSection';
import { useFeedStore } from '../../src/store';
import { mockPosts, mockStories } from '../../src/utils/mockData';
import { Post, Story } from '../../src/types';

function StoryItem({ story }: { story: Story; index: number }) {
  const theme = useTheme();
  const ringColor = story.isSeen ? theme.colors.border.light : theme.colors.accent.primary;

  return (
    <View>
      <Pressable
        style={{
          alignItems: 'center',
          marginRight: theme.spacing.base,
          width: 72,
        }}
      >
        <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
          {/* Ring behind emoji */}
          <View
            style={{
              position: 'absolute',
              width: 48,
              height: 48,
              borderRadius: 24,
              borderWidth: 2,
              borderColor: ringColor,
            }}
          />
          <Avatar emoji={story.userEmoji} name={story.userName} size="md" />
        </View>
        <Text
          variant="caption"
          numberOfLines={1}
          align="center"
          style={{ marginTop: theme.spacing.xs, width: 64 }}
        >
          {story.userName}
        </Text>
      </Pressable>
    </View>
  );
}

function StoriesRow() {
  const theme = useTheme();

  return (
    <View
      style={{
        paddingVertical: theme.spacing.base,
        paddingLeft: theme.spacing.base,
      }}
    >
      <FlatList
        horizontal
        data={mockStories}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => <StoryItem story={item} index={index} />}
        showsHorizontalScrollIndicator={false}
      />
    </View>
  );
}

function FeedHeader() {
  return (
    <View>
      <StoriesRow />
      <TrendingSection />
    </View>
  );
}

function SkeletonCard() {
  const theme = useTheme();
  const cardStyle: ViewStyle = {
    backgroundColor: theme.colors.background.elevated,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.base,
    marginBottom: theme.spacing.base,
  };
  const shimmerColor = theme.colors.border.light;

  return (
    <View style={cardStyle}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.md }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: shimmerColor }} />
        <View style={{ marginLeft: theme.spacing.md }}>
          <View style={{ width: 120, height: 12, borderRadius: 6, backgroundColor: shimmerColor }} />
          <View style={{ width: 80, height: 10, borderRadius: 5, backgroundColor: shimmerColor, marginTop: 6 }} />
        </View>
      </View>
      <View style={{ width: '100%', height: 14, borderRadius: 7, backgroundColor: shimmerColor, marginBottom: 8 }} />
      <View style={{ width: '70%', height: 14, borderRadius: 7, backgroundColor: shimmerColor, marginBottom: theme.spacing.base }} />
      <View style={{ width: '100%', height: 200, borderRadius: theme.borderRadius.md, backgroundColor: shimmerColor }} />
    </View>
  );
}

export default function FeedScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { posts, isLoading, isRefreshing, setPosts, setLoading, setRefreshing, toggleLike } = useFeedStore();

  // Background color for gradient — uses theme color dynamically
  const bgColor = theme.colors.background.primary;
  const bgTransparent = theme.colors.background.primary + '00';

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      setPosts(mockPosts);
      setLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => {
      setPosts(mockPosts);
      setRefreshing(false);
    }, 1000);
  }, []);

  const renderPost = ({ item }: { item: Post; index: number }) => (
    <View>
      <PostCard
        post={item}
        onLike={toggleLike}
      />
    </View>
  );

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  // The gradient extends taller than the header content to create dissolve effect
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  if (isLoading) {
    return (
      <View style={containerStyle}>
        {/* Gradient header that dissolves */}
        <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
          <LinearGradient
            colors={[bgColor, bgColor, bgTransparent]}
            locations={[0, 0.6, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.headerContent, { paddingTop: insets.top }]}>
            <Text variant="subheading" weight="bold">San</Text>
            <Pressable>
              <Feather name="bell" size={22} color={theme.colors.text.primary} />
            </Pressable>
          </View>
        </View>
        <View style={{ paddingHorizontal: theme.spacing.base, paddingTop: headerContentHeight }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      {/* Gradient header - solid at top, dissolves at bottom */}
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient
          colors={[bgColor, bgColor, bgTransparent]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
          <Text variant="subheading" weight="bold">San</Text>
          <Pressable
            onPress={() => router.push('/notifications')}
            style={{ position: 'relative' }}
          >
            <Feather name="bell" size={22} color={theme.colors.text.primary} />
            <View
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: theme.colors.accent.primary,
              }}
            />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={renderPost}
        ListHeaderComponent={FeedHeader}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.base, paddingBottom: 100, paddingTop: headerContentHeight }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.accent.primary}
            progressViewOffset={headerContentHeight}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
});
