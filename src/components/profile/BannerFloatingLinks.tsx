import React, { useEffect, useMemo, useRef } from 'react';
import { View, Pressable, Animated, Easing, Dimensions } from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { triggerHaptic } from '../../utils/haptics';
import { openUrl } from '../../utils/openUrl';

const SCREEN_WIDTH = Dimensions.get('window').width;

// ── Floating social-link chips over the profile banner ──────────────────────
//
// Telegram-gifts style: instead of a static row under the bio, each social
// link becomes a small chip scattered at a RANDOM position across the banner
// every time the profile opens, gently drifting side-to-side. Cheap by design:
//   • Positions are computed ONCE per mount (useMemo []) — new layout each open,
//     zero per-frame layout work.
//   • At most a handful of chips (link count is capped at 3 in the editor).
//   • The drift is a single Animated.Value per chip on the NATIVE driver
//     (translate only) — no JS-thread work, no re-renders while animating.

type LinkType = string;

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
  if (lower.includes('spotify.com')) return 'spotify';
  if (lower.includes('reddit.com')) return 'reddit';
  if (lower.includes('vk.com')) return 'vk';
  return 'website';
}

const BRAND: Record<string, { name: string; color: string; isBrand: boolean }> = {
  github: { name: 'github', color: '#FFFFFF', isBrand: true },
  twitter: { name: 'twitter', color: '#1DA1F2', isBrand: true },
  instagram: { name: 'instagram', color: '#E4405F', isBrand: true },
  youtube: { name: 'youtube', color: '#FF0000', isBrand: true },
  telegram: { name: 'telegram-plane', color: '#0088CC', isBrand: true },
  linkedin: { name: 'linkedin-in', color: '#0A66C2', isBrand: true },
  twitch: { name: 'twitch', color: '#9146FF', isBrand: true },
  spotify: { name: 'spotify', color: '#1DB954', isBrand: true },
  tiktok: { name: 'tiktok', color: '#FFFFFF', isBrand: true },
  discord: { name: 'discord', color: '#5865F2', isBrand: true },
  reddit: { name: 'reddit-alien', color: '#FF4500', isBrand: true },
  vk: { name: 'vk', color: '#0077FF', isBrand: true },
  website: { name: 'globe', color: '#7FB4FF', isBrand: false },
};

const CHIP = 30; // chip diameter

export interface BannerLink { type: string; url: string }

interface Placement {
  url: string;
  brandKey: string;
  x: number;
  y: number;
  ampX: number;
  ampY: number;
  dur: number;
  delay: number;
}

function FloatingChip({ p }: { p: Placement }) {
  const theme = useTheme();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: p.dur, delay: p.delay, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: p.dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, p.dur, p.delay]);

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-p.ampX, p.ampX] });
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [p.ampY, -p.ampY] });

  const icon = BRAND[p.brandKey] || BRAND.website;

  return (
    <Animated.View style={{ position: 'absolute', left: p.x, top: p.y, transform: [{ translateX }, { translateY }] }}>
      <Pressable
        onPress={() => { triggerHaptic('light'); openUrl(p.url); }}
        hitSlop={8}
        style={{
          width: CHIP,
          height: CHIP,
          borderRadius: CHIP / 2,
          // Translucent dark backdrop so any brand colour stays legible over an
          // arbitrary banner image, with a hairline ring for the "chip" look.
          backgroundColor: 'rgba(15,15,18,0.55)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.18)',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 5,
          elevation: 4,
        }}
      >
        {icon.isBrand
          ? <FontAwesome5 name={icon.name as any} size={13} color={icon.color} brand />
          : <Feather name={icon.name as any} size={14} color={icon.color} />}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Renders the given links as floating chips scattered across the banner. Must
 * be a child of the banner View (which is `overflow: 'hidden'`, so chips are
 * clipped to the banner). `bannerHeight` is the banner's height in px.
 */
export function BannerFloatingLinks({ links, bannerHeight }: { links: BannerLink[]; bannerHeight: number }) {
  // Vertical safe band: below the top chrome (QR / settings / stat pills sit
  // around the top ~60px) and above the avatar/name/identity row that overlaps
  // the banner's lower ~140px. Keep chips in the clear middle strip.
  const placements = useMemo<Placement[]>(() => {
    const list = (links || []).slice(0, 3);
    const n = list.length;
    if (n === 0) return [];
    const topMin = 72;
    const topMax = Math.max(topMin + 24, bannerHeight - 150);
    const sideMargin = 18;
    const usableW = SCREEN_WIDTH - sideMargin * 2 - CHIP;
    const slotW = usableW / n;
    return list.map((lnk, i) => {
      // One chip per horizontal slot (guarantees separation), random within it.
      const x = sideMargin + i * slotW + Math.random() * Math.max(slotW - CHIP, 1);
      const y = topMin + Math.random() * (topMax - topMin);
      return {
        url: lnk.url,
        brandKey: detectLinkType(lnk.url) !== 'website' ? detectLinkType(lnk.url) : (lnk.type || 'website'),
        x,
        y,
        ampX: 5 + Math.random() * 4,   // 5–9 px horizontal drift
        ampY: 4 + Math.random() * 4,   // 4–8 px vertical drift
        dur: 2600 + Math.random() * 1600, // 2.6–4.2 s per half-cycle
        delay: Math.random() * 800,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, bannerHeight]);

  if (placements.length === 0) return null;
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: bannerHeight }} pointerEvents="box-none">
      {placements.map((p, i) => <FloatingChip key={i} p={p} />)}
    </View>
  );
}
