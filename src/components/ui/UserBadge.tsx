import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// ── BADGES ARE GEMS, NOT WORDS (Nov 2026) ────────────────────────────────────────────────────────────
//
// Asked for: the admin-granted badges were text («Creator», «Dev») and read as dated; they should be
// exclusive-looking things with no text, possibly animated. Each badge is now a small gradient tile
// with a white glyph, and a light shine passes over it a couple of times after it appears.
//
// The six old keys keep their meaning (they are stored on profiles: `profiles.badge`, any string up to
// 32 characters, not validated by the Worker), so every badge already granted turns into its gem with
// no migration. The rest are new and are granted the same way, from Settings → Admin.
//
// The shine is a bounded CSS animation (Reanimated 4): two passes, then nothing runs. A badge sits in
// list rows, so a perpetual animation would keep the UI thread busy for as long as a chat list is on
// screen, which is exactly the battery cost the low-power reports were about.

type GlyphName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface BadgeDef {
  icon: GlyphName;
  /** Gradient, top-left to bottom-right. */
  colors: readonly [string, string];
}

export const BADGE_DEFS: Record<string, BadgeDef> = {
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

const SIZES = { sm: 15, md: 18, lg: 34 } as const;

interface UserBadgeProps {
  badge: string;
  size?: keyof typeof SIZES;
}

export const UserBadge = memo(function UserBadge({ badge, size = 'sm' }: UserBadgeProps) {
  const def = BADGE_DEFS[badge];
  if (!def) return null;
  const s = SIZES[size];
  const stripe = Math.max(4, Math.round(s * 0.34));
  return (
    <View style={[styles.gem, { width: s, height: s, borderRadius: Math.round(s * 0.3) }]}>
      <LinearGradient colors={def.colors} start={GRADIENT_START} end={GRADIENT_END} style={StyleSheet.absoluteFill} />
      <MaterialCommunityIcons name={def.icon} size={Math.round(s * 0.68)} color="#FFFFFF" />
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
              '45%': { transform: [{ translateX: s + stripe * 3 }, { rotate: '20deg' }] },
              '100%': { transform: [{ translateX: s + stripe * 3 }, { rotate: '20deg' }] },
            },
            animationDuration: '2600ms',
            animationDelay: '700ms',
            animationIterationCount: 2,
            animationTimingFunction: 'ease-in-out',
            animationFillMode: 'both',
          },
        ]}
      />
    </View>
  );
});

const GRADIENT_START = { x: 0, y: 0 };
const GRADIENT_END = { x: 1, y: 1 };

const styles = StyleSheet.create({
  gem: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  shine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.42)' },
});
