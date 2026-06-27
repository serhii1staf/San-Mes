import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Pressable, ActivityIndicator, Image, Dimensions, Modal, Animated, Share, Alert, ScrollView as RNScrollView, InteractionManager, Text as RNText } from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { LinkedText } from '../../src/components/ui/LinkedText';
import { ModalStatusBar } from '../../src/components/ui/ModalStatusBar';
import { parseImageUrls, getProfile, getFollowCounts, deletePost, isRepost, getLikedPosts, getUserComments } from '../../src/lib/supabase';
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
import { EditProfileTabModal } from '../../src/components/profile/EditProfileTabModal';
import { useProfileAppearanceStore } from '../../src/store/profileAppearanceStore';
import { useScreenCaptureGuard } from '../../src/hooks/useScreenCaptureGuard';
import { ScreenshotShield } from '../../src/components/ui/ScreenshotShield';
import { PanResponder } from 'react-native';
import { useContextMenuGuard } from '../../src/hooks/useContextMenuGuard';
import { useT } from '../../src/i18n/store';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useBlockedUsersStore, useIsBlocked } from '../../src/store/blockedUsersStore';
import { submitReport } from '../../src/services/moderation';
import { parseBannerTransform, stripBannerTransform } from '../../src/utils/bannerTransform';
import { useBannerBrightness } from '../../src/hooks/useBannerBrightness';
import { kvGetJSONSync, kvSetJSON } from '../../src/services/kvStore';
import { useLiquidGlassActive, NativeGlassView } from '../../src/components/ui/LiquidGlass';
import { HeaderSceneLayer } from '../../src/components/profile/HeaderSceneLayer';
import { HeaderBackgroundLayer } from '../../src/components/profile/HeaderBackgroundLayer';
import { normalizeScene } from '../../src/services/headerScene';
import { useIsFocused } from '@react-navigation/native';
// Seasonal Profile Themes (task 6.2) — render the viewed profile in its owner's
// public theme. Background + ambient layers are SIBLINGS BENEATH the content
// (never wrap a glass view); themed controls read accents from the scope context.
import { resolveProfileTheme, PROFILE_THEMES_ENABLED, DEFAULT_THEME } from '../../src/theme/profileThemes';
import { ProfileThemeScope } from '../../src/components/profile/ProfileThemeScope';
import { ProfileThemeBackground } from '../../src/components/profile/ProfileThemeBackground';
import { useAmbientAnimationGate } from '../../src/hooks/useAmbientAnimationGate';
import { ThemedMenuTrigger } from '../../src/components/profile/ThemedMenuTrigger';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const LIKED_POSTS_CACHE_PREFIX = '@san:liked_posts:';
const USER_REPLIES_CACHE_PREFIX = '@san:user_replies:';
// Truly-constant, theme-independent values hoisted to module scope so they
// are allocated once instead of re-created on every screen render (a fresh
// `contentContainerStyle` / `data` reference makes FlatList do extra work).
const LIST_CONTENT_CONTAINER_STYLE = { paddingBottom: 100, paddingHorizontal: 16, paddingTop: 12 } as const;
const EMPTY_LIST: any[] = [];
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

