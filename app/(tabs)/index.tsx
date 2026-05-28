import React, { useEffect, useCallback, useState, useRef } from 'react';
import { View, FlatList, RefreshControl, Pressable, StyleSheet, ActivityIndicator, Modal, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { PostCard } from '../../src/components/feed/PostCard';
import { PostMenuModal } from '../../src/components/feed/PostMenuModal';
import { useFeedStore, useAuthStore } from '../../src/store';
import { Post } from '../../src/types';
import { getPosts, isRepost, parseImageUrls, toggleLike as apiToggleLike } from '../../src/lib/supabase';
import { useUpdateStore } from '../../src/store/updateStore';
import { triggerHaptic } from '../../src/utils/haptics';

const FEED_CACHE_KEY = '@san:feed_posts';
const FEED_LIMIT = 20;

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
  return (
    <View style={{ backgroundColor: theme.colors.background.elevated, borderRadius: theme.borderRadius.lg, padding: theme.spacing.base, marginBottom: theme.spacing.base }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.md }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.border.light }} />
        <View style={{ marginLeft: theme.spacing.md }}>
          <View style={{ width: 120, height: 12, borderRadius: 6, backgroundColor: theme.colors.border.light }} />
          <View style={{ width: 80, height: 10, borderRadius: 5, backgroundColor: theme.colors.border.light, marginTop: 6 }} />
        </View>
      </View>
      <View style={{ width: '100%', height: 14, borderRadius: 7, backgroundColor: theme.colors.border.light, marginBottom: 8 }} />
      <View style={{ width: '70%', height: 14, borderRadius: 7, backgroundColor: theme.colors.border.light, marginBottom: theme.spacing.base }} />
      <View style={{ width: '100%', height: 200, borderRadius: theme.borderRadius.md, backgroundColor: theme.colors.border.light }} />
    </View>
  );
}

// Map raw Supabase post to Post type
function mapRawPost(p: any, postsById: Record<string, any>): Post | null {
  const repostInfo = isRepost(p.content || '');
  const parsedImages = parseImageUrls(p.image_url);
  const profileData = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;

  let post: Post = {
    id: p.id,
    authorId: p.author_id,
    authorName: profileData?.display_name || 'User',
    authorUsername: profileData?.username || 'user',
    authorEmoji: profileData?.emoji || '😊',
    content: repostInfo.isRepost ? (repostInfo.comment || '') : (p.content || ''),
    imageUrl: parsedImages[0] || undefined,
    imageUrls: parsedImages.length > 0 ? parsedImages : undefined,
    likesCount: p.likes_count || 0,
    commentsCount: p.comments_count || 0,
    sharesCount: p.shares_count || 0,
    isLiked: false,
    isBookmarked: false,
    createdAt: p.created_at,
    isRepost: repostInfo.isRepost,
  };

  if (!post.content && !post.imageUrl && !post.isRepost) return null;

  if (repostInfo.isRepost && repostInfo.originalPostId) {
    const orig = postsById[repostInfo.originalPostId];
    if (orig) {
      const origProfile = Array.isArray(orig.profiles) ? orig.profiles[0] : orig.profiles;
      const origImages = parseImageUrls(orig.image_url);
      post.originalPost = {
        id: orig.id,
        authorName: origProfile?.display_name || 'User',
        authorUsername: origProfile?.username || 'user',
        authorEmoji: origProfile?.emoji || '😊',
        content: orig.content || '',
        imageUrl: origImages[0] || undefined,
        imageUrls: origImages.length > 0 ? origImages : undefined,
      };
    }
  }
  return post;
}

