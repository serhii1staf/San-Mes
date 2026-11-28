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
import { ProfileLinkBubbles } from './ProfileLinkBubbles';
import { createScrollRest, useRestFlag } from './scrollRest';
import { avatarGeometry, createHandMarks } from './profileHandMath';
import type { BannerTransform } from '../../utils/bannerTransform';
import { compareIso } from '../../utils/compareIso';
import { kvGetJSONSync } from '../../services/kvStore';
import { useEntityStore } from '../../services/entityStore';
import { triggerHaptic } from '../../utils/haptics';
import { useTransitionSettled } from '../../hooks/useTransitionSettled';
import { useAmbientMotionAllowed } from '../../hooks/useAmbientMotionAllowed';
import { useT } from '../../i18n/store';
import { getMaskedView } from '../ui/FadingBlurHeader';

// ── THE BANNER MELTS INTO THE PAGE (Nov 2026) ───────────────────────────────────────────────────
//
// Asked: instead of the banner's rounded bottom corners, a smooth transition into the page where the
// tabs (Публикации / Медиа / Ответы) begin, "like Telegram", without cropping or shrinking anything.
// The card keeps its size and the banner its framing. Over the card's last `BANNER_FADE_H` points the
// banner blurs a little and then fades into the page's own colour, which it reaches exactly at the
// card's edge, so no edge is left to see. The curve is a smoothstep, flat at both ends, so there is no
// line where the fade starts or ends. The blur is a copy of the image blurred once when it is decoded
// and shown through a gradient mask: nothing is blurred per frame. A GIF banner gets the fade without
// the blur (a still copy would not follow the animation). Without a banner the card keeps its rounded
// tinted shape.
const BANNER_FADE_H = 140;
const BANNER_BLUR_RADIUS = 18;
const FADE_STOPS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1] as const;
const smoothstep = (t: number) => t * t * (3 - 2 * t);
type GradientColors = readonly [string, string, ...string[]];
/** `bg` (#RRGGBB) at the fade's alpha at each of `FADE_STOPS`. */
function fadeColors(bg: string): GradientColors {
  const base = bg.length === 9 ? bg.slice(0, 7) : bg;
  return FADE_STOPS.map((s) => base + Math.round(smoothstep(s) * 255).toString(16).padStart(2, '0')) as unknown as GradientColors;
}
// The blur's mask: none at the top of the fade, fully in by a little past its middle, where the page
// colour has started to cover it.
const BLUR_MASK_STOPS = [0, 0.12, 0.24, 0.36, 0.48, 0.6, 1] as const;
const BLUR_MASK_COLORS = BLUR_MASK_STOPS.map((s) => `rgba(0,0,0,${smoothstep(Math.min(1, s / 0.6)).toFixed(3)})`) as unknown as GradientColors;

// ─── Scroll-driven values (same curves as the original screens) ─────────────

export function useProfileScrollAnim() {
  const scrollY = React.useRef(new Animated.Value(0)).current;
  return useMemo(() => {
    // The resting offset, for pausing what has been scrolled away. See scrollRest.ts.
    const { rest, onRest } = createScrollRest();
    return {
      scrollY,
      // Where the name and the buttons sit on the page, reported once by the header card, for the hand
      // that pulls them up (ProfileHand).
      marks: createHandMarks(),
      onScroll: Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
      // Both: a drag released without a fling ends with `onScrollEndDrag` alone on iOS.
      onScrollEndDrag: onRest,
      onMomentumScrollEnd: onRest,
      rest,
      headerOpacity: scrollY.interpolate({ inputRange: [0, 36, 210], outputRange: [0, 0, 1], extrapolate: 'clamp' }),
      leftTranslateX: scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, -60], extrapolate: 'clamp' }),
      rightTranslateX: scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, 60], extrapolate: 'clamp' }),
    };
  }, [scrollY]);
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

/** The link drops' band, below the top inset: beside the avatar. */
const DROPS_TOP = 44;
const DROPS_HEIGHT = 108;

