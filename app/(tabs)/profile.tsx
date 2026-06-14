import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Pressable, ActivityIndicator, Dimensions, Image, Animated, Modal, Share, Alert, RefreshControl, ScrollView, InteractionManager } from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { LinkedText } from '../../src/components/ui/LinkedText';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { FormattedText } from '../../src/components/ui/FormattedText';
import { LinkPreview } from '../../src/components/ui/LinkPreview';
import { EmojiPattern } from '../../src/components/ui/EmojiPattern';
import { LiquidGlassAvatarRing } from '../../src/components/ui/LiquidGlassAvatarRing';
import { ProfilePostCard } from '../../src/components/profile/ProfilePostCard';
import { useProfileAppearanceStore } from '../../src/store/profileAppearanceStore';
import { extractFirstUrl } from '../../src/services/linkPreview';
import { kvGetJSONSync, kvSetJSON } from '../../src/services/kvStore';
import { AccountSwitcher } from '../../src/components/ui/AccountSwitcher';
import { PostContextMenu } from '../../src/components/ui/PostContextMenu';
import { SwipeablePostCard } from '../../src/components/ui/SwipeablePostCard';
import { FollowsListModal, FollowsListMode } from '../../src/components/profile/FollowsListModal';
import { showToast } from '../../src/store/toastStore';
import { useContextMenuGuard } from '../../src/hooks/useContextMenuGuard';
import { useAuthStore } from '../../src/store';
import { useFeedStore } from '../../src/store/feedStore';
import { isRepost, parseImageUrls, getFollowCounts, supabase, deletePost } from '../../src/lib/supabase';
import { openUrl } from '../../src/utils/openUrl';
import { Post } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';
import { formatTimeAgo } from '../../src/utils/mockData';
import { accountKey } from '../../src/services/cacheService';
import { shouldSync, resetThrottle } from '../../src/services/syncThrottle';
import { useT } from '../../src/i18n/store';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { parseBannerTransform, stripBannerTransform } from '../../src/utils/bannerTransform';

const SCREEN_WIDTH = Dimensions.get('window').width;
const MY_POSTS_CACHE_KEY = '@san:my_posts';
type TabName = 'posts' | 'replies' | 'media' | 'likes';

function detectLinkType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('github.com')) return 'github';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
  if (lower.includes('instagram.com')) return 'instagram';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('t.me') || lower.includes('telegram.me')) return 'telegram';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('linkedin.com')) return 'linkedin';
  if (lower.includes('discord.gg') || lower.includes('discord.com')) return 'discord';
  if (lower.includes('twitch.tv')) return 'twitch';
  if (lower.includes('spotify.com')) return 'spotify';
  if (lower.includes('reddit.com')) return 'reddit';
  if (lower.includes('vk.com')) return 'vk';
  return 'website';
}

