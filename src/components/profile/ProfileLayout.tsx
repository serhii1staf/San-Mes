/**
 * Telegram-style profile building blocks, shared by the own-profile tab (`app/(tabs)/profile.tsx`)
 * and someone else's profile (`app/profile/[id].tsx`).
 *
 * Layout, top to bottom:
 *   - cover: optional banner / drawn background / stickers, a large round avatar, name, @username
 *   - a row of equal action tiles (Message / Share / More, or Edit / Customize / Share)
 *   - an info card: bio, username, links
 * plus a top bar that stays transparent over the cover and turns solid, with the name as its title,
 * once the name scrolls under it.
 *
 * Everything that moves is driven by ONE `Animated.Value` (the scroll offset) through the native
 * driver, so scrolling and the collapse never touch the JS thread. Only `opacity` and `transform`
 * are animated; neither re-runs layout.
 *
 * Sizes come from `useWindowDimensions`, not a module-level `Dimensions.get`, so the screen
 * re-lays itself out when the window changes size (rotation, split view, iPhone Duo open/close).
 */
import React, { memo, useMemo } from 'react';
import {
  View,
  Pressable,
  Animated,
  StyleSheet,
  Text as RNText,
  Image,
  Modal,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { UserBadge } from '../ui/UserBadge';
import { CachedImage } from '../ui/CachedImage';
import { NativeGlassView } from '../ui/LiquidGlass';
import { emojiTextStyle } from '../ui/emojiText';
import { LinkedText } from '../ui/LinkedText';
import { HeaderBackgroundLayer } from './HeaderBackgroundLayer';
import { HeaderSceneLayer } from './HeaderSceneLayer';
import type { HeaderScene } from '../../services/headerScene';
import type { BannerTransform } from '../../utils/bannerTransform';
import { triggerHaptic } from '../../utils/haptics';
import { openUrl } from '../../utils/openUrl';
import { useT } from '../../i18n/store';

export const PROFILE_TOP_BAR_HEIGHT = 52;
export const PROFILE_AVATAR_SIZE = 104;
const AVATAR_TOP_GAP = 4;

// ─── Scroll-driven values ────────────────────────────────────────────────────

export interface ProfileScrollAnim {
  scrollY: Animated.Value;
  onScroll: (...args: any[]) => void;
  avatarStyle: any;
  bannerStyle: any;
  barBackgroundOpacity: Animated.AnimatedInterpolation<number>;
  titleStyle: any;
}

/**
 * One scroll value, every interpolation derived from it once.
 *
 * The title and the bar background appear while the NAME passes under the bar. The name sits
 * `PROFILE_AVATAR_SIZE + AVATAR_TOP_GAP + 12` below the bar's bottom edge, so that is where the
 * hand-off is centred.
 */
export function useProfileScrollAnim(): ProfileScrollAnim {
  const scrollY = React.useRef(new Animated.Value(0)).current;
  return useMemo(() => {
    const nameUnderBar = PROFILE_AVATAR_SIZE + AVATAR_TOP_GAP + 12;
    return {
      scrollY,
      onScroll: Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
      avatarStyle: {
        opacity: scrollY.interpolate({
          inputRange: [PROFILE_AVATAR_SIZE * 0.35, PROFILE_AVATAR_SIZE * 0.85],
          outputRange: [1, 0],
          extrapolate: 'clamp',
        }),
        transform: [
          {
            // Shrinks towards the bar as it scrolls away; grows slightly on an iOS pull-down.
            scale: scrollY.interpolate({
              inputRange: [-140, 0, PROFILE_AVATAR_SIZE],
              outputRange: [1.14, 1, 0.55],
              extrapolate: 'clamp',
            }),
          },
          {
            translateY: scrollY.interpolate({
              inputRange: [0, PROFILE_AVATAR_SIZE],
              outputRange: [0, PROFILE_AVATAR_SIZE * 0.3],
              extrapolate: 'clamp',
            }),
          },
        ],
      },
      // Over-scroll only (iOS bounce): the banner stretches to keep the gap above it filled.
      // Positive scroll leaves it attached to the content.
      bannerStyle: {
        transform: [
          {
            translateY: scrollY.interpolate({
              inputRange: [-300, 0, 1],
              outputRange: [-150, 0, 0],
              extrapolate: 'clamp',
            }),
          },
          {
            scale: scrollY.interpolate({
              inputRange: [-300, 0, 1],
              outputRange: [1.9, 1, 1],
              extrapolate: 'clamp',
            }),
          },
        ],
      },
      barBackgroundOpacity: scrollY.interpolate({
        inputRange: [nameUnderBar - 24, nameUnderBar + 8],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
      titleStyle: {
        opacity: scrollY.interpolate({
          inputRange: [nameUnderBar - 6, nameUnderBar + 18],
          outputRange: [0, 1],
          extrapolate: 'clamp',
        }),
        transform: [
          {
            translateY: scrollY.interpolate({
              inputRange: [nameUnderBar - 6, nameUnderBar + 18],
              outputRange: [10, 0],
              extrapolate: 'clamp',
            }),
          },
        ],
      },
    };
  }, [scrollY]);
}

// ─── Top bar ─────────────────────────────────────────────────────────────────

/**
 * Round 36 pt chrome button. Liquid glass when it is on; otherwise a flat translucent disc.
 *
 * Deliberately NOT a BlurView: this sits on every profile and a blur layer per button is the kind of
 * fixed cost that shows up as dropped frames during the push transition on weak Android devices.
 * Pressed feedback is a scale, never an opacity, because an opacity on any ancestor of a GlassView
 * discards the glass (expo/expo#41024).
 */
export const ProfileChromeButton = memo(function ProfileChromeButton({
  icon,
  onPress,
  onLongPress,
  overMedia,
  glassActive,
  accessibilityLabel,
  iconFamily = 'feather',
}: {
  icon: string;
  onPress: () => void;
  onLongPress?: () => void;
  /** True when the button sits on a banner/drawing, which needs a dark disc and a white glyph. */
  overMedia: boolean;
  glassActive: boolean;
  accessibilityLabel: string;
  iconFamily?: 'feather' | 'fa5';
}) {
  const theme = useTheme();
  // Over media the disc is always dark (dark glass, or a 32 % black fill), so a white glyph reads
  // both on the cover and after the bar behind it has turned solid.
  const color = overMedia ? '#FFFFFF' : theme.colors.text.primary;
  const glyph =
    iconFamily === 'fa5' ? (
      <FontAwesome5 name={icon} size={15} color={color} />
    ) : (
      <Feather name={icon as any} size={19} color={color} />
    );
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({ borderRadius: 18, transform: [{ scale: pressed ? 0.92 : 1 }] })}
    >
      {glassActive ? (
        <NativeGlassView
          glassStyle="regular"
          colorScheme={overMedia || theme.isDark ? 'dark' : 'light'}
          style={styles.chromeButton}
        >
          {glyph}
        </NativeGlassView>
      ) : (
        <View
          style={[
            styles.chromeButton,
            {
              backgroundColor: overMedia
                ? 'rgba(0,0,0,0.32)'
                : theme.isDark
                  ? 'rgba(255,255,255,0.10)'
                  : 'rgba(0,0,0,0.06)',
            },
          ]}
        >
          {glyph}
        </View>
      )}
    </Pressable>
  );
});

/**
 * Transparent over the cover; a solid bar with the name as its title once the name has scrolled
 * under it. The background is a plain fill, not a blur: animating the alpha of a
 * UIVisualEffectView renders it incorrectly until the alpha returns to 1, and a solid fill is
 * free on every device.
 */
export const ProfileTopBar = memo(function ProfileTopBar({
  topInset,
  title,
  anim,
  left,
  right,
}: {
  topInset: number;
  title: string;
  anim: ProfileScrollAnim;
  left?: React.ReactNode;
  right?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, height: topInset + PROFILE_TOP_BAR_HEIGHT, zIndex: 20 }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: theme.colors.background.primary,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border.light,
            opacity: anim.barBackgroundOpacity,
          },
        ]}
      />
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: topInset,
          left: 0,
          right: 0,
          height: PROFILE_TOP_BAR_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
        }}
      >
        <View style={styles.barSide} pointerEvents="box-none">{left}</View>
        <Animated.View pointerEvents="none" style={[{ flex: 1, alignItems: 'center' }, anim.titleStyle]}>
          <Text variant="body" weight="semibold" numberOfLines={1}>{title}</Text>
        </Animated.View>
        <View style={[styles.barSide, { alignItems: 'flex-end' }]} pointerEvents="box-none">{right}</View>
      </View>
    </View>
  );
});

