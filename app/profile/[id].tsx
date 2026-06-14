import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Pressable, ActivityIndicator, Image, Dimensions, Modal, Animated, Share, Alert, ScrollView as RNScrollView, StatusBar, InteractionManager } from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { LinkedText } from '../../src/components/ui/LinkedText';
import { parseImageUrls, getProfile, getFollowCounts, deletePost, isRepost, supabase, getLikedPosts, getUserComments } from '../../src/lib/supabase';
import { extractFirstUrl } from '../../src/services/linkPreview';
import { useAuthStore } from '../../src/store';
import { useEntityStore } from '../../src/store';
import { useFeedStore } from '../../src/store/feedStore';
import { syncProfile, syncUserPosts } from '../../src/services/syncService';
import { queueMutation } from '../../src/services/offlineQueue';
import { openUrl } from '../../src/utils/openUrl';
import { triggerHaptic } from '../../src/utils/haptics';
import { showToast } from '../../src/store/toastStore';
import { formatTimeAgo } from '../../src/utils/mockData';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { PostContextMenu } from '../../src/components/ui/PostContextMenu';
import { UserProfilePostCard } from '../../src/components/ui/UserProfilePostCard';
import { FollowsListModal, FollowsListMode } from '../../src/components/profile/FollowsListModal';
import { ProfileReplyCard, ProfileReply } from '../../src/components/profile/ProfileReplyCard';
import { AdaptiveProfileText } from '../../src/components/profile/AdaptiveProfileText';
import { useProfileAppearanceStore } from '../../src/store/profileAppearanceStore';
import { PanResponder } from 'react-native';
import { useContextMenuGuard } from '../../src/hooks/useContextMenuGuard';
import { useT } from '../../src/i18n/store';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useBlockedUsersStore, useIsBlocked } from '../../src/store/blockedUsersStore';
import { parseBannerTransform, stripBannerTransform } from '../../src/utils/bannerTransform';
import { useBannerBrightness } from '../../src/hooks/useBannerBrightness';
import { kvGetJSONSync, kvSetJSON } from '../../src/services/kvStore';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const LIKED_POSTS_CACHE_PREFIX = '@san:liked_posts:';
const USER_REPLIES_CACHE_PREFIX = '@san:user_replies:';
type TabName = 'posts' | 'replies' | 'media' | 'likes';

// Report category KEYS — labels come from the dictionary at render time
// so the sheet works in both Russian and English without duplicate strings.
const REPORT_CATEGORIES: { key: string; labelKey: string }[] = [
  { key: 'spam', labelKey: 'report.cat.spam' },
  { key: 'violence', labelKey: 'report.cat.violence' },
  { key: 'misinformation', labelKey: 'report.cat.misinformation' },
  { key: 'fraud', labelKey: 'report.cat.fraud' },
  { key: 'other', labelKey: 'report.cat.other' },
];

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
  if (lower.includes('spotify.com') || lower.includes('open.spotify.com')) return 'spotify';
  return 'website';
}

function SocialLinkIcon({ type, url }: { type: string; url: string }) {
  const theme = useTheme();
  const icons: Record<string, { name: string; color: string; isBrand: boolean }> = {
    github: { name: 'github', color: theme.isDark ? '#FFF' : '#333', isBrand: true },
    twitter: { name: 'twitter', color: '#1DA1F2', isBrand: true },
    instagram: { name: 'instagram', color: '#E4405F', isBrand: true },
    youtube: { name: 'youtube', color: '#FF0000', isBrand: true },
    telegram: { name: 'telegram-plane', color: '#0088CC', isBrand: true },
    tiktok: { name: 'tiktok', color: theme.isDark ? '#FFF' : '#000', isBrand: true },
    linkedin: { name: 'linkedin-in', color: '#0A66C2', isBrand: true },
    discord: { name: 'discord', color: '#5865F2', isBrand: true },
    twitch: { name: 'twitch', color: '#9146FF', isBrand: true },
    spotify: { name: 'spotify', color: '#1DB954', isBrand: true },
    website: { name: 'globe', color: '#2563EB', isBrand: false },
  };
  const detected = detectLinkType(url);
  const icon = icons[detected] || icons[type] || icons.website;
  return (
    <Pressable onPress={() => { triggerHaptic('light'); openUrl(url); }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: icon.color + '18', alignItems: 'center', justifyContent: 'center' }}>
      {icon.isBrand ? <FontAwesome5 name={icon.name} size={13} color={icon.color} brand /> : <Feather name={icon.name as any} size={13} color={icon.color} />}
    </Pressable>
  );
}

