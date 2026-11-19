/**
 * Profile building blocks shared by the own-profile tab (`app/(tabs)/profile.tsx`) and someone
 * else's profile (`app/profile/[id].tsx`).
 *
 * The header is the app's ORIGINAL profile design (banner card, rounded-square avatar, left-aligned
 * name / @handle, social chips, bio, action pills, floating buttons that slide away on scroll),
 * kept as it was minus the follower counts. Below it, where the post tabs used to be, a "Медиа"
 * grid shows recent photos from chats, so the screen is not empty.
 *
 * Performance: one ScrollView with a fixed handful of views instead of a post list; scroll effects
 * are opacity / translate on the native driver; the media grid is read from the small per-chat tail
 * cache AFTER the push transition, never on the open frame.
 */
import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  View,
  Pressable,
  Animated,
  StyleSheet,
  Image,
  Modal,
  Platform,
  InteractionManager,
  useWindowDimensions,
} from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { UserBadge } from '../ui/UserBadge';
import { CachedImage } from '../ui/CachedImage';
import { BlurView } from '../ui/AppBlurView';
import { NativeGlassView } from '../ui/LiquidGlass';
import { LinkedText } from '../ui/LinkedText';
import { HeaderBackgroundLayer } from './HeaderBackgroundLayer';
import { ProfileLinkBubbles } from './ProfileLinkBubbles';
import { HeaderSceneLayer } from './HeaderSceneLayer';
import type { HeaderScene } from '../../services/headerScene';
import type { BannerTransform } from '../../utils/bannerTransform';
import { compareIso } from '../../utils/compareIso';
import { kvGetJSONSync } from '../../services/kvStore';
import { useEntityStore } from '../../services/entityStore';
import { triggerHaptic } from '../../utils/haptics';
import { useTransitionSettled } from '../../hooks/useTransitionSettled';
import { useT } from '../../i18n/store';

// ─── Scroll-driven values (same curves as the original screens) ─────────────

export function useProfileScrollAnim() {
  const scrollY = React.useRef(new Animated.Value(0)).current;
  return useMemo(() => ({
    scrollY,
    onScroll: Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    headerOpacity: scrollY.interpolate({ inputRange: [0, 36, 210], outputRange: [0, 0, 1], extrapolate: 'clamp' }),
    leftTranslateX: scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, -60], extrapolate: 'clamp' }),
    rightTranslateX: scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, 60], extrapolate: 'clamp' }),
  }), [scrollY]);
}
export type ProfileScrollAnim = ReturnType<typeof useProfileScrollAnim>;

// ─── Floating chrome buttons (QR / settings, or back / menu) ─────────────────

function ChromeButton({ glassActive, onPress, children, label }: { glassActive: boolean; onPress: () => void; children: React.ReactNode; label: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={{ borderRadius: 17, overflow: glassActive ? undefined : 'hidden' }}>
      {glassActive ? (
        <NativeGlassView glassStyle="regular" colorScheme="dark" style={styles.chrome}>{children}</NativeGlassView>
      ) : (
        <BlurView role="scrim" intensity={80} tint="dark" style={styles.chrome}>{children}</BlurView>
      )}
    </Pressable>
  );
}

export const ProfileFloatingButtons = memo(function ProfileFloatingButtons({
  topInset, anim, glassActive, left, right,
}: {
  topInset: number;
  anim: ProfileScrollAnim;
  glassActive: boolean;
  left?: { icon: string; fa5?: boolean; label: string; onPress: () => void };
  right?: { icon: string; fa5?: boolean; label: string; onPress: () => void };
}) {
  const glyph = (b: { icon: string; fa5?: boolean }) =>
    b.fa5 ? <FontAwesome5 name={b.icon} size={15} color="#FFFFFF" /> : <Feather name={b.icon as any} size={17} color="#FFFFFF" />;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: topInset + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 100 }}>
      <Animated.View style={{ transform: [{ translateX: anim.leftTranslateX }] }}>
        {left ? <ChromeButton glassActive={glassActive} onPress={left.onPress} label={left.label}>{glyph(left)}</ChromeButton> : null}
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: anim.rightTranslateX }] }}>
        {right ? <ChromeButton glassActive={glassActive} onPress={right.onPress} label={right.label}>{glyph(right)}</ChromeButton> : null}
      </Animated.View>
    </View>
  );
});

