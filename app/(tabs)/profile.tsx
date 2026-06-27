import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Pressable, ActivityIndicator, Dimensions, Image, Animated, Modal, Share, Alert, ScrollView, InteractionManager, Text as RNText } from 'react-native';
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
import { ProfilePostCard } from '../../src/components/profile/ProfilePostCard';
import { UserProfilePostCard } from '../../src/components/ui/UserProfilePostCard';
import { ProfileReplyCard, ProfileReply } from '../../src/components/profile/ProfileReplyCard';
import { EditProfileTabModal } from '../../src/components/profile/EditProfileTabModal';
import { useProfileAppearanceStore } from '../../src/store/profileAppearanceStore';
import { extractFirstUrl } from '../../src/services/linkPreview';
import { kvGetJSONSync, kvSetJSON } from '../../src/services/kvStore';
import { AccountSwitcher } from '../../src/components/ui/AccountSwitcher';
import { PostContextMenu } from '../../src/components/ui/PostContextMenu';
import { FollowsListModal, FollowsListMode } from '../../src/components/profile/FollowsListModal';
import { showToast } from '../../src/store/toastStore';
import { useContextMenuGuard } from '../../src/hooks/useContextMenuGuard';
import { useAuthStore } from '../../src/store';
import { useFeedStore } from '../../src/store/feedStore';
import { isRepost, parseImageUrls, getFollowCounts, deletePost, getLikedPosts, getUserComments } from '../../src/lib/supabase';
import { openUrl } from '../../src/utils/openUrl';
import { Post } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';
import { formatTimeAgo } from '../../src/utils/mockData';
import { shouldSync, resetThrottle } from '../../src/services/syncThrottle';
import { useT } from '../../src/i18n/store';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useLiquidGlassActive, NativeGlassView } from '../../src/components/ui/LiquidGlass';
import { parseBannerTransform, stripBannerTransform } from '../../src/utils/bannerTransform';
import { useBannerBrightness } from '../../src/hooks/useBannerBrightness';
import { useScreenCaptureGuard } from '../../src/hooks/useScreenCaptureGuard';
import { ScreenshotShield } from '../../src/components/ui/ScreenshotShield';
import { HeaderSceneLayer } from '../../src/components/profile/HeaderSceneLayer';
import { HeaderBackgroundLayer } from '../../src/components/profile/HeaderBackgroundLayer';
import { getLocalScene, normalizeScene } from '../../src/services/headerScene';
import { useIsFocused } from '@react-navigation/native';
// Seasonal Profile Themes (task 6.1) — render the owner's OWN profile in the
// account's selected public theme. Background + ambient layers are SIBLINGS
// BENEATH the content (never wrap a glass view); the palette gradient shows
// through the transparent FlatList behind the glass cards.
import { resolveProfileTheme, PROFILE_THEMES_ENABLED, DEFAULT_THEME } from '../../src/theme/profileThemes';
import { ProfileThemeScope } from '../../src/components/profile/ProfileThemeScope';
import { ProfileThemeBackground } from '../../src/components/profile/ProfileThemeBackground';
import { useAmbientAnimationGate } from '../../src/hooks/useAmbientAnimationGate';
import { useActiveProfileThemeId } from '../../src/store/profileThemeStore';

const SCREEN_WIDTH = Dimensions.get('window').width;
const MY_POSTS_CACHE_KEY = '@san:my_posts';
// Per-account cache keys for the lazy-loaded "Likes" and "Replies" tabs.
// Built lazily via accountKey() so signing in/out swaps cache scopes.
const LIKED_POSTS_CACHE_PREFIX = '@san:liked_posts:';
const USER_REPLIES_CACHE_PREFIX = '@san:user_replies:';
// Truly-constant, theme-independent list values hoisted to module scope so
// they are allocated ONCE instead of re-created on every screen render. A
// fresh `contentContainerStyle` / `data` reference makes the Animated.FlatList
// re-run extra reconciliation/virtualization work on each parent re-render
// (tab switch, follow-count update, refreshing flag, viewingImage toggle…),
// even when the underlying rows are unchanged. Mirrors the same constants
// already used by app/profile/[id].tsx.
const LIST_CONTENT_CONTAINER_STYLE = { paddingBottom: 100, paddingHorizontal: 16, paddingTop: 12 } as const;
const EMPTY_LIST: any[] = [];
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

// Compact count formatter for the inline profile stats ("14.8K", "1.2M").
function formatCount(n: number): string {
  if (!n || n < 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1).replace('.0', '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace('.0', '') + 'K';
  return String(n);
}

// Labeled social-link pill (icon + platform name) for the redesigned profile
// header module — matches the Instagram/TikTok-style chips in the mockup.
function SocialChip({ url, theme }: { url: string; theme: any }) {
  const glassActive = useLiquidGlassActive();
  const type = detectLinkType(url);
  const map: Record<string, { name: string; color: string; isBrand: boolean; label: string }> = {
    github: { name: 'github', color: theme.isDark ? '#FFF' : '#333', isBrand: true, label: 'GitHub' },
    twitter: { name: 'twitter', color: '#1DA1F2', isBrand: true, label: 'Twitter' },
    instagram: { name: 'instagram', color: '#E4405F', isBrand: true, label: 'Instagram' },
    youtube: { name: 'youtube', color: '#FF0000', isBrand: true, label: 'YouTube' },
    telegram: { name: 'telegram-plane', color: '#0088CC', isBrand: true, label: 'Telegram' },
    tiktok: { name: 'tiktok', color: theme.isDark ? '#FFF' : '#000', isBrand: true, label: 'TikTok' },
    linkedin: { name: 'linkedin-in', color: '#0A66C2', isBrand: true, label: 'LinkedIn' },
    discord: { name: 'discord', color: '#5865F2', isBrand: true, label: 'Discord' },
    twitch: { name: 'twitch', color: '#9146FF', isBrand: true, label: 'Twitch' },
    spotify: { name: 'spotify', color: '#1DB954', isBrand: true, label: 'Spotify' },
    website: { name: 'globe', color: '#2563EB', isBrand: false, label: 'Сайт' },
  };
  const icon = map[type] || map.website;
  const content = (
    <>
      {icon.isBrand ? <FontAwesome5 name={icon.name} size={13} color={icon.color} brand /> : <Feather name={icon.name as any} size={13} color={icon.color} />}
      <Text variant="caption" weight="semibold">{icon.label}</Text>
    </>
  );
  if (glassActive) {
    return (
      <Pressable onPress={() => { triggerHaptic('light'); openUrl(url); }} style={{ borderRadius: 16 }}>
        <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 }}>
          {content}
        </NativeGlassView>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={() => { triggerHaptic('light'); openUrl(url); }} style={{ borderRadius: 16, overflow: 'hidden' }}>
      <BlurView intensity={70} tint={theme.isDark ? 'dark' : 'light'} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7 }}>
        {content}
      </BlurView>
    </Pressable>
  );
}