export default function FeedScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { posts, setPosts, isLoading, setLoading, isRefreshing, setRefreshing, toggleLike, feedScrollOffset, setFeedScrollOffset } = useFeedStore();
  const [menuPost, setMenuPost] = useState<Post | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const hasFetched = useRef(false);
  const flatListRef = useRef<FlatList>(null);

  // Save scroll offset to store (throttled via scrollEventThrottle on FlatList)
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    setFeedScrollOffset(offset);
  }, [setFeedScrollOffset]);

  // Restore scroll position when tab regains focus
  useFocusEffect(
    useCallback(() => {
      if (flatListRef.current && feedScrollOffset > 0) {
        // Small delay to ensure FlatList is fully rendered before scrolling
        setTimeout(() => {
          flatListRef.current?.scrollToOffset({ offset: feedScrollOffset, animated: false });
        }, 50);
      }
    }, [feedScrollOffset])
  );

  const { status: updateStatus, progress: updateProgress, message: updateMessage, checkForUpdate, applyUpdate } = useUpdateStore();

  // On first mount: if store is empty — load from cache then from Supabase
  // If store already has posts — display instantly without network request
  useEffect(() => {
    if (posts.length > 0) {
      // Store already has data — show instantly, no fetch needed
      setLoading(false);
      return;
    }

    // Store is empty — try loading from cache first
    AsyncStorage.getItem(FEED_CACHE_KEY).then((cached) => {
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPosts(parsed);
            setLoading(false);
          }
        } catch {}
      }
    }).catch(() => {});
  }, []);

  // Fetch fresh data from Supabase (once, only if store was empty)
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    if (posts.length === 0) {
      loadFeed();
    }
    checkForUpdate();
  }, []);

  // Safety timeout to hide loading state
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 1500);
    return () => clearTimeout(t);
  }, []);

  const loadFeed = useCallback(async () => {
    try {
      const { posts: rawPosts, error } = await getPosts(FEED_LIMIT, 0);
      if (error || !rawPosts) {
        // Network error: preserve existing store data, hide loading
        setLoading(false);
        return;
      }

      const postsById: Record<string, any> = {};
      for (const p of rawPosts) postsById[p.id] = p;

      const mapped: Post[] = [];
      for (const p of rawPosts) {
        const post = mapRawPost(p, postsById);
        if (post) mapped.push(post);
      }

      // Write to Zustand store (primary data source)
      setPosts(mapped);
      setLoading(false);

      // Save to AsyncStorage cache (non-blocking)
      AsyncStorage.setItem(FEED_CACHE_KEY, JSON.stringify(mapped)).catch(() => {});
    } catch {
      // Network error: preserve existing store data, hide loading/refreshing
      setLoading(false);
    }
  }, [setPosts, setLoading]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { posts: rawPosts, error } = await getPosts(FEED_LIMIT, 0);
      if (error || !rawPosts) {
        // Network error: preserve existing data from store, hide refresh indicator
        setRefreshing(false);
        return;
      }

      const postsById: Record<string, any> = {};
      for (const p of rawPosts) postsById[p.id] = p;

      const mapped: Post[] = [];
      for (const p of rawPosts) {
        const post = mapRawPost(p, postsById);
        if (post) mapped.push(post);
      }

      // Update store with fresh data
      setPosts(mapped);
      // Save to cache (non-blocking)
      AsyncStorage.setItem(FEED_CACHE_KEY, JSON.stringify(mapped)).catch(() => {});
    } catch {
      // Network error: preserve existing data from store
    }
    setRefreshing(false);
  }, [setPosts, setRefreshing]);

  const handleToggleLike = useCallback((postId: string) => {
    if (!user?.id) return;
    // Optimistic update via store
    toggleLike(postId);
    // Send to server (fire and forget)
    apiToggleLike(user.id, postId).catch(() => {});
  }, [user?.id, toggleLike]);

  const renderPost = useCallback(({ item }: { item: Post }) => (
    <View>
      <PostCard
        post={item}
        onComment={(postId) => router.push({ pathname: '/comments/[id]', params: { id: postId } })}
        onLike={(postId) => handleToggleLike(postId)}
        onShare={(postId) => {
          if (!user?.id) return;
          triggerHaptic('medium');
          useFeedStore.getState().setPendingRepost(postId);
          router.push('/(tabs)/create');
        }}
        onMenu={(post) => setMenuPost(post)}
      />
    </View>
  ), [handleToggleLike, user?.id]);

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  if (isLoading && posts.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: bgColor }}>
        <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
          <LinearGradient colors={[bgColor, bgColor, bgTransparent]} locations={[0, 0.6, 1]} style={StyleSheet.absoluteFill} />
          <View style={[styles.headerContent, { paddingTop: insets.top }]}>
            <Text variant="subheading" weight="bold">San</Text>
            <Pressable onPress={() => router.push('/notifications')}><Feather name="bell" size={22} color={theme.colors.text.primary} /></Pressable>
          </View>
        </View>
        <View style={{ paddingHorizontal: theme.spacing.base, paddingTop: headerContentHeight }}>
          <SkeletonCard /><SkeletonCard />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient colors={[bgColor, bgColor, bgTransparent]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="subheading" weight="bold">San</Text>
            {(updateStatus === 'checking' || updateStatus === 'downloading' || updateStatus === 'ready') && (
              <Pressable onPress={() => setShowUpdateModal(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.accent.primary + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                {updateStatus !== 'ready' ? <ActivityIndicator size={11} color={theme.colors.accent.primary} /> : <Feather name="check-circle" size={12} color={theme.colors.accent.primary} />}
                <Text variant="caption" color={theme.colors.accent.primary} style={{ fontSize: 11 }}>{updateStatus === 'ready' ? 'Готово' : `${Math.round(updateProgress)}%`}</Text>
              </Pressable>
            )}
          </View>
          <Pressable onPress={() => router.push('/notifications')} style={{ position: 'relative' }}>
            <Feather name="bell" size={22} color={theme.colors.text.primary} />
            <View style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accent.primary }} />
          </Pressable>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={renderPost}
        ListHeaderComponent={posts.length === 0 ? FeedHeader : undefined}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.base, paddingBottom: 100, paddingTop: headerContentHeight }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        maxToRenderPerBatch={5}
        windowSize={7}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={theme.colors.accent.primary} progressViewOffset={headerContentHeight} />}
      />

      <PostMenuModal visible={!!menuPost} post={menuPost} onClose={() => setMenuPost(null)} />

      <Modal visible={showUpdateModal} transparent animationType="fade" onRequestClose={() => setShowUpdateModal(false)} statusBarTranslucent>
        <View style={{ flex: 1 }}>
          <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setShowUpdateModal(false)} />
          <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden' }}>
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}><View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} /></View>
              <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                <Text variant="body" weight="bold" align="center" style={{ marginBottom: 16 }}>Обновление</Text>
                <View style={{ height: 6, backgroundColor: theme.colors.border.light, borderRadius: 3, marginBottom: 12, overflow: 'hidden' }}><View style={{ height: '100%', width: `${Math.min(updateProgress, 100)}%`, backgroundColor: theme.colors.accent.primary, borderRadius: 3 }} /></View>
                <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginBottom: 16 }}>{Math.round(updateProgress)}%</Text>
                {updateStatus === 'ready' && (<Pressable onPress={applyUpdate} style={{ backgroundColor: theme.colors.accent.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}><Text variant="body" weight="semibold" color="#FFFFFF">Перезапустить</Text></Pressable>)}
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 8 },
});
