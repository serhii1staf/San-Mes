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
import { ProfilePostCard } from '../../src/components/profile/ProfilePostCard';
import { useProfileAppearanceStore } from '../../src/store/profileAppearanceStore';
import { extractFirstUrl } from '../../src/services/linkPreview';
import { kvGetJSONSync, kvSetJSON } from '../../src/services/kvStore';
import { AccountSwitcher } from '../../src/components/ui/AccountSwitcher';
import { PostContextMenu } from '../../src/components/ui/PostContextMenu';
import { SwipeablePostCard } from '../../src/components/ui/SwipeablePostCard';
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
  // frame after the tab activates so the tab highlight switches instantly and the
  // heavy mount happens off the tap's critical path (no perceived freeze).
  const [postsReady, setPostsReady] = useState(true);
  const [activeTab, setActiveTab] = useState<TabName>('posts');
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [showQR, setShowQR] = useState(false);
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

  // 1. On mount: if store is empty, hydrate from MMKV (instant, no flicker)
  // then fetch fresh in the background. The MMKV read is synchronous so we
  // defer it via InteractionManager to keep the tab-switch frame buttery on
  // weak devices — same approach as (tabs)/index.tsx.
  useEffect(() => {
    if (userPosts.length > 0) return; // Store already has data — show instantly
    const handle = InteractionManager.runAfterInteractions(() => {
      try {
        const parsed = kvGetJSONSync<any[]>(MY_POSTS_CACHE_KEY, []);
        if (Array.isArray(parsed) && parsed.length > 0) setProfilePosts(parsed);
      } catch {}
    });
    return () => handle.cancel();
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
      const { data } = await supabase.from('posts').select('*').eq('author_id', user.id).order('created_at', { ascending: false }).limit(20);
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

      const mapped: Post[] = data.map((p: any) => {
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
      });
      setProfilePosts(mapped);
      kvSetJSON(MY_POSTS_CACHE_KEY, mapped);
      AsyncStorage.setItem(accountKey(MY_POSTS_CACHE_KEY), JSON.stringify(mapped)).catch(() => {});
    } catch {}
  }, [user?.id]);

  const loadFollows = useCallback(async () => {
    if (!user?.id) return;
    try { const counts = await getFollowCounts(user.id); setFollowCounts(counts); } catch {}
  }, [user?.id]);

  // Restore scroll position when tab regains focus
  useFocusEffect(
    useCallback(() => {
      if (profileScrollOffset > 0 && scrollViewRef.current && !hasRestoredScroll.current) {
        // Small delay to ensure layout is ready
        const timer = setTimeout(() => {
          (scrollViewRef.current as any)?.scrollTo({ y: profileScrollOffset, animated: false });
        }, 50);
        hasRestoredScroll.current = true;
        return () => clearTimeout(timer);
      }
      hasRestoredScroll.current = false;
    }, [profileScrollOffset])
  );

  // Stable callbacks for the memoized post card so reference equality holds.
  const handlePostLongPress = useCallback((p: any) => {
    openContextMenu(p);
  }, [openContextMenu]);

  const handlePostImagePress = useCallback((uri: string, postId: string, allImages: string[]) => {
    setViewingImage({ uri, postId, allImages });
  }, []);

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

  if (!user) return <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={theme.colors.accent.primary} /></View>;

  const userLinks: { type: string; url: string }[] = (user as any).links || [];
  const bannerUrl = (user as any)?.bannerUrl;
  const tabs: { key: TabName; label: string }[] = [{ key: 'posts', label: t('profile.posts') }, { key: 'replies', label: t('profile.replies') }, { key: 'media', label: t('profile.media') }, { key: 'likes', label: t('profile.likes') }];
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://san-m-app.com/profile/${user.id}`)}`;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, height: insets.top + 50, opacity: headerOpacity }} pointerEvents="none">
        <LinearGradient colors={[theme.colors.background.primary, theme.colors.background.primary, theme.colors.background.primary + '00']} locations={[0, 0.6, 1]} style={{ flex: 1 }} />
      </Animated.View>
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 100 }}>
        <Animated.View style={{ transform: [{ translateX: buttonsTranslateX }] }}><Pressable onPress={() => { triggerHaptic('light'); setShowQR(true); }} style={{ borderRadius: 17, overflow: 'hidden' }}><BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}><FontAwesome5 name="qrcode" size={15} color="#FFFFFF" /></BlurView></Pressable></Animated.View>
        <Animated.View style={{ transform: [{ translateX: settingsTranslateX }] }}><Pressable onPress={() => { triggerHaptic('light'); router.push('/settings'); }} style={{ borderRadius: 17, overflow: 'hidden' }}><BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}><Feather name="settings" size={16} color="#FFFFFF" /></BlurView></Pressable></Animated.View>
      </View>
      <Animated.FlatList
        ref={scrollViewRef}
        data={activeTab === 'posts' && postsReady ? userPosts : []}
        keyExtractor={(item: any) => item.id}
        renderItem={({ item }: { item: any }) => (
          <ProfilePostCard
            post={item}
            authorName={user.displayName || ''}
            authorEmoji={user.emoji || '😊'}
            authorVerified={user.is_verified}
            authorBadge={user.badge}
            shareText={`${user.displayName}: ${item.content || ''}\nhttps://san-m-app.com/post/${item.id}`}
            postEmoji={postEmoji}
            onLongPress={handlePostLongPress}
            onImagePress={handlePostImagePress}
          />
        )}
        // Virtualization tuned for weak Android / iPhone 12. Keeps the
        // mounted card count low so swipe gestures, link previews, and
        // formatted-text reflow don't all sit on the UI thread at once —
        // the root cause of `SLOW ui<30 @ (tabs)/profile`.
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={7}
        removeClippedSubviews={true}
        showsVerticalScrollIndicator={false}
        bounces={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 100, paddingHorizontal: 16, paddingTop: 12 }}
        ListHeaderComponent={(
          <>
            <View style={{ height: 200, marginHorizontal: -16, marginTop: -12, backgroundColor: theme.colors.accent.primary + '20' }}>
              {bannerUrl ? <CachedImage uri={bannerUrl} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
              <LinearGradient colors={['transparent', theme.colors.background.primary]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60 }} />
            </View>
            <View style={{ marginTop: -90 }}>
              <Pressable onPress={() => setShowAccountSwitcher(true)}><View style={{ width: 72, height: 72, borderRadius: 36, overflow: 'hidden', borderWidth: 3, borderColor: theme.colors.background.primary, backgroundColor: theme.isDark ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' }}><Avatar emoji={user.emoji} size="lg" /></View></Pressable>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                <View style={{ flex: 1, marginRight: 8 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Text variant="body" weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>{user.displayName}</Text>{user.is_verified && <VerifiedBadge size={13} />}{user.badge && <UserBadge badge={user.badge} size="sm" />}</View><Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>@{user.username}</Text></View>
                <Pressable onPress={() => { triggerHaptic('light'); router.push('/profile/edit'); }} style={{ borderRadius: 20, overflow: 'hidden', flexShrink: 0 }}><BlurView intensity={80} tint="dark" style={{ paddingHorizontal: 16, paddingVertical: 7 }}><Text variant="caption" weight="semibold" color="#FFFFFF">{t('profile.edit')}</Text></BlurView></Pressable>
              </View>
              <View style={{ flexDirection: 'row', marginTop: 10, gap: 16 }}>
                <Text variant="caption"><Text variant="caption" weight="bold">{userPosts.length}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>{t('profile.posts_count')}</Text></Text>
                <Text variant="caption"><Text variant="caption" weight="bold">{followCounts.following}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>{t('profile.following')}</Text></Text>
                <Text variant="caption"><Text variant="caption" weight="bold">{followCounts.followers}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>{t('profile.followers')}</Text></Text>
              </View>
              {user.bio ? <LinkedText style={{ marginTop: 8 }}>{user.bio}</LinkedText> : null}
              {userLinks.length > 0 && <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>{userLinks.map((link, idx) => <SocialLinkIcon key={idx} type={link.type} url={link.url} />)}</View>}
            </View>
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
    </View>
  );
}