// ─── Action pill (unchanged from the original header) ────────────────────────

export function ProfileActionPill({ glassActive, onPress, square = false, accent = false, children }: { glassActive: boolean; onPress: () => void; square?: boolean; accent?: boolean; children: React.ReactNode }) {
  const theme = useTheme();
  const height = 38;
  const radius = height / 2;
  const surface = { height, width: square ? height : undefined, paddingHorizontal: square ? 0 : 20, borderRadius: radius, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6 };
  const accentFill = theme.colors.accent.primary;
  if (glassActive) {
    return (
      <Pressable onPress={onPress} style={{ borderRadius: radius }}>
        <NativeGlassView glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} tintColor={accent ? accentFill + 'D9' : undefined} style={surface}>{children}</NativeGlassView>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} style={{ borderRadius: radius, overflow: 'hidden' }}>
      <BlurView intensity={70} tint={theme.isDark ? 'dark' : 'light'} style={surface}>
        {accent ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: accentFill + 'E6' }]} /> : null}
        {children}
      </BlurView>
    </Pressable>
  );
}

// ─── Header card (the original design, minus follower counts) ───────────────

export const ProfileHeaderCard = memo(function ProfileHeaderCard({
  topInset, anim, glassActive, emoji, displayName, username, isVerified, badge, bio, links,
  bannerUrl, bannerTransform, scene, sceneAnimate, onAvatarPress, actions,
}: {
  topInset: number;
  anim: ProfileScrollAnim;
  glassActive: boolean;
  emoji: string;
  displayName: string;
  username: string;
  isVerified?: boolean;
  badge?: string | null;
  bio?: string | null;
  links: { url: string }[];
  bannerUrl?: string;
  bannerTransform: BannerTransform;
  scene: HeaderScene | null;
  sceneAnimate: boolean;
  onAvatarPress?: () => void;
  actions: React.ReactNode;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const settled = useTransitionSettled();
  // ── Telegram's profile scroll animation ────────────────────────────────────
  // As the profile scrolls, the avatar travels to the Dynamic Island on iPhone (shrinking and turning
  // black, so it merges into it) and slides out through the top of the screen elsewhere — the effect
  // Telegram introduced on iOS and later brought to Android. Pure transform/opacity on the native
  // driver. No opacity on the avatar's container: an alpha on a GlassView ancestor discards the glass.
  const island = Platform.OS === 'ios' && topInset >= 51;
  const avatarAnim = useMemo(() => {
    const startX = 20 + 42;
    const startY = topInset + 52 + 42;
    const targetX = island ? width / 2 : startX;
    const targetY = island ? topInset / 2 : -70;
    const travel = Math.max(60, startY - targetY);
    const s = anim.scrollY;
    const pin = targetY - startY + travel;
    return {
      container: {
        transform: [
          { translateX: s.interpolate({ inputRange: [0, travel], outputRange: [0, targetX - startX], extrapolate: 'clamp' }) },
          // Past `travel` it keeps counter-scrolling, so it stays parked in the island.
          { translateY: s.interpolate({ inputRange: [0, travel, travel + 2000], outputRange: [0, pin, pin + 2000], extrapolate: 'clamp' }) },
          { scale: s.interpolate({ inputRange: [0, travel], outputRange: [1, island ? 0.16 : 0.55], extrapolate: 'clamp' }) },
        ],
      },
      black: { opacity: s.interpolate({ inputRange: [travel * 0.45, travel * 0.9], outputRange: [0, 1], extrapolate: 'clamp' }) },
    };
  }, [anim.scrollY, width, topInset, island]);
  const avatar = glassActive ? (
    <NativeGlassView glassStyle={bannerUrl ? 'clear' : 'regular'} colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.avatarTile}>
      <Avatar emoji={emoji || '😊'} size="lg" />
    </NativeGlassView>
  ) : (
    <View style={[styles.avatarTile, { overflow: 'hidden' }]}>
      <BlurView intensity={70} tint={theme.isDark ? 'dark' : 'light'} style={styles.avatarTile}>
        <Avatar emoji={emoji || '😊'} size="lg" />
      </BlurView>
    </View>
  );
  // White name over a cover; theme text on the plain card (white-on-cream was unreadable in light).
  const onMedia = !!bannerUrl || !!scene?.background || (scene?.drawing?.length ?? 0) > 0 || theme.isDark;
  const nameColor = onMedia ? '#FFFFFF' : theme.colors.text.primary;
  const handleColor = onMedia ? 'rgba(255,255,255,0.85)' : theme.colors.text.secondary;
  const shadow = onMedia ? styles.textShadow : null;
  return (
    <View style={{ borderBottomLeftRadius: 30, borderBottomRightRadius: 30, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}>
      {bannerUrl ? (
        <View style={StyleSheet.absoluteFill}>
          {/* No shimmer: a shimmer on every cold open is exactly the "it is loading" look that was
              reported. The banner is warmed into memory at launch (see _layout.tsx) and otherwise
              fades in over the card's own background on its first appearance in the session. */}
          <CachedImage
            uri={bannerUrl}
            style={{ width: '100%', height: '100%', transform: [{ translateX: bannerTransform.translateX }, { translateY: bannerTransform.translateY }, { scale: bannerTransform.scale }] }}
            resizeMode="cover"
            proxyWidth={Math.round(width)}
          />
          <LinearGradient colors={[theme.colors.background.primary + '00', theme.colors.background.primary + '55']} style={StyleSheet.absoluteFill} pointerEvents="none" />
        </View>
      ) : null}
      <HeaderBackgroundLayer backgroundId={scene?.background} drawing={scene?.drawing} hasBanner={!!bannerUrl} blend={scene?.bgBlend} />

      <View style={{ paddingTop: topInset + 52, paddingHorizontal: 20, paddingBottom: 22 }}>
        {/* Placeholder: the real avatar is drawn above the frost (see the end of the card) so it
            stays crisp while it flies to the island. */}
        <View style={styles.avatarTile} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
          <Text variant="heading" weight="bold" color={nameColor} numberOfLines={1} style={{ flexShrink: 1, fontSize: 24, lineHeight: 28, ...(shadow || {}) }}>{displayName}</Text>
          {isVerified ? <VerifiedBadge size={18} /> : null}
          {badge ? <UserBadge badge={badge} size="md" /> : null}
        </View>
        <Text variant="body" color={handleColor} numberOfLines={1} style={{ marginTop: 2, ...(shadow || {}) }}>@{username}</Text>
        {bio ? (
          <View style={{ marginTop: 14 }}>
            <LinkedText style={{ color: theme.colors.text.secondary, fontSize: 15, lineHeight: 21 }}>{bio}</LinkedText>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}>{actions}</View>
      </View>

      <HeaderSceneLayer scene={scene} animate={sceneAnimate} />

      {/* Links float as liquid bubbles in the space beside the avatar (they replaced the chip row
          under the @handle). Under the frost, so they frost over with the rest of the card. */}
      {links.length > 0 ? (
        <ProfileLinkBubbles
          links={links}
          top={topInset + 44}
          left={20 + 84 + 16}
          height={108}
          active={sceneAnimate}
        />
      ) : null}

      {/* Frost fades in over the whole card as it scrolls away (native-driver opacity). It is
          invisible at the top of the page, so the blur view is created after the push animation
          instead of during it. */}
      {settled ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: anim.headerOpacity }]}>
          <BlurView intensity={theme.isDark ? 55 : 75} tint={theme.isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.isDark ? 'rgba(20,21,28,0.32)' : 'rgba(255,255,255,0.34)' }]} />
        </Animated.View>
      ) : null}

      <Animated.View style={[{ position: 'absolute', top: topInset + 52, left: 20 }, avatarAnim.container]}>
        <Pressable onPress={onAvatarPress} disabled={!onAvatarPress} style={{ borderRadius: 26 }}>
          {avatar}
          {island ? (
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 26, backgroundColor: '#000' }, avatarAnim.black]} />
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  );
});