// ─── Cover ───────────────────────────────────────────────────────────────────

export interface ProfileCoverProps {
  topInset: number;
  emoji: string;
  displayName: string;
  username: string;
  isVerified?: boolean;
  badge?: string | null;
  bannerUrl?: string;
  bannerTransform: BannerTransform;
  scene: HeaderScene | null;
  sceneAnimate: boolean;
  anim: ProfileScrollAnim;
  onAvatarPress?: () => void;
  onAvatarLongPress?: () => void;
  avatarAccessibilityLabel?: string;
}

/** True when the cover has something painted behind the text, which then has to be white. */
export function coverHasMedia(bannerUrl: string | undefined, scene: HeaderScene | null): boolean {
  return !!bannerUrl || !!scene?.background || (scene?.drawing?.length ?? 0) > 0;
}

export const ProfileCover = memo(function ProfileCover({
  topInset,
  emoji,
  displayName,
  username,
  isVerified,
  badge,
  bannerUrl,
  bannerTransform,
  scene,
  sceneAnimate,
  anim,
  onAvatarPress,
  onAvatarLongPress,
  avatarAccessibilityLabel,
}: ProfileCoverProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const proxyWidth = Math.round(width);
  const hasMedia = coverHasMedia(bannerUrl, scene);
  const nameColor = hasMedia ? '#FFFFFF' : theme.colors.text.primary;
  const subColor = hasMedia ? 'rgba(255,255,255,0.86)' : theme.colors.text.secondary;
  const textShadow = hasMedia ? styles.textShadow : null;
  const bg = theme.colors.background.primary;

  // Avatar fill: a soft tint of the accent on a plain cover, a translucent disc on media.
  const avatarFill = hasMedia
    ? 'rgba(255,255,255,0.18)'
    : theme.isDark
      ? 'rgba(255,255,255,0.08)'
      : 'rgba(0,0,0,0.05)';

  return (
    <View style={{ paddingTop: topInset + PROFILE_TOP_BAR_HEIGHT + AVATAR_TOP_GAP, paddingBottom: 22 }}>
      {/* Backdrop layers. Absolute, so the identity block alone decides the cover's height. */}
      {hasMedia ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, anim.bannerStyle]}>
          {bannerUrl ? (
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
              proxyWidth={proxyWidth}
              skeleton
            />
          ) : null}
          <HeaderBackgroundLayer
            backgroundId={scene?.background}
            drawing={scene?.drawing}
            hasBanner={!!bannerUrl}
            blend={scene?.bgBlend}
          />
          {/* Darkens the top for the status bar and fades the bottom into the page, so the cover
              ends without a hard edge and the action tiles sit on the page colour. */}
          <LinearGradient
            colors={['rgba(0,0,0,0.30)', 'rgba(0,0,0,0)', bg + '00', bg + 'E6']}
            locations={[0, 0.3, 0.62, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
      <HeaderSceneLayer scene={scene} animate={sceneAnimate} />

      <View style={{ alignItems: 'center', paddingHorizontal: 24 }}>
        <Animated.View style={anim.avatarStyle}>
          <Pressable
            onPress={onAvatarPress}
            onLongPress={onAvatarLongPress}
            disabled={!onAvatarPress && !onAvatarLongPress}
            accessibilityRole={onAvatarPress ? 'button' : 'image'}
            accessibilityLabel={avatarAccessibilityLabel}
            style={({ pressed }) => [
              styles.avatar,
              { backgroundColor: avatarFill, transform: [{ scale: pressed ? 0.96 : 1 }] },
            ]}
          >
            <RNText allowFontScaling={false} style={[emojiTextStyle(54), { textAlign: 'center' }]}>
              {emoji || '🙂'}
            </RNText>
          </Pressable>
        </Animated.View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, maxWidth: '100%' }}>
          <Text
            variant="heading"
            weight="bold"
            color={nameColor}
            numberOfLines={1}
            style={{ flexShrink: 1, fontSize: 24, lineHeight: 29, textAlign: 'center', ...(textShadow || {}) }}
          >
            {displayName}
          </Text>
          {isVerified ? <VerifiedBadge size={18} /> : null}
          {badge ? <UserBadge badge={badge} size="md" /> : null}
        </View>
        <Text
          variant="body"
          color={subColor}
          numberOfLines={1}
          style={{ marginTop: 3, fontSize: 15, ...(textShadow || {}) }}
        >
          @{username}
        </Text>
      </View>
    </View>
  );
});

