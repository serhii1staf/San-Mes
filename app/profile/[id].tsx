import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Pressable, ActivityIndicator, Image, Dimensions, Modal, Animated, Platform, Share, Alert, ScrollView, InteractionManager, Text as RNText } from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from '../../src/components/ui/AppBlurView';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../src/theme';
import { pinnedTabsRevealConfig } from '../../src/theme/motion';
import { Text, Avatar } from '../../src/components/ui';
import { LinkedText } from '../../src/components/ui/LinkedText';
import { ModalStatusBar } from '../../src/components/ui/ModalStatusBar';
import { parseImageUrls, getProfile, getFollowCounts, deletePost, isRepost, getLikedPosts, getUserComments } from '../../src/lib/supabase';
import { extractFirstUrl } from '../../src/services/linkPreview';
import { useAuthStore } from '../../src/store';
import { useEntityStore } from '../../src/store';
import { useFeedStore } from '../../src/store/feedStore';
import { syncProfile, syncUserPosts } from '../../src/services/syncService';
import { shouldSync } from '../../src/services/syncThrottle';
import { queueMutation } from '../../src/services/offlineQueue';
import { openUrl } from '../../src/utils/openUrl';
import { triggerHaptic } from '../../src/utils/haptics';
import { showToast } from '../../src/store/toastStore';
import { formatTimeAgo } from '../../src/utils/mockData';
import { AnimatedFlashList } from '@shopify/flash-list';
import { bottomScrimColors, SCRIM_LOCATIONS } from '../../src/theme/scrim';
import { BAR_FADE_HEIGHT } from '../../src/components/navigation/CustomTabBar';
import { CachedImage, prefetchImages } from '../../src/components/ui/CachedImage';
import { ImageViewerModal, ViewerActionButton } from '../../src/components/chat/ImageViewerModal';
import { openPostShareSheet, openProfileShareSheet } from '../../src/store/shareSheetStore';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { PostContextMenu } from '../../src/components/ui/PostContextMenu';
import { UserProfilePostCard } from '../../src/components/ui/UserProfilePostCard';
import { FollowsListModal, FollowsListMode } from '../../src/components/profile/FollowsListModal';
import { ProfileReplyCard, ProfileReply } from '../../src/components/profile/ProfileReplyCard';
import { createGifVisTracker, type GifVisTracker } from '../../src/utils/gifVisTracker';
import { EditProfileTabModal } from '../../src/components/profile/EditProfileTabModal';
import { useProfileAppearanceStore } from '../../src/store/profileAppearanceStore';
import { useScreenCaptureGuard } from '../../src/hooks/useScreenCaptureGuard';
import { ScreenshotShield } from '../../src/components/ui/ScreenshotShield';
import { PanResponder } from 'react-native';
import { useContextMenuGuard } from '../../src/hooks/useContextMenuGuard';
import { useT } from '../../src/i18n/store';
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
import { useScreenMountMark } from '../../src/hooks/useScreenMountMark';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const LIKED_POSTS_CACHE_PREFIX = '@san:liked_posts:';
const USER_REPLIES_CACHE_PREFIX = '@san:user_replies:';
// Truly-constant, theme-independent values hoisted to module scope so they
// are allocated once instead of re-created on every screen render (a fresh
// `contentContainerStyle` / `data` reference makes FlatList do extra work).
const LIST_CONTENT_CONTAINER_STYLE = { paddingBottom: 100, paddingHorizontal: 16, paddingTop: 12 } as const;
const EMPTY_LIST: any[] = [];

/**
 * ── PROFILES ALREADY RENDERED ONCE THIS SESSION ───────────────────────────────
 *
 * Reported, twice: open a profile through an @mention, go back, tap the mention again, and the profile
 * "reloads" — the content visibly jumps in rather than being there.
 *
 * It is not a reload. React Navigation's docs are unambiguous that going back UNMOUNTS the screen, and
 * there is no API in v7 or expo-router that preserves a popped screen's state — I checked the whole
 * surface (`unmountOnBlur` is gone, `freezeOnBlur` and `react-freeze` only help screens that are
 * mounted-but-blurred, `getId` and `dismissTo` only avoid duplicates).
 * https://reactnavigation.org/docs/navigation-lifecycle/
 *
 * So the second tap is a FRESH MOUNT, and `postsReady` starts at `false` again, and the list renders
 * `EMPTY_LIST` for at least one frame before the cards commit. On a busy JS thread mid-push-transition
 * that "one frame" is long enough to see, and what you see is an empty profile filling in — which
 * reads exactly like a reload.
 *
 * The documented remedy, once you accept the remount, is to hold the state OUTSIDE the screen. That is
 * all this is: a session-scoped record of which profiles have already paid for their first paint. A
 * revisit seeds `postsReady` to `true` and the cards are on screen in the first committed frame.
 *
 * WHY THIS IS SAFE, AND WHY ONLY `postsReady`
 *
 * The gate exists to keep 18+ heavy cards from mounting during the open animation. On a REVISIT the
 * expensive halves of that work are already done: the posts are in `entityStore` (no fetch) and their
 * images are in expo-image's memory cache (no download, no decode). What remains is cheap.
 *
 * `chromeReady` is deliberately NOT seeded. iOS rebuilds a BlurView's backdrop-filter CALayer on every
 * mount with nothing cached to help it, so that one is still worth a frame of stagger — and it is the
 * banner and the blur buttons, not the post list, that the "it jumps" report is about.
 *
 * A plain module-level Set, not MMKV: the point is to skip work whose cost is already paid IN THIS
 * PROCESS. Persisting it across launches would seed `true` on a cold start where nothing is warm, which
 * is precisely the case the gate was written for.
 *
 * Unbounded is fine here — it holds profile id strings for one session, and the entity store's own
 * memory cap (1200 profiles) is the real bound on how many can be visited.
 */
const paintedProfileIds = new Set<string>();

/**
 * Repost originals already requested THIS SESSION, across mounts.
 *
 * Was a `useRef` inside the component, which resets on mount — and going back unmounts this screen, so
 * every re-entry re-fetched the original post behind every repost on the profile. Session-scoped here,
 * so a revisit issues no requests at all.
 *
 * A REQUEST ledger, not a cache: the posts themselves live in `entityStore`, which owns their eviction.
 *
 * Kept in `{ current }` shape so the four call sites below read exactly as they did when this was a
 * `useRef`. The change being made is WHERE the ledger lives, not how it is used, and a diff that also
 * rewrites four unrelated expressions makes that harder to see.
 */
