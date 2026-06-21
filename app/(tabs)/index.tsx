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
import { HERO_IMG_WIDTH } from '../../src/components/feed/PostCard';
import { prefetchImages } from '../../src/components/ui/CachedImage';
import { PostMenuModal } from '../../src/components/feed/PostMenuModal';
import { useFeedStore, useAuthStore, useEntityStore } from '../../src/store';
import { useNotificationsBadge } from '../../src/store/notificationsBadgeStore';
import { Post } from '../../src/types';
import { getPosts, isRepost, parseImageUrls, isImageSpoiler, toggleLike as apiToggleLike } from '../../src/lib/supabase';
import { useUpdateStore } from '../../src/store/updateStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { useConnectivityStore } from '../../src/services/connectivityMonitor';
import { resetThrottle, shouldSync } from '../../src/services/syncThrottle';
import { accountKey } from '../../src/services/cacheService';
import { kvGetJSONSync, kvGetStringSync, kvSetJSON } from '../../src/services/kvStore';
import { updateFeedWidget } from '../../src/services/widgetBridge';
import { useWidgetSettingsStore } from '../../src/store/widgetSettingsStore';
import { queueMutation } from '../../src/services/offlineQueue';
import { useT } from '../../src/i18n/store';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { PixelIcon } from '../../src/components/pixel-icons/PixelIcon';
import { FadingBlurHeader, isFadingBlurAvailable } from '../../src/components/ui/FadingBlurHeader';

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

