import React, { memo } from 'react';
import { View, Image, StyleSheet, type ImageSourcePropType } from 'react-native';
import Animated from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// ── BADGES ARE GEMS, NOT WORDS (Nov 2026) ────────────────────────────────────────────────────────────
//
// Asked for: the admin-granted badges were text («Creator», «Dev») and read as dated; they should be
// exclusive-looking things with no text, possibly animated. Each badge is now a small gradient tile
// with a white glyph, and a light shine passes over it a couple of times after it appears.
//
// The six old keys keep their meaning (they are stored on profiles: `profiles.badge`, a free string the
// Worker does not validate), so every badge already granted turns into its gem with no migration. The
// rest are new and are granted the same way, from Settings → Admin.
//
// The shine is a bounded CSS animation (Reanimated 4): two passes, then nothing runs. A badge sits in
// list rows, so a perpetual animation would keep the UI thread busy for as long as a chat list is on
// screen, which is exactly the battery cost the low-power reports were about.

type GlyphName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface BadgeDef {
  icon?: GlyphName;
  /** A picture instead of a glyph, drawn over the gradient (the app's own badge). */
  image?: ImageSourcePropType;
  /** The same picture at twice the resolution, for the large size only. */
  imageLarge?: ImageSourcePropType;
  /** Width over height, for a picture badge. Glyph badges are square. */
  aspect?: number;
  /** Gradient, top-left to bottom-right. */
  colors: readonly [string, string];
}

export const BADGE_DEFS: Record<string, BadgeDef> = {
  // The app's own: its wordmark, cut from assets/icon.png. san.png (136×64) serves the list and profile
  // sizes; at the admin picker's 34 pt it came out soft on a 3x screen (102 px from 64), so that size
  // uses san_lg.png, the same cut at 272×128. One big file for every size would instead be shrunk about
  // 3x in list rows, where Android's plain bilinear scaling leaves the letters' edges ragged.
  san: {
    image: require('../../../assets/badges/san.png'),
    imageLarge: require('../../../assets/badges/san_lg.png'),
    aspect: 2.125,
    colors: ['#000000', '#000000'],
  },
  // The original six.
  developer: { icon: 'code-braces', colors: ['#6366F1', '#22D3EE'] },
  admin: { icon: 'shield-crown', colors: ['#EF4444', '#F97316'] },
  moderator: { icon: 'shield-check', colors: ['#F59E0B', '#EAB308'] },
  vip: { icon: 'crown', colors: ['#F5B700', '#FF7A00'] },
  creator: { icon: 'star-shooting', colors: ['#EC4899', '#8B5CF6'] },
  verified: { icon: 'check-decagram', colors: ['#10B981', '#059669'] },
  // New.
  diamond: { icon: 'diamond-stone', colors: ['#22D3EE', '#3B82F6'] },
  flame: { icon: 'fire', colors: ['#FB923C', '#E11D48'] },
  bolt: { icon: 'lightning-bolt', colors: ['#FACC15', '#F97316'] },
  rocket: { icon: 'rocket-launch', colors: ['#60A5FA', '#7C3AED'] },
  galaxy: { icon: 'star-four-points', colors: ['#A855F7', '#EC4899'] },
  sparkles: { icon: 'creation', colors: ['#FBBF24', '#F472B6'] },
  heart: { icon: 'heart', colors: ['#F472B6', '#E11D48'] },
  crystal: { icon: 'crystal-ball', colors: ['#C084FC', '#4F46E5'] },
  infinity: { icon: 'infinity', colors: ['#2DD4BF', '#3B82F6'] },
  atom: { icon: 'atom', colors: ['#67E8F9', '#6366F1'] },
  meteor: { icon: 'meteor', colors: ['#FDBA74', '#DC2626'] },
  moon: { icon: 'moon-waning-crescent', colors: ['#A5B4FC', '#4338CA'] },
  snow: { icon: 'snowflake', colors: ['#7DD3FC', '#2563EB'] },
  ufo: { icon: 'ufo', colors: ['#A3E635', '#0D9488'] },
  alien: { icon: 'alien', colors: ['#4ADE80', '#0891B2'] },
  ghost: { icon: 'ghost', colors: ['#A1A1AA', '#7C3AED'] },
  skull: { icon: 'skull', colors: ['#64748B', '#111827'] },
  butterfly: { icon: 'butterfly', colors: ['#F9A8D4', '#818CF8'] },
  cat: { icon: 'cat', colors: ['#FDBA74', '#F472B6'] },
  music: { icon: 'music-note', colors: ['#F472B6', '#9333EA'] },
  gamer: { icon: 'gamepad-variant', colors: ['#34D399', '#0EA5E9'] },
  trophy: { icon: 'trophy', colors: ['#FCD34D', '#D97706'] },
  sword: { icon: 'sword-cross', colors: ['#CBD5E1', '#475569'] },
};

