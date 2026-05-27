import React, { useEffect, useCallback, useState } from 'react';
import { View, FlatList, RefreshControl, ViewStyle, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { PostCard } from '../../src/components/feed/PostCard';
import { PostMenuModal } from '../../src/components/feed/PostMenuModal';
import { TrendingSection } from '../../src/components/feed/TrendingSection';
import { useFeedStore, useAuthStore } from '../../src/store';
import { Post } from '../../src/types';
import { getPosts, toggleLike as toggleLikeAPI } from '../../src/lib/supabase';


function FeedHeader() {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40 }}>
      <Text style={{ fontSize: 40 }}>📝</Text>
      <Text variant="body" weight="semibold" style={{ marginTop: 12 }}>Пока нет публикаций</Text>
      <Text variant="caption" color={theme.colors.text.secondary} align="center" style={{ marginTop: 4, paddingHorizontal: 32 }}>
        Подпишись на людей или создай свой первый пост
      </Text>
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
  const { user } = useAuthStore();
  const [menuPost, setMenuPost] = useState<Post | null>(null);

  // Background color for gradient — uses theme color dynamically
  const bgColor = theme.colors.background.primary;
  const bgTransparent = theme.colors.background.primary + '00';

  useEffect(() => {
    const fetchPosts = async () => {
      setLoading(true);
      try {
        const { posts: dbPosts } = await getPosts();
        const mapped = dbPosts.map(p => ({
          id: p.id,
          authorId: p.author_id,
          authorName: (Array.isArray(p.profiles) ? p.profiles[0]?.display_name : p.profiles?.display_name) || 'User',
          authorUsername: (Array.isArray(p.profiles) ? p.profiles[0]?.username : p.profiles?.username) || 'user',
          authorEmoji: (Array.isArray(p.profiles) ? p.profiles[0]?.emoji : p.profiles?.emoji) || '😊',
          content: p.content,
          imageUrl: p.image_url || undefined,
          likesCount: p.likes_count || 0,
          commentsCount: p.comments_count || 0,
          sharesCount: p.shares_count || 0,
          isLiked: false,
          isBookmarked: false,
          createdAt: p.created_at,
        }));
        setPosts(mapped);
      } catch (e) {
        setPosts([]);
      } finally {
        setLoading(false);
      }
    };
    fetchPosts();
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { posts: dbPosts } = await getPosts();
      const mapped = dbPosts.map(p => ({
        id: p.id,
        authorId: p.author_id,
        authorName: (Array.isArray(p.profiles) ? p.profiles[0]?.display_name : p.profiles?.display_name) || 'User',
        authorUsername: (Array.isArray(p.profiles) ? p.profiles[0]?.username : p.profiles?.username) || 'user',
        authorEmoji: (Array.isArray(p.profiles) ? p.profiles[0]?.emoji : p.profiles?.emoji) || '😊',
        content: p.content,
        imageUrl: p.image_url || undefined,
        likesCount: p.likes_count || 0,
        commentsCount: p.comments_count || 0,
        sharesCount: p.shares_count || 0,
        isLiked: false,
        isBookmarked: false,
        createdAt: p.created_at,
      }));
      setPosts(mapped);
    } catch (e) {
      setPosts([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const renderPost = ({ item }: { item: Post; index: number }) => (
    <View>
      <PostCard
        post={item}
        onComment={(postId) => router.push({ pathname: '/comments/[id]', params: { id: postId } })}
        onLike={async (postId) => {
          toggleLike(postId);
          if (user?.id) {
            await toggleLikeAPI(user.id, postId);
          }
        }}
        onShare={async (postId) => {
          try {
            const { Share } = require('react-native');
            await Share.share({ message: `https://san-mes.vercel.app/post/${postId}` });
          } catch {}
        }}
        onMenu={(post) => setMenuPost(post)}
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
        ListHeaderComponent={posts.length === 0 ? FeedHeader : undefined}
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

      <PostMenuModal visible={!!menuPost} post={menuPost} onClose={() => setMenuPost(null)} />
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