// ─── "Медиа": recent photos from chats ───────────────────────────────────────

export interface ProfileMediaItem { url: string; conversationId: string }

const MEDIA_LIMIT = 24;
const isAnimated = (u: string) => /\.gif(\?|$)/i.test(u) || /giphy\.com|tenor\.com/i.test(u);

/**
 * Photos from chats, newest first. `peerId` set: the DM with that person (both directions).
 * `peerId` null: photos THIS account sent in its most recent chats.
 *
 * Read from `chat_tail:<conversationId>` (the bounded ~60-message tail the chat keeps for its own
 * first paint), after interactions, so a profile push never pays for it. GIFs are skipped: a grid of
 * animating GIFs is the decode load the chat screen gates for a reason.
 */
export function useProfileMedia(myId: string | undefined, peerId: string | null): ProfileMediaItem[] {
  const [items, setItems] = useState<ProfileMediaItem[]>([]);
  useEffect(() => {
    if (!myId) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      try {
        const convs = (useEntityStore.getState().conversations || []) as Array<{ id: string; participantId?: string; lastMessageAt?: string }>;
        const picked = (peerId ? convs.filter((c) => c.participantId === peerId) : [...convs])
          .sort((a, b) => compareIso(b.lastMessageAt || '', a.lastMessageAt || ''))
          .slice(0, peerId ? 2 : 10);
        const out: { url: string; conversationId: string; ts: string }[] = [];
        const seen = new Set<string>();
        for (const c of picked) {
          const tail = kvGetJSONSync<any[]>(`chat_tail:${c.id}`, []);
          for (let i = tail.length - 1; i >= 0; i--) {
            const m = tail[i];
            if (!m || !Array.isArray(m.imageUrls)) continue;
            if (!peerId && m.senderId !== myId) continue;
            for (const u of m.imageUrls) {
              if (typeof u !== 'string' || !u.startsWith('http') || isAnimated(u) || seen.has(u)) continue;
              seen.add(u);
              out.push({ url: u, conversationId: c.id, ts: String(m.createdAt || '') });
            }
          }
        }
        out.sort((a, b) => compareIso(b.ts, a.ts));
        setItems(out.slice(0, MEDIA_LIMIT).map(({ url, conversationId }) => ({ url, conversationId })));
      } catch {
        setItems([]);
      }
    });
    return () => handle.cancel();
  }, [myId, peerId]);
  return items;
}

