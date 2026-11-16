import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ActivityIndicator, Animated, Share, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../src/theme';
import { useAuthStore } from '../../src/store';
import { useT } from '../../src/i18n/store';
import { triggerHaptic } from '../../src/utils/haptics';
import { showToast } from '../../src/store/toastStore';
import { shouldSync } from '../../src/services/syncThrottle';
import { prefetchImages } from '../../src/components/ui/CachedImage';
import { useLiquidGlassActive } from '../../src/components/ui/LiquidGlass';
import { AccountSwitcher } from '../../src/components/ui/AccountSwitcher';
import { ScreenshotShield } from '../../src/components/ui/ScreenshotShield';
import { useScreenCaptureGuard } from '../../src/hooks/useScreenCaptureGuard';
import { useScreenMountMark } from '../../src/hooks/useScreenMountMark';
import { getLocalScene, normalizeScene } from '../../src/services/headerScene';
import { parseBannerTransform, stripBannerTransform } from '../../src/utils/bannerTransform';
import { getTabBarHeight } from '../../src/components/navigation/CustomTabBar';
import {
  ProfileActionRow,
  ProfileChromeButton,
  ProfileCover,
  ProfileInfoCard,
  ProfileInfoRow,
  ProfileLinkRow,
  ProfileQRModal,
  ProfileTopBar,
  coverHasMedia,
  parseProfileLinks,
  profileUrl,
  useProfileScrollAnim,
  type ProfileAction,
} from '../../src/components/profile/ProfileLayout';

/**
 * The account's own profile — Telegram-style: avatar, name, @username, three action tiles and an
 * info card. Posts, likes, replies, media tabs and follower counts were removed with the publishing
 * feature; this is a messenger profile now.
 *
 * Deliberately light: one ScrollView with a fixed handful of views, so opening the tab costs a
 * single cheap commit instead of a list of post cards.
 */