function ProfileMenuModalImpl({ visible, profile, onClose }: { visible: boolean; profile: any; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const [showQR, setShowQR] = useState(false);
  const [mode, setMode] = useState<'menu' | 'report'>('menu');
  const isClosing = useRef(false);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 8,
    onPanResponderMove: (_, g) => { if (g.dy > 0) dragY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 80 || g.vy > 0.5) handleClose();
      else Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 100, friction: 10 }).start();
    },
  })).current;

  useEffect(() => {
    if (visible) {
      isClosing.current = false;
      setMode('menu');
      dragY.setValue(0);
      slideAnim.setValue(SCREEN_HEIGHT);
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 10 }).start();
    }
  }, [visible]);

  const handleClose = () => {
    if (isClosing.current) return;
    isClosing.current = true;
    Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 180, useNativeDriver: true }).start(() => {
      setShowQR(false);
      setMode('menu');
      onClose();
    });
  };

  const switchToReport = () => {
    // Animate out, switch mode, animate in (like PostMenuModal)
    Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 150, useNativeDriver: true }).start(() => {
      setMode('report');
      dragY.setValue(0);
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }).start();
    });
  };

  const handleCopyLink = async () => {
    triggerHaptic('light');
    await Clipboard.setStringAsync(`https://san-m-app.com/profile/${profile?.id}`);
    showToast(t('toast.link_copied'), 'link');
    handleClose();
  };

  const handleShare = async () => {
    triggerHaptic('light');
    try { await Share.share({ message: `${t('profile_menu.share_message', undefined, { name: profile?.display_name || 'User' })}\nhttps://san-m-app.com/profile/${profile?.id}` }); } catch {}
    handleClose();
  };

  const handleReport = (cat: string) => {
    triggerHaptic('medium');
    showToast(t('toast.report_sent'), 'flag');
    handleClose();
  };

  // Block / unblock the profile owner. Apple compliance guideline 1.2
  // requires UGC apps to expose a top-level block flow on user profiles
  // (not only as a buried action under a post menu) — this is that
  // affordance. On confirm, flips the local block list which immediately
  // hides any cached posts of theirs across the app via the wrapper
  // checks in PostCard / UserProfilePostCard / CommentRow.
  const handleBlockToggle = () => {
    if (!profile) return;
    triggerHaptic('medium');
    const isBlockedNow = useBlockedUsersStore.getState().isBlocked(profile.id);
    if (isBlockedNow) {
      Alert.alert(
        t('block.unblock_confirm_title', undefined, { username: profile.username || '' }),
        t('block.unblock_confirm_msg'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('block.menu.unblock'),
            onPress: () => {
              useBlockedUsersStore.getState().unblock(profile.id);
              showToast(t('block.toast.unblocked'), 'check');
              handleClose();
            },
          },
        ],
      );
    } else {
      Alert.alert(
        t('block.confirm_title', undefined, { username: profile.username || '' }),
        t('block.confirm_msg'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('block.action'),
            style: 'destructive',
            onPress: () => {
              useBlockedUsersStore.getState().block(profile.id);
              showToast(t('block.toast.blocked'), 'slash');
              handleClose();
            },
          },
        ],
      );
    }
  };

  if (!profile) return null;
  const translateY = Animated.add(slideAnim, dragY);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://san-m-app.com/profile/${profile.id}`)}`;

  // QR fullscreen view
  if (showQR) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setShowQR(false)} statusBarTranslucent>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' }} onPress={() => setShowQR(false)}>
          <View style={{ backgroundColor: '#FFF', borderRadius: 20, padding: 20 }}>
            <Image source={{ uri: qrUrl }} style={{ width: 200, height: 200 }} resizeMode="contain" />
          </View>
          <Text variant="caption" color="#FFFFFF" style={{ marginTop: 16 }}>{t('profile.qr_close_hint')}</Text>
        </Pressable>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose} statusBarTranslucent>
      <StatusBar hidden />
      <View style={{ flex: 1 }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={handleClose} />
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY }] }} {...panResponder.panHandlers}>
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 12 }}>
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)' }} />
              </View>

              {mode === 'menu' ? (
                <>
                  {/* Header with avatar + QR */}
                  <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Avatar emoji={profile.emoji || '😊'} size="lg" />
                      <View style={{ marginLeft: 12, flex: 1, marginRight: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text variant="body" weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>{profile.display_name}</Text>
                          {profile.is_verified && <VerifiedBadge size={13} />}
                          {profile.badge && <UserBadge badge={profile.badge} size="sm" />}
                        </View>
                        <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>@{profile.username}</Text>
                      </View>
                      <Pressable onPress={() => { triggerHaptic('light'); setShowQR(true); }} style={{ backgroundColor: '#FFF', borderRadius: 8, padding: 4 }}>
                        <Image source={{ uri: qrUrl }} style={{ width: 44, height: 44 }} resizeMode="contain" />
                      </Pressable>
                    </View>
                  </View>
                  <MenuItem icon="link" label={t('profile_menu.copy_link')} onPress={handleCopyLink} theme={theme} />
                  <MenuItem icon="share-2" label={t('profile_menu.share_profile')} onPress={handleShare} theme={theme} />
                  <MenuItem icon="flag" label={t('profile_menu.report')} onPress={() => { triggerHaptic('light'); switchToReport(); }} theme={theme} destructive />
                  <ProfileBlockMenuItem profileId={profile.id} onPress={handleBlockToggle} theme={theme} />
                </>
              ) : (
                <>
                  <Text variant="body" weight="semibold" align="center" style={{ paddingVertical: 12 }}>{t('report.title')}</Text>
                  {REPORT_CATEGORIES.map((cat) => (
                    <Pressable key={cat.key} onPress={() => handleReport(cat.key)} style={{ paddingVertical: 14, paddingHorizontal: 20, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}>
                      <Text variant="body">{t(cat.labelKey)}</Text>
                    </Pressable>
                  ))}
                </>
              )}
              <View style={{ height: 12 }} />
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

function MenuItem({ icon, label, onPress, theme, destructive }: { icon: string; label: string; onPress: () => void; theme: any; destructive?: boolean }) {
  const color = destructive ? '#FF3B30' : theme.colors.text.primary;
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: destructive ? '#FF3B3010' : (theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'), alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon as any} size={17} color={color} />
      </View>
      <Text variant="body" color={color} style={{ marginLeft: 14 }}>{label}</Text>
    </Pressable>
  );
}

// Block / unblock entry for the profile menu. Subscribes to the
// blocked-users store so the label flips immediately after the
// confirmation dialog without forcing the parent ProfileMenuModal to
// re-render every block-list mutation.
function ProfileBlockMenuItem({ profileId, onPress, theme }: { profileId: string; onPress: () => void; theme: any }) {
  const t = useT();
  const isBlocked = useIsBlocked(profileId);
  return (
    <MenuItem
      icon={isBlocked ? 'check-circle' : 'slash'}
      label={isBlocked ? t('block.action_unblock') : t('block.action')}
      onPress={onPress}
      theme={theme}
      destructive={!isBlocked}
    />
  );
}

// Memoize the menu modal so it doesn't re-render when the parent screen
// re-renders (e.g., on every scroll-driven Animated update or unrelated state
// change). It only depends on `visible`, `profile`, and `onClose`.
const ProfileMenuModal = React.memo(ProfileMenuModalImpl);

export default function UserProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Mount-time marker — opens-someone-else's-profile lag is a primary user
  // complaint; this attribution lets the panel show whether the freeze
  // came from the screen's first render or from downstream image fan-out.
  // Skipped at the call site when the monitor is off.
  const mountStart = useRef(Date.now()).current;
  const perfEnabled = useSettingsStore((s) => s.perfMonitorEnabled);
  useEffect(() => {
    if (!perfEnabled) return;
    perfMonitor.markScreenMount('profile/[id]', Date.now() - mountStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfEnabled]);
  const { id, fromChat } = useLocalSearchParams<{ id: string; fromChat?: string }>();
  // Field selector — destructuring the whole store re-rendered this screen on
  // every unrelated auth-state change (badge sync, token refresh, etc.).
  const currentUser = useAuthStore((s) => s.user);
  // Viewer-side decoration shared with the home profile tab — drives the
  // faint emoji / pixel-icon pattern on every visible post card. Stable
  // string so memoized cards only re-render when it actually changes.
  const postEmoji = useProfileAppearanceStore((s) => s.postEmoji);
  const [isLoading, setIsLoading] = useState(true);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [activeTab, setActiveTab] = useState<TabName>('posts');
  // Lazy-loaded secondary tab data — Likes / Replies. Filled the first
  // time the user flips into that tab, then cached per-profile in MMKV
  // so reopening is instant. Cache keys include the target profile id
  // (the OWNER of this profile, not the viewer) so each profile has
  // its own slice.
  const [likedPosts, setLikedPosts] = useState<any[]>([]);
  const [likedLoaded, setLikedLoaded] = useState(false);
  const [likedFetching, setLikedFetching] = useState(false);
  const [userReplies, setUserReplies] = useState<ProfileReply[]>([]);
  const [repliesLoaded, setRepliesLoaded] = useState(false);
  const [repliesFetching, setRepliesFetching] = useState(false);
  // Posts cards are heavy (gesture handlers + images). Gate their mount one frame
  // after the tab activates so the tab highlight switches instantly and the heavy
  // mount happens off the tap's critical path — same approach as (tabs)/profile.tsx.
  // Posts cards are heavy (gesture handlers + images). Gate their mount one
  // frame after the tab activates so the tab highlight switches instantly and
  // the heavy mount happens off the tap's critical path. Start FALSE so the
  // first paint carries only the header — cards mount after the navigation
  // transition completes via InteractionManager. That breathing room kept
  // the JS thread clear and eliminated the `SLOW ui<30 @ profile/[id]`
  // burst we saw when 18+ cards mounted in 300 ms during the open animation.
  const [postsReady, setPostsReady] = useState(false);
  // Heavy iOS chrome — `expo-blur` BlurView (×2 here) and the banner
  // CachedImage — must NOT mount during the navigation transition into
  // this screen. BlurView spins up a CALayer with a backdrop filter and
  // the banner kicks off a network fetch + decode; both land on the same
  // frame as the open animation and were a major source of
  // `SLOW ui<30 @ profile/[id]`. Render flat-coloured fallbacks and
  // swap to the real components once interactions settle below.
  const [chromeReady, setChromeReady] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [viewingImage, setViewingImage] = useState<{ uri: string; postId: string; allImages?: string[] } | null>(null);
  // Followers / Following list modal opened from the header counters.
  const [followsModal, setFollowsModal] = useState<FollowsListMode | null>(null);
  const { target: contextPost, open: openContextMenu, close: closeContextMenu } = useContextMenuGuard<any>();
  // Virtualization is handled by Animated.FlatList below — no manual windowing
  // needed. Initial mount is gated by `postsReady` so the tab tap stays snappy.
  const scrollY = useRef(new Animated.Value(0)).current;
  // Memoize interpolations so each is allocated once, not per-render. Each
  // re-render of this screen otherwise creates 5 new AnimatedInterpolation
  // nodes that the same scrollY then has to drive.
  const headerOpacity = useMemo(
    () => scrollY.interpolate({ inputRange: [0, 50, 120], outputRange: [0, 0, 1], extrapolate: 'clamp' }),
    [scrollY],
  );
  const buttonsTranslateX = useMemo(
    () => scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, -60], extrapolate: 'clamp' }),
    [scrollY],
  );
  const menuTranslateX = useMemo(
    () => scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, 60], extrapolate: 'clamp' }),
    [scrollY],
  );
  // Center-header stats (Following / Followers pills) — fade out as the
  // banner scrolls off-screen so they don't fight the floating "follow"
  // badge that appears once you've scrolled past the avatar.
  const centerStatsOpacity = useMemo(
    () => scrollY.interpolate({ inputRange: [0, 80, 160], outputRange: [1, 1, 0], extrapolate: 'clamp' }),
    [scrollY],
  );
  // Pair the opacity fade-out with a subtle shrink so the pills don't
  // just dissolve in place — they tuck away as they fade. Same input
  // range as `centerStatsOpacity` so the two animations land together.
  const centerStatsScale = useMemo(
    () => scrollY.interpolate({ inputRange: [0, 80, 160], outputRange: [1, 1, 0.7], extrapolate: 'clamp' }),
    [scrollY],
  );
  // NOTE: a previous iteration animated the @username + display-name
  // toward the avatar on scroll. Removed — the user found the motion
  // distracting. Identity row now stays static; pills above still
  // shrink/fade out as the banner scrolls off.
  const badgeOpacity = useMemo(
    () => scrollY.interpolate({ inputRange: [180, 220], outputRange: [0, 1], extrapolate: 'clamp' }),
    [scrollY],
  );
  const badgeTranslateY = useMemo(
    () => scrollY.interpolate({ inputRange: [180, 220], outputRange: [20, 0], extrapolate: 'clamp' }),
    [scrollY],
  );

  // Read profile from entity store (cached)
  const cachedProfile = useEntityStore((s) => s.profiles[id ?? '']);
  // Read follow state from entity store
  const isFollowingState = useEntityStore((s) => s.isFollowing(currentUser?.id ?? '', id ?? ''));
  // Read user posts from entity store, filtered by author_id
  const allPosts = useEntityStore((s) => s.posts);
  const userPosts = React.useMemo(() => {
    if (!id) return [];
    return Object.values(allPosts)
      .filter((p) => p.author_id === id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [allPosts, id]);

  // Fallback profile state (for when no cached data exists)
  const [fallbackProfile, setFallbackProfile] = useState<any>(null);

  useEffect(() => {
    if (!id) return;

    // If we have cached profile, show it immediately (no loading)
    if (cachedProfile) {
      setIsLoading(false);
    } else {
      // No cached data — load from Supabase directly as fallback
      setIsLoading(true);
      getProfile(id).then(({ profile: profileData }) => {
        if (profileData) {
          setFallbackProfile(profileData);
          // Also upsert into entity store for future use
          useEntityStore.getState().upsertProfile({
            id: profileData.id,
            username: profileData.username,
            display_name: profileData.display_name,
            emoji: profileData.emoji || '😀',
            bio: profileData.bio || '',
            banner_url: (profileData as any).banner_url || null,
            links: (profileData as any).links ? JSON.stringify((profileData as any).links) : null,
            badge: (profileData as any).badge || null,
            is_verified: (profileData as any).is_verified || false,
            created_at: profileData.created_at || null,
            updated_at: profileData.updated_at || null,
          });
        }
        setIsLoading(false);
      }).catch(() => setIsLoading(false));
    }

    // Defer the heavier follow-up work (background sync, image prefetch, follow
    // counts) until after the navigation transition into this screen has
    // settled — keeps the open animation smooth on weak devices.
    const handle = InteractionManager.runAfterInteractions(() => {
      // Heavy post cards mount only after the navigation transition has
      // settled — that single frame of breathing room is what kept SLOW
      // ui<30 from firing on profile open.
      setPostsReady(true);
      // Same gate also flips on the heavy iOS chrome (BlurView buttons +
      // banner CachedImage). One flag, one render, no extra effects.
      setChromeReady(true);

      // Trigger background sync for profile and user posts
      syncProfile(id);
      syncUserPosts(id);

      // Warm the image cache for this profile's banner so it appears instantly.
      import('../../src/components/ui/CachedImage').then(({ prefetchImages }) => {
        const p: any = useEntityStore.getState().profiles[id];
        if (p?.banner_url) prefetchImages([p.banner_url]);
      }).catch(() => {});

      // Load follow counts from Supabase (keep direct call for counts display)
      getFollowCounts(id).then((counts) => setFollowCounts(counts)).catch(() => {});
    });
    return () => handle.cancel();
  }, [id]);

  // Display profile: prefer cached from store, fallback to direct fetch
  const displayProfile = cachedProfile || fallbackProfile;

  // Display posts mapped for UI — resolve reposts
  const [resolvedOriginals, setResolvedOriginals] = useState<Record<string, any>>({});
  // Track which original-post IDs are already resolved OR currently being
  // fetched so we never re-issue the same `.in()` query when `userPosts`
  // updates from background sync. Without this, every store mutation that
  // reorders/refreshes userPosts would re-fetch the same originals.
  const requestedOriginalIds = useRef<Set<string>>(new Set());

  // Fetch original posts for reposts in this profile
  useEffect(() => {
    const repostOriginalIds: string[] = [];
    for (const p of userPosts) {
      const ri = isRepost(p.content || '');
      if (
        ri.isRepost &&
        ri.originalPostId &&
        !resolvedOriginals[ri.originalPostId] &&
        !requestedOriginalIds.current.has(ri.originalPostId)
      ) {
        repostOriginalIds.push(ri.originalPostId);
      }
    }
    if (repostOriginalIds.length === 0) return;
    // Mark as requested up-front so concurrent runs of this effect (triggered
    // by rapid userPosts changes) don't issue duplicate queries.
    for (const oid of repostOriginalIds) requestedOriginalIds.current.add(oid);
    supabase.from('posts').select('*, profiles:author_id (display_name, username, emoji)').in('id', repostOriginalIds).then(({ data }) => {
      if (!data) return;
      const map: Record<string, any> = { ...resolvedOriginals };
      for (const o of data) map[o.id] = o;
      // Check for deeper chain
      const deeperIds: string[] = [];
      for (const o of data) {
        const ori = isRepost(o.content || '');
        if (
          ori.isRepost &&
          ori.originalPostId &&
          !map[ori.originalPostId] &&
          !requestedOriginalIds.current.has(ori.originalPostId)
        ) deeperIds.push(ori.originalPostId);
      }
      if (deeperIds.length > 0) {
        for (const oid of deeperIds) requestedOriginalIds.current.add(oid);
        supabase.from('posts').select('*, profiles:author_id (display_name, username, emoji)').in('id', deeperIds).then(({ data: deep }) => {
          if (deep) { for (const dp of deep) map[dp.id] = dp; }
          setResolvedOriginals(map);
        });
      } else {
        setResolvedOriginals(map);
      }
    });
  }, [userPosts]);

  const displayPosts = React.useMemo(() => {
    return userPosts.map((p) => {
      const repostInfo = isRepost(p.content || '');
      const parsedImages = parseImageUrls(p.image_url);

      let content = repostInfo.isRepost ? (repostInfo.comment || '') : (p.content || '');
      let imageUrl = parsedImages[0] || undefined;
      let imageUrls = parsedImages.length > 0 ? parsedImages : undefined;
      let originalPost: any = undefined;

      if (repostInfo.isRepost && repostInfo.originalPostId) {
        // Follow repost chain
        let orig = resolvedOriginals[repostInfo.originalPostId];
        let depth = 0;
        while (orig && depth < 10) {
          const origRi = isRepost(orig.content || '');
          if (origRi.isRepost && origRi.originalPostId && resolvedOriginals[origRi.originalPostId]) {
            orig = resolvedOriginals[origRi.originalPostId];
            depth++;
          } else break;
        }
        if (orig) {
          const origProfile = Array.isArray(orig.profiles) ? orig.profiles[0] : orig.profiles;
          const origImages = parseImageUrls(orig.image_url);
          const origRiCheck = isRepost(orig.content || '');
          originalPost = {
            id: orig.id,
            authorName: origProfile?.display_name || 'User',
            authorUsername: origProfile?.username || 'user',
            authorEmoji: origProfile?.emoji || '😊',
            content: origRiCheck.isRepost ? (origRiCheck.comment || '') : (orig.content || ''),
            imageUrl: origImages[0] || undefined,
            imageUrls: origImages.length > 0 ? origImages : undefined,
          };
          // Use original post's images for display if the repost has none
          if (!imageUrl && originalPost.imageUrl) {
            imageUrl = originalPost.imageUrl;
            imageUrls = originalPost.imageUrls;
          }
        }
      }

      return {
        id: p.id,
        content,
        imageUrl,
        imageUrls,
        likesCount: p.likes_count || 0,
        commentsCount: p.comments_count || 0,
        createdAt: p.created_at,
        status: p.status,
        isRepost: repostInfo.isRepost,
        originalPost,
      };
    });
  }, [userPosts, resolvedOriginals]);

  // Stable callbacks for the memoized post card so it can short-circuit on
  // reference equality instead of receiving fresh inline lambdas every render.
  const handlePostLongPress = useCallback((enrichedPost: any) => {
    openContextMenu(enrichedPost);
  }, [openContextMenu]);

  const handlePostImagePress = useCallback((uri: string, postId: string, allImages: string[]) => {
    setViewingImage({ uri, postId, allImages });
  }, []);

  // ─── Likes / Replies tab loaders ───────────────────────────────────────
  // Same lazy-fetch + per-account cache pattern as the home profile tab.
  // Fires only when the user flips into the corresponding tab.
  const loadLikedPosts = useCallback(async () => {
    if (!id || likedFetching) return;
    setLikedFetching(true);
    try {
      const cacheKey = LIKED_POSTS_CACHE_PREFIX + id;
      const cached = kvGetJSONSync<any[] | null>(cacheKey, null);
      if (Array.isArray(cached) && cached.length > 0 && likedPosts.length === 0) {
        setLikedPosts(cached);
      }

      const { posts: rows, error } = await getLikedPosts(id, { limit: 50 });
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
          createdAt: p.created_at,
          isRepost: repostInfo.isRepost,
        };
      };

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
  }, [id, likedFetching, likedPosts.length]);

  const loadUserReplies = useCallback(async () => {
    if (!id || repliesFetching) return;
    setRepliesFetching(true);
    try {
      const cacheKey = USER_REPLIES_CACHE_PREFIX + id;
      const cached = kvGetJSONSync<ProfileReply[] | null>(cacheKey, null);
      if (Array.isArray(cached) && cached.length > 0 && userReplies.length === 0) {
        setUserReplies(cached);
      }

      const { replies: rows, error } = await getUserComments(id, { limit: 50 });
      if (error || !rows) {
        setRepliesLoaded(true);
        return;
      }

      // Resolve repost chains for parent posts so the preview reflects
      // the ORIGINAL post the reply is responding to. Same pattern as
      // the home profile screen.
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
        const { data: originals } = await supabase
          .from('posts')
          .select('id, content, image_url')
          .in('id', originalIds);
        if (originals) {
          for (const o of originals) originalsMap[o.id] = o;
        }
      }

      const buildReply = (c: any): ProfileReply => {
        const parent = Array.isArray(c.posts) ? c.posts[0] : c.posts;
        const parentAuthor = parent
          ? (Array.isArray(parent.profiles) ? parent.profiles[0] : parent.profiles)
          : null;
        let snippetSource: string = parent?.content || '';
        let imageSource: string | null | undefined = parent?.image_url;
        if (snippetSource.startsWith('::repost::')) {
          const rest = snippetSource.slice('::repost::'.length);
          const sep = rest.indexOf('::');
          const originalId = sep >= 0 ? rest.slice(0, sep) : rest;
          const repostComment = sep >= 0 ? rest.slice(sep + 2) : '';
          const orig = originalsMap[originalId];
          if (orig) {
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
  }, [id, repliesFetching, userReplies.length]);

  useEffect(() => {
    if (activeTab === 'likes' && !likedLoaded && !likedFetching && id) {
      const handle = InteractionManager.runAfterInteractions(() => loadLikedPosts());
      return () => handle.cancel();
    }
    if (activeTab === 'replies' && !repliesLoaded && !repliesFetching && id) {
      const handle = InteractionManager.runAfterInteractions(() => loadUserReplies());
      return () => handle.cancel();
    }
  }, [activeTab, likedLoaded, likedFetching, repliesLoaded, repliesFetching, id, loadLikedPosts, loadUserReplies]);

  // Stable close handler so the memoized ProfileMenuModal doesn't see a fresh
  // function on every parent render and skip its memo bailout.
  const handleCloseMenu = useCallback(() => setShowMenu(false), []);

  const handleFollow = async () => {
    if (!currentUser?.id || !id) return;
    // Self-follow is a no-op — never insert or notify against yourself.
    if (currentUser.id === id) return;
    triggerHaptic('medium');
    if (isFollowingState) {
      setFollowCounts(c => ({ ...c, followers: Math.max(0, c.followers - 1) }));
      await queueMutation('unfollow', { followerId: currentUser.id, followingId: id });
    } else {
      setFollowCounts(c => ({ ...c, followers: c.followers + 1 }));
      await queueMutation('follow', { followerId: currentUser.id, followingId: id });
    }
  };

  // Adaptive name + @username colour driven by banner brightness. The hook
  // must be called before any conditional return so its position in the
  // hook-ordering stays stable across renders. `displayProfile` may be
  // undefined on the first paint — the hook handles null/undefined input.
  const bannerUrlForBrightness = stripBannerTransform(displayProfile?.banner_url) || undefined;
  const { isLight: bannerIsLight } = useBannerBrightness(bannerUrlForBrightness);

  if (isLoading && !displayProfile) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={theme.colors.accent.primary} /></View>;
  }

  if (!displayProfile) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="body" color={theme.colors.text.tertiary}>{t('profile.user_not_found')}</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}><Text variant="body" color={theme.colors.accent.primary}>{t('common.back')}</Text></Pressable>
      </View>
    );
  }

  const isOwnProfile = currentUser?.id === displayProfile.id;
  const bannerUrlRaw = displayProfile.banner_url as string | null | undefined;
  // Banner URL is stored with an optional `#x=&y=&s=` hash carrying the
  // user-chosen position + zoom (see src/utils/bannerTransform.ts). The
  // hash must be stripped before the value goes through the image
  // proxy — `proxiedImageUrl` would otherwise percent-encode it.
  const bannerUrl = stripBannerTransform(bannerUrlRaw) || undefined;
  // Memoize the parsed transform — needed for both the JSX banner image
  // and the listHeader useMemo's dep list. Without memoization, every
  // render returns a fresh {translateX, translateY, scale} object and
  // the listHeader memo would never short-circuit.
  const bannerTransform = useMemo(() => parseBannerTransform(bannerUrlRaw), [bannerUrlRaw]);
  // Memoize the userLinks parse — was running on every render. The links
  // string can be ~50–500 chars depending on how many social URLs the user
  // saved; parsing it 60×/sec while the profile re-renders during scroll
  // is wasted work. Keyed on the raw string so a profile-edit invalidates.
  const profileLinksRaw = displayProfile.links;
  const userLinks = useMemo<{ type: string; url: string }[]>(() => {
    if (!profileLinksRaw) return [];
    if (typeof profileLinksRaw !== 'string') return profileLinksRaw as any;
    try { return JSON.parse(profileLinksRaw); } catch { return []; }
  }, [profileLinksRaw]);
  const tabs = useMemo<{ key: TabName; label: string }[]>(
    () => [
      { key: 'posts', label: t('profile.posts') },
      { key: 'replies', label: t('profile.replies') },
      { key: 'media', label: t('profile.media') },
      { key: 'likes', label: t('profile.likes') },
    ],
    [t],
  );

  // ─── ListHeaderComponent — memoized ────────────────────────────────────
  // Why memoize: same reasoning as (tabs)/profile.tsx. FlatList passes the
  // JSX through untouched; the reconciler still walks every child of the
  // header on every parent re-render. Caching the JSX value short-circuits
  // the walk when state unrelated to the header (likedFetching, viewing
  // image, follow toggling, etc.) flips. Dominant cost previously was the
  // dual-Text adaptive-colour crossfade — replaced with a single
  // Animated.Text + native-driver opacity nudge.
  const listHeader = (
    <>
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
            proxyWidth={1080}
          />
        ) : null}
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)']} locations={[0.4, 1]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 140 }} pointerEvents="none" />
        <LinearGradient colors={['transparent', theme.colors.background.primary]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 48 }} pointerEvents="none" />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: -140, paddingHorizontal: 8 }}>
        <View style={{ flex: 1 }}>
          <AdaptiveProfileText
            isLight={bannerIsLight}
            darkBgColor="rgba(255,255,255,0.92)"
            lightBgColor={theme.colors.text.secondary}
            numberOfLines={1}
            style={{
              textAlign: 'right',
              fontSize: 13,
              textShadowColor: 'rgba(0,0,0,0.45)',
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 2,
              marginRight: 12,
            }}
          >
            @{displayProfile.username}
          </AdaptiveProfileText>
        </View>
        <View style={{ width: 72, height: 72, borderRadius: 36, overflow: 'hidden', borderWidth: 3, borderColor: theme.colors.background.primary, backgroundColor: theme.isDark ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' }}>
          <Avatar emoji={displayProfile.emoji || '😊'} size="lg" />
        </View>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 12 }}>
          <AdaptiveProfileText
            isLight={bannerIsLight}
            darkBgColor="#FFFFFF"
            lightBgColor={theme.colors.text.primary}
            numberOfLines={1}
            style={{
              flexShrink: 1,
              fontSize: 15,
              fontWeight: '700',
              textShadowColor: 'rgba(0,0,0,0.45)',
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 2,
            }}
          >
            {displayProfile.display_name}
          </AdaptiveProfileText>
          {displayProfile.is_verified && <VerifiedBadge size={13} />}
          {displayProfile.badge && <UserBadge badge={displayProfile.badge} size="sm" />}
        </View>
      </View>
      {!isOwnProfile && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 }}>
          {fromChat !== '1' && (
            <Pressable
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: displayProfile.id } })}
              style={{ width: 32, height: 32, borderRadius: 16, overflow: 'hidden' }}
            >
              {chromeReady ? (
                <BlurView intensity={70} tint={theme.isDark ? 'dark' : 'light'} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="send" size={14} color={theme.colors.text.primary} />
                </BlurView>
              ) : (
                <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)' }}>
                  <Feather name="send" size={14} color={theme.colors.text.primary} />
                </View>
              )}
            </Pressable>
          )}
          <Pressable
            onPress={handleFollow}
            style={{
              minWidth: 96,
              height: 32,
              paddingHorizontal: 16,
              backgroundColor: isFollowingState ? 'transparent' : theme.colors.accent.primary,
              borderWidth: isFollowingState ? 1 : 0,
              borderColor: theme.colors.border.medium,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              variant="caption"
              weight="semibold"
              color={isFollowingState ? theme.colors.text.primary : '#FFFFFF'}
              align="center"
              style={{ fontSize: 13, lineHeight: 16 }}
            >
              {isFollowingState ? t('profile.unfollow') : t('profile.follow')}
            </Text>
          </Pressable>
        </View>
      )}
      {(displayProfile.bio || userLinks.length > 0) && (
        <View style={{ marginTop: isOwnProfile ? 12 : 14, alignItems: 'center', paddingHorizontal: 8 }}>
          {displayProfile.bio ? (
            <LinkedText
              style={{
                textAlign: 'center',
                color: theme.colors.text.secondary,
              }}
            >
              {displayProfile.bio}
            </LinkedText>
          ) : null}
          {userLinks.length > 0 && (
            <View style={{ flexDirection: 'row', marginTop: displayProfile.bio ? 10 : 0, gap: 8, justifyContent: 'center' }}>
              {userLinks.map((link: any, idx: number) => <SocialLinkIcon key={idx} type={link.type} url={link.url} />)}
            </View>
          )}
        </View>
      )}
      <View style={{ marginTop: 16, marginHorizontal: -16, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
        <View style={{ flexDirection: 'row' }}>
          {tabs.map((tab) => (
            <Pressable key={tab.key} onPress={() => {
              triggerHaptic('selection');
              setActiveTab(tab.key);
            }} style={{ flex: 1, alignItems: 'center', paddingVertical: 11 }}>
              <Text variant="caption" weight={activeTab === tab.key ? 'bold' : 'regular'} color={activeTab === tab.key ? theme.colors.text.primary : theme.colors.text.tertiary}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ position: 'absolute', bottom: 0, height: 2, backgroundColor: theme.colors.accent.primary, width: SCREEN_WIDTH / 4, left: tabs.findIndex(t => t.key === activeTab) * (SCREEN_WIDTH / 4) }} />
      </View>
      <View style={{ height: 12 }} />
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header gradient overlay - smooth opacity based on scroll */}
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, height: insets.top + 50, opacity: headerOpacity }} pointerEvents="none">
        <LinearGradient colors={[theme.colors.background.primary, theme.colors.background.primary, theme.colors.background.primary + '00']} locations={[0, 0.6, 1]} style={{ flex: 1 }} />
      </Animated.View>

      {/* Fixed header buttons - animate out on scroll. The redesigned
          layout drops compact follow-stat pills between the back button
          and the menu button so the counters stay within thumb reach
          regardless of scroll position; they fade out via
          `centerStatsOpacity` once the banner has scrolled past, which
          is also when the floating "follow" badge takes over. */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 100 }}>
        <Animated.View style={{ transform: [{ translateX: buttonsTranslateX }] }}>
          <Pressable onPress={() => router.back()} style={{ borderRadius: 17, overflow: 'hidden' }}>
            {chromeReady ? (
              <BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="chevron-left" size={18} color="#FFFFFF" />
              </BlurView>
            ) : (
              <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
                <Feather name="chevron-left" size={18} color="#FFFFFF" />
              </View>
            )}
          </Pressable>
        </Animated.View>
        <Animated.View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: centerStatsOpacity, transform: [{ scale: centerStatsScale }] }}>
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
        <Animated.View style={{ transform: [{ translateX: menuTranslateX }] }}>
          <Pressable onPress={() => { triggerHaptic('light'); setShowMenu(true); }} style={{ borderRadius: 17, overflow: 'hidden' }}>
            {chromeReady ? (
              <BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="more-horizontal" size={18} color="#FFFFFF" />
              </BlurView>
            ) : (
              <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
                <Feather name="more-horizontal" size={18} color="#FFFFFF" />
              </View>
            )}
          </Pressable>
        </Animated.View>
      </View>

      <Animated.FlatList
        data={
          activeTab === 'posts'
            ? (postsReady ? displayPosts : [])
            : activeTab === 'likes'
              ? likedPosts
              : activeTab === 'replies'
                ? userReplies
                : []
        }
        keyExtractor={(item: any) => item.id}
        renderItem={({ item }: { item: any }) => {
          if (activeTab === 'replies') {
            return <ProfileReplyCard reply={item as ProfileReply} />;
          }
          if (activeTab === 'likes') {
            return (
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
            );
          }
          return (
            <UserProfilePostCard
              post={item}
              authorName={displayProfile.display_name}
              authorUsername={displayProfile.username}
              authorEmoji={displayProfile.emoji || '😊'}
              authorVerified={displayProfile.is_verified}
              authorBadge={displayProfile.badge}
              authorId={displayProfile.id}
              postEmoji={postEmoji}
              onLongPress={handlePostLongPress}
              onImagePress={handlePostImagePress}
            />
          );
        }}
        // Virtualization tuned for weak Android / iPhone 12. Keeps the
        // mounted card count low so gesture handlers, FormattedText, and any
        // LinkPreview unfurls don't all sit on the UI thread at once — the
        // root cause of `SLOW ui<30 @ profile/[id]`.
        initialNumToRender={3}
        maxToRenderPerBatch={2}
        windowSize={5}
        updateCellsBatchingPeriod={100}
        removeClippedSubviews={true}
        showsVerticalScrollIndicator={false}
        bounces={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        // Posts get a 16px gutter; the banner + tabs in the header extend
        // edge-to-edge via negative horizontal margins below.
        contentContainerStyle={{ paddingBottom: 100, paddingHorizontal: 16, paddingTop: 12 }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={(
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Text variant="caption" color={theme.colors.text.tertiary}>
              {activeTab === 'posts' ? t('profile.no_posts') : t('profile.empty_section')}
            </Text>
          </View>
        )}
      />

      {/* Bottom gradient - always visible */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, zIndex: 90 }} pointerEvents="none">
        <LinearGradient colors={['transparent', theme.colors.background.primary]} locations={[0, 0.8]} style={{ flex: 1 }} />
      </View>

      {/* Floating badge - animated */}
      {!isOwnProfile && (
        <Animated.View style={{ position: 'absolute', bottom: 28, left: 0, right: 0, alignItems: 'center', zIndex: 100, opacity: badgeOpacity, transform: [{ translateY: badgeTranslateY }] }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, gap: 8,
            borderRadius: 20,
            backgroundColor: theme.isDark ? 'rgba(22,22,22,0.95)' : 'rgba(255,255,255,0.95)',
            shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 6,
            borderWidth: 0.5, borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
          }}>
            <Avatar emoji={displayProfile.emoji || '😊'} size="xs" />
            <Text variant="caption" weight="semibold" numberOfLines={1} style={{ maxWidth: 100 }}>{displayProfile.display_name}</Text>
            {displayProfile.is_verified && <VerifiedBadge size={10} />}
            <Pressable onPress={handleFollow} style={{ paddingHorizontal: 12, paddingVertical: 5, backgroundColor: isFollowingState ? 'transparent' : theme.colors.accent.primary, borderWidth: isFollowingState ? 1 : 0, borderColor: theme.colors.border.medium, borderRadius: 12 }}>
              <Text variant="caption" weight="semibold" color={isFollowingState ? theme.colors.text.primary : '#FFFFFF'} style={{ fontSize: 11 }}>{isFollowingState ? t('profile.unfollow') : t('profile.follow')}</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}

      <ProfileMenuModal visible={showMenu} profile={displayProfile} onClose={handleCloseMenu} />
      <FollowsListModal visible={!!followsModal} mode={followsModal || 'followers'} userId={displayProfile?.id || null} onClose={() => setFollowsModal(null)} />

      {/* Fullscreen Image Viewer */}
      <Modal visible={!!viewingImage} transparent animationType="none" onRequestClose={() => setViewingImage(null)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }}>
          {/* Top bar with gradient blur */}
          <LinearGradient colors={['rgba(0,0,0,0.8)', 'rgba(0,0,0,0.5)', 'transparent']} locations={[0, 0.6, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 80, zIndex: 10 }}>
            <View style={{ position: 'absolute', top: insets.top + 12, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              {/* Author info */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Avatar emoji={displayProfile?.emoji || '😊'} size="xs" />
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Text variant="caption" weight="semibold" color="#FFFFFF" style={{ fontSize: 11 }}>{displayProfile?.display_name || 'User'}</Text>
                    {displayProfile?.is_verified && <VerifiedBadge size={10} />}
                  </View>
                  {viewingImage && <Text variant="caption" color="rgba(255,255,255,0.6)" style={{ fontSize: 9 }}>{(() => { const p = displayPosts.find((pp: any) => pp.id === viewingImage.postId); return p?.createdAt ? formatTimeAgo(p.createdAt) : ''; })()}</Text>}
                </View>
              </View>
              {/* Close */}
              <Pressable onPress={() => setViewingImage(null)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="x" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
          </LinearGradient>

          {/* Image — zoomable + horizontal scroll for multi-image */}
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            {viewingImage && (
              viewingImage.allImages && viewingImage.allImages.length > 1 ? (
                <RNScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center' }}>
                  {viewingImage.allImages.map((imgUri, idx) => (
                    <RNScrollView key={idx} maximumZoomScale={3} minimumZoomScale={1} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ justifyContent: 'center', alignItems: 'center', width: SCREEN_WIDTH, height: '100%' }} centerContent bouncesZoom>
                      <CachedImage uri={imgUri} style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH }} resizeMode="contain" />
                    </RNScrollView>
                  ))}
                </RNScrollView>
              ) : (
                <RNScrollView maximumZoomScale={3} minimumZoomScale={1} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ justifyContent: 'center', alignItems: 'center', flex: 1 }} centerContent bouncesZoom>
                  <CachedImage uri={viewingImage.uri} style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH }} resizeMode="contain" />
                </RNScrollView>
              )
            )}
          </View>

          {/* Description (if exists) — for reposts, fall back to the original post's content */}
          {viewingImage && (() => {
            const post = displayPosts.find((pp: any) => pp.id === viewingImage.postId);
            const caption = post?.content || post?.originalPost?.content || '';
            return caption ? (
              <RNScrollView style={{ maxHeight: 60, marginHorizontal: 24, marginBottom: 8 }} showsVerticalScrollIndicator={false}>
                <Text variant="caption" color="rgba(255,255,255,0.8)" style={{ fontSize: 12 }}>{caption}</Text>
              </RNScrollView>
            ) : null;
          })()}

          {/* Bottom actions — compact rounded container, centered */}
          <View style={{ alignItems: 'center', paddingBottom: insets.bottom + 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 24, paddingHorizontal: 20, paddingVertical: 10 }}>
              {isOwnProfile && (
                <Pressable onPress={() => { 
                  if (viewingImage) {
                    const post = displayPosts.find((p: any) => p.id === viewingImage.postId);
                    useFeedStore.getState().setEditingPost({ id: viewingImage.postId, content: post?.content || '', imageUrl: post?.imageUrl, imageUrls: post?.imageUrls && post.imageUrls.length > 0 ? post.imageUrls : (post?.imageUrl ? [post.imageUrl] : undefined) });
                  }
                  setViewingImage(null); 
                  router.push('/(tabs)/create'); 
                }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="edit-2" size={16} color="#FFFFFF" />
                </Pressable>
              )}
              <Pressable onPress={async () => { if (viewingImage) { const post = displayPosts.find((p: any) => p.id === viewingImage.postId); const caption = post?.content || post?.originalPost?.content || ''; const { shareImageUrl } = require('../../src/utils/sharePost'); await shareImageUrl(viewingImage.uri, caption); } }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="share" size={16} color="#FFFFFF" />
              </Pressable>
              {isOwnProfile && (
                <Pressable onPress={() => { if (viewingImage) { Alert.alert(t('profile.delete_post_title'), t('profile.delete_post_msg'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.delete'), style: 'destructive', onPress: async () => { if (currentUser?.id) { await deletePost(viewingImage.postId, currentUser.id); } setViewingImage(null); } }]); } }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,60,50,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="trash-2" size={16} color="#FF3B30" />
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>
      <PostContextMenu visible={!!contextPost} post={contextPost} isOwnPost={isOwnProfile} onClose={closeContextMenu} onDelete={isOwnProfile ? async (postId) => { if (currentUser?.id) { await deletePost(postId, currentUser.id); } closeContextMenu(); } : undefined} />
    </View>
  );
}