// Cheap content-equality check between two Post arrays.
//
// Used to short-circuit `setPosts` when the server (or the cached payload
// the focus-effect just parsed) returned data that is content-identical to
// what's already in state. Without this, every `loadFeed` / `handleRefresh`
// network response — even when nothing changed — replaces the array with
// fresh object references, busting `PostCard`'s `React.memo` and forcing
// every visible card to reconcile. On a 100-post feed with 6 visible cards
// that reconciliation is the dominant cost behind the residual
// `SLOW long task @ (tabs)` markers (~150–170 ms on weak devices).
//
// Excludes `isLiked` / `isBookmarked` because the server-side `mapRawPost`
// always defaults those to `false`, while local optimistic `handleToggleLike`
// flips them on top of state. Comparing those would treat every refresh as
// "changed" even when nothing on the server actually moved.
function postsShallowEqual(a: Post[], b: Post[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (
      x.id !== y.id ||
      x.content !== y.content ||
      x.imageUrl !== y.imageUrl ||
      x.likesCount !== y.likesCount ||
      x.commentsCount !== y.commentsCount ||
      x.sharesCount !== y.sharesCount ||
      x.isSpoilerImage !== y.isSpoilerImage ||
      (x.originalPost?.id) !== (y.originalPost?.id) ||
      (x.originalPost?.content) !== (y.originalPost?.content)
    ) {
      return false;
    }
  }
  return true;
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
  // Mount-time marker — feed open is the first impression on cold start, so
  // any time spent here is highly user-visible. Skipped at the call site too
  // when the perf monitor is off so we don't pay the Date.now() + function
  // hop on the cold-start frame.
  const mountStart = useRef(Date.now()).current;
  // Fire ONCE on first mount, regardless of whether perfMonitor was on or
  // off at that moment. Reading `perfMonitorEnabled` from the store at
  // effect-time means a later toggle doesn't re-fire this effect with the
  // long-stale `mountStart` (which was producing fake 3-minute durations
  // in the snapshot panel). Empty deps + lazy store read = correct semantics.
  useEffect(() => {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    perfMonitor.markScreenMount('(tabs)/index', Date.now() - mountStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Subscribe field-by-field — pulling the whole user object from useAuthStore
  // re-renders the entire feed screen on any unrelated profile change.
  const userId = useAuthStore((s) => s.user?.id);
  const isRefreshing = useFeedStore((s) => s.isRefreshing);
  const setRefreshing = useFeedStore((s) => s.setRefreshing);
  // Hydrate the feed from MMKV. We do TWO reads:
  //
  // 1. A tiny synchronous peek (just the first 8 posts) on first render so
  //    the list isn't blank for a frame. Reading 8 entries from the cache is
  //    a few KB of JSON.parse — cheap.
  // 2. The full hydrate happens after `runAfterInteractions` below, so a
  //    100-post cache parse never lands on the navigation-transition frame.
  //    That synchronous full parse was the dominant cost in the
  //    `SLOW long task @ (tabs)` markers users were seeing.
  const [posts, setPosts] = useState<Post[]>(() => {
    try { return kvGetJSONSync<Post[]>(FEED_CACHE_KEY, []).slice(0, 8); } catch { return []; }
  });
  const [menuPost, setMenuPost] = useState<Post | null>(null);

  // Tracks the raw MMKV cache string of the last payload we loaded into
  // state. Lets the focus reload cheaply detect "nothing changed since last
  // time" and skip the parse + setPosts cascade. Without this, each return
  // to the home tab (e.g. when the user is rapidly switching between tabs)
  // would parse the entire cached feed, allocate fresh post-object
  // references, and force every visible PostCard to re-render — landing as
  // a single ~170 ms long task on the JS thread. Now we only do the work
  // when the cache has actually been updated (e.g. by a new post created
  // from the create screen, or by a fresh network sync).
  const lastFocusCacheRawRef = useRef<string | null>(null);

  // Full feed hydration — runs once after the navigation transition has
  // settled. Replaces the seeded 8-post peek with the entire cached list.
  // Deferred so the heavy parse never blocks first paint. Reads the raw
  // MMKV string and stashes it in `lastFocusCacheRawRef` so the focus
  // reload below can short-circuit the parse + setPosts when the cache
  // hasn't changed since this initial hydrate.
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      try {
        const raw = kvGetStringSync(FEED_CACHE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Post[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Always record the cache signature so the focus reload's
          // raw-equality check works even when this hydrate is a no-op.
          lastFocusCacheRawRef.current = raw;
          // Only force a re-render when the parsed list actually adds
          // posts beyond the synchronous 8-post peek AND the content
          // differs. The shallow-equality check protects against the
          // case where the seeded peek already covered everything in
          // cache — without it, this useEffect would replace the array
          // with fresh refs and bust every visible PostCard's memo.
          setPosts((prev) => {
            if (parsed.length <= prev.length) return prev;
            return postsShallowEqual(prev, parsed) ? prev : parsed;
          });
        }
      } catch {}
    });
    return () => handle.cancel();
    // Only run once on mount; the focus-effect below handles re-reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the iOS home-screen widget in sync with the latest feed (no-op on Android
  // or when the native widget module isn't in the build yet).
  // Deferred via InteractionManager so it never blocks the frame when switching
  // tabs or when new posts arrive — keeps navigation buttery on weak devices.
  //
  // We also skip the work entirely when the slice that drives the widget +
  // image prefetch hasn't actually changed. `posts` is replaced by a fresh
  // array on every like toggle (`handleToggleLike` does `prev.map`), but a
  // like flip never affects what the widget renders nor which images need
  // prefetching — without this guard the bridge call + `Image.prefetch`
  // setup would fire on every tap, contributing to the residual long task
  // users were seeing after rapid tab switches.
  const widgetSigRef = useRef<string>('');
  useEffect(() => {
    if (posts.length === 0) return;
    // Build a signature of the fields that actually feed the widget +
    // prefetch: top 12 ids + first image (for prefetch deduping) + first
    // 32 chars of content (widget shows the head of the post). Cheap to
    // compute; comparing it to the previous run is a single string compare.
    let sig = '';
    const top = Math.min(posts.length, 12);
    for (let i = 0; i < top; i++) {
      const p = posts[i];
      sig += p.id + '|' + (p.imageUrl || '') + '|' + (p.content ? p.content.slice(0, 32) : '') + '\n';
    }
    if (sig === widgetSigRef.current) return;
    widgetSigRef.current = sig;
    const handle = InteractionManager.runAfterInteractions(() => {
      // Warm the image cache for the visible viewport ONLY. Previously this
      // grabbed up to 12 posts × ~5 URLs each (`imageUrl` + `imageUrls` array
      // + repost-embed image) — up to ~60 simultaneous prefetches on the
      // native image decoder. When the user then scrolled, every new card
      // mounted by FlatList virtualization landed BEHIND those prefetches in
      // the decode queue, dropping the UI thread to ~39 fps.
      // Visible viewport on iPhone fits ~1.5-2 cards (initialNumToRender=2),
      // so 4 hero images × 1 URL each is more than enough warm-up. Reposts
      // and carousels load lazily as the user reaches them.
      const heroes: string[] = [];
      const limit = Math.min(posts.length, 4);
      for (let i = 0; i < limit; i++) {
        const u = posts[i].imageUrl || posts[i].imageUrls?.[0];
        if (u) heroes.push(u);
      }
      // Warm at the EXACT width the hero/carousel displays at (HERO_IMG_WIDTH)
      // so the warmed weserv URL shares an expo-image cache key with the real
      // mount. Warming at the old default (600 → w=1200) produced a different
      // URL than the hero displayed (w=800 via the proxy default), so every
      // "warmed" hero still cold-fetched on first paint.
      if (heroes.length > 0) prefetchImages(heroes, HERO_IMG_WIDTH);
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
  // Loading is computed off the seeded peek above. If the peek already
  // returned posts we don't show the spinner; otherwise the network fetch
  // (or the full hydrate effect above) clears it.
  const [isLoading, setIsLoading] = useState(() => posts.length === 0);
  const hasFetched = useRef(false);

  // Subscribe to update store fields individually so the feed screen doesn't
  // re-render on every progress tick of an OTA download.
  const updateStatus = useUpdateStore((s) => s.status);
  const updateProgress = useUpdateStore((s) => s.progress);
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate);
  const applyUpdate = useUpdateStore((s) => s.applyUpdate);
  const isOnline = useConnectivityStore((s) => s.isOnline);

  // Decorative pixel icon next to the "San" title — a per-device
  // preference picked from the existing pixel-icons screen with
  // `?purpose=home-header`. Subscribed field-by-field so the feed
  // doesn't re-render on unrelated settings flips.
  const homeHeaderIcon = useSettingsStore((s) => s.homeHeaderIcon);
  // Long-press only — keeps the tap unclaimed for a future
  // scroll-to-top binding. Light haptic mirrors the rest of the
  // long-press paths in the app.
  const onTitleLongPress = useCallback(() => {
    triggerHaptic('light');
    router.push('/settings/pixel-icons?purpose=home-header');
  }, []);

  // Reload from cache when tab gains focus (picks up new posts from create screen).
  // Synchronous MMKV read deferred via InteractionManager so the tab-switch frame
  // is never blocked — keeps navigation buttery on weak devices.
  //
  // Cheap signature check: read the raw MMKV string and skip the parse +
  // setPosts when the cached feed hasn't changed since the last focus
  // reload. Prevents the costly cascade of PostCard re-renders + widget-
  // bridge calls + image prefetch that piles onto a single RAF when users
  // rapidly switch tabs and return to home — the dominant cost behind
  // `SLOW long task @ (tabs)`. The cache only changes when create-post
  // writes a new entry or `loadFeed` / `handleRefresh` lands a network
  // response, so the vast majority of focus events are now no-ops.
  useFocusEffect(
    useCallback(() => {
      const handle = InteractionManager.runAfterInteractions(() => {
        try {
          const raw = kvGetStringSync(FEED_CACHE_KEY);
          if (!raw) return;
          if (raw === lastFocusCacheRawRef.current) {
            setIsLoading(false);
            return;
          }
          const parsed = JSON.parse(raw) as Post[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            lastFocusCacheRawRef.current = raw;
            // Even when the raw cache string changed (e.g. another screen
            // re-serialised the same data), only force a re-render if the
            // content actually differs from what's already on screen.
            // Without this, returning a `setPosts(parsed)` with fresh
            // object refs busts every visible PostCard's React.memo and
            // contributes to the residual long task users were seeing.
            setPosts((prev) => (postsShallowEqual(prev, parsed) ? prev : parsed));
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
        const { apiGet } = await import('../../src/services/apiClient');
        const idList = Array.from(missingIds);
        const fetched = await Promise.all(
          idList.map((mid) => apiGet<any>(`/v1/posts/${encodeURIComponent(mid)}`).then((r) => r.data).catch(() => null)),
        );
        const missingPosts = fetched.filter(Boolean) as any[];
        if (missingPosts.length > 0) {
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
            const fetched2 = await Promise.all(
              newMissing.map((nid) => apiGet<any>(`/v1/posts/${encodeURIComponent(nid)}`).then((r) => r.data).catch(() => null)),
            );
            for (const dp of fetched2) if (dp) postsById[dp.id] = dp;
          }
        }
      }

      const mapped: Post[] = [];
      for (const p of rawPosts) {
        const post = mapRawPost(p, postsById);
        if (post) mapped.push(post);
      }

      // Short-circuit when the server returned the same payload we already
      // have on screen. `setPosts(mapped)` would otherwise replace the
      // array with fresh references and force every visible PostCard's
      // `React.memo` to bust → ~150–170 ms of reconciliation on weak
      // devices, landing 2–3 s after a tab switch as the residual
      // `SLOW long task @ (tabs)` users were seeing. When content matches,
      // skip the cache rewrite too — the on-disk JSON is already current.
      let didUpdate = false;
      setPosts((prev) => {
        if (postsShallowEqual(prev, mapped)) return prev;
        didUpdate = true;
        return mapped;
      });
      setIsLoading(false);

      if (didUpdate) {
        // Defer the JSON.stringify off the response frame so it never
        // lands on the same RAF as the setPosts re-render. The cache
        // signature ref is refreshed inside the same deferred block so
        // the focus-effect's raw-equality check stays correct regardless
        // of when it observes either side.
        InteractionManager.runAfterInteractions(() => {
          kvSetJSON(FEED_CACHE_KEY, mapped);
          lastFocusCacheRawRef.current = kvGetStringSync(FEED_CACHE_KEY);
        });
      }
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
        const { apiGet } = await import('../../src/services/apiClient');
        const idList = Array.from(missingIds);
        const fetched = await Promise.all(
          idList.map((mid) => apiGet<any>(`/v1/posts/${encodeURIComponent(mid)}`).then((r) => r.data).catch(() => null)),
        );
        const missingPosts = fetched.filter(Boolean) as any[];
        if (missingPosts.length > 0) {
          for (const mp of missingPosts) {
            postsById[mp.id] = mp;
            const mri = isRepost(mp.content || '');
            if (mri.isRepost && mri.originalPostId && !postsById[mri.originalPostId]) missingIds.add(mri.originalPostId);
          }
          const newMissing = Array.from(missingIds).filter(id => !postsById[id]);
          if (newMissing.length > 0) {
            const fetched2 = await Promise.all(
              newMissing.map((nid) => apiGet<any>(`/v1/posts/${encodeURIComponent(nid)}`).then((r) => r.data).catch(() => null)),
            );
            for (const dp of fetched2) if (dp) postsById[dp.id] = dp;
          }
        }
      }

      const mapped: Post[] = [];
      for (const p of rawPosts) {
        const post = mapRawPost(p, postsById);
        if (post) mapped.push(post);
      }

      // Same short-circuit as `loadFeed`: skip the setPosts cascade and the
      // cache rewrite when the server returned content-equal data, since the
      // dominant cost is the React reconciliation of every visible PostCard
      // (their props are React.memo'd by ref). A no-op refresh now leaves
      // posts untouched and only the spinner spins down.
      let didUpdate = false;
      setPosts((prev) => {
        if (postsShallowEqual(prev, mapped)) return prev;
        didUpdate = true;
        return mapped;
      });
      if (didUpdate) {
        InteractionManager.runAfterInteractions(() => {
          kvSetJSON(FEED_CACHE_KEY, mapped);
          lastFocusCacheRawRef.current = kvGetStringSync(FEED_CACHE_KEY);
        });
      }
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
    // Toggle: if already following, unfollow; otherwise follow. Both paths
    // update the entity store optimistically inside queueMutation, so the
    // PostCard's follow icon flips immediately.
    const already = useEntityStore.getState().isFollowing(userId, targetUserId);
    queueMutation(already ? 'unfollow' : 'follow', { followerId: userId, followingId: targetUserId });
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

  // PostCard is wrapped in React.memo + carries its own per-card RAF
  // gate, so we render it directly here. The previous `<View>{...}</View>`
  // wrapper added a no-op shadow-node per cell that participated in the
  // FlatList batch's reconciliation budget without rendering any pixels.
  const renderPost = useCallback(({ item }: { item: Post }) => (
    <PostCard
      post={item}
      currentUserId={userId}
      onComment={handleComment}
      onLike={handleToggleLike}
      onFollow={handleFollow}
      onShare={handleShare}
      onMenu={handleMenu}
    />
  ), [userId, handleComment, handleToggleLike, handleFollow, handleShare, handleMenu]);

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  if (isLoading && posts.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: bgColor }}>
        <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
          {!isFadingBlurAvailable() && (
            <LinearGradient colors={[bgColor, bgColor + '80', bgTransparent]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
          )}
          <FadingBlurHeader isDark={theme.isDark} direction="down" height={insets.top + 38} fadeStart={0.5} blendColor={bgColor + '8C'} />
          <View style={[styles.headerContent, { paddingTop: insets.top }]}>
            <Pressable onLongPress={onTitleLongPress} delayLongPress={350} hitSlop={6} style={styles.titleRow}>
              {homeHeaderIcon ? <PixelIcon id={homeHeaderIcon} size={26} /> : null}
              <Text variant="subheading" weight="bold">San</Text>
            </Pressable>
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
        {!isFadingBlurAvailable() && (
          <LinearGradient colors={[bgColor, bgColor + '80', bgTransparent]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
        )}
        <FadingBlurHeader isDark={theme.isDark} direction="down" height={insets.top + 38} fadeStart={0.5} blendColor={bgColor + '8C'} />
        <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable onLongPress={onTitleLongPress} delayLongPress={350} hitSlop={6} style={styles.titleRow}>
              {homeHeaderIcon ? <PixelIcon id={homeHeaderIcon} size={26} /> : null}
              <Text variant="subheading" weight="bold">San</Text>
            </Pressable>
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
        // PostCards are heavy: each one carries up to 1+ CachedImage (or
        // a LinkPreview thumbnail), an Avatar, FormattedText, action bar,
        // and on reposts an embedded original-post block. iPhone viewport
        // fits 1.5-2 cards above the fold, so any further "off-screen"
        // mounts on cold open are paying their cost on the navigation
        // transition frame and showing up as native UI-thread dips.
        // 2/1/3 means: 2 cards on first paint (visible viewport), 1
        // card per subsequent batch, ~1 viewport cushion. Combined with
        // the lazy-hydrate latch in PostCard (placeholder first commit,
        // hydrate one RAF later), the cold-open frame's UI-thread work
        // is now ~2 placeholders × 1ms with no parallel image decodes
        // before the first paint settles.
        initialNumToRender={2}
        maxToRenderPerBatch={1}
        windowSize={3}
        // Post cards now size to their image's aspect ratio, so an image
        // finishing its decode WHILE you scroll changes that card's height.
        // Without anchoring, every such resize above the viewport shifted the
        // content offset → the "feed jerks / scrolls on its own" the user hit.
        // maintainVisibleContentPosition pins the currently-visible item so
        // height changes above it are compensated by an offset adjustment
        // instead of a visible jump.
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
