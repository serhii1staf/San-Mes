/**
 * ProfileThemePreviewCard
 * -----------------------
 * A memoized, lightweight miniature of a {@link ProfileTheme} for the
 * Theme_Selection_Screen (design §"Components and Interfaces #6", Req 2.1, 2.2).
 *
 * Each card shows, at a glance, what a profile rendered in this theme looks
 * like:
 *   - the Theme_Palette as a gradient swatch (the same `expo-linear-gradient`
 *     stops the live `ProfileThemeScope` renders);
 *   - the Background_Illustration as a thumbnail when one is bundled, or a
 *     NULL-SAFE palette-only placeholder when `backgroundIllustration` is null
 *     (the PLACEHOLDER phase — and the same degradation a failed image load
 *     produces live);
 *   - the theme's Emoji_Accent_Set rendered STATICALLY (like / menu / follow
 *     glyphs), or nothing when the theme defines no accents.
 *
 * Deliberately cheap so a `FlatList` of these stays under the perf monitor's
 * long-task threshold (Req 2.7, 9.4):
 *   - NO ambient animation is ever mounted in a preview (snow/leaves are
 *     skipped here even for `autumn`/`winter`);
 *   - NO liquid-glass view — previews are flat colored swatches, not real
 *     glass surfaces — keeping the list render light on the weak device;
 *   - it is `React.memo`'d so scrolling (which flips `isSelected` on at most
 *     two cards) never re-renders the whole carousel.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import { Text } from '../ui';
import { borderRadius, spacing } from '../../theme/tokens';
import type { ProfileTheme } from '../../theme/profileThemes';
import { effectiveEmojiAccents } from '../../theme/profileThemeEffective';

interface ProfileThemePreviewCardProps {
  /** The built-in theme this card previews. */
  theme: ProfileTheme;
  /** Whether this preview is the currently selected one (Req 2.2). */
  isSelected: boolean;
  /** Tapping the card selects this theme on the selection screen. */
  onPress?: () => void;
  /** Card width in points; the height is derived from it. Defaults to 220. */
  width?: number;
}

function ProfileThemePreviewCardBase({
  theme,
  isSelected,
  onPress,
  width = 220,
}: ProfileThemePreviewCardProps) {
  const { palette } = theme;
  const emojiAccents = effectiveEmojiAccents(theme);
  // Portrait-ish miniature, echoing a profile screen's aspect.
  const height = Math.round(width * 1.3);

  // The registry guarantees ≥2 gradient stops for every theme, so this cast to
  // the tuple type `LinearGradient` expects is always satisfied.
  const gradientColors = palette.gradient as readonly [string, string, ...string[]];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={theme.label}
      style={[
        styles.card,
        {
          width,
          height,
          borderColor: isSelected ? palette.accent : 'rgba(0,0,0,0.08)',
          borderWidth: isSelected ? 2.5 : StyleSheet.hairlineWidth,
          shadowColor: isSelected ? palette.accent : '#000',
          shadowOpacity: isSelected ? 0.3 : 0.12,
          elevation: isSelected ? 8 : 2,
        },
      ]}
    >
      {/* Palette swatch — bottom-most, full-bleed (Req 2.1). */}
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Illustration thumbnail when bundled; otherwise a palette-only
          placeholder so the card never renders blank (Req 2.1, null-safe). */}
      {theme.backgroundIllustration != null ? (
        <Image
          source={theme.backgroundIllustration}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          pointerEvents="none"
          transition={150}
        />
      ) : (
        <View style={styles.placeholder} pointerEvents="none">
          <Text variant="label" weight="semibold" color={palette.secondaryText}>
            {theme.label}
          </Text>
        </View>
      )}

      {/* Static emoji accents (like / menu / follow) — no animation, rendered
          only when the theme defines an Emoji_Accent_Set (Req 2.1). */}
      {emojiAccents != null && (
        <View style={styles.accentRow} pointerEvents="none">
          <Text variant="body" style={styles.accentGlyph}>
            {emojiAccents.like}
          </Text>
          <Text variant="body" style={styles.accentGlyph}>
            {emojiAccents.menu}
          </Text>
          <Text variant="body" style={styles.accentGlyph}>
            {emojiAccents.follow}
          </Text>
        </View>
      )}

      {/* Label chip drawn from the palette text colors so it reads on any
          theme background. */}
      <View style={styles.labelBar} pointerEvents="none">
        <Text variant="caption" weight="bold" color={palette.text} numberOfLines={1}>
          {theme.label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    backgroundColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.55,
  },
  accentRow: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  accentGlyph: {
    fontSize: 18,
  },
  labelBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center',
  },
});

/**
 * Memoized so scrolling the selection carousel — which flips `isSelected` on at
 * most two cards — never re-renders the whole list (mirrors `appearance.tsx`'s
 * `ThemePreviewCard` memo, Req 2.7, 9.4). Themes are stable module constants, so
 * an identity check on `theme` is sufficient.
 */
export const ProfileThemePreviewCard = React.memo(
  ProfileThemePreviewCardBase,
  (prev, next) =>
    prev.isSelected === next.isSelected &&
    prev.theme === next.theme &&
    prev.width === next.width &&
    prev.onPress === next.onPress,
);

export default ProfileThemePreviewCard;