/** Every badge the admin can grant, in the order the picker shows them. */
export const BADGE_KEYS = Object.keys(BADGE_DEFS);

// ── SEVERAL BADGES ON ONE PERSON (Nov 2026) ──────────────────────────────────────────────────────────
//
// `profiles.badge` holds one key or a comma-separated list of them ("san,diamond,flame"). One key is
// the list of one, so everything stored before reads the same. Unknown keys are skipped, so a badge
// removed from this table disappears instead of breaking the row.
export function parseBadges(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const raw of value.split(',')) {
    const key = raw.trim();
    if (key && BADGE_DEFS[key] && !out.includes(key)) out.push(key);
  }
  return out;
}

/** The stored form of a set of badges, in the picker's order; null for none. */
export function joinBadges(keys: string[]): string | null {
  const ordered = BADGE_KEYS.filter((k) => keys.includes(k));
  return ordered.length > 0 ? ordered.join(',') : null;
}

const SIZES = { sm: 15, md: 18, lg: 34 } as const;
/** How many badges a row shows at each size: names in lists have little room beside them. */
const MAX_SHOWN = { sm: 3, md: 8, lg: 99 } as const;

interface UserBadgeProps {
  /** One badge key, or several separated by commas. */
  badge: string;
  size?: keyof typeof SIZES;
  /**
   * The light passing over the gem after it appears. Off where a badge repeats down a page: on a
   * profile every post card carries its author's badges, and thirty shines starting at once on open
   * were thirty animations the UI thread drew for six seconds, most of them below the fold.
   */
  shine?: boolean;
}

export const UserBadge = memo(function UserBadge({ badge, size = 'sm', shine = true }: UserBadgeProps) {
  const keys = parseBadges(badge);
  if (keys.length === 0) return null;
  if (keys.length === 1) return <BadgeGem badgeKey={keys[0]} size={size} shine={shine} />;
  return (
    <View style={[styles.row, size === 'sm' ? null : styles.wrap, { gap: size === 'lg' ? 6 : 3 }]}>
      {keys.slice(0, MAX_SHOWN[size]).map((k) => (
        <BadgeGem key={k} badgeKey={k} size={size} shine={shine} />
      ))}
    </View>
  );
});

const BadgeGem = memo(function BadgeGem({ badgeKey, size, shine }: { badgeKey: string; size: keyof typeof SIZES; shine: boolean }) {
  const def = BADGE_DEFS[badgeKey];
  if (!def) return null;
  const s = SIZES[size];
  const w = def.image ? Math.round(s * (def.aspect || 1)) : s;
  const stripe = Math.max(4, Math.round(s * 0.34));
  return (
    <View style={[styles.gem, { width: w, height: s, borderRadius: Math.round(s * 0.3) }]}>
      <LinearGradient colors={def.colors} start={GRADIENT_START} end={GRADIENT_END} style={StyleSheet.absoluteFill} />
      {def.image ? (
        <Image source={size === 'lg' && def.imageLarge ? def.imageLarge : def.image} style={{ width: w, height: s }} resizeMode="contain" />
      ) : (
        <MaterialCommunityIcons name={def.icon} size={Math.round(s * 0.68)} color="#FFFFFF" />
      )}
      {shine ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.shine,
            {
              width: stripe,
              left: -stripe * 2,
              top: -s * 0.3,
              bottom: -s * 0.3,
              animationName: {
                '0%': { transform: [{ translateX: 0 }, { rotate: '20deg' }] },
                '45%': { transform: [{ translateX: w + stripe * 3 }, { rotate: '20deg' }] },
                '100%': { transform: [{ translateX: w + stripe * 3 }, { rotate: '20deg' }] },
              },
              animationDuration: '2600ms',
              animationDelay: '700ms',
              animationIterationCount: 2,
              animationTimingFunction: 'ease-in-out',
              animationFillMode: 'both',
            },
          ]}
        />
      ) : null}
    </View>
  );
});

const GRADIENT_START = { x: 0, y: 0 };
const GRADIENT_END = { x: 1, y: 1 };

const styles = StyleSheet.create({
  gem: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  shine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.42)' },
});
