import React, { useEffect, useCallback, useState, useRef } from 'react';
import { View, FlatList, RefreshControl, Pressable, StyleSheet, ActivityIndicator, Modal, InteractionManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { PostCard } from '../../src/components/feed/PostCard';
import { prefetchImages } from '../../src/components/ui/CachedImage';
import { PostMenuModal } from '../../src/components/feed/PostMenuModal';
import { useFeedStore, useAuthStore } from '../../src/store';
import { useNotificationsBadge } from '../../src/store/notificationsBadgeStore';
import { Post } from '../../src/types';
import { getPosts, isRepost, parseImageUrls, isImageSpoiler, toggleLike as apiToggleLike, supabase } from '../../src/lib/supabase';
import { useUpdateStore } from '../../src/store/updateStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { useConnectivityStore } from '../../src/services/connectivityMonitor';
import { resetThrottle, shouldSync } from '../../src/services/syncThrottle';
import { accountKey } from '../../src/services/cacheService';
import { kvGetJSONSync, kvSetJSON } from '../../src/services/kvStore';
import { updateFeedWidget } from '../../src/services/widgetBridge';
import { useWidgetSettingsStore } from '../../src/store/widgetSettingsStore';
import { queueMutation } from '../../src/services/offlineQueue';
import { useT } from '../../src/i18n/store';

const FEED_CACHE_KEY = '@san:feed_posts';
const FEED_LIMIT = 20;

// Tiny presence-only component that watches the unread-notifications count
// and renders a subtle pill on the bell icon. Lives outside FeedScreen so it
// re-renders independently when the count changes — the parent feed screen
// doesn't need to re-flow on every bell update.
function NotificationBellBadge({ accent, bg }: { accent: string; bg: string }) {
  const unread = useNotificationsBadge((s) => s.unread);
  const recompute = useNotificationsBadge((s) => s.recompute);
  // Recompute on tab focus so the count refreshes whenever the user lands
  // back on the home tab — picks up any new notifications written to the
  // cache by the notifications screen since the last visit.
  useFocusEffect(useCallback(() => { recompute(); return () => {}; }, [recompute]));
  if (unread <= 0) return null;
  const label = unread > 99 ? '99+' : String(unread);
  return (
    <View
      style={{
        position: 'absolute',
        // Anchor to the top-right of the bell. minWidth+padding lets the
        // pill grow naturally for 2- and 3-digit counts.
        top: -6,
        right: -10,
        minWidth: 16,
        height: 16,
        paddingHorizontal: 4,
        borderRadius: 8,
        backgroundColor: accent,
        alignItems: 'center',
        justifyContent: 'center',
        // 2-px border in the surrounding background colour creates a tiny
        // gap between the pill and the bell, so the badge stays readable
        // when the bell is tinted darker (matches the iOS Notification
        // Center bell convention).
        borderWidth: 2,
        borderColor: bg,
      }}
    >
      <Text variant="caption" weight="bold" color="#FFFFFF" style={{ fontSize: 10, lineHeight: 12 }}>{label}</Text>
    </View>
  );
}

function FeedHeader() {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40 }}>
      <Text style={{ fontSize: 40 }}>📝</Text>
      <Text variant="body" weight="semibold" style={{ marginTop: 12 }}>{t('feed.empty')}</Text>
      <Text variant="caption" color={theme.colors.text.secondary} align="center" style={{ marginTop: 4, paddingHorizontal: 32 }}>
        {t('feed.empty_hint')}
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
  const spoiler = isImageSpoiler(p.image_url);
  const profileData = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;

  let post: Post = {
    id: p.id,
    authorId: p.author_id,
    authorName: profileData?.display_name || 'User',
    authorUsername: profileData?.username || 'user',
    authorEmoji: profileData?.emoji || '😊',
    authorBadge: profileData?.badge || undefined,
    authorVerified: profileData?.is_verified || false,
    content: repostInfo.isRepost ? (repostInfo.comment || '') : (p.content || ''),
    imageUrl: parsedImages[0] || undefined,
    imageUrls: parsedImages.length > 0 ? parsedImages : undefined,
    isSpoilerImage: spoiler,
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
    // Follow the repost chain to find the actual original (non-repost) post
    let origId: string | undefined = repostInfo.originalPostId;
    let orig = postsById[origId];
    const maxDepth = 10; // prevent infinite loops
    let depth = 0;
    while (orig && depth < maxDepth) {
      const origRepostInfo = isRepost(orig.content || '');
      if (origRepostInfo.isRepost && origRepostInfo.originalPostId && postsById[origRepostInfo.originalPostId]) {
        // This "original" is itself a repost — follow the chain
        origId = origRepostInfo.originalPostId;
        orig = postsById[origId];
        depth++;
      } else {
        break; // Found the actual original (or chain ends here)
      }
    }

    if (orig) {
      const origProfile = Array.isArray(orig.profiles) ? orig.profiles[0] : orig.profiles;
      const origImages = parseImageUrls(orig.image_url);
      const origRepostCheck = isRepost(orig.content || '');
      post.originalPost = {
        id: orig.id,
        authorName: origProfile?.display_name || 'User',
        authorUsername: origProfile?.username || 'user',
        authorEmoji: origProfile?.emoji || '😊',
        authorBadge: origProfile?.badge || undefined,
        authorVerified: origProfile?.is_verified || false,
        content: origRepostCheck.isRepost ? (origRepostCheck.comment || '') : (orig.content || ''),
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
  const t = useT();
  // Subscribe field-by-field — pulling the whole user object from useAuthStore
  // re-renders the entire feed screen on any unrelated profile change.
  const userId = useAuthStore((s) => s.user?.id);
  const isRefreshing = useFeedStore((s) => s.isRefreshing);
  const setRefreshing = useFeedStore((s) => s.setRefreshing);
  // Hydrate the feed SYNCHRONOUSLY from MMKV on the very first render so the list
  // paints with content immediately — no empty→fill flicker, instant offline.
  const [posts, setPosts] = useState<Post[]>(() => {
    try { return kvGetJSONSync<Post[]>(FEED_CACHE_KEY, []); } catch { return []; }
  });
  const [menuPost, setMenuPost] = useState<Post | null>(null);

  // Keep the iOS home-screen widget in sync with the latest feed (no-op on Android
  // or when the native widget module isn't in the build yet).
  // Deferred via InteractionManager so it never blocks the frame when switching
  // tabs or when new posts arrive — keeps navigation buttery on weak devices.
  useEffect(() => {
    if (posts.length === 0) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      // Warm the image cache for the first screenful so scrolling is instant.
      prefetchImages(posts.slice(0, 12).flatMap((p) => [p.imageUrl, ...(p.imageUrls || []), p.originalPost?.imageUrl]));
      const { postCount } = useWidgetSettingsStore.getState();
      updateFeedWidget(posts.map((p) => ({
        id: p.id,
        authorName: p.authorName,
        authorEmoji: p.authorEmoji,
        authorVerified: p.authorVerified,
        content: p.content,
        imageUrl: p.imageUrl,
        imageUrls: p.imageUrls,
      })), postCount);
    });
    return () => handle.cancel();
  }, [posts]);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isLoading, setIsLoading] = useState(() => {
    try { return kvGetJSONSync<Post[]>(FEED_CACHE_KEY, []).length === 0; } catch { return true; }
  });
  const hasFetched = useRef(false);

  // Subscribe to update store fields individually so the feed screen doesn't
  // re-render on every progress tick of an OTA download.
  const updateStatus = useUpdateStore((s) => s.status);
  const updateProgress = useUpdateStore((s) => s.progress);
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate);
  const applyUpdate = useUpdateStore((s) => s.applyUpdate);
  const isOnline = useConnectivityStore((s) => s.isOnline);

  // Reload from cache when tab gains focus (picks up new posts from create screen).
  // Synchronous MMKV read deferred via InteractionManager so the tab-switch frame
  // is never blocked — keeps navigation buttery on weak devices.
  useFocusEffect(
    useCallback(() => {
      const handle = InteractionManager.runAfterInteractions(() => {
        try {
          const parsed = kvGetJSONSync<Post[]>(FEED_CACHE_KEY, []);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPosts(parsed);
            setIsLoading(false);
          }
        } catch {}
      });
      return () => handle.cancel();
    }, [])
  );

  // On first mount: posts are already hydrated synchronously from MMKV above, so
  // there's nothing to load from cache here. Just make sure the spinner is hidden
  // when we already have data.
  useEffect(() => {
    if (posts.length > 0) setIsLoading(false);
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
    const t = setTimeout(() => setIsLoading(false), 1500);
    return () => clearTimeout(t);
  }, []);

  const loadFeed = useCallback(async () => {
    try {
      // Throttle gate: skip network if recently synced (cache stays on screen)
      if (!(await shouldSync('feed'))) {
        setIsLoading(false);
        return;
      }
      const { posts: rawPosts, error } = await getPosts(FEED_LIMIT, 0);
      if (error || !rawPosts) {
        // Network error: preserve existing store data, hide loading
        setIsLoading(false);
        return;
      }

      const postsById: Record<string, any> = {};
      for (const p of rawPosts) postsById[p.id] = p;

      // Collect all referenced original post IDs that are not in this batch
      const missingIds = new Set<string>();
      for (const p of rawPosts) {
        const ri = isRepost(p.content || '');
        if (ri.isRepost && ri.originalPostId && !postsById[ri.originalPostId]) {
          missingIds.add(ri.originalPostId);
        }
      }

      // Fetch missing referenced posts (with profiles) for repost chain resolution
      if (missingIds.size > 0) {
        const { data: missingPosts } = await supabase.from('posts').select('*, profiles:author_id (display_name, username, emoji, badge, is_verified)').in('id', Array.from(missingIds));
        if (missingPosts) {
          for (const mp of missingPosts) {
            postsById[mp.id] = mp;
            // Also check if this post is itself a repost needing resolution
            const mri = isRepost(mp.content || '');
            if (mri.isRepost && mri.originalPostId && !postsById[mri.originalPostId]) {
              missingIds.add(mri.originalPostId);
            }
          }
          // Second pass: fetch any newly discovered missing IDs (one level deeper)
          const newMissing = Array.from(missingIds).filter(id => !postsById[id]);
          if (newMissing.length > 0) {
            const { data: deepPosts } = await supabase.from('posts').select('*, profiles:author_id (display_name, username, emoji, badge, is_verified)').in('id', newMissing);
            if (deepPosts) {
              for (const dp of deepPosts) postsById[dp.id] = dp;
            }
          }
        }
      }

      const mapped: Post[] = [];
      for (const p of rawPosts) {
        const post = mapRawPost(p, postsById);
        if (post) mapped.push(post);
      }

      // Write to Zustand store (primary data source)
      setPosts(mapped);
      setIsLoading(false);

      // Save to cache (MMKV sync mirror + AsyncStorage), non-blocking.
      kvSetJSON(FEED_CACHE_KEY, mapped);
      AsyncStorage.setItem(accountKey(FEED_CACHE_KEY), JSON.stringify(mapped)).catch(() => {});
    } catch {
      // Network error: preserve existing store data, hide loading/refreshing
      setIsLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    resetThrottle('feed');
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

      // Resolve repost chains - fetch missing referenced posts
      const missingIds = new Set<string>();
      for (const p of rawPosts) {
        const ri = isRepost(p.content || '');
        if (ri.isRepost && ri.originalPostId && !postsById[ri.originalPostId]) {
          missingIds.add(ri.originalPostId);
        }
      }
      if (missingIds.size > 0) {
        const { data: missingPosts } = await supabase.from('posts').select('*, profiles:author_id (display_name, username, emoji, badge, is_verified)').in('id', Array.from(missingIds));
        if (missingPosts) {
          for (const mp of missingPosts) {
            postsById[mp.id] = mp;
            const mri = isRepost(mp.content || '');
            if (mri.isRepost && mri.originalPostId && !postsById[mri.originalPostId]) missingIds.add(mri.originalPostId);
          }
          const newMissing = Array.from(missingIds).filter(id => !postsById[id]);
          if (newMissing.length > 0) {
            const { data: deepPosts } = await supabase.from('posts').select('*, profiles:author_id (display_name, username, emoji, badge, is_verified)').in('id', newMissing);
            if (deepPosts) { for (const dp of deepPosts) postsById[dp.id] = dp; }
          }
        }
      }

      const mapped: Post[] = [];
      for (const p of rawPosts) {
        const post = mapRawPost(p, postsById);
        if (post) mapped.push(post);
      }

      // Update store with fresh data
      setPosts(mapped);
      // Save to cache (MMKV sync mirror + AsyncStorage), non-blocking.
      kvSetJSON(FEED_CACHE_KEY, mapped);
      AsyncStorage.setItem(accountKey(FEED_CACHE_KEY), JSON.stringify(mapped)).catch(() => {});
    } catch {
      // Network error: preserve existing data from store
    }
    setRefreshing(false);
  }, [setPosts, setRefreshing]);

  const handleToggleLike = useCallback((postId: string) => {
    if (!userId) return;
    // Optimistic update locally
    setPosts(prev => prev.map(p =>
      p.id === postId ? { ...p, isLiked: !p.isLiked, likesCount: p.isLiked ? p.likesCount - 1 : p.likesCount + 1 } : p
    ));
    // Send to server (fire and forget)
    apiToggleLike(userId, postId).catch(() => {});
  }, [userId]);

  // Stable callbacks for PostCard so its React.memo isn't busted by new function
  // references on every render of FeedScreen.
  const handleComment = useCallback((postId: string) => {
    router.push({ pathname: '/comments/[id]', params: { id: postId } });
  }, []);

  const handleFollow = useCallback((targetUserId: string) => {
    triggerHaptic('medium');
    queueMutation('follow', { followerId: userId, followingId: targetUserId });
  }, [userId]);

  const handleShare = useCallback((postId: string) => {
    if (!userId) return;
    triggerHaptic('medium');
    useFeedStore.getState().setPendingRepost(postId);
    router.push('/(tabs)/create');
  }, [userId]);

  const handleMenu = useCallback((post: Post) => {
    setMenuPost(post);
  }, []);

  const renderPost = useCallback(({ item }: { item: Post }) => (
    <View>
      <PostCard
        post={item}
        currentUserId={userId}
        onComment={handleComment}
        onLike={handleToggleLike}
        onFollow={handleFollow}
        onShare={handleShare}
        onMenu={handleMenu}
      />
    </View>
  ), [userId, handleComment, handleToggleLike, handleFollow, handleShare, handleMenu]);

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
            <Pressable onPress={() => router.push('/notifications')} style={{ position: 'relative' }}>
              <Feather name="bell" size={22} color={theme.colors.text.primary} />
              <NotificationBellBadge accent={theme.colors.accent.primary} bg={theme.colors.background.primary} />
            </Pressable>
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
            {!isOnline && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,59,48,0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                <ActivityIndicator size={10} color="#FF3B30" />
                <Text variant="caption" color="#FF3B30" style={{ fontSize: 10 }}>{t('feed.offline')}</Text>
              </View>
            )}
            {(updateStatus === 'checking' || updateStatus === 'downloading' || updateStatus === 'ready') && (
              <Pressable onPress={() => setShowUpdateModal(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.accent.primary + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                {updateStatus !== 'ready' ? <ActivityIndicator size={11} color={theme.colors.accent.primary} /> : <Feather name="check-circle" size={12} color={theme.colors.accent.primary} />}
                <Text variant="caption" color={theme.colors.accent.primary} style={{ fontSize: 11 }}>{updateStatus === 'ready' ? t('feed.update_ready') : `${Math.round(updateProgress)}%`}</Text>
              </Pressable>
            )}
          </View>
          <Pressable onPress={() => router.push('/notifications')} style={{ position: 'relative' }}>
            <Feather name="bell" size={22} color={theme.colors.text.primary} />
            <NotificationBellBadge accent={theme.colors.accent.primary} bg={theme.colors.background.primary} />
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
        removeClippedSubviews={true}
        initialNumToRender={6}
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
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}><View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} /></View>
              <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                <Text variant="body" weight="bold" align="center" style={{ marginBottom: 16 }}>{t('feed.update_title')}</Text>
                <View style={{ height: 6, backgroundColor: theme.colors.border.light, borderRadius: 3, marginBottom: 12, overflow: 'hidden' }}><View style={{ height: '100%', width: `${Math.min(updateProgress, 100)}%`, backgroundColor: theme.colors.accent.primary, borderRadius: 3 }} /></View>
                <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginBottom: 16 }}>{Math.round(updateProgress)}%</Text>
                {updateStatus === 'ready' && (<Pressable onPress={applyUpdate} style={{ backgroundColor: theme.colors.accent.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}><Text variant="body" weight="semibold" color="#FFFFFF">{t('feed.update_restart')}</Text></Pressable>)}
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