const requestedRepostOriginalIds: { current: Set<string> } = { current: new Set<string>() };
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
  const t = useT();
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
    // ── THE ONE LABEL HERE THAT IS NOT A BRAND NAME, AND THE ONLY ONE THAT NEEDED TRANSLATING ──
    //
    // This was the hardcoded literal `'Сайт'`. Every other entry in this map is a proper noun that
    // is spelled the same in every language, so the map read as if it needed no i18n — and the one
    // entry that did was invisible among them.
    //
    // Reported as: with the interface in English, the caption near the Message button on someone's
    // profile is still Russian. It is this chip, and it is worse than one label: the line below is
    // `map[type] || map.website`, so `website` is also the CATCH-ALL for any link whose type is not
    // recognised. So an English UI showed "Сайт" for every generic link on the profile.
    //
    // Reusing `edit_profile.link_website` rather than adding `profile.link_website`: it already means
    // exactly "Website"/"Сайт", it is already present in BOTH dictionaries, and it is the label the
    // link EDITOR uses for the same link type — so the profile and the editor cannot drift apart.
    // There is no global ru/en key-parity test in this repo, so a brand-new key added to one
    // dictionary only would fall back to Russian silently, which is the exact failure being fixed.
    website: { name: 'globe', color: '#2563EB', isBrand: false, label: t('edit_profile.link_website') },
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
  // Driven dim, like PostMenuModal. This menu had a STATIC backdrop and let RN's `animationType="fade"`
  // cross-fade the whole modal window instead — see the note on `handleClose`.
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const [showQR, setShowQR] = useState(false);
  const [mode, setMode] = useState<'menu' | 'report'>('menu');
  const isClosing = useRef(false);
  // Action to run after this menu has fully closed. See `handleClose`.
  const afterCloseRef = useRef<(() => void) | null>(null);

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
      backdropAnim.setValue(0);
      // Same curve as PostMenuModal and SlideUpSheet: spring 50/9 for the card, 200 ms linear for the dim.
      // Was a lone spring at 50/10 with no dim animation at all.
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const handleClose = () => {
    if (isClosing.current) return;
    isClosing.current = true;
    // ── 180 → 250 ms, PLUS THE DIM, PLUS A DEFERRED HANDOFF ───────────────────
    //
    // Reported: opening "Share profile" from here felt awkward, and it should behave like the feed's
    // three-dots chain — first sheet slides down and out, second slides up in.
    //
    // Three things differed from `PostMenuModal`, and all three showed up in that one transition.
    //
    // The handoff was the visible one. `afterCloseRef` ran in the SAME tick as `onClose()`, so
    // `openProfileShareSheet` fired before React had even committed `showMenu = false`, let alone before
    // iOS had torn the modal window down. `SlideUpSheet` then started its spring while its own Modal was
    // still being presented behind the outgoing one, so the first frames of the slide-up played
    // off-screen and the sheet appeared already at rest. That is the "abrupt" arrival. `PostMenuModal`
    // defers by 30 ms for exactly this reason and its comment says so; this copy of the pattern simply
    // never got that line.
    //
    // The other two are why the EXIT felt different: 180 ms against the family's 250 ms, and no dim
    // fade-out at all — the dim used to disappear with RN's `animationType="fade"` on the whole window
    // rather than on its own curve. Both matched up now, and the modal is `animationType="none"` so RN
    // stops cross-fading the window underneath the spring.
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(() => {
        setShowQR(false);
        setMode('menu');
        onClose();
        // Run whatever asked to happen once this menu is actually gone — the share action needs this,
        // because this menu is an RN <Modal> and so is the share sheet, and two overlapping RN Modals
        // on iOS end with the second one never appearing.
        const next = afterCloseRef.current;
        afterCloseRef.current = null;
        if (next) { try { next(); } catch {} }
      }, 30);
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

  // Sends the profile link into a chat through the in-app picker instead of handing off to the OS
  // share sheet. Queued until this menu has closed (see `handleClose`).
  const handleShare = () => {
    triggerHaptic('light');
    const pid = profile?.id;
    if (!pid) return;
    afterCloseRef.current = () => openProfileShareSheet(pid, profile?.display_name || undefined);
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
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose} statusBarTranslucent>
      <ModalStatusBar />
      <View style={{ flex: 1 }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdropAnim }}>
          <Pressable style={{ flex: 1 }} onPress={handleClose} />
        </Animated.View>
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
  useScreenMountMark('profile/[id]');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Mount-time marker — opens-someone-else's-profile lag is a primary user
  // complaint; this attribution lets the panel show whether the freeze
  // came from the screen's first render or from downstream image fan-out.
  // Skipped at the call site when the monitor is off.
  // Mount timing moved to the FIRST hook of this component - see useScreenMountMark.
  // Measured from here it under-reported: every hook above it fell outside the window.
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
  //
  // ...EXCEPT ON A REVISIT, where starting at `false` is what produces the reported "the profile
  // reloads and the content jumps in". See `paintedProfileIds` at the top of this file for the full
  // reasoning. `useState` takes an initialiser so this is read once per mount, not on every render.
  //
  // ── BOTH GATES ARE GONE ───────────────────────────────────────────────────
  //
  // `postsReady` was a one-frame hold that handed the FlashList `EMPTY_LIST`, and `chromeReady` a
  // second frame behind it that withheld the banner and the BlurViews. Together they are the reported
  // "I open someone's profile and the banner goes off like a flash" — the banner did not merely paint
  // late, it did not START its request until two render+commit cycles had passed, and rAF callbacks
  // queue behind whatever long task the JS thread is already running, so on a cold open the wait is
  // unbounded in practice. `paintedProfileIds` and the `listEmpty → null` suppression were both added
  // to paper over the first frame this gate produces; with the gate gone neither is load-bearing.
  //
  // The long tasks the gates were splitting are real and are being attacked at the source instead
  // (per-card mount cost). Splitting them was never the same as reducing them, and the split is what
  // is visible: `SLOW ui<30` was traded for a screen that assembles itself over half a second.
  //
  // Native-stack pushes animate in UIKit, not in JS — a busy JS thread does not stutter the slide-in.
  // That is the same fact the deleted `listReady` gate in app/chat/[id].tsx was retired on.
  const postsReady = true;
  // Heavy iOS chrome — `expo-blur` BlurView (×2 here) and the banner
  // CachedImage — must NOT mount during the navigation transition into
  // this screen. BlurView spins up a CALayer with a backdrop filter and
  // the banner kicks off a network fetch + decode; both land on the same
  // frame as the open animation and were a major source of
  // `SLOW ui<30 @ profile/[id]`. Render flat-coloured fallbacks and
  // swap to the real components once interactions settle below.
  const chromeReady = true;
  const [showMenu, setShowMenu] = useState(false);
  const [viewingImage, setViewingImage] = useState<{ uri: string; postId: string; allImages?: string[] } | null>(null);
  // Followers / Following list modal opened from the header counters.
  const [followsModal, setFollowsModal] = useState<FollowsListMode | null>(null);
  const { target: contextPost, open: openContextMenu, close: closeContextMenu } = useContextMenuGuard<any>();
  // Virtualization is handled by the FlashList below — it RECYCLES cells rather than
  // mounting and unmounting them, and needs no windowing knobs (see the long note at the
  // list). Initial mount is gated by `postsReady` so the tab tap stays snappy.
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
  // Native-driven reveal: a downward SLIDE, no opacity. Recomputed only when the measured offset
  // changes (rare), so per-frame scrolling never touches the JS thread — the interpolation runs
  // entirely on the native side. Until the row is measured (`tabsOffsetY` still <= the pin position)
  // we push the reveal point out of reach so the bar stays hidden on first paint.
  //
  // ── WHY THERE IS NO `opacity` HERE ANY MORE ────────────────────────────────
  //
  // The overlay contains the ACTIVE TAB PILL, which is a `NativeGlassView` when liquid glass is on, and
  // `expo-glass-effect` discards the glass whenever the view or any ancestor carries an opacity
  // (expo/expo#41024). The bar sits at alpha 0 for the whole time the reader is at the top of the
  // profile — i.e. always, on arrival — so the pill's glass was destroyed before it was ever seen and
  // scrolling down revealed a flat pill instead. Identical change to `app/(tabs)/profile.tsx`, which is
  // this screen's own-profile twin; see the longer note there.
  //
  // `pinnedBarTop + 64` over-covers the bar's real height. Over-travelling is free (it is off-screen
  // either way); under-travelling would leave a visible sliver pinned at the top.
  //
  // The ramp — how much scroll the reveal spans, and its easing — comes from
  // `pinnedTabsRevealConfig` in src/theme/motion.ts, shared with `app/(tabs)/profile.tsx`. Both screens
  // used to write out a 24 pt LINEAR window here, which drove ~115 pt of bar from 24 pt of finger and
  // started and stopped instantly: the "the header appears too abruptly" report. The reveal still ends
  // exactly at `end`, so the inline-to-pinned handoff stays pixel-aligned.
  const pinnedTabsTranslateY = useMemo(() => {
    const end = tabsOffsetY > pinnedBarTop ? tabsOffsetY - pinnedBarTop : Number.MAX_SAFE_INTEGER;
    const { inputRange, outputRange } = pinnedTabsRevealConfig(end, -(pinnedBarTop + 64));
    return scrollY.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
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
  // Read user posts from the entity store, filtered by author_id.
  //
  // This subscribes to the ENTIRE `posts` map, which is the largest object in the app, and
  // the memo below is an `Object.values(...)` scan plus an `O(n log n)` sort that allocates
  // two `Date` objects per comparison. `allPosts` gets a new identity on every
  // `upsertPost`/`upsertPosts` from ANY source — a feed refresh, a chat prefetch, a sync
  // tick for an unrelated screen — so the whole scan re-ran, and this screen (banner, blur
  // chrome, post list) re-rendered, while the user was simply looking at a profile.
  //
  // Two changes, both invisible:
  //
  //   1. `created_at` is an ISO-8601 string, and ISO-8601 sorts correctly as a STRING
  //      (fixed-width, big-endian, zero-padded). So the comparator is a string compare
  //      instead of two `Date` allocations plus two `getTime()` calls per comparison.
  //   2. The sort key is precomputed nowhere and the filter runs first, so the sort only
  //      ever sees this author's posts, not the global set.
  //
  // The subscription itself stays on the whole map: narrowing it would need an
  // author→postIds index in the store, which is a real change to `entityStore` and is
  // listed in the report as the follow-up rather than smuggled in here.
  const allPosts = useEntityStore((s) => s.posts);
  const userPosts = React.useMemo(() => {
    if (!id) return [];
    const mine: typeof allPosts[keyof typeof allPosts][] = [];
    for (const key in allPosts) {
      const p = allPosts[key];
      if (p && p.author_id === id) mine.push(p);
    }
    return mine.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  }, [allPosts, id]);

  // ── "НЕТ ПУБЛИКАЦИЙ" MUST NOT BE SAID BEFORE WE HAVE LOOKED ────────────────
  //
  // `listEmpty` below still reads `if (gatedTab && !postsReady) return null;`, and `postsReady` is a
  // `true` constant since the mount gates were deleted — so that guard does nothing and the caption is
  // once again bound to the array being empty.
  //
  // It matters more here than on the own-profile tab. `userPosts` is derived by scanning the entity
  // store for `author_id === id`, so opening a profile the app has never seen starts with an empty
  // array by construction, and `syncUserPosts(id)` does not even begin until `runAfterInteractions`
  // fires. The first thing the user is told about a stranger's profile is that they have never posted.
  //
  // Same flag and argument as `feedSettled` in (tabs)/index.tsx: an empty array is not evidence of an
  // empty profile until a fetch has finished saying so. Set by `syncUserPosts`'s settlement below, and
  // short-circuited whenever posts are already on screen.
  const [postsSettled, setPostsSettled] = useState(false);

  // Fallback profile state (for when no cached data exists)
  const [fallbackProfile, setFallbackProfile] = useState<any>(null);

  useEffect(() => {
    if (!id) return;

    // Whether the blocking fallback below actually issued a `getProfile(id)`.
    // Read by the deferred block further down to avoid firing a SECOND, identical
    // request for the same profile — see the note there.
    let didDirectFetch = false;

    // If we have cached profile, show it immediately (no loading)
    if (cachedProfile) {
      setIsLoading(false);
    } else {
      // No cached data — load from Supabase directly as fallback
      didDirectFetch = true;
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

    // The RENDER gates are bounded to one frame: the first paint carries only the
    // identity block, and the heavy post cards + iOS chrome (BlurView buttons,
    // banner CachedImage) commit on the very next frame. `runAfterInteractions`
    // used to own these two flags as well, and because it waits for every
    // registered interaction handle rather than for the next frame, the banner and
    // avatar could stay unrendered for an indeterminate stretch and then pop in —
    // the "the avatar/banner behaves strangely" report.
    //
    // The NETWORK / prefetch work below stays on `runAfterInteractions`: it has no
    // pixels attached to it, so an unbounded wait there costs nothing visible and
    // still keeps requests off the transition.
    // TWO frames, not one. `postsReady` mounts the post cards (gesture handlers,
    // FormattedText, images); `chromeReady` mounts the banner `CachedImage` and the two
    // BlurViews. Setting both in the same `requestAnimationFrame` put the card mount AND
    // the blur/decode storm on one commit — which is exactly the failure
    // `app/(tabs)/profile.tsx` already staggers across two frames, with a comment
    // explaining that landing them together dropped the UI thread to ~32 fps.
    //
    // This screen (the OTHER user's profile) never got that fix, and it is the heavier of
    // the two: 16 blur/glass mount sites against 14, and 3 initial cards against 2.
    //
    // ── THE TWO RENDER RAFs ARE GONE ──────────────────────────────────────────
    //
    // Everything above describes the gates that used to be released here; the flags are now constants
    // (see their declarations). The bookkeeping that supported them goes with them: `paintedProfileIds`
    // only existed so a REVISIT could skip the blank first frame, and there is no blank first frame to
    // skip any more. It is still written below so the top-of-file cache stays coherent for anything
    // that reads it, and costs a Set insert.
    if (id) paintedProfileIds.add(String(id));

    // The NETWORK work keeps its `runAfterInteractions` wrapper. Nothing visual hangs off it, so an
    // unbounded wait here costs no pixels and still keeps the requests off the transition — the one
    // half of the original design that was always sound.
    const handle = InteractionManager.runAfterInteractions(() => {
      // Trigger background sync for profile and user posts.
      //
      // ── NOT WHEN THE BLOCKING FALLBACK IS ALREADY FETCHING IT ───────────────
      //
      // `syncProfile(id)` resolves to `getProfile(id)` behind a 10-minute
      // `syncWithThrottle`. On an UNCACHED profile — an @mention, a search hit, a
      // comment author, i.e. every case where this screen shows its spinner — the
      // fallback above has that exact request in flight already, and it does not
      // stamp the throttle, so nothing deduplicated them. The screen issued two
      // identical round trips for the same row, doubling the work on the one path
      // that was already the slowest.
      //
      // When the profile IS cached the fallback does not run, and this is the only
      // fetch — which is the case the throttle was written for, so it keeps
      // running exactly as before. The uncached path loses nothing: the direct
      // fetch upserts into the entity store itself.
      if (!didDirectFetch) syncProfile(id);
      // `.finally`, not a bare call: this is the moment we are entitled to say the profile has no
      // posts. `syncUserPosts` swallows its own errors and returns `Promise<void>`, and its
      // `syncWithThrottle` short-circuit still counts as settled — a throttled skip means the store
      // already holds the answer from within the last five minutes. See `postsSettled`.
      void syncUserPosts(id).finally(() => setPostsSettled(true));

      // Banner warming moved OUT of this block — see `bannerUrlForWarm` below.
      // It was here, and it could never hit the cache. Two reasons, both about
      // the cache key, and one reason about timing:
      //
      //   1. `prefetchImages([p.banner_url])` used the default width of 600
      //      while the render below passes `proxyWidth={SCREEN_WIDTH}` (~390).
      //      The proxy width is part of the URL and the URL is expo-image's
      //      cache key, so the warm and the render asked for two different
      //      objects.
      //   2. It warmed `p.banner_url` RAW, including the `#x=&y=&s=` transform
      //      hash, while the render passes `stripBannerTransform(...)`. Again a
      //      different key.
      //   3. It sat inside `runAfterInteractions`, which waits for every
      //      registered interaction handle rather than for the next frame, so
      //      even a correct warm would have started late.
      //
      // Net effect: the prefetch spent egress downloading bytes under a key
      // nothing ever reads, and the banner's real request did not begin until
      // `chromeReady` mounted the image two rAFs later. That is the visible
      // "banner pops in afterwards" on this screen. The own-profile tab already
      // had the correct pattern and a comment explaining it; this screen never
      // got it.

      // Load follow counts from Supabase (keep direct call for counts display).
      // Gated behind the per-profile sync throttle (5-min window) so rapid
      // revisits don't re-hit the network — the cached `followCounts` state
      // stays on screen when skipped (we don't clear it).
      (async () => {
        if (await shouldSync('follow_counts:' + id, 5 * 60 * 1000)) {
          getFollowCounts(id).then((counts) => setFollowCounts(counts)).catch(() => {});
        }
      })();

      // Resolve the REAL follow state from the server and write it into the
      // entity store. The store only knew about follows set optimistically
      // this session (or via syncFollows), so on a fresh profile open / cold
      // start the button could show "Подписаться" even though the DB row
      // exists. Reconciling here makes the button reflect server truth on
      // every profile open, regardless of session or cache. Self-profiles
      // are skipped (you can't follow yourself). Gated behind the per-profile
      // sync throttle (5-min window): when skipped, the entity-store follow
      // state already drives the button, so there's no visual regression.
      if (currentUser?.id && id && currentUser.id !== id) {
        (async () => {
          if (await shouldSync('is_following:' + id, 5 * 60 * 1000)) {
            import('../../src/lib/supabase').then(({ isFollowing }) =>
              isFollowing(currentUser.id, id).then((following) => {
                const entity = useEntityStore.getState();
                if (following) entity.setFollow(currentUser.id, id);
                else entity.removeFollow(currentUser.id, id);
              }).catch(() => {})
            ).catch(() => {});
          }
        })();
      }
    });
    return () => { handle.cancel(); };
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
  //
  // ── AND IT SURVIVES LEAVING THE SCREEN ──────────────────────────────────────
  //
  // This was a `useRef`, which resets on mount — and since going back UNMOUNTS this screen, every
  // re-entry re-fetched the original post behind every repost on the profile, one request each, on the
  // frames right after the push transition. That is a straightforward contributor to the reported FPS
  // dip on a second visit, and it is fetching answers we already have.
  //
  // A module-level Set (see `requestedRepostOriginalIds` at the top of the file) is session-scoped
  // instead of mount-scoped, so a revisit issues nothing. It is only a REQUEST ledger — the posts
  // themselves live in `entityStore`, which owns their eviction — so the worst case if the store drops
  // an original is a missing preview until the next cold start, not stale content.
  const requestedOriginalIds = requestedRepostOriginalIds;

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

  // ── Media tab ───────────────────────────────────────────────────────────────
  // A filtered view of `displayPosts` — posts carrying at least one image. The
  // tab previously fell through to `EMPTY_LIST` with no loader behind it, so it
  // was permanently empty and read as broken rather than unimplemented.
  //
  // Derived rather than fetched: no request, no cache, no loading state, and it is
  // built from the SAME objects the posts tab renders, so the two can never
  // disagree about a post's images. Both the current `imageUrls` shape and the
  // legacy single `imageUrl` are checked so older cached posts are not dropped.
  const mediaPosts = React.useMemo(
    () => displayPosts.filter((p: any) => (p?.imageUrls && p.imageUrls.length > 0) || !!p?.imageUrl),
    [displayPosts],
  );

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

  // ── RECYCLE POOLS, ONE PER ROW SHAPE ──────────────────────────────────────
  //
  // Required by the FlashList migration below. FlashList v2 recycles a cell by reusing the mounted
  // component tree of a cell that scrolled off. Without `getItemType` every row shares one pool, so
  // switching from Posts to Replies would hand a mounted `UserProfilePostCard` tree to a
  // `ProfileReplyCard` — a different component, so React throws the tree away and mounts a new one.
  // That is exactly the mount cost this migration exists to remove.
  //
  // Three components across four tabs: `UserProfilePostCard` (Posts, Media and Likes — this screen
  // shows another user, so even Posts are heterogenous-author cards) and `ProfileReplyCard`
  // (Replies). The active tab fully determines the shape, so the type is derived from it rather than
  // from the item. Called on every layout pass per the docs, so it stays a constant keyed on the tab.
  //
  // Identical shape to `app/(tabs)/profile.tsx`, which already does this.
  const listItemType = activeTab === 'replies' ? 'reply' : 'user-post';
  const getItemType = useCallback(() => listItemType, [listItemType]);

  // ── REPLY-GIF ANIMATION GATE ───────────────────────────────────────────────
  //
  // A profile snapshot on a real device reported this route with `imgCount: 16`, `worstFps: 39` and
  // `avgMountMs: 56`. A cheap mount next to a bad frame rate means the cost is continuous rather than
  // a mount, and the continuous cost on a reply list is animated GIFs: an animated image decodes
  // every frame on the UI thread for as long as its cell exists, including cells the list is merely
  // retaining. `ProfileReplyCard` rendered the reply's own GIF with animation unconditionally.
  //
  // Same tracker the comments screen uses, now shared from `src/utils/gifVisTracker.ts`. It bounds
  // animation to visible, settled rows and to two at a time, and staggers the resume so a settle does
  // not restart every decode on one frame.
  //
  // Declared here, above `renderReplyItem`, because that callback closes over `gifTracker` — putting
  // it next to the scroll handlers further down left it in the temporal dead zone.
  const gifTrackerRef = useRef<GifVisTracker | null>(null);
  if (!gifTrackerRef.current) gifTrackerRef.current = createGifVisTracker();
  const gifTracker = gifTrackerRef.current;
  useEffect(() => () => gifTrackerRef.current?.dispose(), []);

  const renderReplyItem = useCallback(
    ({ item }: { item: any }) => <ProfileReplyCard reply={item as ProfileReply} gifTracker={gifTracker} />,
    // `gifTracker` is a ref's `.current`, created once for the screen, so this list stays effectively
    // empty in practice. It is declared rather than omitted because an honest dep list is what keeps
    // the React Compiler from memoising against a value it was not told about.
    [gifTracker],
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
  // Cache-only hydration, split out of the loaders so it can run on the
  // tab-switch frame while the network call stays deferred. This matters MORE
  // here than on the own-profile tab: this is a pushed route, so `likedPosts` /
  // `userReplies` are discarded on back-navigation and re-entering the profile
  // would otherwise show the empty state again on every visit.
  const hydrateLikedFromCache = useCallback(() => {
    if (!id || likedPosts.length > 0) return;
    try {
      const cached = kvGetJSONSync<any[] | null>(LIKED_POSTS_CACHE_PREFIX + id, null);
      if (Array.isArray(cached) && cached.length > 0) setLikedPosts(cached);
    } catch {}
  }, [id, likedPosts.length]);

  const hydrateRepliesFromCache = useCallback(() => {
    if (!id || userReplies.length > 0) return;
    try {
      const cached = kvGetJSONSync<ProfileReply[] | null>(USER_REPLIES_CACHE_PREFIX + id, null);
      if (Array.isArray(cached) && cached.length > 0) setUserReplies(cached);
    } catch {}
  }, [id, userReplies.length]);

  // Same lazy-fetch + per-account cache pattern as the home profile tab.
  // Fires only when the user flips into the corresponding tab.
  const loadLikedPosts = useCallback(async () => {
    if (!id || likedFetching) return;
    setLikedFetching(true);
    try {
      hydrateLikedFromCache();

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
        try { kvSetJSON(LIKED_POSTS_CACHE_PREFIX + id, mapped); } catch {}
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
      hydrateRepliesFromCache();

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
        try { kvSetJSON(USER_REPLIES_CACHE_PREFIX + id, mapped); } catch {}
      });
    } catch {
      setRepliesLoaded(true);
    } finally {
      setRepliesFetching(false);
    }
  }, [id, repliesFetching, userReplies.length]);

  // First open of a secondary tab: paint cache on THIS frame, fetch after the
  // transition. See `hydrateLikedFromCache` for why the read cannot stay inside
  // the deferred loader.
  useEffect(() => {
    if (!id) return;
    if (activeTab === 'likes' && !likedLoaded && !likedFetching) {
      hydrateLikedFromCache();
      const handle = InteractionManager.runAfterInteractions(() => loadLikedPosts());
      return () => handle.cancel();
    }
    if (activeTab === 'replies' && !repliesLoaded && !repliesFetching) {
      hydrateRepliesFromCache();
      const handle = InteractionManager.runAfterInteractions(() => loadUserReplies());
      return () => handle.cancel();
    }
  }, [activeTab, likedLoaded, likedFetching, repliesLoaded, repliesFetching, id, loadLikedPosts, loadUserReplies, hydrateLikedFromCache, hydrateRepliesFromCache]);

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
  // ── START THE BANNER DOWNLOAD NOW, RENDER IT LATER ────────────────────────
  //
  // Ported from `app/(tabs)/profile.tsx`, which already had it. The warm this
  // replaces lived inside `runAfterInteractions` and used a cache key the
  // renderer never asks for — see the note in the mount effect above.
  //
  // Three things have to line up for the warm to be a hit rather than wasted
  // egress, and all three are the same values the `CachedImage` below uses:
  //   • the STRIPPED url, because `proxiedImageUrl` would percent-encode the
  //     `#x=&y=&s=` transform hash into a different key;
  //   • `SCREEN_WIDTH`, because the proxy width is part of the URL;
  //   • `'disk'`, which downloads WITHOUT decoding. The decode is the expensive
  //     half and the whole reason `chromeReady` staggers the mount, so decoding
  //     here would move the storm back onto the frames the stagger protects.
  //     It happens lazily when the visible image mounts, by then a local read.
  //
  // A plain mount effect, not `runAfterInteractions`: this has no pixels
  // attached, so it cannot compete with the transition, and starting the
  // request a frame earlier is the entire point.
  useEffect(() => {
    if (!bannerUrl) return;
    prefetchImages([bannerUrl], SCREEN_WIDTH, 'disk');
  }, [bannerUrl]);
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
            /* Shimmer while the bytes land, matching the own-profile banner. Without
               it this card showed its flat `rgba(255,255,255,0.05)` fill until the
               image decoded, so a slow banner read as a broken header rather than as
               a loading one. Opt-in per caller in `CachedImage`; the own-profile twin
               already passed it and this screen did not. */
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

      {/* User-chosen background gradient — card backdrop, above the cover photo
          but below the identity content. */}
      <HeaderBackgroundLayer backgroundId={scene.background} drawing={scene.drawing} hasBanner={!!bannerUrl} blend={scene.bgBlend} />

      {/* ── Module content (left-aligned identity block, matches the mockup) ── */}
      <View style={{ paddingTop: insets.top + 52, paddingHorizontal: 20, paddingBottom: 22 }}>
        {/* Avatar — rounded square, top-left; liquid glass when enabled */}
        {/* `clear` over a banner, `regular` without one — see the twin on the own-profile screen for
            why. Short version: `regular` is frosted enough to hide the cover photo behind this tile,
            so switching Liquid Glass ON was losing the photo that the `BlurView` fallback shows. */}
        {glassActive ? (
          <NativeGlassView glassStyle={bannerUrl ? 'clear' : 'regular'} colorScheme={theme.isDark ? 'dark' : 'light'} style={{ width: 84, height: 84, borderRadius: 26, alignItems: 'center', justifyContent: 'center' }}>
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
          <Text variant="heading" weight="bold" color="#FFFFFF" numberOfLines={1} style={{ flexShrink: 1, fontSize: 24, lineHeight: 28, textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }}>{displayProfile.display_name}</Text>
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
  const onRepliesViewable = useRef(({ viewableItems }: { viewableItems: any[] }) => {
    // Insertion order matters: the tracker ranks GIFs by position in this set to apply its cap, and
    // the viewability callback reports top-to-bottom.
    const next = new Set<string>();
    for (const v of viewableItems) {
      const id = v?.item?.id;
      if (id) next.add(id);
    }
    gifTrackerRef.current?.update(next);
  }).current;
  const repliesViewabilityConfig = useRef({ itemVisiblePercentThreshold: 35 }).current;
  // Folded into the existing scroll-active handlers rather than added as new listeners, so this adds
  // no extra scroll plumbing — `setScrolling` is a cheap flag flip that early-returns when unchanged.
  const handleScrollBeginDrag = useCallback(() => {
    setScrollActive(true);
    gifTrackerRef.current?.setScrolling(true);
  }, []);
  const handleScrollSettle = useCallback(() => {
    setScrollActive(false);
    gifTrackerRef.current?.setScrolling(false);
  }, []);
  // Was inline JSX on the list, so a new element every render.
  //
  // ── AND IT MUST NOT CLAIM "NO POSTS" WHILE THE MOUNT GATE IS SHUT ──────────
  //
  // Same fix, same reason, as the own-profile tab — see the long note there. While
  // `postsReady` is false the list is deliberately handed `EMPTY_LIST` so the heavy
  // cards do not mount during the push transition, and FlashList responds to an
  // empty dataset by rendering this component. The result was a frame of
  // "Ещё нет публикаций" over posts that were already in the entity store.
  //
  // On THIS screen it was the more misleading of the two, because `postsReady` is
  // seeded from `paintedProfileIds` on a revisit — so the false caption appeared on
  // the FIRST visit only, which is precisely when the user has no way to know the
  // profile is not simply empty.
  //
  // `likes` / `replies` are not gated and keep their immediate caption.
  //
  // ── AND `postsReady` NO LONGER ANSWERS ANYTHING ─────────────────────────────
  //
  // The guard was `!postsReady`, which is a `true` constant now, so it did nothing. `postsSettled` is
  // both a working guard and a better question: `postsReady` meant "the mount gate has opened", which
  // was only ever correlated with having looked; this means "the fetch has finished".
  //
  // Also note what this makes redundant. The note above says the false caption "appeared on the FIRST
  // visit only" because `postsReady` was seeded from `paintedProfileIds` on a revisit — a per-session
  // Set of profiles that had already painted. `postsSettled` needs no such bookkeeping: on a revisit
  // the entity store already holds the posts, so the list is not empty and the caption cannot render.
  const listEmpty = useMemo(() => {
    const gatedTab = activeTab === 'posts' || activeTab === 'media';
    if (gatedTab && !postsSettled) return null;
    return (
      <View style={{ alignItems: 'center', paddingVertical: 40 }}>
        <Text variant="caption" color={theme.colors.text.tertiary}>
          {activeTab === 'posts' ? t('profile.no_posts') : t('profile.empty_section')}
        </Text>
      </View>
    );
  }, [theme.colors.text.tertiary, activeTab, t, postsSettled]);

  // ─── FULLSCREEN VIEWER ────────────────────────────────────────────────────
  //
  // Same replacement as the own-profile tab: this screen also hand-rolled a native `Modal` with
  // `animationType="none"`, a static backdrop and zero gestures. It was the MOST drifted of the
  // three copies — no liquid glass anywhere, no repost handling in the header, different corner
  // radii and button sizes than the own-profile twin, and it never refetched after a delete.
  //
  // Rendering the chat's viewer here means one interaction and one set of metrics everywhere:
  // drag to dismiss with the dim following the drag, pinch or double-tap to zoom, and chrome that
  // fades with the gesture instead of being cut off in a frame.
  const viewerPayload = useMemo(() => {
    if (!viewingImage) return null;
    const images = viewingImage.allImages && viewingImage.allImages.length > 0
      ? viewingImage.allImages
      : [viewingImage.uri];
    const idx = Math.max(0, images.indexOf(viewingImage.uri));
    return { images, index: idx };
  }, [viewingImage]);

  const closeViewer = useCallback(() => setViewingImage(null), []);

  const viewingPost = useMemo(
    () => (viewingImage ? displayPosts.find((p: any) => p.id === viewingImage.postId) : undefined),
    [viewingImage, displayPosts],
  );

  // Memoized: the viewer compares chrome by reference, so an inline node would re-render its pager
  // on every render of this screen.
  const viewerHeader = useMemo(() => {
    if (!viewingImage) return null;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Avatar emoji={displayProfile?.emoji || '😊'} size="xs" />
        <View style={{ flexShrink: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Text variant="caption" weight="semibold" color="#FFFFFF" numberOfLines={1} style={{ fontSize: 11 }}>{displayProfile?.display_name || 'User'}</Text>
            {displayProfile?.is_verified && <VerifiedBadge size={10} />}
          </View>
          <Text variant="caption" color="rgba(255,255,255,0.6)" style={{ fontSize: 9 }}>
            {viewingPost?.createdAt ? formatTimeAgo(viewingPost.createdAt) : ''}
          </Text>
        </View>
      </View>
    );
  }, [viewingImage, viewingPost, displayProfile?.emoji, displayProfile?.display_name, displayProfile?.is_verified]);

  // A BARE ROW — the translucent pill that used to wrap these buttons is gone. It put a second
  // background behind buttons that already have their own circular fills, which is the "there is
  // another container in the bottom area" report. Metrics now match the own-profile viewer (42 pt
  // buttons, gap 10) so the two screens stop drifting.
  // The post body shown over the photo in the viewer. A post has ONE body regardless of how many
  // images it carries, so this does not change as the pager moves between them. A repost falls back to
  // the original's body when the repost itself added no comment, which is what the share action already
  // does — so the two never disagree about what this post "says".
  const postViewerCaption = useMemo(() => {
    const own = viewingPost?.content || '';
    if (own.trim()) return own;
    return (viewingPost as any)?.originalPost?.content || '';
  }, [viewingPost]);
  const viewerFooter = useMemo(() => {
    if (!viewingImage) return null;
    return (
      <View style={{ alignItems: 'center', gap: 10 }}>
        {/* THE POST'S OWN TEXT, over the photo.
   
            Same treatment as the chat viewer, asked for explicitly: opening a photo from a profile
            should show the caption that was published with it. Works for a single photo and for a
            multi-photo post alike, because a post has ONE body regardless of how many images it
            carries — so it does not change as the pager moves.
   
            No background, no border, no card. A shadow so it reads on a bright image. Capped at 96 pt
            and scrollable, because a post body can be long and the actions must never be pushed off
            screen. `nestedScrollEnabled` for Android, which needs it stated inside another gesture area.
   
            For a repost the original's body is used when the repost itself has none, matching what the
            share action already does. */}
        {postViewerCaption ? (
          <ScrollView
            style={{ maxHeight: 96, alignSelf: 'stretch', marginHorizontal: 24 }}
            contentContainerStyle={{ paddingBottom: 2 }}
            showsVerticalScrollIndicator={false}
            bounces={false}
            nestedScrollEnabled
          >
            <Text
              variant="caption"
              color="#FFFFFF"
              style={{ fontSize: 13, lineHeight: 18, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }}
            >
              {postViewerCaption}
            </Text>
          </ScrollView>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {isOwnProfile && (
          <ViewerActionButton
            icon="edit-2"
            accessibilityLabel={t('common.edit')}
            onPress={() => {
              const post = viewingPost;
              const pid = viewingImage.postId;
              useFeedStore.getState().setEditingPost({
                id: pid,
                content: post?.content || '',
                imageUrl: post?.imageUrl,
                imageUrls: post?.imageUrls && post.imageUrls.length > 0 ? post.imageUrls : (post?.imageUrl ? [post.imageUrl] : undefined),
              });
              setViewingImage(null);
              router.push('/(tabs)/create');
            }}
          />
        )}
        <ViewerActionButton
          icon="share"
          // `post.share` does not exist in EITHER dictionary, so this button announced the literal
          // string "post.share" to VoiceOver / TalkBack, in both languages, with no fallback to hide
          // it. `common.share` is the key that carries "Share" / "Поделиться" and is what the sibling
          // buttons in this same row already use for edit and delete (`common.edit`, `common.delete`).
          accessibilityLabel={t('common.share')}
          onPress={() => {
            triggerHaptic('light');
            const caption = viewingPost?.content || viewingPost?.originalPost?.content || '';
            openPostShareSheet(viewingImage.postId, caption);
          }}
        />
        {isOwnProfile && (
          <ViewerActionButton
            icon="trash-2"
            destructive
            accessibilityLabel={t('common.delete')}
            onPress={() => {
              const pid = viewingImage.postId;
              Alert.alert(t('profile.delete_post_title'), t('profile.delete_post_msg'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('common.delete'),
                  style: 'destructive',
                  onPress: async () => {
                    if (currentUser?.id) await deletePost(pid, currentUser.id);
                    setViewingImage(null);
                  },
                },
              ]);
            }}
          />
        )}
        </View>
      </View>
    );
  }, [viewingImage, viewingPost, isOwnProfile, currentUser?.id, t]);

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
      <View
        // box-none: the container itself must NOT capture touches. It spans the
        // full width at the very top and overlaps the pinned category-tab band
        // below it (which sits at a lower zIndex). With the default
        // pointerEvents="auto" this row swallowed taps in its empty middle
        // region, so the pinned Posts/Replies/Media/Likes pills could not be
        // tapped. box-none keeps the back/menu Pressables (children) tappable
        // while letting taps in the gap fall through to the pinned tab bar.
        pointerEvents="box-none"
        style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 100 }}>
        <Animated.View style={{ transform: [{ translateX: buttonsTranslateX }] }}>
          <Pressable onPress={() => router.back()} style={{ borderRadius: 17, overflow: glassActive ? undefined : 'hidden' }}>
            {glassActive ? (
              // Interactive morphing glass IS the button; icon is its child. No
              // overflow so the liquid stretch isn't clipped on touch.
              <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="chevron-left" size={18} color="#FFFFFF" />
              </NativeGlassView>
            ) : chromeReady ? (
              <BlurView role="scrim" intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
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
              <BlurView role="scrim" intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
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

      {/* ── FLASHLIST v2, NOT Animated.FlatList ──────────────────────────────────
          A device snapshot put this route at 29 mounts averaging 70 ms with 5 long tasks, worst
          374 ms, and ~24 `UserProfilePostCard.body` marks inside one second for a screen showing
          about three cards. Navigating away and back replayed the whole sequence, which is what the
          user described as the profile "reloading" — visibly, right down to the avatar.

          The cause was this list. `app/(tabs)/profile.tsx` was migrated to FlashList a while ago,
          got `getItemType` recycle pools, and deliberately deleted its windowing knobs. THIS screen
          — the other user's profile, the heavier of the two — never got that migration and was still
          an `Animated.FlatList` with:

              initialNumToRender={3}  maxToRenderPerBatch={2}  windowSize={7}
              updateCellsBatchingPeriod={80}  removeClippedSubviews={false}

          `windowSize: 7` is ~3.5 viewport heights in each direction, so VirtualizedList materialised
          roughly two dozen rows for the three that were visible, two per 80 ms tick — precisely the
          observed cadence. `removeClippedSubviews={false}` then kept every one of them attached to
          the native view tree. Each row is a full card: `SwipeablePostCard` (three shared values, a
          four-worklet pan gesture, two animated styles, a `collapsable={false}` view), 25-40 native
          views, `FormattedText`, thumbnails with skeletons.

          FlashList RECYCLES instead of mounting and unmounting, which is the direct answer to a
          mount-count problem, and v2 asks for no size estimates at all. So the three knobs that were
          compensating for a missing trusted height are not merely unused here — two of them worked by
          keeping MORE cells alive, which was the problem.

          `drawDistance` (default 250 px) is left at its default: far tighter than `windowSize: 7`
          already, and the brief is to measure before tuning further.

          `AnimatedFlashList` is `Animated.createAnimatedComponent(FlashList)`, exported by
          @shopify/flash-list 2.3.2, so the existing native-driven `onScroll` Animated.event keeps
          working unchanged. Same import the own-profile tab uses.

          Honest note: this does NOT make a revisit free. React Navigation unmounts the popped screen
          (documented, and there is no API to preserve it), so re-entering is a fresh mount either
          way. What changes is that the fresh mount builds ~3 cards instead of ~24. */}
      <AnimatedFlashList
        // Tab-driven data swap — memoized so consecutive renders within
        // the same tab hand the list an IDENTICAL reference. Without
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
                // Media is a filtered view of the posts already loaded — derived,
                // never fetched — so switching to it is instant and it no longer
                // renders permanently empty.
                : activeTab === 'media'
                  ? (postsReady ? mediaPosts : EMPTY_LIST)
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
        // Recycle pool per row shape — see the note where `getItemType` is defined.
        getItemType={getItemType}
        // Feeds the reply-GIF animation gate. Both are `useRef(...).current`, so they are stable and
        // do not make the list re-wire its handlers on render. The tracker ignores an unchanged
        // viewable set, so a callback that fires without a real change costs one size compare.
        onViewableItemsChanged={onRepliesViewable}
        viewabilityConfig={repliesViewabilityConfig}
        // ── THE FLATLIST VIRTUALISATION KNOBS ARE GONE ──────────────────────────
        //
        // Removed: `initialNumToRender={3}`, `maxToRenderPerBatch={2}`, `windowSize={7}`,
        // `updateCellsBatchingPeriod={80}`, `removeClippedSubviews={false}`. FlashList v2 has no
        // equivalents — sizing is automatic and recycling replaces the mount/unmount window these
        // were rationing.
        //
        // They are not merely unused. Every one of them existed to compensate for the missing trusted
        // height, and TWO of them worked by keeping more cells mounted: `windowSize: 7` (raised so
        // scrolling up found cards already built) and `removeClippedSubviews={false}` (off because
        // detach → re-attach → re-measure made scrolling up oscillate against variable-height rows).
        // Both of those are answers to a problem recycling does not have.
        //
        // `maintainVisibleContentPosition` is ON BY DEFAULT in v2 and is the documented answer to the
        // "a row above the viewport changes height and the content jumps" problem that
        // `removeClippedSubviews={false}` was working around here.
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
        ListEmptyComponent={listEmpty}
      />

      {/* ── BOTTOM SCRIM — AND WHY IT IS NOT `BAR_FADE_HEIGHT` ────────────────
          Reported four times: "on someone's profile the darkening at the bottom is different,
          completely different". It was, and the previous version of this block is why.

          It imported `BAR_FADE_HEIGHT` from `CustomTabBar`, on the reasoning that reusing the tab
          bar's own three pieces would make the two identical by construction. The colours and stops
          were indeed identical. The height was the mistake, and it is the height that was visible.

          `BAR_FADE_HEIGHT` is defined as the tab bar's FOOTPRINT — the 60 pt glass capsule plus its
          24 pt bottom margin. `src/theme/scrim.ts` states the governing rule three separate times:
          "the scrim spans exactly the chrome and stops", and specifically that `BAR_FADE_HEIGHT` is
          "exactly the capsule's height plus its bottom margin, so the ramp finishes level with the
          top of the navigation". So that number is not "the bottom scrim height", it is "the height
          of the tab bar". This screen is a pushed route outside the `(tabs)` group and HAS NO TAB
          BAR, so what got drawn was an 84 pt black ramp sized to a capsule that is not there — with
          nothing sitting on it.

          That is the whole difference the report describes, and it is not an alpha value. On the home
          screen the ramp reads as a soft shadow because the glass capsule sits on its dark end and
          gives it a reason to exist; the eye reads bar-plus-shadow. Here the same ramp, at the same
          height, with no capsule, reads as a dark slab the content falls into. Copying the ramp was
          right. Copying the height of absent chrome was not.

          ── THE HEIGHT WAS NEVER THE PROBLEM. TWO OF MY FIXES CHASED IT ANYWAY. ──
          For the record, because the sequence is instructive. I changed this height twice and neither
          change was visible, for the same reason both times: a SECOND, legacy gradient at `zIndex: 90`
          was painting over this one (see the long note further down where it used to be). So:

            first attempt   `BAR_FADE_HEIGHT` -> `insets.bottom + 48`. Also arithmetically a no-op:
                            BAR_FADE_HEIGHT is 84 and `insets.bottom` on an iPhone is 34, so I changed
                            84 to 82 and wrote a long justification about the governing rule.
            second attempt  -> `Math.max(insets.bottom, 16)`, reasoning that a scrim over absent chrome
                            should only cover the bezel. Sound reasoning, wrong premise: the chrome was
                            not absent, a legacy gradient was drawing it.

          Both attempts were me theorising about why the ramp "read wrong" while never checking whether
          the ramp I was editing was the one on screen. It was not.

          Back to the tab bar's own expression, which is the point: the user asks for the darkening here
          to match the screens that have the bottom navigation, and matching means using the same ramp,
          the same 17-stop curve and the same height those screens use. `CustomTabBar` draws
          `BAR_FADE_HEIGHT + (Platform.OS === 'android' ? insets.bottom : 0)`; this is that expression,
          so the two cannot drift.

          The remaining difference from a tab screen is the glass capsule floating on the ramp, which
          cannot be reproduced here without moving the route into the `(tabs)` group — and that breaks
          `CustomTabBar`'s slot math (it pushes every route not named `profile` into the main bar) and
          turns a native-stack push into a tab switch. That trade stays unmade.

          `pointerEvents="none"` so it never intercepts a tap on the list or on the floating follow
          widget, which sits above it. Placed after the list and before the pinned tabs overlay, so
          it paints over scrolling content and under the chrome. */}
      <LinearGradient
        colors={bottomScrimColors(theme.isDark, theme.colors.background.primary)}
        locations={SCRIM_LOCATIONS}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: BAR_FADE_HEIGHT + (Platform.OS === 'android' ? insets.bottom : 0),
        }}
        pointerEvents="none"
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
        // NO `opacity` HERE. The active tab pill below is a NativeGlassView and an alpha on any
        // ancestor discards its glass (expo/expo#41024) — see the note on `pinnedTabsTranslateY`.
        style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 110, transform: [{ translateY: pinnedTabsTranslateY }] }}
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

      {/* ── THE LEGACY BOTTOM GRADIENT LIVED HERE, AND IT WAS THE WHOLE BUG ──────
          Removed. This is the "старое затемнение" reported six times, and it is why every previous
          attempt of mine to fix it did nothing visible.

          What was here:

            <View style={{ position:'absolute', bottom:0, left:0, right:0, height:80, zIndex:90 }}>
              <LinearGradient colors={['transparent', theme.colors.background.primary]}
                              locations={[0, 0.8]} />
            </View>

          Three things wrong with it, and the third is what hid my edits:

            1. WRONG EFFECT. It fades to `background.primary` — a background-COLOURED wash. Every
               other surface in the app uses the shared BLACK ramp from `src/theme/scrim.ts`. That
               file records this exact mistake being fixed in the chat once already: the chat's stops
               "used to be local (`[bgTransparent, bgColor + 'B3', bgColor]`, midpoint 0.45) — a
               background-coloured fade rather than the black ramp used behind the tab bar, which is
               why the chat's scrim looked like a different effect from every other screen's."
               Same defect, same screen-specific hardcode, never cleaned up here.

            2. WRONG GEOMETRY. A hardcoded 80 with `locations={[0, 0.8]}`, against the shared ramp's
               `BOTTOM_CHROME_SCRIM_HEIGHT` (84) and 17-stop smoothstep curve.

            3. `zIndex: 90`. The shared scrim below has no zIndex, so it sits in document order and
               this painted ON TOP OF IT. Which means the screen has had TWO bottom gradients stacked
               all along, and the visible one was the legacy one. That is why changing the shared
               scrim's height from 84 to 82, and then to the safe-area inset, changed nothing the user
               could see — I was editing the gradient underneath.

          With this gone, the shared ramp below is the only bottom gradient on the screen, and it is
          the same ramp, stops and height the tab bar draws. */}

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

      {/* Fullscreen viewer — the SAME component the chat and the own-profile tab use. */}
      <ImageViewerModal
        payload={viewerPayload}
        onClose={closeViewer}
        topInset={insets.top}
        bottomInset={insets.bottom}
        proxyWidth={SCREEN_WIDTH}
        header={viewerHeader}
        footer={viewerFooter}
        zoomable
      />
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