export const ProfileMediaGrid = memo(function ProfileMediaGrid({ items, onPressItem }: { items: ProfileMediaItem[]; onPressItem: (item: ProfileMediaItem) => void }) {
  const theme = useTheme();
  const t = useT();
  const { width } = useWindowDimensions();
  const gap = 3;
  const cell = Math.floor((width - 32 - gap * 2) / 3);
  return (
    <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
      <View style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, backgroundColor: theme.colors.accent.primary + '1F', marginBottom: 12 }}>
        <Text variant="caption" weight="bold">{t('profile.media')}</Text>
      </View>
      {items.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
          <Feather name="image" size={26} color={theme.colors.text.tertiary} />
          <Text variant="caption" color={theme.colors.text.tertiary} align="center">{t('profile.media_empty', 'Здесь появятся фото из чатов')}</Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
          {items.map((it) => (
            <Pressable key={it.url} onPress={() => { triggerHaptic('light'); onPressItem(it); }} style={{ width: cell, height: cell, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.colors.background.elevated }}>
              {/* Display width; `proxiedImageUrl` applies the density factor (see ProfileContentTabs). */}
              <CachedImage uri={it.url} style={{ width: cell, height: cell }} resizeMode="cover" proxyWidth={cell} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
});

// ─── Links / QR helpers ──────────────────────────────────────────────────────

/** Links are stored either as an array or as a JSON string; anything unparseable is no links. */
export function parseProfileLinks(raw: unknown): { type?: string; url: string }[] {
  let v: unknown = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v.filter((l: any) => l && typeof l.url === 'string' && l.url.length > 0) : [];
}

export function profileUrl(profileId: string): string {
  return `https://san-m-app.com/profile/${profileId}`;
}

export function ProfileQRModal({ visible, onClose, profileId, title }: { visible: boolean; onClose: () => void; profileId: string; title: string }) {
  const t = useT();
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(profileUrl(profileId))}`;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' }} onPress={onClose}>
        <Text variant="body" weight="bold" color="#FFFFFF" style={{ marginBottom: 20 }}>{title}</Text>
        <View style={{ backgroundColor: '#FFF', borderRadius: 20, padding: 20 }}>
          {visible ? <Image source={{ uri: qrUrl }} style={{ width: 200, height: 200 }} resizeMode="contain" /> : null}
        </View>
        <Text variant="caption" color="#FFFFFF" style={{ marginTop: 20, opacity: 0.7 }}>{t('profile.qr_close_hint')}</Text>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chrome: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  avatarTile: { width: 84, height: 84, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  textShadow: { textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
