import React, { useEffect, useCallback, useState, useMemo } from 'react';
import { View, FlatList, RefreshControl, Pressable, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { PostCard } from '../../src/components/feed/PostCard';
import { PostMenuModal } from '../../src/components/feed/PostMenuModal';
import { useFeedStore, useAuthStore, useEntityStore } from '../../src/store';
import { Post } from '../../src/types';
import { isRepost, parseImageUrls } from '../../src/lib/supabase';
import { syncFeed } from '../../src/services/syncService';
import { queueMutation } from '../../src/services/offlineQueue';
import { useUpdateStore } from '../../src/store/updateStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { LocalPost } from '../../src/services/entityStore';


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

export default function FeedScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { isRefreshing, setRefreshing } = useFeedStore();
  const [menuPost, setMenuPost] = useState<Post | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Read from entity store
  const posts = useEntityStore((s) => s.posts);
  const feedIds = useEntityStore((s) => s.feedIds);
  const isHydrated = useEntityStore((s) => s.isHydrated);
  const profiles = useEntityStore((s) => s.profiles);
  const likes = useEntityStore((s) => s.likes);

  const { status: updateStatus, progress: updateProgress, message: updateMessage, checkForUpdate, applyUpdate } = useUpdateStore();

  useEffect(() => { checkForUpdate(); }, []);

  // Map LocalPost[] to Post[] using profiles from entityStore
  const mappedPosts: Post[] = useMemo(() => {
    const result: Post[] = [];
    const postsById: Record<string, LocalPost> = posts;

    for (const id of feedIds) {
      const p = postsById[id];
      if (!p) continue;

      const repostInfo = isRepost(p.content || '');
      const parsedImages = parseImageUrls(p.image_url);
      const profile = profiles[p.author_id];

      const isLiked = user?.id ? (likes[user.id] || []).includes(p.id) : false;

      let post: Post = {
        id: p.id,
        authorId: p.author_id,
        authorName: profile?.display_name || 'User',
        authorUsername: profile?.username || 'user',
        authorEmoji: profile?.emoji || '😊',
        content: repostInfo.isRepost ? (repostInfo.comment || '') : (p.content || ''),
        imageUrl: parsedImages[0] || undefined,
        imageUrls: parsedImages.length > 0 ? parsedImages : undefined,
        likesCount: p.likes_count || 0,
        commentsCount: p.comments_count || 0,
        sharesCount: p.shares_count || 0,
        isLiked,
        isBookmarked: false,
        createdAt: p.created_at,
        isRepost: repostInfo.isRepost,
      };

      if (!post.content && !post.imageUrl && !post.isRepost) continue;

      // Handle reposts — look up original post in store
      if (repostInfo.isRepost && repostInfo.originalPostId) {
        const orig = postsById[repostInfo.originalPostId];
        if (orig) {
          const origProfile = profiles[orig.author_id];
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
      result.push(post);
    }
    return result;
  }, [posts, feedIds, profiles, likes, user?.id]);

  // On mount: always trigger syncFeed (it handles errors gracefully)
  // Data is loaded once at app startup (_layout.tsx) — no need to sync here
  // Just show what's in the store immediately

  // Once hydrated and we have data (or after safety timeout), stop loading
  useEffect(() => {
    if (isHydrated && feedIds.length > 0) {
      setIsLoading(false);
    }
  }, [isHydrated, feedIds.length]);

  // 1.5-second skeleton safety timeout
  useEffect(() => { const t = setTimeout(() => setIsLoading(false), 1500); return () => clearTimeout(t); }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await syncFeed();
    setRefreshing(false);
  }, []);

  const handleToggleLike = useCallback((postId: string) => {
    if (!user?.id) return;
    const currentlyLiked = (likes[user.id] || []).includes(postId);
    // Fire and forget — don't await, let it run in background
    queueMutation('toggle_like', {
      userId: user.id,
      postId,
      liked: !currentlyLiked,
    });
  }, [user?.id, likes]);

  const renderPost = ({ item }: { item: Post }) => {
    // Show pending indicator on posts with status === 'pending'
    const localPost = posts[item.id];
    const isPending = localPost?.status === 'pending';

    return (
      <View>
        {isPending && (
          <View style={[styles.pendingBadge, { backgroundColor: theme.colors.accent.primary + '20' }]}>
            <ActivityIndicator size={10} color={theme.colors.accent.primary} />
            <Text variant="caption" color={theme.colors.accent.primary} style={{ marginLeft: 4, fontSize: 10 }}>
              Отправка...
            </Text>
          </View>
        )}
        <PostCard
          post={item}
          onComment={(postId) => router.push({ pathname: '/comments/[id]', params: { id: postId } })}
          onLike={(postId) => handleToggleLike(postId)}
          onShare={(postId) => { if (!user?.id) return; triggerHaptic('medium'); useFeedStore.getState().setPendingRepost(postId); router.push('/(tabs)/create'); }}
          onMenu={(post) => setMenuPost(post)}
        />
      </View>
    );
  };

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  if (isLoading && mappedPosts.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: bgColor }}>
        <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
          <LinearGradient colors={[bgColor, bgColor, bgTransparent]} locations={[0, 0.6, 1]} style={StyleSheet.absoluteFill} />
          <View style={[styles.headerContent, { paddingTop: insets.top }]}>
            <Text variant="subheading" weight="bold">San</Text>
            <Feather name="bell" size={22} color={theme.colors.text.primary} />
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
        data={mappedPosts}
        keyExtractor={(item) => item.id}
        renderItem={renderPost}
        ListHeaderComponent={mappedPosts.length === 0 ? FeedHeader : undefined}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.base, paddingBottom: 100, paddingTop: headerContentHeight }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        maxToRenderPerBatch={5}
        windowSize={7}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={theme.colors.accent.primary} progressViewOffset={headerContentHeight} />}
      />

      <PostMenuModal visible={!!menuPost} post={menuPost} onClose={() => setMenuPost(null)} />

      <Modal visible={showUpdateModal} transparent animationType="fade" onRequestClose={() => setShowUpdateModal(false)} statusBarTranslucent>
        <View style={{ flex: 1 }}>
          <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setShowUpdateModal(false)} />
          <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden' }}>
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
              </View>
              <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                <Text variant="body" weight="bold" align="center" style={{ marginBottom: 16 }}>Обновление</Text>
                <View style={{ height: 6, backgroundColor: theme.colors.border.light, borderRadius: 3, marginBottom: 12, overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${Math.min(updateProgress, 100)}%`, backgroundColor: theme.colors.accent.primary, borderRadius: 3 }} />
                </View>
                <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginBottom: 16 }}>{Math.round(updateProgress)}%</Text>
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
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 8 },
  pendingBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, alignSelf: 'flex-start', marginBottom: 4 },
});
