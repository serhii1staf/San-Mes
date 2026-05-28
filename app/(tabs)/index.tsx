import React, { useEffect, useCallback, useState } from 'react';
import { View, FlatList, RefreshControl, ViewStyle, Pressable, StyleSheet, ActivityIndicator, Modal, Animated as RNAnimated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { PostCard } from '../../src/components/feed/PostCard';
import { PostMenuModal } from '../../src/components/feed/PostMenuModal';
import { TrendingSection } from '../../src/components/feed/TrendingSection';
import { useFeedStore, useAuthStore, useEntityStore } from '../../src/store';
import { Post } from '../../src/types';
import { isRepost, parseImageUrls } from '../../src/lib/supabase';
import { syncFeed } from '../../src/lib/syncEngine';
import { queueMutation } from '../../src/lib/mutationQueue';
import { useUpdateStore } from '../../src/store/updateStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { LocalPost } from '../../src/lib/entityStore';

// Module-level flag to prevent skeleton from showing after first load
let globalFeedLoaded = false;


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

/**
 * Convert a LocalPost from entityStore into the Post type used by UI components.
 */
function mapLocalPostToPost(localPost: LocalPost, profiles: Record<string, any>, userId: string | undefined, likedPostIds: Set<string>): Post | null {
  const repostInfo = isRepost(localPost.content || '');
  const parsedImages = parseImageUrls(localPost.image_url);
  const authorProfile = profiles[localPost.author_id];

  let post: Post = {
    id: localPost.id,
    authorId: localPost.author_id,
    authorName: authorProfile?.display_name || 'User',
    authorUsername: authorProfile?.username || 'user',
    authorEmoji: authorProfile?.emoji || '😊',
    content: repostInfo.isRepost ? (repostInfo.comment || '') : localPost.content,
    imageUrl: parsedImages[0] || undefined,
    imageUrls: parsedImages.length > 0 ? parsedImages : undefined,
    likesCount: localPost.likes_count || 0,
    commentsCount: localPost.comments_count || 0,
    sharesCount: localPost.shares_count || 0,
    isLiked: likedPostIds.has(localPost.id),
    isBookmarked: false,
    createdAt: localPost.created_at,
    isRepost: repostInfo.isRepost,
  };

  // Skip posts with no content and no image (broken/empty)
  if (!post.content && !post.imageUrl && !post.isRepost) return null;

  return post;
}

export default function FeedScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { isRefreshing, setRefreshing, pendingRepostId, setPendingRepost } = useFeedStore();
  const [menuPost, setMenuPost] = useState<Post | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(!globalFeedLoaded);
  const syncStarted = React.useRef(false);

  const { status: updateStatus, progress: updateProgress, message: updateMessage, checkForUpdate, applyUpdate } = useUpdateStore();

  // Read from entity store (SSOT)
  const feedPosts = useEntityStore((s) => s.getFeedPosts());
  const profiles = useEntityStore((s) => s.profiles);
  const isHydrated = useEntityStore((s) => s.isHydrated);
  const userLikes = useEntityStore((s) => user?.id ? s.getUserLikes(user.id) : new Set<string>());

  // Safety timeout - ALWAYS hide skeleton after 3 seconds no matter what
  useEffect(() => {
    if (globalFeedLoaded) return; // Already loaded, no need for timeout
    const timer = setTimeout(() => {
      globalFeedLoaded = true;
      setIsInitialLoading(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // If we already have posts, show them immediately
  useEffect(() => {
    if (feedPosts.length > 0) {
      globalFeedLoaded = true;
      setIsInitialLoading(false);
    }
  }, [feedPosts.length]);

  // Check for OTA updates on mount
  useEffect(() => {
    checkForUpdate();
  }, []);

  // Load likes from SQLite when user is available
  useEffect(() => {
    if (user?.id && isHydrated) {
      useEntityStore.getState().loadLikes(user.id);
    }
  }, [user?.id, isHydrated]);

  // Trigger initial sync — don't wait for isHydrated, just sync immediately
  useEffect(() => {
    if (syncStarted.current) return;
    syncStarted.current = true;

    // Force isHydrated if not already set (safety)
    if (!useEntityStore.getState().isHydrated) {
      useEntityStore.setState({ isHydrated: true });
    }

    // Sync feed from Supabase
    syncFeed(user?.id)
      .then(() => {
        globalFeedLoaded = true;
        setIsInitialLoading(false);
      })
      .catch(() => {
        globalFeedLoaded = true;
        setIsInitialLoading(false);
      });
  }, []);

  // Map local posts to UI Post type
  const posts: Post[] = React.useMemo(() => {
    if (!feedPosts.length) return [];
    const mapped: Post[] = [];
    for (const localPost of feedPosts) {
      const post = mapLocalPostToPost(localPost, profiles, user?.id, userLikes);
      if (post) mapped.push(post);
    }
    return mapped;
  }, [feedPosts, profiles, user?.id, userLikes]);

  // Resolve reposts — find original post data from entity store
  const postsWithReposts: Post[] = React.useMemo(() => {
    const allPosts = useEntityStore.getState().posts;
    return posts.map((post) => {
      if (!post.isRepost) return post;
      const repostInfo = isRepost(allPosts[post.id]?.content || '');
      if (repostInfo.isRepost && repostInfo.originalPostId) {
        const origLocal = allPosts[repostInfo.originalPostId];
        if (origLocal) {
          const origProfile = profiles[origLocal.author_id];
          const origImages = parseImageUrls(origLocal.image_url);
          return {
            ...post,
            originalPost: {
              id: origLocal.id,
              authorName: origProfile?.display_name || 'User',
              authorUsername: origProfile?.username || 'user',
              authorEmoji: origProfile?.emoji || '😊',
              content: origLocal.content,
              imageUrl: origImages[0] || undefined,
              imageUrls: origImages.length > 0 ? origImages : undefined,
            },
          };
        }
        // Original post deleted — skip this repost
        return null;
      }
      return post;
    }).filter(Boolean) as Post[];
  }, [posts, profiles]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncFeed(user?.id);
    } catch (e) {
      // Keep existing posts on error
    } finally {
      setRefreshing(false);
    }
  }, [user?.id]);

  const handleToggleLike = useCallback(async (postId: string) => {
    if (!user?.id) return;
    queueMutation('toggle_like', { userId: user.id, postId });
  }, [user?.id]);

  const renderPost = ({ item }: { item: Post; index: number }) => (
    <View>
      <PostCard
        post={item}
        onComment={(postId) => router.push({ pathname: '/comments/[id]', params: { id: postId } })}
        onLike={async (postId) => {
          handleToggleLike(postId);
        }}
        onShare={async (postId) => {
          if (!user?.id) return;
          triggerHaptic('medium');
          useFeedStore.getState().setPendingRepost(postId);
          router.push('/(tabs)/create');
        }}
        onMenu={(post) => setMenuPost(post)}
      />
    </View>
  );

  // Background color for gradient
  const bgColor = theme.colors.background.primary;
  const bgTransparent = theme.colors.background.primary + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  if (isInitialLoading && postsWithReposts.length === 0) {
    return (
      <View style={containerStyle}>
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="subheading" weight="bold">San</Text>
            {(updateStatus === 'checking' || updateStatus === 'downloading' || updateStatus === 'ready') && (
              <Pressable onPress={() => setShowUpdateModal(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.accent.primary + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                {updateStatus !== 'ready' ? (
                  <ActivityIndicator size={11} color={theme.colors.accent.primary} />
                ) : (
                  <Feather name="check-circle" size={12} color={theme.colors.accent.primary} />
                )}
                <Text variant="caption" color={theme.colors.accent.primary} style={{ fontSize: 11 }}>
                  {updateStatus === 'ready' ? 'Готово' : `${Math.round(updateProgress)}%`}
                </Text>
              </Pressable>
            )}
          </View>
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
        data={postsWithReposts}
        keyExtractor={(item) => item.id}
        renderItem={renderPost}
        ListHeaderComponent={postsWithReposts.length === 0 ? FeedHeader : undefined}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.base, paddingBottom: 100, paddingTop: headerContentHeight }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        maxToRenderPerBatch={5}
        windowSize={7}
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

      {/* Update Modal - bottom sheet style */}
      <Modal visible={showUpdateModal} transparent animationType="fade" onRequestClose={() => setShowUpdateModal(false)} statusBarTranslucent>
        <View style={{ flex: 1 }}>
          <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setShowUpdateModal(false)} />
          <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10, overflow: 'hidden' }}>
              {/* Handle */}
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
              </View>

              <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                <Text variant="body" weight="bold" align="center" style={{ marginBottom: 16 }}>Обновление приложения</Text>
                
                {/* Progress bar */}
                <View style={{ height: 6, backgroundColor: theme.colors.border.light, borderRadius: 3, marginBottom: 12, overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${Math.min(updateProgress, 100)}%`, backgroundColor: theme.colors.accent.primary, borderRadius: 3 }} />
                </View>
                
                <Text variant="caption" color={theme.colors.text.secondary} align="center" style={{ marginBottom: 4 }}>
                  {updateMessage || 'Ожидание...'}
                </Text>
                <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginBottom: 16 }}>
                  {Math.round(updateProgress)}%
                </Text>

                {updateStatus === 'ready' && (
                  <Pressable onPress={applyUpdate} style={{ backgroundColor: theme.colors.accent.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}>
                    <Text variant="body" weight="semibold" color="#FFFFFF">Перезапустить</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </View>
      </Modal>
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