export default function ProfileScreen() {
  useScreenMountMark('(tabs)/profile');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { width } = useWindowDimensions();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const glassActive = useLiquidGlassActive();
  const screenFocused = useIsFocused();
  const anim = useProfileScrollAnim();

  const [showQR, setShowQR] = useState(false);
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false);

  // Own-account screenshot lock: protects the owner's own profile view too.
  const ownScreenshotsOff = !!(user as any)?.screenshots_disabled;
  const { screenshotDetected } = useScreenCaptureGuard(ownScreenshotsOff, 'own-profile');

  // Badge / verification can change from the admin panel; refresh them at most every 10 minutes.
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    (async () => {
      if (!(await shouldSync('self_badge:' + userId, 10 * 60 * 1000))) return;
      const { apiGet } = await import('../../src/services/apiClient');
      const { data } = await apiGet<{ badge: string | null; is_verified: boolean }>(
        `/v1/profiles/${encodeURIComponent(userId)}`,
      );
      const current = useAuthStore.getState().user;
      if (data && current && (data.badge !== current.badge || data.is_verified !== current.is_verified)) {
        updateProfile({ badge: data.badge || undefined, is_verified: data.is_verified || false });
      }
    })().catch(() => {});
  }, [userId, updateProfile]);

  // Banner: strip the `#x=&y=&s=` transform hash before it reaches the image proxy, and start the
  // download on mount ('disk' = fetch without decoding) at the SAME width the cover renders with,
  // because the proxy width is part of the cache key.
  const bannerUrlRaw = (user as any)?.bannerUrl as string | undefined;
  const bannerUrl = stripBannerTransform(bannerUrlRaw) || undefined;
  const bannerTransform = useMemo(() => parseBannerTransform(bannerUrlRaw), [bannerUrlRaw]);
  const proxyWidth = Math.round(width);
  useEffect(() => {
    if (bannerUrl) prefetchImages([bannerUrl], proxyWidth, 'disk');
  }, [bannerUrl, proxyWidth]);

  // Header decorations: the in-memory value right after editing, else the locally cached scene.
  const headerSceneRaw = (user as any)?.headerScene;
  const scene = useMemo(() => {
    const s = normalizeScene(headerSceneRaw);
    return s.items.length > 0 || s.background || (s.drawing?.length ?? 0) > 0 ? s : getLocalScene(userId);
  }, [headerSceneRaw, userId]);
  const overMedia = coverHasMedia(bannerUrl, scene);

  const linksRaw = (user as any)?.links;
  const links = useMemo(() => parseProfileLinks(linksRaw), [linksRaw]);

  const username = user?.username || '';
  const openEdit = useCallback(() => router.push('/profile/edit'), []);
  const openCustomize = useCallback(() => router.push('/profile/customize-header'), []);
  const shareProfile = useCallback(async () => {
    if (!userId) return;
    try { await Share.share({ message: profileUrl(userId) }); } catch {}
  }, [userId]);
  const copyUsername = useCallback(async () => {
    if (!username) return;
    triggerHaptic('selection');
    await Clipboard.setStringAsync('@' + username);
    showToast(t('toast.copied'), 'copy');
  }, [username, t]);

  const actions = useMemo<ProfileAction[]>(() => [
    { key: 'edit', icon: 'edit-2', label: t('profile.edit'), onPress: openEdit },
    { key: 'customize', icon: 'smile', label: t('profile.customize', 'Оформить'), onPress: openCustomize },
    { key: 'share', icon: 'share', label: t('common.share'), onPress: shareProfile },
  ], [t, openEdit, openCustomize, shareProfile]);

  // After every hook, so the hook count never depends on whether a session is loaded.
  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={theme.colors.accent.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <Animated.ScrollView
        onScroll={anim.onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: getTabBarHeight(insets.bottom) + 28 }}
      >
        <ProfileCover
          topInset={insets.top}
          emoji={user.emoji || ''}
          displayName={user.displayName || username}
          username={username}
          isVerified={!!user.is_verified}
          badge={user.badge}
          bannerUrl={bannerUrl}
          bannerTransform={bannerTransform}
          scene={scene}
          sceneAnimate={screenFocused}
          anim={anim}
          onAvatarPress={() => { triggerHaptic('light'); setShowAccountSwitcher(true); }}
          avatarAccessibilityLabel={t('profile.switch_account', 'Сменить аккаунт')}
        />
        <ProfileActionRow actions={actions} glassActive={glassActive} />
        <ProfileInfoCard>
          {user.bio ? <ProfileInfoRow value={user.bio} caption={t('edit_profile.bio_label')} linkify /> : null}
          <ProfileInfoRow value={'@' + username} caption={t('edit_profile.username_label')} onPress={copyUsername} />
          {links.map((l, i) => <ProfileLinkRow key={`${l.url}-${i}`} url={l.url} />)}
        </ProfileInfoCard>
      </Animated.ScrollView>

      <ProfileTopBar
        topInset={insets.top}
        title={user.displayName || username}
        anim={anim}
        left={
          <ProfileChromeButton
            icon="qrcode"
            iconFamily="fa5"
            overMedia={overMedia}
            glassActive={glassActive}
            accessibilityLabel={t('profile.qr_title')}
            onPress={() => { triggerHaptic('light'); setShowQR(true); }}
          />
        }
        right={
          <ProfileChromeButton
            icon="settings"
            overMedia={overMedia}
            glassActive={glassActive}
            accessibilityLabel={t('settings.title')}
            onPress={() => { triggerHaptic('light'); router.push('/settings'); }}
          />
        }
      />

      <ProfileQRModal visible={showQR} onClose={() => setShowQR(false)} profileId={user.id} title={t('profile.qr_title')} />
      <AccountSwitcher visible={showAccountSwitcher} onClose={() => setShowAccountSwitcher(false)} />
      <ScreenshotShield visible={screenshotDetected} />
    </View>
  );
}
