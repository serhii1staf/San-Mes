import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ActivityIndicator, Animated, InteractionManager, Pressable, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore, useEntityStore } from '../../src/store';
import { getProfile } from '../../src/lib/supabase';
import { syncProfile } from '../../src/services/syncService';
import { cacheProfile, getCachedProfileSync } from '../../src/services/cacheService';
import { markSynced } from '../../src/services/syncThrottle';
import { useT } from '../../src/i18n/store';
import { triggerHaptic } from '../../src/utils/haptics';
import { openProfileShareSheet } from '../../src/store/shareSheetStore';
import { prefetchImages } from '../../src/components/ui/CachedImage';
import { useLiquidGlassActive } from '../../src/components/ui/LiquidGlass';
import { ScreenshotShield } from '../../src/components/ui/ScreenshotShield';
import { useScreenCaptureGuard } from '../../src/hooks/useScreenCaptureGuard';
import { useScreenMountMark } from '../../src/hooks/useScreenMountMark';
import { parseBannerTransform, stripBannerTransform } from '../../src/utils/bannerTransform';
import { ProfileMenuModal } from '../../src/components/profile/ProfileMenuModal';
import {
  ProfileActionPill,
  ProfileFloatingButtons,
  ProfileHeaderCard,
  parseProfileLinks,
  useProfileScrollAnim,
} from '../../src/components/profile/ProfileLayout';
import { ProfileContentTabs } from '../../src/components/profile/ProfileContentTabs';
import { useAuthorChannel } from '../../src/services/realtime/authorChannel';
import { CardDismissSurface } from '../../src/components/navigation/CardDismiss';

/**
 * Someone else's profile. Same design as before (banner card, avatar tile, name, links, bio,
 * Message / share pills, back + menu buttons); post tabs and follower counts are gone with
 * publishing, and the space under the header shows the photos exchanged with this person.
 *
 * Opening it is one cheap commit: the cached row paints immediately, the refresh and the media
 * read run after the push transition, and there is no post list to build.
 */
