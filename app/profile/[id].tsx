import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ActivityIndicator, Animated, InteractionManager, Pressable, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore, useEntityStore } from '../../src/store';
import { getProfile } from '../../src/lib/supabase';
import { syncProfile, toSceneText } from '../../src/services/syncService';
import { useT } from '../../src/i18n/store';
import { triggerHaptic } from '../../src/utils/haptics';
import { showToast } from '../../src/store/toastStore';
import { openProfileShareSheet } from '../../src/store/shareSheetStore';
import { useIsBlocked } from '../../src/store/blockedUsersStore';
import { prefetchImages } from '../../src/components/ui/CachedImage';
import { useLiquidGlassActive } from '../../src/components/ui/LiquidGlass';
import { ScreenshotShield } from '../../src/components/ui/ScreenshotShield';
import { useScreenCaptureGuard } from '../../src/hooks/useScreenCaptureGuard';
import { useScreenMountMark } from '../../src/hooks/useScreenMountMark';
import { normalizeScene } from '../../src/services/headerScene';
import { parseBannerTransform, stripBannerTransform } from '../../src/utils/bannerTransform';
import { ProfileMenuModal } from '../../src/components/profile/ProfileMenuModal';
import {
  ProfileActionRow,
  ProfileChromeButton,
  ProfileCover,
  ProfileInfoCard,
  ProfileInfoRow,
  ProfileLinkRow,
  ProfileTopBar,
  coverHasMedia,
  parseProfileLinks,
  useProfileScrollAnim,
  type ProfileAction,
} from '../../src/components/profile/ProfileLayout';

/**
 * Someone else's profile — Telegram-style: avatar, name, @username, Message / Share / More tiles and
 * an info card. Posts, likes, replies, media tabs and follower counts were removed with the
 * publishing feature.
 *
 * Opening it is one cheap commit: the cached profile row renders immediately, the network refresh
 * runs after the push transition, and there is no list to build. That is what makes the push from
 * a busy chat smooth — the native slide never waits on a heavy first render.
 */
