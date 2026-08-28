import React, { memo } from 'react';
import { View, ViewStyle, TextStyle, Text as RNText, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { emojiTextStyle } from './emojiText';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  source?: string;
  name?: string;
  emoji?: string;
  size?: AvatarSize;
  style?: ViewStyle;
  /**
   * OPT-IN (default false). When false, emoji avatars render as the bare,
   * centered emoji with no background (the original look). Set to true only
   * where the soft, deterministic per-user circular container (tint fill +
   * hairline ring) is wanted — e.g. the chat list and home feed.
   */
  tint?: boolean;
}

/**
 * Deterministic, hook-free tint for emoji avatars.
 *
 * A stable seed string (name || emoji) is hashed into a hue (0..360) so a
 * given user keeps the same color everywhere in the app. The fill stays very
 * soft so it complements the emoji rather than competing with it.
 *
 *   Light: fill `hsl(hue, 70%, 92%)`   border `hsl(hue, 60%, 82%)`
 *   Dark:  fill `hsla(hue, 55%, 55%, 0.18)`  border `hsla(hue, 55%, 60%, 0.30)`
 */
function getEmojiTint(seed: string, isDark: boolean): { fill: string; border: string } {
  // Cheap, stable string hash (djb2-style) → non-negative integer.
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;

  if (isDark) {
    return {
      fill: `hsla(${hue}, 55%, 55%, 0.18)`,
      border: `hsla(${hue}, 55%, 60%, 0.30)`,
    };
  }
  return {
    fill: `hsl(${hue}, 70%, 92%)`,
    border: `hsl(${hue}, 60%, 82%)`,
  };
}

export const Avatar = memo(function Avatar({
  source,
  name,
  emoji,
  size = 'md',
  style,
  tint = false,
}: AvatarProps) {
  const theme = useTheme();

  const sizeMap: Record<AvatarSize, number> = {
    xs: 24,
    sm: 32,
    md: 44,
    lg: 64,
    xl: 96,
  };

  // Emoji fontSize — conservative to avoid clipping
  const emojiSizeMap: Record<AvatarSize, number> = {
    xs: 13,
    sm: 17,
    md: 24,
    lg: 34,
    xl: 50,
  };

  const fontSizeMap: Record<AvatarSize, number> = {
    xs: 10,
    sm: theme.typography.sizes.xs,
    md: theme.typography.sizes.base,
    lg: theme.typography.sizes.lg,
    xl: theme.typography.sizes['2xl'],
  };

  const dimension = sizeMap[size];

  // Emoji avatar — centered inside a soft, deterministic circular container
  if (emoji) {
    const emojiSize = emojiSizeMap[size];
    // ── THE EMOJI BOX COMES FROM `emojiTextStyle`, NOT FROM ARITHMETIC HERE ───
    //
    // This used to hand-roll the metrics:
    //
    //     fontSize: emojiSize,
    //     lineHeight: Platform.OS === 'android' ? emojiSize + 4 : undefined,
    //     includeFontPadding: false,
    //     textAlignVertical: 'center',
    //
    // which is the four-property recipe in `emojiText.ts` minus the one that file calls load-bearing:
    // "without an explicit height the view is measured from font metrics that the emoji bitmap exceeds,
    // and no `lineHeight` can rescue it." There was no `height`, and on iOS there was no `lineHeight`
    // either.
    //
    // The bigger problem was `emojiSize + 4`. An ADDITIVE correction cannot track a glyph whose overflow
    // scales with the point size, so it diverges as the avatar grows — against the helper's 1.3x box:
    //
    //     xs 13pt  ->  17 vs 17   (ok)
    //     sm 17pt  ->  21 vs 22   (-1)
    //     md 24pt  ->  28 vs 31   (-3)
    //     lg 34pt  ->  38 vs 44   (-6)
    //     xl 50pt  ->  54 vs 65   (-11)
    //
    // Which is exactly the reported shape: emoji clipped on Android, worst on the large avatars. Every
    // box the helper produces still fits its container (xs 17/24, sm 22/32, md 31/44, lg 44/64,
    // xl 65/96), so nothing overflows the circle.
    //
    // This is the most-mounted emoji surface in the app and it was the one site NOT using the helper —
    // which is the failure mode `emojiText.ts` was created to end. Its own note says twenty-six places
    // render an emoji and only two had all four properties.
    const innerText = (
      <RNText
        style={{
          ...emojiTextStyle(emojiSize),
          textAlign: 'center',
        }}
        // The helper's docs ask for this wherever the glyph sits in a fixed-size cell: an accessibility
        // text scale would otherwise grow it past a box that is deliberately exact. Already correct here.
        allowFontScaling={false}
      >
        {emoji}
      </RNText>
    );

    if (!tint) {
      return (
        <View
          style={[
            {
              width: dimension,
              height: dimension,
              alignItems: 'center',
              justifyContent: 'center',
            },
            style,
          ]}
        >
          {innerText}
        </View>
      );
    }

    const seed = name || emoji || '';
    const { fill, border } = getEmojiTint(seed, theme.isDark);

    return (
      <View
        style={[
          {
            width: dimension,
            height: dimension,
            borderRadius: dimension / 2,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: fill,
            borderWidth: StyleSheet.hairlineWidth * 1.5,
            borderColor: border,
          },
          style,
        ]}
      >
        {innerText}
      </View>
    );
  }

  const containerStyle: ViewStyle = {
    width: dimension,
    height: dimension,
    borderRadius: dimension / 2,
    overflow: 'hidden',
    backgroundColor: theme.colors.accent.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle hairline ring to match the emoji container treatment.
    borderWidth: StyleSheet.hairlineWidth * 1.5,
    borderColor: theme.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
  };

  if (source) {
    return (
      <View style={[containerStyle, style]}>
        <CachedImage
          uri={source}
          style={{ width: dimension, height: dimension }}
          proxyWidth={dimension}
        />
      </View>
    );
  }

  const getInitials = (name?: string): string => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name[0].toUpperCase();
  };

  return (
    <View style={[containerStyle, style]}>
      <Text
        weight="semibold"
        color={theme.colors.text.inverse}
        style={{ fontSize: fontSizeMap[size] } as TextStyle}
      >
        {getInitials(name)}
      </Text>
    </View>
  );
});
