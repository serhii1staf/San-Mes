import React, { useEffect, useCallback } from 'react';
import { View, FlatList, RefreshControl, ViewStyle, Pressable } from 'react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { PostCard } from '../../src/components/feed/PostCard';
import { useFeedStore } from '../../src/store';
import { mockPosts, mockStories } from '../../src/utils/mockData';
import { Post, Story } from '../../src/types';

function StoryItem({ story, index }: { story: Story; index: number }) {
  const theme = useTheme();
  const ringColor = story.isSeen ? theme.colors.border.light : theme.colors.accent.primary;

  return (
    <Animated.View entering={FadeIn.delay(index * 80).duration(400)}>
      <Pressable
        style={{
          alignItems: 'center',
          marginRight: theme.spacing.base,
          width: 72,
        }}
      >
        <View
          style={{
            padding: 2,
            borderRadius: 36,
            borderWidth: 2,
            borderColor: ringColor,
          }}
        >
          <Avatar source={story.userAvatar} name={story.userName} size="md" />
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
    </Animated.View>
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
  const { posts, isLoading, isRefreshing, setPosts, setLoading, setRefreshing, toggleLike } = useFeedStore();

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      setPosts(mockPosts as unknown as import('../../src/store/feedStore').Post[]);
      setLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => {
      setPosts(mockPosts as unknown as import('../../src/store/feedStore').Post[]);
      setRefreshing(false);
    }, 1000);
  }, []);

  const renderPost = ({ item, index }: { item: Post; index: number }) => (
    <Animated.View entering={FadeInDown.delay(index * 100).duration(400)}>
      <PostCard
        post={item as unknown as import('../../src/types').Post}
        onLike={toggleLike}
      />
    </Animated.View>
  );

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const headerStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing['2xl'],
    paddingBottom: theme.spacing.md,
  };

  if (isLoading) {
    return (
      <View style={containerStyle}>
        <View style={headerStyle}>
          <Text variant="subheading" weight="bold">San</Text>
        </View>
        <View style={{ paddingHorizontal: theme.spacing.base }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      <View style={headerStyle}>
        <Text variant="subheading" weight="bold">San</Text>
        <Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: theme.colors.accent.primary,
                marginRight: theme.spacing.xs,
              }}
            />
          </View>
        </Pressable>
      </View>
      <FlatList
        data={posts as unknown as Post[]}
        keyExtractor={(item) => item.id}
        renderItem={renderPost}
        ListHeaderComponent={StoriesRow}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.base, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.accent.primary}
          />
        }
      />
    </View>
  );
}