function SocialLinkIcon({ type, url }: { type: string; url: string }) {
  const theme = useTheme();
  const brandIcons: Record<string, { name: string; color: string; isBrand: boolean }> = {
    github: { name: 'github', color: theme.isDark ? '#FFFFFF' : '#333333', isBrand: true },
    twitter: { name: 'twitter', color: '#1DA1F2', isBrand: true },
    instagram: { name: 'instagram', color: '#E4405F', isBrand: true },
    youtube: { name: 'youtube', color: '#FF0000', isBrand: true },
    telegram: { name: 'telegram-plane', color: '#0088CC', isBrand: true },
    linkedin: { name: 'linkedin-in', color: '#0A66C2', isBrand: true },
    twitch: { name: 'twitch', color: '#9146FF', isBrand: true },
    spotify: { name: 'spotify', color: '#1DB954', isBrand: true },
    tiktok: { name: 'tiktok', color: theme.isDark ? '#FFFFFF' : '#000000', isBrand: true },
    discord: { name: 'discord', color: '#5865F2', isBrand: true },
    website: { name: 'globe', color: '#2563EB', isBrand: false },
  };
  const detected = detectLinkType(url);
  const icon = brandIcons[detected] || brandIcons[type] || brandIcons.website;
  return (
    <Pressable onPress={() => { triggerHaptic('light'); openUrl(url); }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: icon.color + '18', alignItems: 'center', justifyContent: 'center' }}>
      {icon.isBrand ? <FontAwesome5 name={icon.name} size={13} color={icon.color} brand /> : <Feather name={icon.name as any} size={13} color={icon.color} />}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Mount-time marker — opens-the-profile-tab freezes are extremely common
  // (large image fan-out, long FlatList batches), so this is one of the
  // primary surfaces the user wants to attribute. Skipped at the call site
  // when the monitor is off so we don't pay Date.now() + the function hop
  // on the cold tab-focus frame.
  const mountStart = useRef(Date.now()).current;
  // Fire ONCE on first mount. Reading `perfMonitorEnabled` from the store at
  // effect-time (not via subscription) means a later toggle doesn't re-fire
  // this with a stale `mountStart` — that bug was producing fake 3-minute
  // mount durations whenever perfMonitor flipped after first paint.
  useEffect(() => {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    perfMonitor.markScreenMount('(tabs)/profile', Date.now() - mountStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Selectors over destructuring — pulling the whole user object re-rendered
  // the profile screen on every unrelated profile field change (badge sync, etc.)
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  // Individual selectors avoid re-rendering this screen on every unrelated
  // change to the feed store (e.g., feed list updates, refresh flag flips).
  const userPosts = useFeedStore((s) => s.profilePosts);
  const setProfilePosts = useFeedStore((s) => s.setProfilePosts);
  const profileScrollOffset = useFeedStore((s) => s.profileScrollOffset);
  const setProfileScrollOffset = useFeedStore((s) => s.setProfileScrollOffset);
  const postEmoji = useProfileAppearanceStore((s) => s.postEmoji);
  // Virtualization is now handled by Animated.FlatList — no manual windowing
  // needed. Tab tap stays snappy via the `postsReady` gating below.
  // Posts cards are heavier (gesture handlers + images). Gate their mount one
  // frame after the tab activates so the tab highlight switches instantly and
  // the heavy mount happens off the tap's critical path (no perceived freeze).
  // Start FALSE so the first paint of the profile screen carries only the
  // header, and the post cards mount once the navigation transition into
  // this screen has completed (via InteractionManager). That single frame
  // of breathing room is enough to keep the JS thread clear during the
  // open animation, which was the source of `SLOW ui<30 @ (tabs)/profile`.
  const [postsReady, setPostsReady] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      setPostsReady(true);
    });
    return () => handle.cancel();
  }, []);
  // Heavy iOS chrome — `expo-blur` BlurView (×3 on this screen) and the
  // banner CachedImage — must NOT mount on the same commit as the post
  // cards. BlurView spins up a CALayer with a backdrop filter and the
  // banner kicks off a network fetch + decode; landing all of that on
  // the same frame as `postsReady` flipping was the dominant cause of
  // the UI thread dropping to ~32 fps on the cold-open scroll (the user
  // saw it as "~1 second hang"). Stagger chromeReady ONE RAF AFTER
  // postsReady so the post cards commit on one frame and the heavy
  // chrome commits on the next — no single frame carries both storms.
  const [chromeReady, setChromeReady] = useState(false);
  useEffect(() => {
    if (!postsReady) return;
    const handle = requestAnimationFrame(() => setChromeReady(true));
    return () => cancelAnimationFrame(handle);
  }, [postsReady]);
  const [activeTab, setActiveTab] = useState<TabName>('posts');
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [showQR, setShowQR] = useState(false);
  // Followers / Following list modal — opens when the user taps the
  // counters in the profile header. `null` means the modal is closed.
  const [followsModal, setFollowsModal] = useState<FollowsListMode | null>(null);
  const [viewingImage, setViewingImage] = useState<{ uri: string; postId: string; allImages?: string[] } | null>(null);
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false);
  const { target: contextPost, open: openContextMenu, close: closeContextMenu } = useContextMenuGuard<any>();

  // Sync badge/is_verified from DB on mount (in case it changed via admin panel)
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('profiles').select('badge, is_verified').eq('id', user.id).single().then(({ data }) => {
      if (data && (data.badge !== user.badge || data.is_verified !== user.is_verified)) {
        updateProfile({ badge: data.badge || undefined, is_verified: data.is_verified || false });
      }
    }).catch(() => {});
  }, [user?.id]);
  const [refreshing, setRefreshing] = useState(false);
  const hasFetched = useRef(false);
  const scrollViewRef = useRef<any>(null);
  const hasRestoredScroll = useRef(false);

  // 1. On mount: if store is empty, hydrate from MMKV synchronously.
  // Reading ~50 cached posts takes ~1-2ms — well under one frame budget —
  // so we do NOT defer this through InteractionManager. Deferring meant
  // the profile tab mounted EMPTY, the navigation transition played for
  // ~300 ms over an empty screen, then `runAfterInteractions` finally
  // fired and the cache materialized. That ~300 ms empty-tab gap was
  // exactly the "freeze" users saw on cold-open → profile tab → scroll.
  // Running the MMKV read on the same commit as mount means the FlatList
  // sees real posts on the very first render, with zero empty-tab gap.
  useEffect(() => {
    if (userPosts.length > 0) return; // Store already has data — show instantly
    try {
      const parsed = kvGetJSONSync<any[]>(MY_POSTS_CACHE_KEY, []);
      if (Array.isArray(parsed) && parsed.length > 0) setProfilePosts(parsed);
    } catch {}
  }, []);

  // 2. Fetch fresh data once (if not already fetched). Defer until after
  // interactions so we never compete with the navigation transition.
  useEffect(() => {
    if (hasFetched.current || !user?.id) return;
    hasFetched.current = true;
    const handle = InteractionManager.runAfterInteractions(() => {
      loadMyPosts();
      loadFollows();
    });
    return () => handle.cancel();
  }, [user?.id]);

  const loadMyPosts = useCallback(async () => {
    if (!user?.id) return;
    try {
      // Throttle gate: skip network if recently synced (cache stays on screen)
      if (!(await shouldSync('my_posts'))) return;
      // Cap at 50 (was 100). The user almost never scrolls past the first
      // window-and-a-half of cards before bouncing off the tab; the second
      // half of the previous 100-item haul was paying for repost-chain
      // resolution + JSON.stringify into MMKV without ever being seen.
      // Cutting the working set in half halves the post-response sync work
      // — exactly the work that was landing as the 1311 ms long task users
      // saw 5–6 s after the profile tab opened (Supabase response → 100×
      // regex+map+chain-walk → setProfilePosts → FlatList reconcile).
      const { data } = await supabase.from('posts').select('*').eq('author_id', user.id).order('created_at', { ascending: false }).limit(50);
      if (!data) return;

      // Collect original post IDs from reposts
      const originalPostIds: string[] = [];
      for (const p of data) {
        const repostInfo = isRepost(p.content || '');
        if (repostInfo.isRepost && repostInfo.originalPostId) {
          originalPostIds.push(repostInfo.originalPostId);
        }
      }

      // Fetch original posts for reposts (with author profiles)
      let originalsMap: Record<string, any> = {};
      if (originalPostIds.length > 0) {
        const { data: originals } = await supabase.from('posts').select('*, profiles:author_id (display_name, username, emoji, badge, is_verified)').in('id', originalPostIds);
        if (originals) {
          for (const o of originals) {
            originalsMap[o.id] = o;
          }
          // Check if any originals are themselves reposts — fetch deeper
          const deeperIds: string[] = [];
          for (const o of originals) {
            const oRepost = isRepost(o.content || '');
            if (oRepost.isRepost && oRepost.originalPostId && !originalsMap[oRepost.originalPostId]) {
              deeperIds.push(oRepost.originalPostId);
            }
          }
          if (deeperIds.length > 0) {
            const { data: deepPosts } = await supabase.from('posts').select('*, profiles:author_id (display_name, username, emoji, badge, is_verified)').in('id', deeperIds);
            if (deepPosts) {
              for (const dp of deepPosts) originalsMap[dp.id] = dp;
            }
          }
        }
      }

      // Map posts in two halves with a microtask yield in between. The
      // previous 100-item single-pass map ran ~120–250 ms of synchronous
      // regex+parse work on a slow device, and that was the dominant cost
      // of the 1311 ms long task the perf monitor flagged 5–6 s after the
      // profile tab opened (response from Supabase → big map → setState
      // → FlatList reconcile, all on one frame). Yielding once between
      // halves lets the JS thread service any pending input/animation
      // frame so no single block exceeds ~120 ms.
      const buildPost = (p: any): Post => {
        const repostInfo = isRepost(p.content || '');
        const parsedImages = parseImageUrls(p.image_url);
        const post: Post = { id: p.id, authorId: p.author_id, authorName: user.displayName || '', authorUsername: user.username || '', authorEmoji: user.emoji || '😊', content: repostInfo.isRepost ? (repostInfo.comment || '') : (p.content || ''), imageUrl: parsedImages[0] || undefined, imageUrls: parsedImages.length > 0 ? parsedImages : undefined, likesCount: p.likes_count || 0, commentsCount: p.comments_count || 0, sharesCount: p.shares_count || 0, isLiked: false, isBookmarked: false, createdAt: p.created_at, isRepost: repostInfo.isRepost };

        // Attach original post data for reposts — follow chain to actual original
        if (repostInfo.isRepost && repostInfo.originalPostId && originalsMap[repostInfo.originalPostId]) {
          let orig = originalsMap[repostInfo.originalPostId];
          // Follow repost chain to find actual original content
          const maxDepth = 10;
          let depth = 0;
          while (orig && depth < maxDepth) {
            const origRepostInfo = isRepost(orig.content || '');
            if (origRepostInfo.isRepost && origRepostInfo.originalPostId && originalsMap[origRepostInfo.originalPostId]) {
              orig = originalsMap[origRepostInfo.originalPostId];
              depth++;
            } else {
              break;
            }
          }
          const origProfile = Array.isArray(orig.profiles) ? orig.profiles[0] : orig.profiles;
          const origImages = parseImageUrls(orig.image_url);
          const origRepostCheck = isRepost(orig.content || '');
          post.originalPost = {
            id: orig.id,
            authorName: origProfile?.display_name || 'User',
            authorUsername: origProfile?.username || 'user',
            authorEmoji: origProfile?.emoji || '😊',
            content: origRepostCheck.isRepost ? (origRepostCheck.comment || '') : (orig.content || ''),
            imageUrl: origImages[0] || undefined,
            imageUrls: origImages.length > 0 ? origImages : undefined,
          };
        }

        return post;
      };

      // Map posts in small chunks with a macrotask yield between each so
      // no single chunk exceeds the 60 ms long-task threshold. Previous
      // 2-half approach left each half at ~25 posts × ~5ms = ~125ms,
      // still big enough to register as a long task on slow devices and
      // freeze scroll for a frame. Chunks of 5 keep each batch at
      // ~25-30ms — comfortably below the threshold even with
      // repost-chain walking on top.
      const CHUNK_SIZE = 5;
      const mapped: Post[] = [];
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, i + CHUNK_SIZE).map(buildPost);
        mapped.push(...chunk);
        // Yield to the macrotask queue so any queued input/animation
        // frame can run between chunks. A microtask
        // (await Promise.resolve()) does NOT split the task boundary —
        // microtasks drain inside the current macrotask. setTimeout(0)
        // hands back to the event loop, breaking the synchronous burst
        // that previously landed as a 123ms+ long task while the user
        // was scrolling through profile.
        if (i + CHUNK_SIZE < data.length) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      setProfilePosts(mapped);
      // Persist the snapshot AFTER the next interaction window so the
      // JSON.stringify of ~100 posts (15–40 KB) doesn't pile up on the same
      // RAF as `setProfilePosts` reconciliation. That stringify on the
      // synchronous path was the residual ~130 ms long task users saw a
      // few seconds after re-entering the profile tab. The cache stays
      // correct because nothing else reads it before the next paint.
      InteractionManager.runAfterInteractions(() => {
        kvSetJSON(MY_POSTS_CACHE_KEY, mapped);
      });
    } catch {}
  }, [user?.id]);

  const loadFollows = useCallback(async () => {
    if (!user?.id) return;
    try { const counts = await getFollowCounts(user.id); setFollowCounts(counts); } catch {}
  }, [user?.id]);

  // Restore scroll position when tab regains focus. We deliberately do NOT
  // bypass the throttle here anymore — refetching ~100 posts + walking them
  // through the repost-resolution map runs ~150-200 ms of synchronous JS,
  // and that landed as the long task users saw whenever they swung back to
  // the profile tab from settings or any other screen. Pull-to-refresh
  // (handleRefresh) already calls `resetThrottle('my_posts')` so the user
  // has a deterministic way to force-fresh. Newly-published posts show up
  // through the create-post flow's direct store push, not through this
  // focus-driven sync.
  useFocusEffect(
    useCallback(() => {
      if (profileScrollOffset > 0 && scrollViewRef.current && !hasRestoredScroll.current) {
        // Small delay to ensure layout is ready
        const timer = setTimeout(() => {
          (scrollViewRef.current as any)?.scrollTo({ y: profileScrollOffset, animated: false });
        }, 50);
        hasRestoredScroll.current = true;
        // Throttled background sync — only fires if `shouldSync('my_posts')`
        // returns true (i.e. last sync was more than 5 min ago).
        const refreshHandle = InteractionManager.runAfterInteractions(() => {
          loadMyPosts();
        });
        return () => {
          clearTimeout(timer);
          refreshHandle.cancel();
        };
      }
      hasRestoredScroll.current = false;
      // Same throttled refresh for the no-scroll-restore path.
      const refreshHandle = InteractionManager.runAfterInteractions(() => {
        loadMyPosts();
      });
      return () => refreshHandle.cancel();
    }, [profileScrollOffset, loadMyPosts])
  );

  // Stable callbacks for the memoized post card so reference equality holds.
  const handlePostLongPress = useCallback((p: any) => {
    openContextMenu(p);
  }, [openContextMenu]);

  const handlePostImagePress = useCallback((uri: string, postId: string, allImages: string[]) => {
    setViewingImage({ uri, postId, allImages });
  }, []);

  // Stable FlatList accessors. Inline lambdas for `renderItem` and
  // `keyExtractor` made FlatList rebuild its internal cell-renderer
  // wrapper on every parent re-render — so a single setProfilePosts
  // (which fires after the Supabase response) was enough to ripple a
  // re-evaluation through every visible cell, even though
  // ProfilePostCard's memo would later short-circuit. Hoisting them
  // keeps the FlatList virtualization path stable and confines the
  // setProfilePosts work to the items whose props actually changed.
  const keyExtractorPost = useCallback((item: any) => item.id, []);
  // The card needs author identity values, but those are stable across
  // the life of this screen for the user's OWN profile (only their auth
  // store can mutate them). Read once into a ref-like memo so the
  // renderItem closure stays stable across ListHeader-driven re-renders.
  const cardAuthorName = user?.displayName || '';
  const cardAuthorEmoji = user?.emoji || '😊';
  const cardAuthorVerified = user?.is_verified;
  const cardAuthorBadge = user?.badge;
  const renderPostItem = useCallback(
    ({ item }: { item: any }) => (
      <ProfilePostCard
        post={item}
        authorName={cardAuthorName}
        authorEmoji={cardAuthorEmoji}
        authorVerified={cardAuthorVerified}
        authorBadge={cardAuthorBadge}
        shareText={`${cardAuthorName}: ${item.content || ''}\nhttps://san-m-app.com/post/${item.id}`}
        postEmoji={postEmoji}
        onLongPress={handlePostLongPress}
        onImagePress={handlePostImagePress}
      />
    ),
    [cardAuthorName, cardAuthorEmoji, cardAuthorVerified, cardAuthorBadge, postEmoji, handlePostLongPress, handlePostImagePress],
  );

  // Pull-to-refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    resetThrottle('my_posts');
    await loadMyPosts();
    await loadFollows();
    setRefreshing(false);
  }, [loadMyPosts, loadFollows]);

  // Animated values for the scroll-based header. Created once and memoized so
  // each interpolation is allocated only one node instead of one-per-render.
  // Declared BEFORE any conditional returns to keep hook order stable.
  const scrollY = useRef(new Animated.Value(0)).current;
  const headerOpacity = useMemo(
    () => scrollY.interpolate({ inputRange: [0, 50, 120], outputRange: [0, 0, 1], extrapolate: 'clamp' }),
    [scrollY],
  );
  const buttonsTranslateX = useMemo(
    () => scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, -60], extrapolate: 'clamp' }),
    [scrollY],
  );
  const settingsTranslateX = useMemo(
    () => scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, 60], extrapolate: 'clamp' }),
    [scrollY],
  );
  // Center-header stats (Following / Followers pills) — fade out as the
  // banner scrolls off-screen. Same gating pattern as the side buttons:
  // visible while the banner dominates the viewport, gone before the
  // chrome gradient + (later) sticky title would collide with them.
  const centerStatsOpacity = useMemo(
    () => scrollY.interpolate({ inputRange: [0, 80, 160], outputRange: [1, 1, 0], extrapolate: 'clamp' }),
    [scrollY],
  );

  if (!user) return <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={theme.colors.accent.primary} /></View>;

  const userLinks: { type: string; url: string }[] = (user as any).links || [];
  const bannerUrlRaw = (user as any)?.bannerUrl as string | undefined;
  // Banner URL is stored with an optional `#x=&y=&s=` hash carrying the
  // user-chosen position + zoom. The hash must be stripped before the
  // value goes through the image proxy (it would be percent-encoded into
  // the proxy URL and never reach the upstream as a fragment).
  const bannerUrl = stripBannerTransform(bannerUrlRaw) || undefined;
  const bannerTransform = parseBannerTransform(bannerUrlRaw);
  const tabs: { key: TabName; label: string }[] = [{ key: 'posts', label: t('profile.posts') }, { key: 'replies', label: t('profile.replies') }, { key: 'media', label: t('profile.media') }, { key: 'likes', label: t('profile.likes') }];
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://san-m-app.com/profile/${user.id}`)}`;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, height: insets.top + 50, opacity: headerOpacity }} pointerEvents="none">
        <LinearGradient colors={[theme.colors.background.primary, theme.colors.background.primary, theme.colors.background.primary + '00']} locations={[0, 0.6, 1]} style={{ flex: 1 }} />
      </Animated.View>
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 100 }}>
        <Animated.View style={{ transform: [{ translateX: buttonsTranslateX }] }}><Pressable onPress={() => { triggerHaptic('light'); setShowQR(true); }} style={{ borderRadius: 17, overflow: 'hidden' }}>{chromeReady ? (<BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}><FontAwesome5 name="qrcode" size={15} color="#FFFFFF" /></BlurView>) : (<View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}><FontAwesome5 name="qrcode" size={15} color="#FFFFFF" /></View>)}</Pressable></Animated.View>
        {/* Compact follow stats live in the centre of the top bar in the
            redesigned layout — counters used to sit in a row under the
            avatar (Twitter-clone-style); pulling them up here clears the
            content area for a centered bio + social-icons block and
            keeps the stats within thumb reach without scrolling. Fades
            with `centerStatsOpacity` on scroll so it doesn't fight the
            sticky-title gradient that fades in at scrollY ≈ 50–120. */}
        <Animated.View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: centerStatsOpacity }}>
          <Pressable
            onPress={() => { triggerHaptic('selection'); setFollowsModal('following'); }}
            hitSlop={6}
            style={{ borderRadius: 14, overflow: 'hidden' }}
          >
            {chromeReady ? (
              <BlurView intensity={80} tint="dark" style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text variant="caption" weight="bold" color="#FFFFFF" style={{ fontSize: 12 }}>{followCounts.following}</Text>
                <Text variant="caption" color="rgba(255,255,255,0.85)" style={{ fontSize: 11 }}>{t('profile.following_short')}</Text>
              </BlurView>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.4)' }}>
                <Text variant="caption" weight="bold" color="#FFFFFF" style={{ fontSize: 12 }}>{followCounts.following}</Text>
                <Text variant="caption" color="rgba(255,255,255,0.85)" style={{ fontSize: 11 }}>{t('profile.following_short')}</Text>
              </View>
            )}
          </Pressable>
          <Pressable
            onPress={() => { triggerHaptic('selection'); setFollowsModal('followers'); }}
            hitSlop={6}
            style={{ borderRadius: 14, overflow: 'hidden' }}
          >
            {chromeReady ? (
              <BlurView intensity={80} tint="dark" style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text variant="caption" weight="bold" color="#FFFFFF" style={{ fontSize: 12 }}>{followCounts.followers}</Text>
                <Text variant="caption" color="rgba(255,255,255,0.85)" style={{ fontSize: 11 }}>{t('profile.followers_short')}</Text>
              </BlurView>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.4)' }}>
                <Text variant="caption" weight="bold" color="#FFFFFF" style={{ fontSize: 12 }}>{followCounts.followers}</Text>
                <Text variant="caption" color="rgba(255,255,255,0.85)" style={{ fontSize: 11 }}>{t('profile.followers_short')}</Text>
              </View>
            )}
          </Pressable>
        </Animated.View>
        <Animated.View style={{ transform: [{ translateX: settingsTranslateX }] }}><Pressable onPress={() => { triggerHaptic('light'); router.push('/settings'); }} style={{ borderRadius: 17, overflow: 'hidden' }}>{chromeReady ? (<BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}><Feather name="settings" size={16} color="#FFFFFF" /></BlurView>) : (<View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}><Feather name="settings" size={16} color="#FFFFFF" /></View>)}</Pressable></Animated.View>
      </View>
      <Animated.FlatList
        ref={scrollViewRef}
        data={activeTab === 'posts' && postsReady ? userPosts : []}
        keyExtractor={keyExtractorPost}
        renderItem={renderPostItem}
        // Virtualization tuned for weak Android / iPhone 12. The earlier
        // 6/4/7 numbers still let an 18-card profile mount the whole first
        // window inside ~300 ms, which slammed the JS thread into a SLOW
        // ui<30 every time. Tightened further to 3/1/4 so at most ONE card
        // mounts per frame off-screen — even when the perf monitor sees
        // an 18 ms peak card mount, that single mount can fit inside a
        // RAF without stealing time from a swipe gesture. The user can
        // briefly see empty space at the bottom while flicking fast,
        // but no stutter — a strict win on weak devices.
        initialNumToRender={2}
        maxToRenderPerBatch={1}
        windowSize={3}
        updateCellsBatchingPeriod={100}
        removeClippedSubviews={true}
        showsVerticalScrollIndicator={false}
        bounces={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 100, paddingHorizontal: 16, paddingTop: 12 }}
        ListHeaderComponent={(
          <>
            {/* Banner — 300 (was 240): user wanted more banner real estate
                so the image reads as a substantial surface, not a strip.
                The lower fade gradient grew with it (140 / 48) so the
                white name pill reads cleanly regardless of banner content
                and the avatar's circular border eases into the content
                area below. The `transform` on the image applies the
                user-chosen position + zoom from the URL hash; identity
                transform for legacy banners means existing data renders
                unchanged. */}
            <View style={{ height: 300, marginHorizontal: -16, marginTop: -12, backgroundColor: theme.colors.accent.primary + '20', overflow: 'hidden' }}>
              {bannerUrl && chromeReady ? (
                <CachedImage
                  uri={bannerUrl}
                  style={{
                    width: '100%',
                    height: '100%',
                    transform: [
                      { translateX: bannerTransform.translateX },
                      { translateY: bannerTransform.translateY },
                      { scale: bannerTransform.scale },
                    ],
                  }}
                  resizeMode="cover"
                  // Taller banner needs a higher source resolution so iOS
                  // doesn't upscale-blur it. 1080 covers the widest iPhone
                  // we target at 3× DPR with cover-fit headroom for pan/zoom.
                  proxyWidth={1080}
                />
              ) : null}
              <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)']} locations={[0.4, 1]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 140 }} pointerEvents="none" />
              {/* Soft fade into screen background — extended to 48 so the
                  taller banner eases organically into content and the
                  avatar's circular border blends in. */}
              <LinearGradient colors={['transparent', theme.colors.background.primary]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 48 }} pointerEvents="none" />
            </View>
            {/* Horizontal identity row — @username on the LEFT, avatar in
                the CENTER, display name + badges on the RIGHT. Sits ON the
                banner's lower-fade region (marginTop: -120 lifts the row
                deep into the banner; that single negative margin pulls
                ALL downstream content up too — edit pill, bio, links,
                tabs, posts ride higher with no extra changes). flex:1 on
                each side keeps the avatar geometrically centered no matter
                the side-text widths; numberOfLines={1} truncates instead
                of pushing the avatar off-axis. White text + textShadow on
                top of the dark gradient for legibility (no BlurView —
                chrome budget, see chromeReady). The avatar wrapper stays
                a Pressable so tapping it still opens the account switcher. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: -140, paddingHorizontal: 8 }}>
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  textAlign: 'right',
                  fontSize: 13,
                  color: 'rgba(255,255,255,0.92)',
                  textShadowColor: 'rgba(0,0,0,0.6)',
                  textShadowOffset: { width: 0, height: 1 },
                  textShadowRadius: 3,
                  marginRight: 12,
                }}
              >
                @{user.username}
              </Text>
              <Pressable onPress={() => setShowAccountSwitcher(true)}>
                <LiquidGlassAvatarRing emoji={user.emoji} size={80} />
              </Pressable>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 12 }}>
                <Text
                  variant="body"
                  weight="bold"
                  numberOfLines={1}
                  style={{
                    flexShrink: 1,
                    fontSize: 15,
                    color: '#FFFFFF',
                    textShadowColor: 'rgba(0,0,0,0.6)',
                    textShadowOffset: { width: 0, height: 1 },
                    textShadowRadius: 3,
                  }}
                >
                  {user.displayName}
                </Text>
                {user.is_verified && <VerifiedBadge size={13} />}
                {user.badge && <UserBadge badge={user.badge} size="sm" />}
              </View>
            </View>
            {/* Bio + social link icons — both centered. Counters used to
                live here in a 3-text row; they now live in the top header
                pills above so this block stays tight and visually clean. */}
            {(user.bio || userLinks.length > 0) && (
              <View style={{ marginTop: 12, alignItems: 'center', paddingHorizontal: 8 }}>
                {user.bio ? (
                  <LinkedText
                    style={{
                      textAlign: 'center',
                      color: theme.colors.text.secondary,
                    }}
                  >
                    {user.bio}
                  </LinkedText>
                ) : null}
                {userLinks.length > 0 && (
                  <View style={{ flexDirection: 'row', marginTop: user.bio ? 10 : 0, gap: 8, justifyContent: 'center' }}>
                    {userLinks.map((link, idx) => <SocialLinkIcon key={idx} type={link.type} url={link.url} />)}
                  </View>
                )}
              </View>
            )}
            <View style={{ marginTop: 16, marginHorizontal: -16, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
              <View style={{ flexDirection: 'row' }}>{tabs.map((tab) => (<Pressable key={tab.key} onPress={() => { triggerHaptic('selection'); if (tab.key === 'posts') { setPostsReady(false); requestAnimationFrame(() => setActiveTab('posts')); setTimeout(() => setPostsReady(true), 16); } else { setActiveTab(tab.key); } }} style={{ flex: 1, alignItems: 'center', paddingVertical: 11 }}><Text variant="caption" weight={activeTab === tab.key ? 'bold' : 'regular'} color={activeTab === tab.key ? theme.colors.text.primary : theme.colors.text.tertiary}>{tab.label}</Text></Pressable>))}</View>
              <View style={{ position: 'absolute', bottom: 0, height: 2, backgroundColor: theme.colors.accent.primary, width: SCREEN_WIDTH / 4, left: tabs.findIndex(t => t.key === activeTab) * (SCREEN_WIDTH / 4) }} />
            </View>
            {/* Match the previous 12px gap between tabs and the first post. */}
            <View style={{ height: 12 }} />
          </>
        )}
        ListEmptyComponent={(
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Text variant="caption" color={theme.colors.text.tertiary}>
              {activeTab === 'posts' ? t('profile.no_posts') : t('profile.empty_section')}
            </Text>
          </View>
        )}
      />
      <Modal visible={showQR} transparent animationType="fade" onRequestClose={() => setShowQR(false)} statusBarTranslucent>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' }} onPress={() => setShowQR(false)}>
          <Text variant="body" weight="bold" color="#FFFFFF" style={{ marginBottom: 20 }}>{t('profile.qr_title')}</Text>
          <View style={{ backgroundColor: '#FFF', borderRadius: 20, padding: 20 }}><Image source={{ uri: qrUrl }} style={{ width: 200, height: 200 }} resizeMode="contain" /></View>
          <Text variant="caption" color="#FFFFFF" style={{ marginTop: 20, opacity: 0.7 }}>{t('profile.qr_close_hint')}</Text>
        </Pressable>
      </Modal>

      {/* Fullscreen Image Viewer */}
      <Modal visible={!!viewingImage} transparent animationType="none" onRequestClose={() => setViewingImage(null)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }}>
          {/* Top bar with gradient blur */}
          <LinearGradient colors={['rgba(0,0,0,0.8)', 'rgba(0,0,0,0.5)', 'transparent']} locations={[0, 0.6, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 80, zIndex: 10 }}>
            <View style={{ position: 'absolute', top: insets.top + 12, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              {/* Author info — show original author for reposts */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {(() => {
                  const post = userPosts.find(p => p.id === viewingImage?.postId);
                  const isRepostViewing = post?.isRepost && post?.originalPost;
                  const displayEmoji = isRepostViewing ? (post.originalPost?.authorEmoji || '😊') : (user?.emoji || '😊');
                  const displayName = isRepostViewing ? post.originalPost?.authorName : user?.displayName;
                  return (
                    <>
                      <Avatar emoji={displayEmoji} size="xs" />
                      <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                          <Text variant="caption" weight="semibold" color="#FFFFFF" style={{ fontSize: 11 }}>{displayName}</Text>
                          {user?.is_verified && <VerifiedBadge size={10} />}
                        </View>
                        {isRepostViewing && <Text variant="caption" color="rgba(255,255,255,0.5)" numberOfLines={1} style={{ fontSize: 9 }}>{t('profile.repost_from', undefined, { name: user?.displayName || '' })}</Text>}
                        {!isRepostViewing && viewingImage && <Text variant="caption" color="rgba(255,255,255,0.6)" style={{ fontSize: 9 }}>{formatTimeAgo(post?.createdAt || '')}</Text>}
                      </View>
                    </>
                  );
                })()}
              </View>
              {/* Close */}
              <Pressable onPress={() => setViewingImage(null)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="x" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
          </LinearGradient>
          {/* Image — full width, zoomable + horizontal scroll for multi-image */}
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            {viewingImage && (
              viewingImage.allImages && viewingImage.allImages.length > 1 ? (
                <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center' }}>
                  {viewingImage.allImages.map((imgUri, idx) => (
                    <ScrollView key={idx} maximumZoomScale={3} minimumZoomScale={1} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ justifyContent: 'center', alignItems: 'center', width: SCREEN_WIDTH, height: '100%' }} centerContent bouncesZoom>
                      <CachedImage uri={imgUri} style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH }} resizeMode="contain" />
                    </ScrollView>
                  ))}
                </ScrollView>
              ) : (
                <ScrollView maximumZoomScale={3} minimumZoomScale={1} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ justifyContent: 'center', alignItems: 'center', flex: 1 }} centerContent bouncesZoom>
                  <CachedImage uri={viewingImage.uri} style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH }} resizeMode="contain" />
                </ScrollView>
              )
            )}
          </View>
          {/* Description (if exists) — for reposts, fall back to the original post's content */}
          {viewingImage && (() => {
            const post = userPosts.find(p => p.id === viewingImage.postId);
            const caption = post?.content || (post as any)?.originalPost?.content || '';
            return caption ? (
              <ScrollView style={{ maxHeight: 60, marginHorizontal: 24, marginBottom: 8 }} showsVerticalScrollIndicator={false}>
                <Text variant="caption" color="rgba(255,255,255,0.8)" style={{ fontSize: 12 }}>{caption}</Text>
              </ScrollView>
            ) : null;
          })()}
          {/* Bottom actions — compact rounded container, centered */}
          <View style={{ alignItems: 'center', paddingBottom: insets.bottom + 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 28, paddingHorizontal: 24, paddingVertical: 12 }}>
              <Pressable onPress={() => { const ep = userPosts.find(p => p.id === viewingImage!.postId); setViewingImage(null); useFeedStore.getState().setEditingPost({ id: viewingImage!.postId, content: ep?.content || '', imageUrl: ep?.imageUrl, imageUrls: ep?.imageUrls && ep.imageUrls.length > 0 ? ep.imageUrls : (ep?.imageUrl ? [ep.imageUrl] : undefined) }); router.push('/(tabs)/create'); }} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="edit-2" size={17} color="#FFFFFF" />
              </Pressable>
              <Pressable onPress={async () => { if (viewingImage) { const ep = userPosts.find(p => p.id === viewingImage.postId); const { shareImageUrl } = require('../../src/utils/sharePost'); await shareImageUrl(viewingImage.uri, ep?.content); } }} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="share" size={17} color="#FFFFFF" />
              </Pressable>
              <Pressable onPress={() => { if (viewingImage && user?.id) { Alert.alert(t('profile.delete_post_title'), t('profile.delete_post_msg'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.delete'), style: 'destructive', onPress: async () => { await deletePost(viewingImage.postId, user.id); setViewingImage(null); loadMyPosts(); } }]); } }} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,60,50,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="trash-2" size={17} color="#FF3B30" />
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <AccountSwitcher visible={showAccountSwitcher} onClose={() => setShowAccountSwitcher(false)} />
      <PostContextMenu visible={!!contextPost} post={contextPost} isOwnPost={true} onClose={closeContextMenu} onDelete={async (postId) => { if (user?.id) { await deletePost(postId, user.id); useFeedStore.getState().removePost(postId); loadMyPosts(); showToast(t('toast.post_deleted'), 'trash-2'); } }} />
      <FollowsListModal visible={!!followsModal} mode={followsModal || 'followers'} userId={user?.id || null} onClose={() => setFollowsModal(null)} />
    </View>
  );
}