// ─── Action tiles ────────────────────────────────────────────────────────────

export interface ProfileAction {
  key: string;
  icon: string;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

/**
 * Equal-width tiles, icon over label, like Telegram's Message / Mute / Call / More row.
 * Glass tiles on iOS when Liquid Glass is on, tonal tiles otherwise (Material 3 on Android).
 */
export const ProfileActionRow = memo(function ProfileActionRow({
  actions,
  glassActive,
}: {
  actions: ProfileAction[];
  glassActive: boolean;
}) {
  const theme = useTheme();
  const tileBg = theme.colors.background.elevated;
  return (
    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
      {actions.map((a) => {
        const color = a.destructive ? theme.colors.status.error : theme.colors.accent.primary;
        const content = (
          <>
            <Feather name={a.icon as any} size={21} color={color} />
            <Text variant="caption" weight="medium" color={color} numberOfLines={1} style={{ fontSize: 12.5 }}>
              {a.label}
            </Text>
          </>
        );
        return (
          <Pressable
            key={a.key}
            onPress={() => { triggerHaptic('light'); a.onPress(); }}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            android_ripple={glassActive ? undefined : { color: theme.colors.accent.primary + '22', foreground: true }}
            style={({ pressed }) => [
              { flex: 1, borderRadius: 16, overflow: glassActive ? 'visible' : 'hidden' },
              Platform.OS === 'ios' ? { transform: [{ scale: pressed ? 0.96 : 1 }] } : null,
            ]}
          >
            {glassActive ? (
              <NativeGlassView glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.tile}>
                {content}
              </NativeGlassView>
            ) : (
              <View style={[styles.tile, { backgroundColor: tileBg }]}>{content}</View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
});

// ─── Info card ───────────────────────────────────────────────────────────────

export const ProfileInfoCard = memo(function ProfileInfoCard({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const rows = React.Children.toArray(children).filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <View style={{ marginHorizontal: 16, marginTop: 16, borderRadius: 20, backgroundColor: theme.colors.background.elevated, overflow: 'hidden' }}>
      {rows.map((row, i) => (
        <View key={i}>
          {i > 0 ? (
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border.light, marginLeft: 16 }} />
          ) : null}
          {row}
        </View>
      ))}
    </View>
  );
});

/** Value on top, caption under it — Telegram's "bio" / "username" rows. */
export const ProfileInfoRow = memo(function ProfileInfoRow({
  value,
  caption,
  onPress,
  onLongPress,
  linkify,
  right,
}: {
  value: string;
  caption: string;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Render the value through LinkedText so URLs and @mentions in a bio are tappable. */
  linkify?: boolean;
  right?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      android_ripple={onPress || onLongPress ? { color: theme.colors.text.primary + '14', foreground: true } : undefined}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11 },
        Platform.OS === 'ios' && pressed && (onPress || onLongPress) ? { backgroundColor: theme.colors.text.primary + '0D' } : null,
      ]}
    >
      <View style={{ flex: 1 }}>
        {linkify ? (
          <LinkedText style={{ color: theme.colors.text.primary, fontSize: 16, lineHeight: 21 }}>{value}</LinkedText>
        ) : (
          <Text variant="body" style={{ fontSize: 16, lineHeight: 21 }}>{value}</Text>
        )}
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 2, fontSize: 13 }}>
          {caption}
        </Text>
      </View>
      {right}
    </Pressable>
  );
});