// Unified action pill — liquid glass (interactive) when enabled, else the SAME
// BlurView used for the floating chrome buttons. `accent` paints the CTA fill.
function ActionPill({ glassActive, theme, onPress, height = 38, square = false, accent = false, children }: { glassActive: boolean; theme: any; onPress: () => void; height?: number; square?: boolean; accent?: boolean; children: React.ReactNode }) {
  const radius = height / 2;
  const surface = { height, width: square ? height : undefined, paddingHorizontal: square ? 0 : 20, borderRadius: radius, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6 };
  const accentFill = theme.colors.accent.primary;
  if (glassActive) {
    return (
      <Pressable onPress={onPress} style={{ borderRadius: radius }}>
        <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} tintColor={accent ? accentFill + 'D9' : undefined} style={surface}>
          {children}
        </NativeGlassView>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} style={{ borderRadius: radius, overflow: 'hidden' }}>
      <BlurView intensity={70} tint={theme.isDark ? 'dark' : 'light'} style={surface}>
        {accent ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: accentFill + 'E6' }} /> : null}
        {children}
      </BlurView>
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
  // Own-account screenshot lock — when the owner turned it on, protect their
  // own profile view too (so the setting is consistent everywhere the account
  // appears). Android blocks capture outright; iOS flashes the 🙈 shield.
  const ownScreenshotsOff = !!(user as any)?.screenshots_disabled;
  const { screenshotDetected } = useScreenCaptureGuard(ownScreenshotsOff, 'own-profile');
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
  // Lazy-loaded secondary tab data. We don't fetch these on profile mount —
  // fetching only fires the first time the user actually flips to that tab.
  // Cache keys are per-account so account-switching invalidates instantly
  // without us tracking the switch manually (kvStore auto-namespaces).
  const [likedPosts, setLikedPosts] = useState<any[]>([]);
  const [likedLoaded, setLikedLoaded] = useState(false);
  const [likedFetching, setLikedFetching] = useState(false);
  const [userReplies, setUserReplies] = useState<ProfileReply[]>([]);
  const [repliesLoaded, setRepliesLoaded] = useState(false);
  const [repliesFetching, setRepliesFetching] = useState(false);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [showQR, setShowQR] = useState(false);
  // Native iOS-26 liquid glass for the floating QR / settings chrome buttons.
  // Active only when the user has the toggle on AND the device supports it.
  const glassActive = useLiquidGlassActive();
  // Followers / Following list modal — opens when the user taps the
  // counters in the profile header. `null` means the modal is closed.
  const [followsModal, setFollowsModal] = useState<FollowsListMode | null>(null);
  const [viewingImage, setViewingImage] = useState<{ uri: string; postId: string; allImages?: string[] } | null>(null);
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false);
  const { target: contextPost, open: openContextMenu, close: closeContextMenu } = useContextMenuGuard<any>();

  // Sync badge/is_verified from DB on mount (in case it changed via admin panel)
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      // Throttle gate (10-min, per-account): tab revisits reuse the existing
      // `user` state instead of re-hitting the profile endpoint every mount.
      if (!(await shouldSync('self_badge:' + user.id, 10 * 60 * 1000))) return;
      const { apiGet } = await import('../../src/services/apiClient');
      const { data } = await apiGet<{ badge: string | null; is_verified: boolean }>(
        `/v1/profiles/${encodeURIComponent(user.id)}`,
      );
      if (data && (data.badge !== user.badge || data.is_verified !== user.is_verified)) {
        updateProfile({ badge: data.badge || undefined, is_verified: data.is_verified || false });
      }
    })().catch(() => {});
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
      // Page size dropped from 50 to 25 as part of the egress-reduction
      // pass — the user can scroll for more via existing pagination,
      // and the first paint becomes ~half as expensive on weak devices.
      // Phase 5: routes through the Worker via apiGet.
      const { apiGet } = await import('../../src/services/apiClient');
      const { data } = await apiGet<any[]>(`/v1/profiles/${encodeURIComponent(user.id)}/posts?limit=25`);
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
        const fetched = await Promise.all(
          originalPostIds.map((oid) => apiGet<any>(`/v1/posts/${encodeURIComponent(oid)}`).then((r) => r.data).catch(() => null)),
        );
        const originals = fetched.filter(Boolean) as any[];
        if (originals.length > 0) {
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
            const deeper = await Promise.all(
              deeperIds.map((d) => apiGet<any>(`/v1/posts/${encodeURIComponent(d)}`).then((r) => r.data).catch(() => null)),
            );
            for (const dp of deeper) if (dp) originalsMap[dp.id] = dp;
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
    try {
      // Throttle gate (5-min, per-account): keep the cached `followCounts`
      // when recently synced instead of re-hitting getFollowCounts on revisit.
      if (!(await shouldSync('self_follow_counts:' + user.id, 5 * 60 * 1000))) return;
      const counts = await getFollowCounts(user.id); setFollowCounts(counts);
    } catch {}
  }, [user?.id]);

  // ─── Likes tab loader ─────────────────────────────────────────────────
  // Same chunked-build + InteractionManager-deferred persist pattern as
  // `loadMyPosts` so the JS thread doesn't carry a 50-row map in a
  // single block. Skips chain-walking on reposts of liked content for
  // now — the row renders as-is. Follow-up will resolve repost chains
  // here too.
  const loadLikedPosts = useCallback(async () => {
    if (!user?.id || likedFetching) return;
    setLikedFetching(true);
    try {
      // Synchronous MMKV warm-up so re-opening the tab paints instantly
      // even if the network round-trip hasn't returned.
      const cacheKey = LIKED_POSTS_CACHE_PREFIX + user.id;
      const cached = kvGetJSONSync<any[] | null>(cacheKey, null);
      if (Array.isArray(cached) && cached.length > 0 && likedPosts.length === 0) {
        setLikedPosts(cached);
      }

      const { posts: rows, error } = await getLikedPosts(user.id, { limit: 25 });
      if (error || !rows) {
        setLikedLoaded(true);
        return;
      }

      const buildPost = (p: any) => {
        const repostInfo = isRepost(p.content || '');
        const parsedImages = parseImageUrls(p.image_url);
        const authorProfile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
        return {
          id: p.id,
          authorId: p.author_id,
          // Per-row author info — liked posts come from any author, not
          // just the current user. The cards read these as props per
          // render so each row shows the right name + emoji.
          authorName: authorProfile?.display_name || 'User',
          authorUsername: authorProfile?.username || 'user',
          authorEmoji: authorProfile?.emoji || '😊',
          authorVerified: !!authorProfile?.is_verified,
          authorBadge: authorProfile?.badge || null,
          content: repostInfo.isRepost ? (repostInfo.comment || '') : (p.content || ''),
          imageUrl: parsedImages[0] || undefined,
          imageUrls: parsedImages.length > 0 ? parsedImages : undefined,
          likesCount: p.likes_count || 0,
          commentsCount: p.comments_count || 0,
          sharesCount: p.shares_count || 0,
          isLiked: true,
          isBookmarked: false,
          createdAt: p.created_at,
          isRepost: repostInfo.isRepost,
        };
      };

      // Chunks of 5 with macrotask yields — same as `loadMyPosts`.
      const CHUNK_SIZE = 5;
      const mapped: any[] = [];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE).map(buildPost);
        mapped.push(...chunk);
        if (i + CHUNK_SIZE < rows.length) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      setLikedPosts(mapped);
      setLikedLoaded(true);
      InteractionManager.runAfterInteractions(() => {
        try { kvSetJSON(cacheKey, mapped); } catch {}
      });
    } catch {
      setLikedLoaded(true);
    } finally {
      setLikedFetching(false);
    }
  }, [user?.id, likedFetching, likedPosts.length]);

  // ─── Replies tab loader ───────────────────────────────────────────────
  const loadUserReplies = useCallback(async () => {
    if (!user?.id || repliesFetching) return;
    setRepliesFetching(true);
    try {
      const cacheKey = USER_REPLIES_CACHE_PREFIX + user.id;
      const cached = kvGetJSONSync<ProfileReply[] | null>(cacheKey, null);
      if (Array.isArray(cached) && cached.length > 0 && userReplies.length === 0) {
        setUserReplies(cached);
      }

      const { replies: rows, error } = await getUserComments(user.id, { limit: 25 });
      if (error || !rows) {
        setRepliesLoaded(true);
        return;
      }

      // Resolve repost chains for parent posts so the preview reflects
      // the ORIGINAL post the reply is responding to (its image and the
      // text where any URL would be detected). Same approach as
      // `loadMyPosts`: collect missing IDs, batch-fetch, follow-the-chain.
      const originalIds: string[] = [];
      for (const c of rows) {
        const parent = Array.isArray(c.posts) ? c.posts[0] : c.posts;
        const text: string = parent?.content || '';
        if (text.startsWith('::repost::')) {
          const rest = text.slice('::repost::'.length);
          const sep = rest.indexOf('::');
          const oid = sep >= 0 ? rest.slice(0, sep) : rest;
          if (oid) originalIds.push(oid);
        }
      }
      const originalsMap: Record<string, any> = {};
      if (originalIds.length > 0) {
        const { apiGet } = await import('../../src/services/apiClient');
        const fetched = await Promise.all(
          originalIds.map((oid) =>
            apiGet<any>(`/v1/posts/${encodeURIComponent(oid)}`).then((r) => r.data).catch(() => null),
          ),
        );
        for (const o of fetched) if (o) originalsMap[o.id] = o;
      }

      const buildReply = (c: any): ProfileReply => {
        const parent = Array.isArray(c.posts) ? c.posts[0] : c.posts;
        const parentAuthor = parent
          ? (Array.isArray(parent.profiles) ? parent.profiles[0] : parent.profiles)
          : null;
        // Strip the repost prefix from the parent post's snippet so the
        // mini-preview shows the actual text the reply is responding to.
        // When the parent IS a repost we ALSO swap in the original
        // post's image / text for the preview row, so the user sees what
        // they actually replied to (not the repost wrapper).
        let snippetSource: string = parent?.content || '';
        let imageSource: string | null | undefined = parent?.image_url;
        if (snippetSource.startsWith('::repost::')) {
          const rest = snippetSource.slice('::repost::'.length);
          const sep = rest.indexOf('::');
          const originalId = sep >= 0 ? rest.slice(0, sep) : rest;
          const repostComment = sep >= 0 ? rest.slice(sep + 2) : '';
          const orig = originalsMap[originalId];
          if (orig) {
            // Prefer the original's body text + image; if the repost
            // carried a comment too, that's still readable inside the
            // thread itself — we only show one snippet line here.
            snippetSource = orig.content || repostComment;
            imageSource = orig.image_url || imageSource;
          } else {
            snippetSource = repostComment;
          }
        }
        let snippet = snippetSource || '';
        if (snippet.length > 80) snippet = snippet.slice(0, 80) + '…';
        const parsedImages = parseImageUrls(imageSource);
        const link = parsedImages.length === 0 ? extractFirstUrl(snippetSource) : null;
        return {
          id: c.id,
          postId: c.post_id,
          content: c.content || '',
          createdAt: c.created_at,
          parentAuthorName: parentAuthor?.display_name || 'User',
          parentAuthorEmoji: parentAuthor?.emoji || '😊',
          parentAuthorVerified: !!parentAuthor?.is_verified,
          parentSnippet: snippet,
          parentImageUrl: parsedImages[0] || undefined,
          parentImageCount: parsedImages.length,
          parentLinkUrl: link || undefined,
        };
      };

      const CHUNK_SIZE = 5;
      const mapped: ProfileReply[] = [];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE).map(buildReply);
        mapped.push(...chunk);
        if (i + CHUNK_SIZE < rows.length) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      setUserReplies(mapped);
      setRepliesLoaded(true);
      InteractionManager.runAfterInteractions(() => {
        try { kvSetJSON(cacheKey, mapped); } catch {}
      });
    } catch {
      setRepliesLoaded(true);
    } finally {
      setRepliesFetching(false);
    }
  }, [user?.id, repliesFetching, userReplies.length]);

  // Trigger lazy loaders the first time the user opens each secondary
  // tab. Deferred via InteractionManager so the tab-highlight switch
  // and the network call don't compete for the same frame.
  useEffect(() => {
    if (activeTab === 'likes' && !likedLoaded && !likedFetching && user?.id) {
      const handle = InteractionManager.runAfterInteractions(() => loadLikedPosts());
      return () => handle.cancel();
    }
    if (activeTab === 'replies' && !repliesLoaded && !repliesFetching && user?.id) {
      const handle = InteractionManager.runAfterInteractions(() => loadUserReplies());
      return () => handle.cancel();
    }
  }, [activeTab, likedLoaded, likedFetching, repliesLoaded, repliesFetching, user?.id, loadLikedPosts, loadUserReplies]);

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

  // Liked posts come from any author — render using `UserProfilePostCard`
  // so each row shows the actual author's name + emoji, not the current
  // user's. ProfilePostCard takes a single shared author and isn't fit
  // for a heterogenous-author list.
  const renderLikedItem = useCallback(
    ({ item }: { item: any }) => (
      <UserProfilePostCard
        post={item}
        authorName={item.authorName}
        authorUsername={item.authorUsername}
        authorEmoji={item.authorEmoji}
        authorVerified={item.authorVerified}
        authorBadge={item.authorBadge}
        authorId={item.authorId}
        postEmoji={postEmoji}
        onLongPress={handlePostLongPress}
        onImagePress={handlePostImagePress}
      />
    ),
    [postEmoji, handlePostLongPress, handlePostImagePress],
  );

  const renderReplyItem = useCallback(
    ({ item }: { item: ProfileReply }) => <ProfileReplyCard reply={item} />,
    [],
  );

  const keyExtractorReply = useCallback((item: ProfileReply) => item.id, []);

  // Pull-to-refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    resetThrottle('my_posts');
    // Force-fresh the throttled self-syncs too so pull-to-refresh always
    // re-pulls follow counts and the badge/verified reconcile.
    if (user?.id) {
      resetThrottle('self_follow_counts:' + user.id);
      resetThrottle('self_badge:' + user.id);
    }
    await loadMyPosts();
    await loadFollows();
    setRefreshing(false);
  }, [loadMyPosts, loadFollows, user?.id]);

  // Animated values for the scroll-based header. Created once and memoized so
  // each interpolation is allocated only one node instead of one-per-render.
  // Declared BEFORE any conditional returns to keep hook order stable.
  const scrollY = useRef(new Animated.Value(0)).current;
  const headerOpacity = useMemo(
    () => scrollY.interpolate({ inputRange: [0, 36, 210], outputRange: [0, 0, 1], extrapolate: 'clamp' }),
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
  // Pair the opacity fade-out with a subtle shrink so the pills don't
  // just dissolve in place — they tuck away as they fade. Same input
  // range so the two animations land together; output 1→1→0.7 holds
  // full size while the banner is in view, then scales down at the
  // same point the opacity starts dropping.
  const centerStatsScale = useMemo(
    () => scrollY.interpolate({ inputRange: [0, 80, 160], outputRange: [1, 1, 0.7], extrapolate: 'clamp' }),
    [scrollY],
  );
  // NOTE: a previous iteration animated the @username + display-name
  // toward the avatar on scroll (translateX + opacity). It was removed
  // — the user found the motion distracting and the dual-text colour
  // crossfade required to keep adaptive name colour smooth doubled
  // the Text-tree count for nothing visible. Identity row now stays
  // static during scroll. Pills above shrink/fade as before.

  // ─── Seasonal Profile Themes (task 6.1) ────────────────────────────────
  // The owner's own profile renders in the account's selected theme. These
  // hooks run unconditionally and BEFORE the `if (!user)` guard below so the
  // hook order stays stable across renders (the loading guard early-returns).
  const screenFocused = useIsFocused();
  // True while a drag / momentum scroll is in progress — freezes the ambient
  // particles within 100 ms and resumes within 200 ms (Req 6.2, 6.3).
  const [scrollActive, setScrollActive] = useState(false);
  // Optimistic per-account theme id wins; fall back to the persisted user row
  // (`themeId`, mapped from `theme_id`), then the resolver's default (Req 4.2).
  const activeProfileThemeId = useActiveProfileThemeId(user?.id ?? '');
  const profileThemeId = activeProfileThemeId ?? user?.themeId;
  const resolvedProfileTheme = useMemo(() => (PROFILE_THEMES_ENABLED ? resolveProfileTheme(profileThemeId) : DEFAULT_THEME), [profileThemeId]);
  const ambientGate = useAmbientAnimationGate(resolvedProfileTheme);
  // Illustration load fallback: on error / 5 s timeout drop to palette-only
  // while keeping the palette (Req 4.5). Reset when the theme changes.
  const [illustrationFailed, setIllustrationFailed] = useState(false);
  useEffect(() => { setIllustrationFailed(false); }, [profileThemeId]);
  const themeIllustration = illustrationFailed ? null : resolvedProfileTheme.backgroundIllustration;

  // ─── Pinned (sticky) category tab bar ──────────────────────────────────
  // The inline tabs row inside `listHeader` scrolls away with the banner.
  // We mirror it in an absolutely-positioned OVERLAY that reveals once the
  // user scrolls the inline row up under the top chrome, so tab switching
  // stays reachable while posts keep scrolling. All hooks here are
  // unconditional and declared BEFORE the `if (!user)` guard to keep the
  // hook order stable across renders.
  //
  // `tabsOffsetY` is the inline tabs row's offset within the scroll content
  // (captured via onLayout below, plus the content paddingTop). The pinned
  // OVERLAY is anchored flush at the very top (top: 0) and its frosted/opaque
  // backing fills the whole band down to the tab row; the pinned pills are
  // pushed down by `paddingTop: pinnedBarTop` so they sit at viewport-y
  // `pinnedBarTop` (insets.top + 8) — the SAME spot the inline row reaches
  // when `scrollY === tabsOffsetY - pinnedBarTop`. That equality IS the reveal
  // threshold, so the handoff is pixel-aligned with no empty gap above the bar.
  const pinnedBarTop = insets.top + 8;
  const [tabsOffsetY, setTabsOffsetY] = useState(0);
  const tabsOffsetYRef = useRef(0);
  const [pinnedTabsVisible, setPinnedTabsVisible] = useState(false);
  const pinnedTabsVisibleRef = useRef(false);
  const onTabsRowLayout = useCallback((e: any) => {
    // onLayout `y` is relative to the FlatList header container, which sits
    // below the content paddingTop (12). Add it back to recover the absolute
    // scroll-content offset at which the tabs row begins.
    const y = 12 + (e?.nativeEvent?.layout?.y ?? 0);
    if (Math.abs(y - tabsOffsetYRef.current) > 0.5) {
      tabsOffsetYRef.current = y;
      setTabsOffsetY(y);
    }
  }, []);
  // Native-driven reveal: opacity + a small downward slide. Recomputed only
  // when the measured offset changes (rare), so per-frame scrolling never
  // touches the JS thread — the interpolation runs entirely on the native side.
  // Until the row is measured (`tabsOffsetY` still <= the pin position) we push
  // the reveal point out of reach so the bar stays hidden on first paint.
  const pinnedTabsOpacity = useMemo(() => {
    const end = tabsOffsetY > pinnedBarTop ? tabsOffsetY - pinnedBarTop : Number.MAX_SAFE_INTEGER;
    const start = Math.max(0, end - 24);
    return scrollY.interpolate({ inputRange: [start, end], outputRange: [0, 1], extrapolate: 'clamp' });
  }, [scrollY, tabsOffsetY, pinnedBarTop]);
  const pinnedTabsTranslateY = useMemo(() => {
    const end = tabsOffsetY > pinnedBarTop ? tabsOffsetY - pinnedBarTop : Number.MAX_SAFE_INTEGER;
    const start = Math.max(0, end - 24);
    return scrollY.interpolate({ inputRange: [start, end], outputRange: [-8, 0], extrapolate: 'clamp' });
  }, [scrollY, tabsOffsetY, pinnedBarTop]);
  // Gate tappability to when the bar is actually visible. A single listener
  // flips a boolean ONLY when scrollY crosses the threshold (compared against
  // a ref), so we never setState on every scroll frame. Removed on unmount,
  // re-created when the measured offset changes.
  useEffect(() => {
    const threshold = tabsOffsetY > pinnedBarTop ? tabsOffsetY - pinnedBarTop : Number.MAX_SAFE_INTEGER;
    const id = scrollY.addListener(({ value }: { value: number }) => {
      const shouldShow = value >= threshold;
      if (shouldShow !== pinnedTabsVisibleRef.current) {
        pinnedTabsVisibleRef.current = shouldShow;
        setPinnedTabsVisible(shouldShow);
      }
    });
    return () => scrollY.removeListener(id);
  }, [scrollY, tabsOffsetY, pinnedBarTop]);

  if (!user) return <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={theme.colors.accent.primary} /></View>;

  const userLinks = useMemo<{ type: string; url: string }[]>(() => (user as any)?.links || [], [user]);
  // "Build-your-own" header decorations. Prefer the in-memory user value (set
  // right after editing), else the locally-cached scene (instant on cold start).
  const ownScene = useMemo(() => {
    const s = normalizeScene((user as any)?.headerScene);
    return s.items.length > 0 ? s : getLocalScene(user?.id);
  }, [user]);
  const bannerUrlRaw = (user as any)?.bannerUrl as string | undefined;
  // Banner URL is stored with an optional `#x=&y=&s=` hash carrying the
  // user-chosen position + zoom. The hash must be stripped before the
  // value goes through the image proxy (it would be percent-encoded into
  // the proxy URL and never reach the upstream as a fragment).
  const bannerUrl = stripBannerTransform(bannerUrlRaw) || undefined;
  // Memoize the parsed transform — the banner image style array is read
  // by both the JSX below and the ListHeader useMemo's dep list, so we
  // need a stable object reference that only changes when the raw URL
  // changes. Without this, every render recomputes a fresh
  // {translateX, translateY, scale} object and busts the ListHeader memo.
  const bannerTransform = useMemo(() => parseBannerTransform(bannerUrlRaw), [bannerUrlRaw]);
  // Adaptive name + @username colour — when the banner reads as light,
  // we render dark text; when it reads as dark (or unknown), we keep
  // the white-with-shadow legacy look.
  const { isLight: bannerIsLight } = useBannerBrightness(bannerUrl);
  // Tabs labels depend on the i18n `t` function. The result is content-
  // stable per locale; memoize so the ListHeader memo doesn't see a fresh
  // array on every render.
  // Each entry now also carries `defaultLabel` (the unmodified i18n
  // string). The displayed `label` merges any user customization from the
  // settings store — `customLabel || defaultLabel`. The optional `emoji`
  // is rendered as a small text node before the label.
  const profileTabsCustom = useSettingsStore((s) => s.profileTabsCustom);
  const tabs = useMemo<{ key: TabName; label: string; defaultLabel: string; emoji?: string }[]>(
    () => {
      const defaults: { key: TabName; defaultLabel: string }[] = [
        { key: 'posts', defaultLabel: t('profile.posts') },
        { key: 'replies', defaultLabel: t('profile.replies') },
        { key: 'media', defaultLabel: t('profile.media') },
        { key: 'likes', defaultLabel: t('profile.likes') },
      ];
      return defaults.map((d) => {
        const c = profileTabsCustom[d.key];
        return {
          key: d.key,
          defaultLabel: d.defaultLabel,
          label: c?.label || d.defaultLabel,
          emoji: c?.emoji,
        };
      });
    },
    [t, profileTabsCustom],
  );
  // Long-press tab editor state. `editingTabKey` is the tab currently being
  // customised; `null` means the modal is closed. Set + clear go through
  // the store so the change persists across launches.
  const [editingTabKey, setEditingTabKey] = useState<TabName | null>(null);
  const setProfileTabCustom = useSettingsStore((s) => s.setProfileTabCustom);
  const clearProfileTabCustom = useSettingsStore((s) => s.clearProfileTabCustom);
  const editingTabEntry = editingTabKey ? tabs.find((tt) => tt.key === editingTabKey) : null;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://san-m-app.com/profile/${user.id}`)}`;

  // ─── ListHeaderComponent — memoized ────────────────────────────────────
  // Why memoize: FlatList passes the JSX through untouched, so React still
  // reconciles every child of the header on every parent re-render. The
  // header carries a CachedImage banner, a BlurView avatar wrapper, and
  // two AdaptiveProfileText labels — when state unrelated to the header
  // changes (likedFetching, repliesFetching, viewingImage, refreshing,
  // etc.) the reconciler walks all of those subtrees for nothing.
  // Caching the JSX value short-circuits the walk at the header root.
  //
  // Dominant cost previously: dual-Text adaptive-colour crossfade (now
  // single Text) + reconciliation of the three BlurView pills above on
  // every state flip. Tab-switch flash (the user's "data reloads" report)
  // came from `setPostsReady(false)` clearing `data` for ~16 ms during
  // tab taps; that gate was removed above.
  const bannerHeader = useMemo(() => (
    <View style={{ marginHorizontal: -16, marginTop: -12, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}>
      {/* Custom cover photo as the module backdrop (the seasonal theme gradient
          already fills the screen behind this module). */}
      {bannerUrl && chromeReady ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
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
            proxyWidth={SCREEN_WIDTH}
            skeleton
          />
          <LinearGradient
            colors={[theme.colors.background.primary + '00', theme.colors.background.primary + '55']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            pointerEvents="none"
          />
        </View>
      ) : null}
      {/* (Frosted overlay moved to the END of the card so it covers the
          content too — see below, just before the card closes.) */}

      {/* User-chosen background gradient — card backdrop, above any cover photo
          but below the identity content. */}
      <HeaderBackgroundLayer backgroundId={ownScene.background} drawing={ownScene.drawing} hasBanner={!!bannerUrl} blend={ownScene.bgBlend} />

      {/* ── Module content (left-aligned identity block, matches the mockup) ── */}
      <View style={{ paddingTop: insets.top + 52, paddingHorizontal: 20, paddingBottom: 22 }}>
        {/* Avatar — rounded square; liquid glass when enabled; tap → account switcher */}
        <Pressable onPress={() => setShowAccountSwitcher(true)} style={{ borderRadius: 26, alignSelf: 'flex-start' }}>
          {glassActive ? (
            <NativeGlassView glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} style={{ width: 84, height: 84, borderRadius: 26, alignItems: 'center', justifyContent: 'center' }}>
              <Avatar emoji={user.emoji} size="lg" />
            </NativeGlassView>
          ) : (
            <View style={{ width: 84, height: 84, borderRadius: 26, overflow: 'hidden' }}>
              <BlurView intensity={70} tint={theme.isDark ? 'dark' : 'light'} style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}>
                <Avatar emoji={user.emoji} size="lg" />
              </BlurView>
            </View>
          )}
        </Pressable>

        {/* Name + verified + badge */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
          <Text variant="h2" weight="bold" color="#FFFFFF" numberOfLines={1} style={{ flexShrink: 1, fontSize: 24, lineHeight: 28, textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }}>{user.displayName}</Text>
          {user.is_verified && <VerifiedBadge size={18} />}
          {user.badge && <UserBadge badge={user.badge} size="md" />}
        </View>
        {/* @handle */}
        <Text variant="body" color="rgba(255,255,255,0.85)" numberOfLines={1} style={{ marginTop: 2, textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }}>@{user.username}</Text>

        {/* Social link chips */}
        {userLinks.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {userLinks.slice(0, 5).map((lnk: any, i: number) => (
              <SocialChip key={`${lnk.url}-${i}`} url={lnk.url} theme={theme} />
            ))}
          </View>
        )}

        {/* Bio */}
        {user.bio ? (
          <View style={{ marginTop: 14 }}>
            <LinkedText style={{ color: theme.colors.text.secondary, fontSize: 15, lineHeight: 21 }}>
              {user.bio}
            </LinkedText>
          </View>
        ) : null}

        {/* Inline stats — tap opens followers / following lists */}
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
          <Pressable onPress={() => { triggerHaptic('selection'); setFollowsModal('followers'); }} style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text variant="body" weight="bold" color="#FFFFFF" style={{ textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>{formatCount(followCounts.followers)}</Text>
            <Text variant="body" color="rgba(255,255,255,0.8)"> {t('profile.followers_short')}</Text>
          </Pressable>
          <Text variant="body" color="rgba(255,255,255,0.8)" style={{ marginHorizontal: 8 }}>·</Text>
          <Pressable onPress={() => { triggerHaptic('selection'); setFollowsModal('following'); }} style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text variant="body" weight="bold" color="#FFFFFF" style={{ textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>{formatCount(followCounts.following)}</Text>
            <Text variant="body" color="rgba(255,255,255,0.8)"> {t('profile.following_short')}</Text>
          </Pressable>
        </View>

        {/* Action row — own profile: glass (interactive) / BlurView pills */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <ActionPill glassActive={glassActive} theme={theme} accent onPress={() => router.push('/profile/edit')}>
            {resolvedProfileTheme.emojiAccents?.follow ? <Text style={{ fontSize: 14 }}>{resolvedProfileTheme.emojiAccents.follow}</Text> : null}
            <Text variant="caption" weight="semibold" color="#FFFFFF" style={{ fontSize: 14 }}>{t('profile.edit', 'Редактировать')}</Text>
          </ActionPill>
          <ActionPill glassActive={glassActive} theme={theme} square onPress={() => { triggerHaptic('light'); router.push('/profile/customize-header'); }}>
            <Feather name="smile" size={16} color={theme.colors.text.primary} />
          </ActionPill>
          <ActionPill glassActive={glassActive} theme={theme} square onPress={async () => { triggerHaptic('light'); try { await Share.share({ message: `https://san-m-app.com/profile/${user.id}` }); } catch {} }}>
            <Feather name="share" size={16} color={theme.colors.text.primary} />
          </ActionPill>
        </View>
      </View>

      {/* User-built decorations layer — sits above the identity content as a
          decorative sticker layer, below the frosted overlay (so it frosts on
          scroll with everything else). pointerEvents off → taps pass through. */}
      <HeaderSceneLayer scene={ownScene} animate={screenFocused} />

      {/* Frosted-glass overlay — TOP layer of the card so it covers the cover
          photo AND the identity content. Opacity is driven by scroll
          (`headerOpacity`): crisp at rest, frost FADES IN over everything as
          the user scrolls. pointerEvents="none" so the buttons beneath stay
          tappable. */}
      <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: headerOpacity }}>
        {chromeReady ? (
          <BlurView intensity={theme.isDark ? 55 : 75} tint={theme.isDark ? 'dark' : 'light'} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        ) : null}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.isDark ? 'rgba(20,21,28,0.32)' : 'rgba(255,255,255,0.34)' }} />
        <LinearGradient
          colors={[theme.colors.accent.primary + '26', theme.colors.accent.primary + '00', theme.colors.accent.primary + '1C']}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      </Animated.View>
    </View>
  ), [theme, user, bannerUrl, bannerTransform, chromeReady, userLinks, followCounts, insets.top, t, glassActive, ownScene]);

  // Tabs row is split out of the banner header so switching tabs only
  // reconciles this lightweight subtree — the heavy banner (CachedImage,
  // BannerFloatingLinks) keeps a stable element ref and is never re-rendered
  // on tab switch. This is the perf fix: no banner reload, no FPS drop.
  const tabsRow = useMemo(() => (
    <>
      {/* Profile category tabs — the old full-width bottom hairline + the
          sliding accent underline are removed for a cleaner "open" profile.
          The active tab now reads as a rounded pill: interactive liquid glass
          when enabled, otherwise a soft accent-tinted rounded fill. */}
      <View style={{ marginTop: 16 }} onLayout={onTabsRowLayout}>
        <View style={{ flexDirection: 'row', paddingHorizontal: 4 }}>{tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          const content = (
            <>
              {tab.emoji ? (
                <RNText
                  allowFontScaling={false}
                  style={{
                    // Emoji glyphs draw a few pixels above the text baseline; a
                    // tight `<Text variant="caption">` (lineHeight ≈ font size)
                    // clips the top of taller emoji like ✨ / ⚡. Plain RNText
                    // with explicit lineHeight + no includeFontPadding fixes it.
                    fontSize: 14,
                    lineHeight: 18,
                    includeFontPadding: false,
                    textAlignVertical: 'center',
                  }}
                >
                  {tab.emoji}
                </RNText>
              ) : null}
              <Text variant="caption" weight={isActive ? 'bold' : 'regular'} color={isActive ? theme.colors.text.primary : theme.colors.text.tertiary} numberOfLines={1} style={{ flexShrink: 1 }}>{tab.label}</Text>
            </>
          );
          return (
            <Pressable
              key={tab.key}
              onPress={() => { triggerHaptic('selection'); setActiveTab(tab.key); }}
              // Long-press opens the per-tab customization sheet. Own profile
              // only — this whole screen IS the user's own profile.
              onLongPress={() => { triggerHaptic('medium'); setEditingTabKey(tab.key); }}
              delayLongPress={300}
              style={{ flex: 1, paddingHorizontal: 4 }}
            >
              {glassActive && isActive ? (
                <NativeGlassView
                  glassStyle="regular"
                  isInteractive
                  colorScheme={theme.isDark ? 'dark' : 'light'}
                  tintColor={theme.colors.accent.primary + '33'}
                  style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 9, paddingHorizontal: 8, borderRadius: 16, overflow: 'hidden' }}
                >
                  {content}
                </NativeGlassView>
              ) : (
                <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 9, paddingHorizontal: 8, borderRadius: 16, overflow: 'hidden', backgroundColor: isActive ? theme.colors.accent.primary + '1F' : 'transparent' }}>
                  {content}
                </View>
              )}
            </Pressable>
          );
        })}</View>
      </View>
      <View style={{ height: 12 }} />
    </>
  ), [theme, activeTab, tabs, glassActive]);

  // Compose: only `tabsRow` changes reference on tab switch, so React keeps
  // the `bannerHeader` subtree mounted untouched.
  const listHeader = useMemo(() => (
    <>{bannerHeader}{tabsRow}</>
  ), [bannerHeader, tabsRow]);


  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <ProfileThemeScope themeId={profileThemeId} scrollActive={scrollActive} screenFocused={screenFocused}>
      {/* Layer 1: themed background illustration — a SIBLING beneath the content
          (never a parent of a glass view). Renders nothing while the asset is
          null/failed so the palette gradient shows through (Req 4.4, 4.5, 9.2). */}
      <ProfileThemeBackground
        illustration={themeIllustration}
        onError={() => setIllustrationFailed(true)}
        onTimeout={() => setIllustrationFailed(true)}
      />
      {/* Ambient particle layer removed — the theme background is a clean static
          vector landscape (ProfileThemeScene) now, no snow/leaf particles. */}

      {/* (The old scroll-in dark gradient / overlay blur was removed — the
          frosted look now lives ON the rounded header card itself, see
          `bannerHeader` below.) */}
      {/* `pointerEvents="box-none"`: this absolute chrome container sits at
          zIndex 100 — ABOVE the pinned category-tab overlay (zIndex 50) — and
          spans the full width across the SAME vertical band the pinned pills
          occupy. As a plain `auto` View it was the topmost hit-test target over
          that whole band, so taps on the pinned pills landed on this (now empty,
          since the QR/settings buttons translate off-screen on scroll) container
          and died. `box-none` makes the container itself transparent to touches
          (taps fall through to the pinned overlay below) while its real children
          — the QR + settings Pressables — still capture their own taps. */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 100 }}>
        <Animated.View style={{ transform: [{ translateX: buttonsTranslateX }] }}><Pressable onPress={() => { triggerHaptic('light'); setShowQR(true); }} style={{ borderRadius: 17 }}>{glassActive ? (<NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}><FontAwesome5 name="qrcode" size={15} color="#FFFFFF" /></NativeGlassView>) : chromeReady ? (<BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}><FontAwesome5 name="qrcode" size={15} color="#FFFFFF" /></BlurView>) : (<View style={{ width: 34, height: 34, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}><FontAwesome5 name="qrcode" size={15} color="#FFFFFF" /></View>)}</Pressable></Animated.View>
        {/* Follow stats moved into the redesigned header module below. */}
        <View pointerEvents="none" />
        <Animated.View style={{ transform: [{ translateX: settingsTranslateX }] }}><Pressable onPress={() => { triggerHaptic('light'); router.push('/settings'); }} style={{ borderRadius: 17 }}>{glassActive ? (<NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}><Feather name="settings" size={16} color="#FFFFFF" /></NativeGlassView>) : chromeReady ? (<BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}><Feather name="settings" size={16} color="#FFFFFF" /></BlurView>) : (<View style={{ width: 34, height: 34, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}><Feather name="settings" size={16} color="#FFFFFF" /></View>)}</Pressable></Animated.View>
      </View>
      <Animated.FlatList
        ref={scrollViewRef}
        // Tab-driven data swap. `postsReady` only gates the heavy
        // post-card mount path (initial open); the lighter likes /
        // replies tabs render as soon as their loader returns.
        data={
          activeTab === 'posts'
            ? (postsReady ? userPosts : EMPTY_LIST)
            : activeTab === 'likes'
              ? likedPosts
              : activeTab === 'replies'
                ? userReplies
                : EMPTY_LIST
        }
        keyExtractor={activeTab === 'replies' ? keyExtractorReply : keyExtractorPost}
        renderItem={
          activeTab === 'posts'
            ? renderPostItem
            : activeTab === 'likes'
              ? renderLikedItem
              : activeTab === 'replies'
                ? (renderReplyItem as any)
                : renderPostItem
        }
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
        // Seasonal Profile Themes (Req 6.2, 6.3): drive the ambient pause from
        // lightweight JS handlers that fire only on drag/momentum start/end, so
        // they do not contend with the native-driven `onScroll` above.
        onScrollBeginDrag={() => setScrollActive(true)}
        onScrollEndDrag={() => setScrollActive(false)}
        onMomentumScrollEnd={() => setScrollActive(false)}
        contentContainerStyle={LIST_CONTENT_CONTAINER_STYLE}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={(
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Text variant="caption" color={theme.colors.text.tertiary}>
              {activeTab === 'posts' ? t('profile.no_posts') : t('profile.empty_section')}
            </Text>
          </View>
        )}
      />
      {/* ── Pinned (sticky) category tabs overlay ──────────────────────────
          Mirrors the inline tabs row (same labels, active styling, haptic,
          setActiveTab + long-press editor) so the two stay in sync — both
          read `activeTab` and call `setActiveTab`. Reveal is native-driven
          (opacity + slide off `scrollY`); `pointerEvents` is gated to the
          visible state so it's only tappable once shown. Sits BELOW the
          floating QR/settings chrome (zIndex 100) and ABOVE the list. */}
      <Animated.View
        pointerEvents={pinnedTabsVisible ? 'auto' : 'none'}
        // FLUSH STICKY: the overlay is anchored to the VERY TOP of the screen
        // (top: 0) — NOT at `pinnedBarTop`. The frosted/opaque backing below
        // fills the entire band from y=0 (behind the status bar / safe-area)
        // down through the tab row, so when the inline tabs scroll up under
        // the chrome the pinned copy reads as the tabs simply STICKING to the
        // top with content masked beneath it — no transparent empty band above
        // the bar. The tab pills themselves are pushed down by `paddingTop:
        // pinnedBarTop` so they land EXACTLY where the inline tabs sit at the
        // reveal threshold (pixel-aligned handoff, no jump/gap).
        style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, opacity: pinnedTabsOpacity, transform: [{ translateY: pinnedTabsTranslateY }] }}
      >
        <View style={{ overflow: 'hidden', borderBottomLeftRadius: 18, borderBottomRightRadius: 18 }}>
          {/* Solid + frosted backing so scrolling content never shows through —
              reuses the same BlurView glass pattern as the rest of the chrome. */}
          {chromeReady ? (
            <BlurView intensity={theme.isDark ? 55 : 75} tint={theme.isDark ? 'dark' : 'light'} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          ) : null}
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.background.primary + (theme.isDark ? 'D9' : 'E6') }} />
          {/* Pills sit HIGH in the bar — `paddingTop: insets.top + 6` places them
              just below the safe area, in the row the floating QR/settings chrome
              buttons vacate as they slide off on scroll. The frosted/opaque backing
              above is anchored top:0 and fills the whole band from y=0 down through
              the pills (no transparent gap). The reveal threshold math
              (tabsOffsetY - pinnedBarTop) is intentionally left unchanged so the
              inline→pinned handoff stays pixel-aligned. */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingTop: insets.top + 6, paddingBottom: 10 }}>{tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            const content = (
              <>
                {tab.emoji ? (
                  <RNText allowFontScaling={false} style={{ fontSize: 14, lineHeight: 18, includeFontPadding: false, textAlignVertical: 'center' }}>{tab.emoji}</RNText>
                ) : null}
                <Text variant="caption" weight={isActive ? 'bold' : 'regular'} color={isActive ? theme.colors.text.primary : theme.colors.text.tertiary} numberOfLines={1} style={{ flexShrink: 1 }}>{tab.label}</Text>
              </>
            );
            return (
              <Pressable
                key={tab.key}
                onPress={() => { triggerHaptic('selection'); setActiveTab(tab.key); }}
                onLongPress={() => { triggerHaptic('medium'); setEditingTabKey(tab.key); }}
                delayLongPress={300}
                style={{ flex: 1, paddingHorizontal: 4 }}
              >
                {glassActive && isActive ? (
                  <NativeGlassView
                    glassStyle="regular"
                    isInteractive
                    colorScheme={theme.isDark ? 'dark' : 'light'}
                    tintColor={theme.colors.accent.primary + '33'}
                    style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 9, paddingHorizontal: 8, borderRadius: 16, overflow: 'hidden' }}
                  >
                    {content}
                  </NativeGlassView>
                ) : (
                  <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 9, paddingHorizontal: 8, borderRadius: 16, overflow: 'hidden', backgroundColor: isActive ? theme.colors.accent.primary + '1F' : 'transparent' }}>
                    {content}
                  </View>
                )}
              </Pressable>
            );
          })}</View>
        </View>
      </Animated.View>
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
              {glassActive ? (
                <Pressable onPress={() => setViewingImage(null)} style={{ borderRadius: 18 }}>
                  <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="x" size={20} color="#FFFFFF" />
                  </NativeGlassView>
                </Pressable>
              ) : (
                <Pressable onPress={() => setViewingImage(null)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="x" size={20} color="#FFFFFF" />
                </Pressable>
              )}
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
            {glassActive ? (
              <NativeGlassView glassStyle="regular" colorScheme="dark" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 28, paddingHorizontal: 24, paddingVertical: 12 }}>
                {!userPosts.find(p => p.id === viewingImage?.postId)?.isRepost && (
                <Pressable onPress={() => { const ep = userPosts.find(p => p.id === viewingImage!.postId); setViewingImage(null); useFeedStore.getState().setEditingPost({ id: viewingImage!.postId, content: ep?.content || '', imageUrl: ep?.imageUrl, imageUrls: ep?.imageUrls && ep.imageUrls.length > 0 ? ep.imageUrls : (ep?.imageUrl ? [ep.imageUrl] : undefined) }); router.push('/(tabs)/create'); }} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="edit-2" size={17} color="#FFFFFF" />
                </Pressable>
                )}
                <Pressable onPress={async () => { if (viewingImage) { const ep = userPosts.find(p => p.id === viewingImage.postId); const { shareImageUrl } = require('../../src/utils/sharePost'); await shareImageUrl(viewingImage.uri, ep?.content); } }} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="share" size={17} color="#FFFFFF" />
                </Pressable>
                <Pressable onPress={() => { if (viewingImage && user?.id) { Alert.alert(t('profile.delete_post_title'), t('profile.delete_post_msg'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.delete'), style: 'destructive', onPress: async () => { await deletePost(viewingImage.postId, user.id); setViewingImage(null); loadMyPosts(); } }]); } }} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,60,50,0.22)', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="trash-2" size={17} color="#FF3B30" />
                </Pressable>
              </NativeGlassView>
            ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 28, paddingHorizontal: 24, paddingVertical: 12 }}>
              {!userPosts.find(p => p.id === viewingImage?.postId)?.isRepost && (
              <Pressable onPress={() => { const ep = userPosts.find(p => p.id === viewingImage!.postId); setViewingImage(null); useFeedStore.getState().setEditingPost({ id: viewingImage!.postId, content: ep?.content || '', imageUrl: ep?.imageUrl, imageUrls: ep?.imageUrls && ep.imageUrls.length > 0 ? ep.imageUrls : (ep?.imageUrl ? [ep.imageUrl] : undefined) }); router.push('/(tabs)/create'); }} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="edit-2" size={17} color="#FFFFFF" />
              </Pressable>
              )}
              <Pressable onPress={async () => { if (viewingImage) { const ep = userPosts.find(p => p.id === viewingImage.postId); const { shareImageUrl } = require('../../src/utils/sharePost'); await shareImageUrl(viewingImage.uri, ep?.content); } }} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="share" size={17} color="#FFFFFF" />
              </Pressable>
              <Pressable onPress={() => { if (viewingImage && user?.id) { Alert.alert(t('profile.delete_post_title'), t('profile.delete_post_msg'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.delete'), style: 'destructive', onPress: async () => { await deletePost(viewingImage.postId, user.id); setViewingImage(null); loadMyPosts(); } }]); } }} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,60,50,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="trash-2" size={17} color="#FF3B30" />
              </Pressable>
            </View>
            )}
          </View>
        </View>
      </Modal>
      <AccountSwitcher visible={showAccountSwitcher} onClose={() => setShowAccountSwitcher(false)} />
      <PostContextMenu visible={!!contextPost} post={contextPost} isOwnPost={true} onClose={closeContextMenu} onDelete={async (postId) => { if (user?.id) { await deletePost(postId, user.id); useFeedStore.getState().removePost(postId); loadMyPosts(); showToast(t('toast.post_deleted'), 'trash-2'); } }} />
      <FollowsListModal visible={!!followsModal} mode={followsModal || 'followers'} userId={user?.id || null} onClose={() => setFollowsModal(null)} />
      {/* Long-press tab editor — own profile only. The modal seeds with the
          tab's current customization and writes back via the settings
          store so the choice survives relaunch. */}
      <EditProfileTabModal
        visible={!!editingTabEntry}
        defaultLabel={editingTabEntry?.defaultLabel || ''}
        initialLabel={editingTabEntry?.label !== editingTabEntry?.defaultLabel ? editingTabEntry?.label : undefined}
        initialEmoji={editingTabEntry?.emoji}
        onClose={() => setEditingTabKey(null)}
        onApply={(value) => {
          if (editingTabKey) setProfileTabCustom(editingTabKey, value);
        }}
        onReset={() => {
          if (editingTabKey) clearProfileTabCustom(editingTabKey);
        }}
      />
      <ScreenshotShield visible={screenshotDetected} />
      </ProfileThemeScope>
    </View>
  );
}
