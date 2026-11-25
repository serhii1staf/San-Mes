import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ActivityIndicator, Animated, Share, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { useT } from '../../src/i18n/store';
import { triggerHaptic } from '../../src/utils/haptics';
import { prefetchImages } from '../../src/components/ui/CachedImage';
import { useLiquidGlassActive } from '../../src/components/ui/LiquidGlass';
import { AccountSwitcher } from '../../src/components/ui/AccountSwitcher';
import { ScreenshotShield } from '../../src/components/ui/ScreenshotShield';
import { useScreenCaptureGuard } from '../../src/hooks/useScreenCaptureGuard';
import { useScreenMountMark } from '../../src/hooks/useScreenMountMark';
import { parseBannerTransform, stripBannerTransform } from '../../src/utils/bannerTransform';
import { getTabBarHeight } from '../../src/components/navigation/CustomTabBar';
import {
  ProfileActionPill,
  ProfileHeaderCard,
  parseProfileLinks,
  profileUrl,
  useProfileScrollAnim,
} from '../../src/components/profile/ProfileLayout';
import { ProfileContentTabs } from '../../src/components/profile/ProfileContentTabs';

/**
 * The account's own profile. Same design as before (banner card, avatar tile, name, links, bio,
 * Edit / share pills); the follower counts are gone, and the decorate pill went with the header
 * decorations («Оформление», removed in Nov 2026).
 *
 * Lightweight on purpose: a ScrollView with a fixed set of views, no post list — that list was the
 * mount cost behind the profile lag.
 */
export default function ProfileScreen() {
  useScreenMountMark('(tabs)/profile');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { width, height: winHeight } = useWindowDimensions();
  const user = useAuthStore((s) => s.user);
  const glassActive = useLiquidGlassActive();
  const screenFocused = useIsFocused();
  const anim = useProfileScrollAnim();
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false);

  const { screenshotDetected } = useScreenCaptureGuard(!!(user as any)?.screenshots_disabled, 'own-profile');

  // Badge / verification changes from the admin panel arrive with the session check
  // (`restoreSession` → `/v1/auth/me` carries both), on launch and on a return to the app. The separate
  // profile fetch that used to sit here asked the Worker the same question a second time.
  const userId = user?.id;

  // Banner: strip the `#x=&y=&s=` transform hash before the proxy; warm it at the render width.
  const bannerUrlRaw = (user as any)?.bannerUrl as string | undefined;
  const bannerUrl = stripBannerTransform(bannerUrlRaw) || undefined;
  const bannerTransform = useMemo(() => parseBannerTransform(bannerUrlRaw), [bannerUrlRaw]);
  const proxyWidth = Math.round(width);
  useEffect(() => { if (bannerUrl) prefetchImages([bannerUrl], proxyWidth, 'disk'); }, [bannerUrl, proxyWidth]);

  const linksRaw = (user as any)?.links;
  const links = useMemo(() => parseProfileLinks(linksRaw), [linksRaw]);
  const share = useCallback(async () => {
    triggerHaptic('light');
    if (userId) { try { await Share.share({ message: profileUrl(userId) }); } catch {} }
  }, [userId]);

  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={theme.colors.accent.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* No QR / Settings buttons in the header: double-tap or long-press the profile capsule in
          the tab bar and they rise out of it (see ProfileQuickDial in CustomTabBar). */}
      <Animated.ScrollView
        onScroll={anim.onScroll}
        onScrollEndDrag={anim.onScrollEndDrag}
        onMomentumScrollEnd={anim.onMomentumScrollEnd}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        bounces={false}
        // No minHeight here any more: ProfileContentTabs sizes itself so the page always scrolls
        // far enough for the header to collapse and the tabs to pin, and no further.
        contentContainerStyle={{ paddingBottom: getTabBarHeight(insets.bottom) + 28 }}
      >
        <ProfileHeaderCard
          topInset={insets.top}
          anim={anim}
          glassActive={glassActive}
          emoji={user.emoji || ''}
          displayName={user.displayName || user.username || ''}
          username={user.username || ''}
          isVerified={!!user.is_verified}
          badge={user.badge}
          bio={user.bio}
          links={links}
          bannerUrl={bannerUrl}
          bannerTransform={bannerTransform}
          animate={screenFocused}
          onAvatarPress={() => setShowAccountSwitcher(true)}
          actions={
            <>
              <ProfileActionPill glassActive={glassActive} accent onPress={() => router.push('/profile/edit')}>
                <Text variant="caption" weight="semibold" color="#FFFFFF" style={{ fontSize: 14 }}>{t('profile.edit')}</Text>
              </ProfileActionPill>
              <ProfileActionPill glassActive={glassActive} square onPress={share}>
                <Feather name="share" size={16} color={theme.colors.text.primary} />
              </ProfileActionPill>
            </>
          }
        />
        <ProfileContentTabs
          profileId={user.id}
          isOwn
          author={{ name: user.displayName || user.username || '', emoji: user.emoji || '😊', verified: !!user.is_verified, badge: user.badge }}
          sticky={{ scrollY: anim.scrollY, rest: anim.rest, top: insets.top + 6, bottomPad: getTabBarHeight(insets.bottom) + 28, chromeBottom: getTabBarHeight(insets.bottom) }}
        />
      </Animated.ScrollView>

      <AccountSwitcher visible={showAccountSwitcher} onClose={() => setShowAccountSwitcher(false)} />
      <ScreenshotShield visible={screenshotDetected} />
    </View>
  );
}