// ─── Links ───────────────────────────────────────────────────────────────────

type LinkKind =
  | 'github' | 'twitter' | 'instagram' | 'youtube' | 'telegram' | 'tiktok' | 'linkedin'
  | 'discord' | 'twitch' | 'spotify' | 'reddit' | 'vk' | 'website';

function detectLinkKind(url: string): LinkKind {
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

const LINK_META: Record<LinkKind, { icon: string; brand: boolean; label: string; color?: string }> = {
  github: { icon: 'github', brand: true, label: 'GitHub' },
  twitter: { icon: 'twitter', brand: true, label: 'X', color: '#1DA1F2' },
  instagram: { icon: 'instagram', brand: true, label: 'Instagram', color: '#E4405F' },
  youtube: { icon: 'youtube', brand: true, label: 'YouTube', color: '#FF0000' },
  telegram: { icon: 'telegram-plane', brand: true, label: 'Telegram', color: '#2AABEE' },
  tiktok: { icon: 'tiktok', brand: true, label: 'TikTok' },
  linkedin: { icon: 'linkedin-in', brand: true, label: 'LinkedIn', color: '#0A66C2' },
  discord: { icon: 'discord', brand: true, label: 'Discord', color: '#5865F2' },
  twitch: { icon: 'twitch', brand: true, label: 'Twitch', color: '#9146FF' },
  spotify: { icon: 'spotify', brand: true, label: 'Spotify', color: '#1DB954' },
  reddit: { icon: 'reddit-alien', brand: true, label: 'Reddit', color: '#FF4500' },
  vk: { icon: 'vk', brand: true, label: 'VK', color: '#0077FF' },
  website: { icon: 'globe', brand: false, label: '' },
};

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

export const ProfileLinkRow = memo(function ProfileLinkRow({ url }: { url: string }) {
  const theme = useTheme();
  const t = useT();
  const kind = detectLinkKind(url);
  const meta = LINK_META[kind];
  const iconColor = meta.color || theme.colors.text.primary;
  return (
    <ProfileInfoRow
      value={displayUrl(url)}
      caption={meta.label || t('edit_profile.link_website')}
      onPress={() => { triggerHaptic('light'); openUrl(url); }}
      right={
        meta.brand ? (
          <FontAwesome5 name={meta.icon} size={17} color={iconColor} brand />
        ) : (
          <Feather name="globe" size={17} color={theme.colors.accent.primary} />
        )
      }
    />
  );
});

/** Links are stored either as an array or as a JSON string; anything unparseable is no links. */
export function parseProfileLinks(raw: unknown): { type?: string; url: string }[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((l) => l && typeof l.url === 'string' && l.url.length > 0);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((l) => l && typeof l.url === 'string' && l.url.length > 0) : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ─── QR ──────────────────────────────────────────────────────────────────────

export function profileUrl(profileId: string): string {
  return `https://san-m-app.com/profile/${profileId}`;
}

export function ProfileQRModal({
  visible,
  onClose,
  profileId,
  title,
}: {
  visible: boolean;
  onClose: () => void;
  profileId: string;
  title: string;
}) {
  const t = useT();
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(profileUrl(profileId))}`;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' }}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('profile.qr_close_hint')}
      >
        <Text variant="body" weight="bold" color="#FFFFFF" style={{ marginBottom: 20 }}>{title}</Text>
        <View style={{ backgroundColor: '#FFF', borderRadius: 24, padding: 20 }}>
          {visible ? <Image source={{ uri: qrUrl }} style={{ width: 220, height: 220 }} resizeMode="contain" /> : null}
        </View>
        <Text variant="caption" color="rgba(255,255,255,0.7)" style={{ marginTop: 20 }}>{t('profile.qr_close_hint')}</Text>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chromeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barSide: {
    width: 84,
    flexDirection: 'row',
    gap: 8,
  },
  avatar: {
    width: PROFILE_AVATAR_SIZE,
    height: PROFILE_AVATAR_SIZE,
    borderRadius: PROFILE_AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: {
    height: 62,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 6,
  },
  textShadow: {
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