export default function UserProfileScreen() {
  useScreenMountMark('profile/[id]');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { width, height: winHeight } = useWindowDimensions();
  const { id, fromChat } = useLocalSearchParams<{ id: string; fromChat?: string }>();
  const profileId = id ?? '';
  const currentUserId = useAuthStore((s) => s.user?.id);
  const glassActive = useLiquidGlassActive();
  const screenFocused = useIsFocused();
  const anim = useProfileScrollAnim();
  // Their posts and profile edits arrive live while this screen is focused. See the hook.
  useAuthorChannel(profileId && profileId !== currentUserId ? profileId : undefined, screenFocused);

  const cachedProfile = useEntityStore((s) => s.profiles[profileId]);
  const [fallbackProfile, setFallbackProfile] = useState<any>(null);
  // Not in the entity store (opened before its hydrate finished, or older than the 200 profiles its
  // batch keeps): the copy kept per profile on disk, read synchronously, so the screen opens on it
  // instead of a full-screen spinner while the fetch below runs.
  const [diskProfile, setDiskProfile] = useState<any>(() => (cachedProfile || !profileId ? null : getCachedProfileSync(profileId)));
  const [isLoading, setIsLoading] = useState(!cachedProfile && !diskProfile);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    let didDirectFetch = false;
    if (!useEntityStore.getState().profiles[profileId]) {
      didDirectFetch = true;
      setIsLoading(true);
      getProfile(profileId)
        .then(({ profile: p, error }) => {
          if (cancelled) return;
          // A deleted account must not live on in the disk copy (see `syncProfile`). A failed request
          // keeps it: offline, the copy is the best there is.
          const gone = !p && (!error || /not[ _-]?found|404/i.test(error));
          if (gone) {
            setDiskProfile(null);
            void cacheProfile(profileId, null).catch(() => {});
          }
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
              screenshots_disabled: !!(p as any).screenshots_disabled,
              created_at: p.created_at || null,
              updated_at: p.updated_at || null,
            });
            // The same stamp `syncProfile` writes. Without it the next visit (now with a cached copy)
            // went straight to `syncProfile`, found no stamp, and fetched the profile a second time.
            void markSynced(`profile:${profileId}`).catch(() => {});
          }
          setIsLoading(false);
        })
        .catch(() => { if (!cancelled) setIsLoading(false); });
    } else {
      setIsLoading(false);
    }
    // No pixels attached, so the refresh waits for the push transition.
    const handle = InteractionManager.runAfterInteractions(() => {
      if (!didDirectFetch) void syncProfile(profileId);
    });
    return () => { cancelled = true; handle.cancel(); };
  }, [profileId]);

  const profile: any = cachedProfile || fallbackProfile || diskProfile;
  const { screenshotDetected } = useScreenCaptureGuard(!!profile?.screenshots_disabled, 'profile-' + profileId);

  const bannerUrlRaw = profile?.banner_url as string | null | undefined;
  const bannerUrl = stripBannerTransform(bannerUrlRaw) || undefined;
  const bannerTransform = useMemo(() => parseBannerTransform(bannerUrlRaw), [bannerUrlRaw]);
  const proxyWidth = Math.round(width);
  useEffect(() => { if (bannerUrl) prefetchImages([bannerUrl], proxyWidth, 'disk'); }, [bannerUrl, proxyWidth]);

  const linksRaw = profile?.links;
  const links = useMemo(() => parseProfileLinks(linksRaw), [linksRaw]);
  const isOwnProfile = !!currentUserId && currentUserId === profileId;

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/messages');
  }, []);
  const openChat = useCallback(() => {
    // Opened from that very chat: going back IS opening it, without stacking a second copy.
    if (fromChat === '1' && router.canGoBack()) { router.back(); return; }
    router.push({ pathname: '/chat/[id]', params: { id: profileId } });
  }, [fromChat, profileId]);
  const share = useCallback(() => {
    triggerHaptic('light');
    if (profileId) openProfileShareSheet(profileId, profile?.display_name || undefined);
  }, [profileId, profile?.display_name]);
  const closeMenu = useCallback(() => setShowMenu(false), []);
  const menuTarget = useMemo(() => (profile ? {
    id: profile.id, username: profile.username, display_name: profile.display_name,
    emoji: profile.emoji, is_verified: profile.is_verified, badge: profile.badge,
  } : null), [profile]);

  // Dragged sideways, by the right edge or down from the top strip (the back and menu buttons), the
  // profile comes unstuck and can be thrown away; see CardDismissSurface. Every state is wrapped, so
  // the loading and not-found screens close the same way.
  const card = (content: React.ReactNode) => (
    <CardDismissSurface mode="profile" topZone={insets.top + 56} backgroundColor={theme.colors.background.primary}>
      {content}
    </CardDismissSurface>
  );

  // Guards after every hook, so the hook count never changes between renders.
  if (isLoading && !profile) {
    return card(<View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={theme.colors.accent.primary} /></View>);
  }
  if (!profile) {
    return card(
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="body" color={theme.colors.text.tertiary}>{t('profile.user_not_found')}</Text>
        <Pressable onPress={back} style={{ marginTop: 16 }}><Text variant="body" color={theme.colors.accent.primary}>{t('common.back')}</Text></Pressable>
      </View>,
    );
  }

  return card(
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <ProfileFloatingButtons
        topInset={insets.top}
        anim={anim}
        glassActive={glassActive}
        left={{ icon: 'chevron-left', label: t('common.back'), onPress: back }}
        right={isOwnProfile ? undefined : { icon: 'more-horizontal', label: t('profile.more', 'Ещё'), onPress: () => { triggerHaptic('light'); setShowMenu(true); } }}
      />
      <Animated.ScrollView
        onScroll={anim.onScroll}
        onScrollEndDrag={anim.onScrollEndDrag}
        onMomentumScrollEnd={anim.onMomentumScrollEnd}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        bounces={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        <ProfileHeaderCard
          topInset={insets.top}
          anim={anim}
          glassActive={glassActive}
          emoji={profile.emoji || ''}
          displayName={profile.display_name || profile.username || ''}
          username={profile.username || ''}
          isVerified={!!profile.is_verified}
          badge={profile.badge}
          bio={profile.bio}
          links={links}
          bannerUrl={bannerUrl}
          bannerTransform={bannerTransform}
          animate={screenFocused}
          actions={
            isOwnProfile ? (
              <ProfileActionPill glassActive={glassActive} accent onPress={() => router.push('/profile/edit')}>
                <Text variant="caption" weight="semibold" color="#FFFFFF" style={{ fontSize: 14 }}>{t('profile.edit')}</Text>
              </ProfileActionPill>
            ) : (
              <>
                <ProfileActionPill glassActive={glassActive} accent onPress={openChat}>
                  <Text variant="caption" weight="semibold" color="#FFFFFF" style={{ fontSize: 14 }}>{t('profile.message', 'Сообщение')}</Text>
                </ProfileActionPill>
                <ProfileActionPill glassActive={glassActive} square onPress={share}>
                  <Feather name="share" size={16} color={theme.colors.text.primary} />
                </ProfileActionPill>
              </>
            )
          }
        />
        <ProfileContentTabs
          profileId={profileId}
          isOwn={isOwnProfile}
          author={{ name: profile.display_name || profile.username || '', emoji: profile.emoji || '😊', verified: !!profile.is_verified, badge: profile.badge }}
          sticky={{ scrollY: anim.scrollY, rest: anim.rest, top: insets.top + 6, bottomPad: insets.bottom + 32 }}
        />
      </Animated.ScrollView>

      {!isOwnProfile ? <ProfileMenuModal visible={showMenu} profile={menuTarget} onClose={closeMenu} /> : null}
      <ScreenshotShield visible={screenshotDetected} />
    </View>,
  );
}