// Compact count formatter for the inline profile stats row ("14.8K", "1.2M").
function formatCount(n: number): string {
  if (!n || n < 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1).replace('.0', '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace('.0', '') + 'K';
  return String(n);
}

// Labeled social-link pill (icon + platform name) for the redesigned, left-
// aligned profile header — matches the Instagram/TikTok-style chips in the
// target mockup. Reuses the same brand-icon mapping as `SocialLinkIcon`.
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
  // Liquid glass when active (icon + label live INSIDE the glass as children —
  // the proven non-warping pattern); translucent fill otherwise.
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

// Unified action pill for the profile header — liquid glass (interactive, with
// the morph animation) when glass is enabled, otherwise the SAME BlurView used
// for the floating Settings/back chrome. `accent` paints the primary CTA fill.
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
    // Fire-and-forget server submission — `submitReport` never throws, but
    // guard anyway so a rejected promise can't surface as an unhandled
    // rejection. The block flow stays separate (the store syncs that).
    void submitReport({ targetType: 'profile', targetId: profile.id, category: cat }).catch(() => {});
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
      <ModalStatusBar />
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
  // Screen-capture protection: if the VIEWED account turned screenshots off,
  // block capture while their profile is on screen. Per-account flag, read from
  // the already-fetched profile in the entity store (no polling). Android fully
  // blocks; iOS blocks recording and shows the 🙈 shield on a screenshot.
  const screenshotsOff = useEntityStore((s) => !!(s.profiles?.[id || ''] as any)?.screenshots_disabled);
  const { screenshotDetected } = useScreenCaptureGuard(screenshotsOff, 'profile-' + (id || ''));
  // Field selector — destructuring the whole store re-rendered this screen on
  // every unrelated auth-state change (badge sync, token refresh, etc.).
  const currentUser = useAuthStore((s) => s.user);
  // Viewer-side decoration shared with the home profile tab — drives the
  // faint emoji / pixel-icon pattern on every visible post card. Stable
  // string so memoized cards only re-render when it actually changes.
  const postEmoji = useProfileAppearanceStore((s) => s.postEmoji);
  // Native iOS-26 liquid glass for the floating header chrome (back / more
  // buttons + follower/following pills). Active only when the toggle is on
  // AND the device supports it; otherwise the BlurView fallback renders.
  const glassActive = useLiquidGlassActive();
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
  // Floating follow widget visibility — spring-driven SLIDE (smooth), toggled
  // when the user scrolls past a threshold rather than mapped 1:1 to scroll
  // position (that felt abrupt). Slide-only (no opacity) so the glass keeps
  // drawing. Hysteresis avoids flip-flop at the threshold.
  const [followWidgetVisible, setFollowWidgetVisible] = useState(false);
  const widgetSlide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(widgetSlide, {
      toValue: followWidgetVisible ? 1 : 0,
      useNativeDriver: true,
      tension: 55,
      friction: 11,
    }).start();
  }, [followWidgetVisible, widgetSlide]);
  const onProfileScrollY = useCallback((e: any) => {
    const y = e?.nativeEvent?.contentOffset?.y ?? 0;
    setFollowWidgetVisible((prev) => (prev ? y > 170 : y > 230));
  }, []);
  const widgetTranslateY = useMemo(
    () => widgetSlide.interpolate({ inputRange: [0, 1], outputRange: [150, 0] }),
    [widgetSlide],
  );
  // Memoize interpolations so each is allocated once, not per-render. Each
  // re-render of this screen otherwise creates 5 new AnimatedInterpolation
  // nodes that the same scrollY then has to drive.
  const headerOpacity = useMemo(
    () => scrollY.interpolate({ inputRange: [0, 36, 210], outputRange: [0, 0, 1], extrapolate: 'clamp' }),
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
    () => scrollY.interpolate({ inputRange: [180, 220], outputRange: [140, 0], extrapolate: 'clamp' }),
    [scrollY],
  );

  // ─── Pinned (sticky) category tab bar ──────────────────────────────────
  // The inline tabs row inside `listHeader` scrolls away with the banner. We
  // mirror it in an absolutely-positioned OVERLAY that reveals once the user
  // scrolls the inline row up under the top chrome, so switching tabs stays
  // reachable while posts keep scrolling. All hooks here are unconditional and
  // declared BEFORE the loading / not-found guards (which live at the end of
  // the component, after every hook) so the hook order stays stable across
  // renders. Reuses the existing native-driven `scrollY` (the same
  // `Animated.event` that already drives the header chrome); we only ADD a
  // separate `addListener` below for the visibility threshold.
  //
  // `tabsOffsetY` is the inline tabs row's offset within the scroll content
  // (captured via onLayout below, plus the content paddingTop of 12 from
  // LIST_CONTENT_CONTAINER_STYLE). The pinned bar sits at `pinnedBarTop`; the
  // inline row reaches it when `scrollY === tabsOffsetY - pinnedBarTop` —
  // that's the reveal threshold.
  //
  // STICKY FIX: the fixed top chrome (back / menu buttons row, below) is laid
  // out at `insets.top + TOP_CHROME_INSET` and is `TOP_CHROME_BTN` px tall.
  // `chromeHeight` is therefore the distance from the screen top to the BOTTOM
  // edge of that chrome. Pinning the overlay at exactly that y makes it sit
  // FLUSH under the chrome (no empty gap above it), so the tabs read as a true
  // sticky header instead of a separate floating bar. Because the reveal
  // threshold is `tabsOffsetY - pinnedBarTop` and `pinnedBarTop === chromeHeight`,
  // the threshold is exactly "the measured inline-tabs offset minus the chrome
  // height" — so the inline row hands off to the overlay pixel-aligned (no jump,
  // no gap) the instant it reaches the bottom of the chrome.
  const TOP_CHROME_INSET = 8; // vertical offset of the floating buttons row
  const TOP_CHROME_BTN = 34;  // back / menu button height
  const chromeHeight = insets.top + TOP_CHROME_INSET + TOP_CHROME_BTN;
  const pinnedBarTop = chromeHeight;
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
  // flips a boolean ONLY when scrollY crosses the threshold (compared against a
  // ref), so we never setState on every scroll frame. Removed on unmount,
  // re-created when the measured offset changes. This is a SEPARATE listener —
  // it does not touch the existing native-driven `onScroll` Animated.event.
  useEffect(() => {
    const threshold = tabsOffsetY > pinnedBarTop ? tabsOffsetY - pinnedBarTop : Number.MAX_SAFE_INTEGER;
    const listenerId = scrollY.addListener(({ value }: { value: number }) => {
      const shouldShow = value >= threshold;
      if (shouldShow !== pinnedTabsVisibleRef.current) {
        pinnedTabsVisibleRef.current = shouldShow;
        setPinnedTabsVisible(shouldShow);
      }
    });
    return () => scrollY.removeListener(listenerId);
  }, [scrollY, tabsOffsetY, pinnedBarTop]);

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

      // Resolve the REAL follow state from the server and write it into the
      // entity store. The store only knew about follows set optimistically
      // this session (or via syncFollows), so on a fresh profile open / cold
      // start the button could show "Подписаться" even though the DB row
      // exists. Reconciling here makes the button reflect server truth on
      // every profile open, regardless of session or cache. Self-profiles
      // are skipped (you can't follow yourself).
      if (currentUser?.id && id && currentUser.id !== id) {
        import('../../src/lib/supabase').then(({ isFollowing }) =>
          isFollowing(currentUser.id, id).then((following) => {
            const entity = useEntityStore.getState();
            if (following) entity.setFollow(currentUser.id, id);
            else entity.removeFollow(currentUser.id, id);
          }).catch(() => {})
        ).catch(() => {});
      }
    });
    return () => handle.cancel();
  }, [id]);

  // Display profile: prefer cached from store, fallback to direct fetch
  const displayProfile = cachedProfile || fallbackProfile;

  // ─── Seasonal Profile Themes (task 6.2) ────────────────────────────────
  // Render the viewed profile in its OWNER's public theme. The raw theme_id is
  // read off the fetched/cached profile row; resolveProfileTheme maps a missing
  // or unknown id to the Default_Theme (Req 4.1, 4.3, 5.1, 5.2). All hooks here
  // run unconditionally and BEFORE the loading/not-found guards below, so the
  // hook order stays stable across renders (see rules-of-hooks note).
  const screenFocused = useIsFocused();
  // True while a drag / momentum scroll is in progress — freezes the ambient
  // particles within 100 ms and resumes within 200 ms (Req 6.2, 6.3).
  const [scrollActive, setScrollActive] = useState(false);
  const profileThemeId = (displayProfile as any)?.theme_id as string | null | undefined;
  const resolvedProfileTheme = useMemo(() => (PROFILE_THEMES_ENABLED ? resolveProfileTheme(profileThemeId) : DEFAULT_THEME), [profileThemeId]);
  const ambientGate = useAmbientAnimationGate(resolvedProfileTheme);
  // Illustration load fallback: on error / 5 s timeout drop to palette-only
  // while keeping the palette + accents (Req 4.5). Reset when the theme changes.
  const [illustrationFailed, setIllustrationFailed] = useState(false);
  useEffect(() => { setIllustrationFailed(false); }, [profileThemeId]);
  const themeIllustration = illustrationFailed ? null : resolvedProfileTheme.backgroundIllustration;

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
    // Phase 5: bulk-fetch each original post via the Worker. There's no
    // batched endpoint, but the dependency tree is rarely deeper than
    // 1-2 levels and the count of repost-originals on a profile screen
    // is small (page size 25). We parallelise with Promise.all.
    (async () => {
      const { apiGet } = await import('../../src/services/apiClient');
      const fetched = await Promise.all(
        repostOriginalIds.map((oid) =>
          apiGet<any>(`/v1/posts/${encodeURIComponent(oid)}`).then((r) => r.data).catch(() => null),
        ),
      );
      const data = fetched.filter(Boolean) as any[];
      if (data.length === 0) return;
      const map: Record<string, any> = { ...resolvedOriginals };
      for (const o of data) map[o.id] = o;
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
        const deeper = await Promise.all(
          deeperIds.map((oid) =>
            apiGet<any>(`/v1/posts/${encodeURIComponent(oid)}`).then((r) => r.data).catch(() => null),
          ),
        );
        for (const dp of deeper) if (dp) map[dp.id] = dp;
      }
      setResolvedOriginals(map);
    })();
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

  // ─── Stable FlatList accessors ─────────────────────────────────────────
  // Inline `renderItem` and `keyExtractor` were rebuilt on every parent
  // render — including every haptic, scroll-driven state flip, and (most
  // expensively) every tab tap. FlatList saw fresh function references
  // and re-evaluated every cell on every render, which is why the user
  // saw a re-render storm on rapid Posts ↔ Replies ↔ Likes ↔ Media
  // switching: each tap fired ~6 visible cells through the renderItem
  // path twice (once because activeTab changed, once because the
  // function reference itself changed). Hoisting the closures and the
  // key extractor out of JSX collapses that work to "only when the
  // dependency actually changed".
  const keyExtractor = useCallback((item: any) => item.id, []);

  const renderReplyItem = useCallback(
    ({ item }: { item: any }) => <ProfileReplyCard reply={item as ProfileReply} />,
    [],
  );

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

  // Fields read by the Posts-tab card. Hoisted so the closure depends
  // on primitives (stable across most renders) instead of the whole
  // `displayProfile` object reference, which changes whenever anything
  // about the profile flips (badge sync, follow count update, etc.).
  const cardAuthorName = displayProfile?.display_name || 'User';
  const cardAuthorUsername = displayProfile?.username || 'user';
  const cardAuthorEmoji = displayProfile?.emoji || '😊';
  const cardAuthorVerified = displayProfile?.is_verified;
  const cardAuthorBadge = displayProfile?.badge;
  const cardAuthorId = displayProfile?.id;
  const renderPostItem = useCallback(
    ({ item }: { item: any }) => (
      <UserProfilePostCard
        post={item}
        authorName={cardAuthorName}
        authorUsername={cardAuthorUsername}
        authorEmoji={cardAuthorEmoji}
        authorVerified={cardAuthorVerified}
        authorBadge={cardAuthorBadge}
        authorId={cardAuthorId}
        postEmoji={postEmoji}
        onLongPress={handlePostLongPress}
        onImagePress={handlePostImagePress}
      />
    ),
    [
      cardAuthorName,
      cardAuthorUsername,
      cardAuthorEmoji,
      cardAuthorVerified,
      cardAuthorBadge,
      cardAuthorId,
      postEmoji,
      handlePostLongPress,
      handlePostImagePress,
    ],
  );

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

      const { posts: rows, error } = await getLikedPosts(id, { limit: 25 });
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

      const { replies: rows, error } = await getUserComments(id, { limit: 25 });
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

  // Wrapped in useCallback so the memoized listHeader (which lists this
  // in its deps) keeps a stable reference between renders. Without the
  // wrap every parent re-render allocated a fresh function and the
  // header memo invalidated for nothing — the very issue the memo was
  // supposed to fix.
  const handleFollow = useCallback(async () => {
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
  }, [currentUser?.id, id, isFollowingState]);

  // Adaptive name + @username colour driven by banner brightness. The hook
  // must be called before any conditional return so its position in the
  // hook-ordering stays stable across renders. `displayProfile` may be
  // undefined on the first paint — the hook handles null/undefined input.
  const bannerUrlForBrightness = stripBannerTransform(displayProfile?.banner_url) || undefined;
  const { isLight: bannerIsLight } = useBannerBrightness(bannerUrlForBrightness);

  // ⚠️ Rules-of-hooks: do NOT early-return here. Many hooks below (bannerTransform,
  // userLinks, settings selectors, editingTabKey, tabs, listHeader useMemo) must run
  // on EVERY render. Returning early while the profile is still loading made later
  // renders call MORE hooks than the loading render → "Rendered more hooks than
  // during the previous render" → a hard Hermes EXC_BAD_ACCESS crash (seen opening
  // an uncached profile from search). The loading / not-found guards are relocated
  // to just before the main return, AFTER all hooks. Every displayProfile deref
  // between here and there is null-safe.
  const isOwnProfile = currentUser?.id === displayProfile?.id;
  const bannerUrlRaw = displayProfile?.banner_url as string | null | undefined;
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
  const profileLinksRaw = displayProfile?.links;
  const userLinks = useMemo<{ type: string; url: string }[]>(() => {
    if (!profileLinksRaw) return [];
    if (typeof profileLinksRaw !== 'string') return profileLinksRaw as any;
    try { return JSON.parse(profileLinksRaw); } catch { return []; }
  }, [profileLinksRaw]);
  // Long-press tab customization — own profile only. The dynamic profile
  // route IS sometimes used to navigate to one's own profile, so we still
  // read the customizations here, just gated on `isOwnProfile` below.
  const profileTabsCustom = useSettingsStore((s) => s.profileTabsCustom);
  const setProfileTabCustom = useSettingsStore((s) => s.setProfileTabCustom);
  const clearProfileTabCustom = useSettingsStore((s) => s.clearProfileTabCustom);
  const [editingTabKey, setEditingTabKey] = useState<TabName | null>(null);
  const tabs = useMemo<{ key: TabName; label: string; defaultLabel: string; emoji?: string }[]>(
    () => {
      const defaults: { key: TabName; defaultLabel: string }[] = [
        { key: 'posts', defaultLabel: t('profile.posts') },
        { key: 'replies', defaultLabel: t('profile.replies') },
        { key: 'media', defaultLabel: t('profile.media') },
        { key: 'likes', defaultLabel: t('profile.likes') },
      ];
      // Only merge customization when THIS view is rendering the current
      // user's own profile (the dynamic profile route is sometimes used
      // for self-navigation too). Other-user profiles always render the
      // unmodified i18n defaults — read-only by design, no edit affordance.
      if (!isOwnProfile) {
        return defaults.map((d) => ({ key: d.key, label: d.defaultLabel, defaultLabel: d.defaultLabel }));
      }
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
    [t, profileTabsCustom, isOwnProfile],
  );

  // ─── ListHeaderComponent — memoized ────────────────────────────────────
  // Why memoize: same reasoning as (tabs)/profile.tsx. FlatList passes the
  // JSX through untouched; the reconciler still walks every child of the
  // header on every parent re-render. Caching the JSX value short-circuits
  // the walk when state unrelated to the header (likedFetching, viewing
  // image, follow toggling, etc.) flips. Dominant cost previously was the
  // dual-Text adaptive-colour crossfade — replaced with a single
  // Animated.Text + native-driver opacity nudge.
  //
  // FIX (perf hotfix after 9d62fa3 — rapid tab switching dropped to
  //   ~40 fps with a 205 ms long task right after profile mount):
  //   listHeader was a plain `const = (...)` JSX expression, so every
  //   render allocated a fresh element tree for the banner, two
  //   AdaptiveProfileText labels, the bio block, and the tabs row.
  //   The `Animated.FlatList` then handed that fresh tree to React
  //   reconciliation on every parent re-render — including the rapid
  //   `setActiveTab` chain on tab taps — which walked the entire
  //   header subtree in one frame and pushed the JS thread past the
  //   60 fps budget. useMemo with an explicit dep list short-circuits
  //   the walk at the header root for state flips unrelated to the
  //   header itself.
  const bannerHeader = useMemo(() => {
    if (!displayProfile) return null;
    const scene = normalizeScene((displayProfile as any).header_scene);
    return (
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

      {/* User-chosen background gradient — card backdrop, above the cover photo
          but below the identity content. */}
      <HeaderBackgroundLayer backgroundId={scene.background} drawing={scene.drawing} hasBanner={!!bannerUrl} blend={scene.bgBlend} />

      {/* ── Module content (left-aligned identity block, matches the mockup) ── */}
      <View style={{ paddingTop: insets.top + 52, paddingHorizontal: 20, paddingBottom: 22 }}>
        {/* Avatar — rounded square, top-left; liquid glass when enabled */}
        {glassActive ? (
          <NativeGlassView glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} style={{ width: 84, height: 84, borderRadius: 26, alignItems: 'center', justifyContent: 'center' }}>
            <Avatar emoji={displayProfile.emoji || '😊'} size="lg" />
          </NativeGlassView>
        ) : (
          <View style={{ width: 84, height: 84, borderRadius: 26, overflow: 'hidden' }}>
            <BlurView intensity={70} tint={theme.isDark ? 'dark' : 'light'} style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}>
              <Avatar emoji={displayProfile.emoji || '😊'} size="lg" />
            </BlurView>
          </View>
        )}

        {/* Name + verified + badge */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
          <Text variant="h2" weight="bold" color="#FFFFFF" numberOfLines={1} style={{ flexShrink: 1, fontSize: 24, lineHeight: 28, textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }}>{displayProfile.display_name}</Text>
          {displayProfile.is_verified && <VerifiedBadge size={18} />}
          {displayProfile.badge && <UserBadge badge={displayProfile.badge} size="md" />}
        </View>
        {/* @handle */}
        <Text variant="body" color="rgba(255,255,255,0.85)" numberOfLines={1} style={{ marginTop: 2, textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }}>@{displayProfile.username}</Text>

        {/* Social link chips (Instagram / TikTok / …) */}
        {userLinks.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {userLinks.slice(0, 5).map((lnk, i) => (
              <SocialChip key={`${lnk.url}-${i}`} url={lnk.url} theme={theme} />
            ))}
          </View>
        )}

        {/* Bio */}
        {displayProfile.bio ? (
          <View style={{ marginTop: 14 }}>
            <LinkedText style={{ color: theme.colors.text.secondary, fontSize: 15, lineHeight: 21 }}>
              {displayProfile.bio}
            </LinkedText>
          </View>
        ) : null}

        {/* Inline stats — tap opens the followers / following lists */}
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

        {/* Action row — compact rounded Подписаться / Сообщение / Поделиться.
            Liquid glass + morph when enabled; BlurView (same as the chrome
            buttons) when disabled. */}
        {!isOwnProfile && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}>
            <ActionPill glassActive={glassActive} theme={theme} accent={!isFollowingState} onPress={handleFollow}>
              {resolvedProfileTheme.emojiAccents?.follow ? <Text style={{ fontSize: 14 }}>{resolvedProfileTheme.emojiAccents.follow}</Text> : null}
              <Text variant="caption" weight="semibold" color={isFollowingState ? theme.colors.text.primary : '#FFFFFF'} style={{ fontSize: 14 }}>{isFollowingState ? t('profile.unfollow') : t('profile.follow')}</Text>
            </ActionPill>
            {fromChat !== '1' && (
              <ActionPill glassActive={glassActive} theme={theme} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: displayProfile.id } })}>
                {resolvedProfileTheme.emojiAccents?.like ? <Text style={{ fontSize: 14 }}>{resolvedProfileTheme.emojiAccents.like}</Text> : null}
                <Text variant="caption" weight="semibold" color={theme.colors.text.primary} style={{ fontSize: 14 }}>{t('profile.message', 'Сообщение')}</Text>
              </ActionPill>
            )}
            <ActionPill glassActive={glassActive} theme={theme} square onPress={async () => { triggerHaptic('light'); try { await Share.share({ message: `https://san-m-app.com/profile/${displayProfile.id}` }); } catch {} }}>
              <Feather name="share" size={16} color={theme.colors.text.primary} />
            </ActionPill>
          </View>
        )}
      </View>

      {/* User-built decorations from the profile owner — rendered for everyone
          (the scene travels on the profile row). Above content, below frost. */}
      <HeaderSceneLayer scene={scene} animate={screenFocused} />

      {/* Frosted-glass overlay — TOP layer of the card so it covers the cover
          photo AND the identity content. Opacity driven by scroll
          (`headerOpacity`): crisp at rest, frost FADES IN over everything as
          the user scrolls. pointerEvents="none" keeps the buttons tappable. */}
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
    );
  }, [theme, displayProfile, bannerUrl, bannerTransform, chromeReady, isOwnProfile, isFollowingState, fromChat, handleFollow, t, userLinks, followCounts, insets.top, glassActive]);

  // Tabs row split out so switching tabs only reconciles this light subtree —
  // the heavy banner (CachedImage + BannerFloatingLinks) keeps a stable element
  // ref and never re-renders on tab switch. Perf fix: no banner reload, no FPS drop.
  const tabsRow = useMemo(() => (
    <>
      {/* Profile category tabs — bottom hairline + sliding accent underline
          removed for a clean profile. Active tab reads as a rounded pill:
          interactive liquid glass when enabled, else a soft accent fill. */}
      <View style={{ marginTop: 16 }} onLayout={onTabsRowLayout}>
        <View style={{ flexDirection: 'row', paddingHorizontal: 4 }}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            const content = (
              <>
                {tab.emoji ? (
                  <RNText
                    allowFontScaling={false}
                    style={{
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
                onPress={() => {
                  triggerHaptic('selection');
                  setActiveTab(tab.key);
                }}
                // Long-press editor — OWN profile only.
                onLongPress={isOwnProfile ? () => { triggerHaptic('medium'); setEditingTabKey(tab.key); } : undefined}
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
          })}
        </View>
      </View>
      <View style={{ height: 12 }} />
    </>
  ), [theme, activeTab, tabs, glassActive, isOwnProfile]);

  // Compose: only `tabsRow` changes reference on tab switch, so the
  // `bannerHeader` subtree stays mounted untouched (no banner reload).
  const listHeader = useMemo(() => {
    if (!bannerHeader) return null;
    return <>{bannerHeader}{tabsRow}</>;
  }, [bannerHeader, tabsRow]);

  // Memoize the scroll plumbing handed to Animated.FlatList. A fresh
  // `Animated.event` / drag lambda on every render makes the list re-wire its
  // scroll handlers; these references are now stable (scrollY is a ref,
  // onProfileScrollY/setScrollActive are stable). Declared before the guards
  // below so the hook count stays identical on every render path.
  const onProfileScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true, listener: onProfileScrollY }),
    [scrollY, onProfileScrollY],
  );
  const handleScrollBeginDrag = useCallback(() => setScrollActive(true), []);
  const handleScrollSettle = useCallback(() => setScrollActive(false), []);

  // Loading / not-found guards — placed AFTER every hook so hook count is
  // identical on every render (see the rules-of-hooks note above).
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <ProfileThemeScope themeId={profileThemeId} scrollActive={scrollActive} screenFocused={screenFocused}>
      {/* Layer 1: themed background illustration — a SIBLING beneath the
          content (never a parent of a glass view). Renders nothing while the
          asset is null/failed so the palette gradient shows through (Req 4.4,
          4.5, 9.2). */}
      <ProfileThemeBackground
        illustration={themeIllustration}
        onError={() => setIllustrationFailed(true)}
        onTimeout={() => setIllustrationFailed(true)}
      />
      {/* Ambient particle layer removed — the theme background is now a clean
          static vector landscape (ProfileThemeScene), no snow/leaf particles. */}

      {/* (The old scroll-in dark gradient / overlay blur was removed — the
          frosted look now lives ON the rounded header card itself.) */}

      {/* Fixed header buttons - animate out on scroll. The redesigned
          layout drops compact follow-stat pills between the back button
          and the menu button so the counters stay within thumb reach
          regardless of scroll position; they fade out via
          `centerStatsOpacity` once the banner has scrolled past, which
          is also when the floating "follow" badge takes over. */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 100 }}>
        <Animated.View style={{ transform: [{ translateX: buttonsTranslateX }] }}>
          <Pressable onPress={() => router.back()} style={{ borderRadius: 17, overflow: glassActive ? undefined : 'hidden' }}>
            {glassActive ? (
              // Interactive morphing glass IS the button; icon is its child. No
              // overflow so the liquid stretch isn't clipped on touch.
              <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="chevron-left" size={18} color="#FFFFFF" />
              </NativeGlassView>
            ) : chromeReady ? (
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
        {/* Stats moved into the redesigned left-aligned header below. */}
        <View pointerEvents="none" />
        <Animated.View style={{ transform: [{ translateX: menuTranslateX }] }}>
          <Pressable onPress={() => { triggerHaptic('light'); setShowMenu(true); }} style={{ borderRadius: 17, overflow: glassActive ? undefined : 'hidden' }}>
            {glassActive ? (
              <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}>
                <ThemedMenuTrigger size={18} color="#FFFFFF" iconName="more-horizontal" />
              </NativeGlassView>
            ) : chromeReady ? (
              <BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                <ThemedMenuTrigger size={18} color="#FFFFFF" iconName="more-horizontal" />
              </BlurView>
            ) : (
              <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
                <ThemedMenuTrigger size={18} color="#FFFFFF" iconName="more-horizontal" />
              </View>
            )}
          </Pressable>
        </Animated.View>
      </View>

      <Animated.FlatList
        // Tab-driven data swap — memoized so consecutive renders within
        // the same tab hand the FlatList an IDENTICAL reference. Without
        // this the conditional was rebuilt on every parent re-render
        // (every haptic, scroll-driven state flip, follow-modal toggle),
        // which made the FlatList recompute virtualization windows even
        // though the underlying tab data hadn't actually changed.
        data={
          activeTab === 'posts'
            ? (postsReady ? displayPosts : EMPTY_LIST)
            : activeTab === 'likes'
              ? likedPosts
              : activeTab === 'replies'
                ? userReplies
                : EMPTY_LIST
        }
        keyExtractor={keyExtractor}
        renderItem={
          activeTab === 'replies'
            ? renderReplyItem
            : activeTab === 'likes'
              ? renderLikedItem
              : renderPostItem
        }
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
        onScroll={onProfileScroll}
        scrollEventThrottle={16}
        // Seasonal theme ambient pause: freeze particles while a scroll gesture
        // is in progress and resume when it settles (Req 6.2, 6.3). These are
        // lightweight JS handlers that fire only on drag start/end, so they do
        // not contend with the native-driven `onScroll` above.
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollSettle}
        onMomentumScrollEnd={handleScrollSettle}
        // Posts get a 16px gutter; the banner + tabs in the header extend
        // edge-to-edge via negative horizontal margins below.
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
          setActiveTab + own-profile long-press editor) so the two stay in
          sync — both read `activeTab` and call `setActiveTab`. Reveal is
          native-driven (opacity + slide off `scrollY`); `pointerEvents` is
          gated to the visible state so it's only tappable once shown. Sits
          BELOW the floating back/menu chrome (zIndex 100) and ABOVE the list. */}
      <Animated.View
        pointerEvents={pinnedTabsVisible ? 'auto' : 'none'}
        // Visual top is pinned to y=0 so the frosted backing fills the ENTIRE
        // top region (status-bar / safe-area zone included) as one solid bar.
        // The reveal threshold math still anchors off `pinnedBarTop`
        // (= chromeHeight) via the opacity/translateY interpolations above, so
        // the inline tabs hand off pixel-aligned — only the visual top changed.
        style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, opacity: pinnedTabsOpacity, transform: [{ translateY: pinnedTabsTranslateY }] }}
      >
        <View style={{ overflow: 'hidden', borderBottomLeftRadius: 18, borderBottomRightRadius: 18 }}>
          {/* Solid + frosted backing so scrolling content never shows through —
              reuses the same BlurView glass pattern as the rest of the chrome. */}
          {chromeReady ? (
            <BlurView intensity={theme.isDark ? 55 : 75} tint={theme.isDark ? 'dark' : 'light'} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          ) : null}
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.background.primary + (theme.isDark ? 'D9' : 'E6') }} />
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
                onLongPress={isOwnProfile ? () => { triggerHaptic('medium'); setEditingTabKey(tab.key); } : undefined}
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

      {/* Bottom gradient - always visible */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, zIndex: 90 }} pointerEvents="none">
        <LinearGradient colors={['transparent', theme.colors.background.primary]} locations={[0, 0.8]} style={{ flex: 1 }} />
      </View>

      {/* Floating follow widget — slides up on scroll. Glass when enabled,
          BlurView otherwise. Entrance is a translateY SLIDE (never an opacity
          fade) so the native glass keeps drawing. */}
      {!isOwnProfile && (
        <Animated.View pointerEvents={followWidgetVisible ? 'box-none' : 'none'} style={{ position: 'absolute', bottom: 28, left: 0, right: 0, alignItems: 'center', zIndex: 100, transform: [{ translateY: widgetTranslateY }] }}>
          {(() => {
            const followEmoji = resolvedProfileTheme.emojiAccents?.follow;
            const pillStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 12, paddingVertical: 7, gap: 8, borderRadius: 22 };
            const inner = (
              <>
                <Avatar emoji={displayProfile.emoji || '😊'} size="xs" />
                <Text variant="caption" weight="semibold" numberOfLines={1} style={{ maxWidth: 100 }}>{displayProfile.display_name}</Text>
                {displayProfile.is_verified && <VerifiedBadge size={10} />}
                <Pressable
                  onPress={handleFollow}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 28, borderRadius: 14, backgroundColor: isFollowingState ? 'rgba(255,255,255,0.18)' : theme.colors.accent.primary }}
                >
                  {followEmoji ? <Text style={{ fontSize: 11 }}>{followEmoji}</Text> : null}
                  <Text variant="caption" weight="semibold" color={isFollowingState ? theme.colors.text.primary : '#FFFFFF'} style={{ fontSize: 11 }}>{isFollowingState ? t('profile.unfollow') : t('profile.follow')}</Text>
                </Pressable>
              </>
            );
            if (glassActive) {
              return (
                <NativeGlassView glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} style={pillStyle}>
                  {inner}
                </NativeGlassView>
              );
            }
            return (
              <View style={{ borderRadius: 22, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 6 }}>
                <BlurView intensity={70} tint={theme.isDark ? 'dark' : 'light'} style={pillStyle}>
                  {inner}
                </BlurView>
              </View>
            );
          })()}
        </Animated.View>
      )}

      <ProfileMenuModal visible={showMenu} profile={displayProfile} onClose={handleCloseMenu} />
      <ScreenshotShield visible={screenshotDetected} />
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
      {/* Long-press tab editor — own profile only. Mounted unconditionally
          but only ever opened from the long-press handler, which itself
          is gated on `isOwnProfile`. Cheap when idle (returns null until
          opened), so leaving it mounted on other-user profiles is fine. */}
      {isOwnProfile && (() => {
        const editingTabEntry = editingTabKey ? tabs.find((tt) => tt.key === editingTabKey) : null;
        return (
          <EditProfileTabModal
            visible={!!editingTabEntry}
            defaultLabel={editingTabEntry?.defaultLabel || ''}
            initialLabel={editingTabEntry && editingTabEntry.label !== editingTabEntry.defaultLabel ? editingTabEntry.label : undefined}
            initialEmoji={editingTabEntry?.emoji}
            onClose={() => setEditingTabKey(null)}
            onApply={(value) => {
              if (editingTabKey) setProfileTabCustom(editingTabKey, value);
            }}
            onReset={() => {
              if (editingTabKey) clearProfileTabCustom(editingTabKey);
            }}
          />
        );
      })()}
      </ProfileThemeScope>
    </View>
  );
}