export const ProfileHeaderCard = memo(function ProfileHeaderCard({
  topInset, anim, glassActive, emoji, displayName, username, isVerified, badge, bio, links,
  bannerUrl, bannerTransform, animate, onAvatarPress, actions,
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
  /** The screen is focused: the link drops may move. */
  animate: boolean;
  onAvatarPress?: () => void;
  actions: React.ReactNode;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const settled = useTransitionSettled();
  // The drops pause once the page has come to rest with them above the top of the screen (see
  // `ScrollRest`).
  const dropsAway = useRestFlag(anim.rest, (y) => y >= topInset + DROPS_TOP + DROPS_HEIGHT);
  // ── UNDER THE FROST THE HEADER IS STILL (Nov 2026) ────────────────────────────────────────────
  //
  // The frost over the card starts to show at 36 pt of scroll (`headerOpacity`), but the drops kept
  // moving until the page rested past their band. On iOS the frost is our glass, which re-captures
  // and blurs everything beneath it whenever that changes: resting anywhere in between, the moving
  // drops made it capture the card on every frame (or every other one), with nothing touched, for as
  // long as the page stayed there. Resting with the frost showing, they now pause, so the frost goes
  // still too. They are frosted over there anyway, and they resume where they were.
  const frostOn = useRestFlag(anim.rest, (y) => y > 36);
  const headerMoving = animate && !frostOn;
  const motionAllowed = useAmbientMotionAllowed();
  const bannerAnimated = !!bannerUrl && isAnimated(bannerUrl);
  // ── Telegram's profile scroll animation ────────────────────────────────────
  // As the profile scrolls, the avatar travels to the Dynamic Island on iPhone (shrinking and turning
  // black, so it merges into it) and slides out through the top of the screen elsewhere — the effect
  // Telegram introduced on iOS and later brought to Android. Pure transform/opacity on the native
  // driver. No opacity on the avatar's container: an alpha on a GlassView ancestor discards the glass.
  const island = Platform.OS === 'ios' && topInset >= 51;
  const avatarAnim = useMemo(() => {
    // The same numbers the hand reaches for (profileHandMath.ts).
    const { startX, targetX, travel, pin } = avatarGeometry(topInset, width, island);
    const s = anim.scrollY;
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
  const onMedia = !!bannerUrl || theme.isDark;
  const nameColor = onMedia ? '#FFFFFF' : theme.colors.text.primary;
  const handleColor = onMedia ? 'rgba(255,255,255,0.85)' : theme.colors.text.secondary;
  const shadow = onMedia ? styles.textShadow : null;
  const cardTint = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const pageBg = theme.colors.background.primary;
  const fade = useMemo(() => fadeColors(pageBg), [pageBg]);
  const bannerImageStyle = { width: '100%' as const, height: '100%' as const, transform: [{ translateX: bannerTransform.translateX }, { translateY: bannerTransform.translateY }, { scale: bannerTransform.scale }] };
  // iOS only: Android's masked view draws its subtree in software, which a hardware bitmap cannot be
  // drawn into. There the fade alone carries it.
  const FadeMask = Platform.OS === 'ios' && bannerUrl && !bannerAnimated ? getMaskedView() : null;
  return (
    <View
      style={
        bannerUrl
          // A banner ends in a fade to the page instead of rounded corners (see "THE BANNER MELTS
          // INTO THE PAGE"). Still clipped: the banner's own position can scale it past the card.
          ? styles.cardWithBanner
          : [styles.cardRounded, { backgroundColor: cardTint }]
      }
    >
      {bannerUrl ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: cardTint }]} pointerEvents="none">
          {/* No shimmer: a shimmer on every cold open is exactly the "it is loading" look that was
              reported. The banner is warmed into memory at launch (see _layout.tsx) and otherwise
              fades in over the card's own background on its first appearance in the session. */}
          <CachedImage
            uri={bannerUrl}
            style={bannerImageStyle}
            resizeMode="cover"
            proxyWidth={Math.round(width)}
            // A GIF banner plays only while the header is on screen and in the clear: not under the
            // frost (where it also made our glass re-capture the card on every frame), not with
            // another screen on top, and not in Low Power Mode or with Reduce Motion. Reported:
            // "гифки в профиле… нужно, чтобы она не лагала". Still banners get no prop at all.
            autoplay={bannerAnimated ? headerMoving && motionAllowed : undefined}
          />
          <LinearGradient colors={[pageBg + '00', pageBg + '55']} style={StyleSheet.absoluteFill} pointerEvents="none" />
          {/* The blur that comes in toward the bottom: the same image, blurred once, shown through a
              gradient mask. Still banners only (a still copy would not follow a GIF). */}
          {FadeMask ? (
            <FadeMask
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              shouldRasterizeIOS
              maskElement={
                <View style={StyleSheet.absoluteFill}>
                  <LinearGradient colors={BLUR_MASK_COLORS} locations={BLUR_MASK_STOPS} style={styles.bannerFade} />
                </View>
              }
            >
              <CachedImage uri={bannerUrl} style={bannerImageStyle} resizeMode="cover" proxyWidth={Math.round(width)} blurRadius={BANNER_BLUR_RADIUS} />
            </FadeMask>
          ) : null}
          <LinearGradient colors={fade} locations={FADE_STOPS} style={styles.bannerFade} pointerEvents="none" />
        </View>
      ) : null}

      <View style={{ paddingTop: topInset + 52, paddingHorizontal: 20, paddingBottom: 22 }}>
        {/* Placeholder: the real avatar is drawn above the frost (see the end of the card) so it
            stays crisp while it flies to the island. */}
        <View style={styles.avatarTile} />
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}
          onLayout={(e) => {
            const l = e.nativeEvent.layout;
            anim.marks.set({ nameX: l.x + 26, nameY: l.y + l.height / 2 });
          }}
        >
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
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}
          onLayout={(e) => {
            const l = e.nativeEvent.layout;
            anim.marks.set({ actionsX: l.x + 36, actionsY: l.y + l.height / 2 });
          }}
        >
          {actions}
        </View>
      </View>

      {/* Links float as liquid bubbles in the space beside the avatar (they replaced the chip row
          under the @handle). Under the frost, so they frost over with the rest of the card. */}
      {links.length > 0 ? (
        <ProfileLinkBubbles
          links={links}
          top={topInset + DROPS_TOP}
          left={20 + 84 + 16}
          height={DROPS_HEIGHT}
          // Still in Low Power Mode too (Reduce Motion is handled inside).
          active={headerMoving && !dropsAway && motionAllowed}
        />
      ) : null}

      {/* Frost fades in over the whole card as it scrolls away (native-driver opacity). It is
          invisible at the top of the page, so the blur view is created after the push animation
          instead of during it. */}
      {settled ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: anim.headerOpacity }]}>
          <BlurView intensity={theme.isDark ? 55 : 75} tint={theme.isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.isDark ? 'rgba(20,21,28,0.32)' : 'rgba(255,255,255,0.34)' }]} />
          {/* The frost ends in the page's colour too, so the card's edge stays invisible while it
              frosts over (see "THE BANNER MELTS INTO THE PAGE"). */}
          {bannerUrl ? <LinearGradient colors={fade} locations={FADE_STOPS} style={styles.bannerFade} /> : null}
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

// `ProfileQRModal` lived here: an `<Image>` of api.qrserver.com inside a Modal. It is replaced by the
// root-level QR screen (src/components/profile/ProfileQrOverlay.tsx), opened with `openProfileQr`.

const styles = StyleSheet.create({
  chrome: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  avatarTile: { width: 84, height: 84, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  cardRounded: { borderBottomLeftRadius: 30, borderBottomRightRadius: 30, overflow: 'hidden' },
  // Square: its bottom edge is the page's own colour (see "THE BANNER MELTS INTO THE PAGE").
  cardWithBanner: { overflow: 'hidden' },
  bannerFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: BANNER_FADE_H },
  textShadow: { textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