export default function UserProfileScreen() {
  useScreenMountMark('profile/[id]');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { width } = useWindowDimensions();
  const { id, fromChat } = useLocalSearchParams<{ id: string; fromChat?: string }>();
  const profileId = id ?? '';
  const currentUserId = useAuthStore((s) => s.user?.id);
  const glassActive = useLiquidGlassActive();
  const screenFocused = useIsFocused();
  const anim = useProfileScrollAnim();
  const isBlocked = useIsBlocked(profileId);

  const cachedProfile = useEntityStore((s) => s.profiles[profileId]);
  const [fallbackProfile, setFallbackProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(!cachedProfile);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    // Whether the uncached fallback below already fetched the row, so the deferred sync does not
    // issue a second identical request.
    let didDirectFetch = false;
    if (!useEntityStore.getState().profiles[profileId]) {
      didDirectFetch = true;
      setIsLoading(true);
      getProfile(profileId)
        .then(({ profile: p }) => {
          if (cancelled) return;
          if (p) {
            setFallbackProfile(p);
            useEntityStore.getState().upsertProfile({
              id: p.id,
              username: p.username,
              display_name: p.display_name,
              emoji: p.emoji || '😀',
              bio: p.bio || '',
              banner_url: (p as any).banner_url || null,
              theme_id: (p as any).theme_id || null,
              links: (p as any).links ? JSON.stringify((p as any).links) : null,
              badge: (p as any).badge || null,
              is_verified: (p as any).is_verified || false,
              header_scene: toSceneText((p as any).header_scene),
              screenshots_disabled: !!(p as any).screenshots_disabled,
              created_at: p.created_at || null,
              updated_at: p.updated_at || null,
            });
          }
          setIsLoading(false);
        })
        .catch(() => { if (!cancelled) setIsLoading(false); });
    } else {
      setIsLoading(false);
    }
    // The refresh has no pixels attached, so it waits for the push transition to finish.
    const handle = InteractionManager.runAfterInteractions(() => {
      if (!didDirectFetch) void syncProfile(profileId);
    });
    return () => { cancelled = true; handle.cancel(); };
  }, [profileId]);

  const profile: any = cachedProfile || fallbackProfile;

  // The VIEWED account's screenshot lock (Android blocks capture, iOS shows the shield).
  const screenshotsOff = !!profile?.screenshots_disabled;
  const { screenshotDetected } = useScreenCaptureGuard(screenshotsOff, 'profile-' + profileId);

  const bannerUrlRaw = profile?.banner_url as string | null | undefined;
  const bannerUrl = stripBannerTransform(bannerUrlRaw) || undefined;
  const bannerTransform = useMemo(() => parseBannerTransform(bannerUrlRaw), [bannerUrlRaw]);
  const proxyWidth = Math.round(width);
  useEffect(() => {
    if (bannerUrl) prefetchImages([bannerUrl], proxyWidth, 'disk');
  }, [bannerUrl, proxyWidth]);

  const sceneRaw = profile?.header_scene;
  const scene = useMemo(() => normalizeScene(sceneRaw), [sceneRaw]);
  const overMedia = coverHasMedia(bannerUrl, scene);
  const linksRaw = profile?.links;
  const links = useMemo(() => parseProfileLinks(linksRaw), [linksRaw]);

  const isOwnProfile = !!currentUserId && currentUserId === profileId;
  const username: string = profile?.username || '';
  const displayName: string = profile?.display_name || username;

  const openChat = useCallback(() => {
    // Opened from that very chat: going back IS opening the chat, without stacking a second copy.
    if (fromChat === '1' && router.canGoBack()) { router.back(); return; }
    router.push({ pathname: '/chat/[id]', params: { id: profileId } });
  }, [fromChat, profileId]);
  const share = useCallback(() => {
    if (profileId) openProfileShareSheet(profileId, displayName || undefined);
  }, [profileId, displayName]);
  const openMenu = useCallback(() => setShowMenu(true), []);
  const closeMenu = useCallback(() => setShowMenu(false), []);
  const copyUsername = useCallback(async () => {
    if (!username) return;
    triggerHaptic('selection');
    await Clipboard.setStringAsync('@' + username);
    showToast(t('toast.copied'), 'copy');
  }, [username, t]);

  const actions = useMemo<ProfileAction[]>(() => {
    if (isOwnProfile) {
      return [
        { key: 'edit', icon: 'edit-2', label: t('profile.edit'), onPress: () => router.push('/profile/edit') },
        { key: 'share', icon: 'share', label: t('common.share'), onPress: share },
      ];
    }
    return [
      { key: 'message', icon: 'message-circle', label: t('profile.message'), onPress: openChat },
      { key: 'share', icon: 'share', label: t('common.share'), onPress: share },
      { key: 'more', icon: 'more-horizontal', label: t('profile.more', 'Ещё'), onPress: openMenu },
    ];
  }, [isOwnProfile, t, openChat, share, openMenu]);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/messages');
  }, []);

  // Stable object, so the memoized sheet does not re-render on every scroll-driven render here.
  const menuTarget = useMemo(
    () => (profile ? {
      id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      emoji: profile.emoji,
      is_verified: profile.is_verified,
      badge: profile.badge,
    } : null),
    [profile],
  );

  // ── Guards: after every hook, so the hook count is identical on every render ──
  if (isLoading && !profile) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={theme.colors.accent.primary} />
      </View>
    );
  }
  if (!profile) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text variant="body" color={theme.colors.text.tertiary}>{t('profile.user_not_found')}</Text>
        <Pressable onPress={back} style={{ marginTop: 16 }} hitSlop={10}>
          <Text variant="body" color={theme.colors.accent.primary}>{t('common.back')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <Animated.ScrollView
        onScroll={anim.onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        <ProfileCover
          topInset={insets.top}
          emoji={profile.emoji || ''}
          displayName={displayName}
          username={username}
          isVerified={!!profile.is_verified}
          badge={profile.badge}
          bannerUrl={bannerUrl}
          bannerTransform={bannerTransform}
          scene={scene}
          sceneAnimate={screenFocused}
          anim={anim}
        />
        <ProfileActionRow actions={actions} glassActive={glassActive} />
        <ProfileInfoCard>
          {profile.bio ? <ProfileInfoRow value={profile.bio} caption={t('edit_profile.bio_label')} linkify /> : null}
          <ProfileInfoRow value={'@' + username} caption={t('edit_profile.username_label')} onPress={copyUsername} />
          {links.map((l, i) => <ProfileLinkRow key={`${l.url}-${i}`} url={l.url} />)}
        </ProfileInfoCard>
        {isBlocked && !isOwnProfile ? (
          <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginTop: 14, paddingHorizontal: 32 }}>
            {t('profile.blocked_hint', 'Вы заблокировали этого пользователя. Разблокировать можно в меню «Ещё».')}
          </Text>
        ) : null}
      </Animated.ScrollView>

      <ProfileTopBar
        topInset={insets.top}
        title={displayName}
        anim={anim}
        left={
          <ProfileChromeButton
            icon="chevron-left"
            overMedia={overMedia}
            glassActive={glassActive}
            accessibilityLabel={t('common.back')}
            onPress={back}
          />
        }
      />

      {!isOwnProfile ? (
        <ProfileMenuModal visible={showMenu} profile={menuTarget} onClose={closeMenu} />
      ) : null}
      <ScreenshotShield visible={screenshotDetected} />
    </View>
  );
}
