import React from 'react';
import { Pressable, Text as RNText, StyleSheet } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

import { useProfileThemeAccents } from './ProfileThemeContext';
import { ThemedProfileText } from './ThemedProfileText';

/**
 * Seasonal Profile Themes — themed follow ("Подписаться") button (task 6.3).
 *
 * Renders the existing follow control. When the active theme defines an
 * Emoji_Accent_Set, the theme's `follow` emoji glyph is shown alongside the
 * label; otherwise the button renders unchanged (Req 4.6, 4.7). The label is a
 * {@link ThemedProfileText}, so the theme font (when defined and loaded) is
 * applied to the label and otherwise falls back to the app default font
 * (Req 4.8, 4.9, 5.4).
 *
 * Accents come from {@link useProfileThemeAccents}, which yields `null` outside
 * a `ProfileThemeScope`, so the plain control is used everywhere else
 * (Req 4.10). Visual chrome (background, padding, border) stays the caller's
 * responsibility via `style`, keeping this drop-in compatible with the current
 * follow button.
 */
interface ThemedFollowButtonProps {
  /** Whether the viewer already follows this profile (drives the label/style). */
  following: boolean;
  onPress: () => void;
  /** Already-localized label to display (e.g. follow / unfollow text). */
  label: string;
  /** Container style — supply the existing background / padding / border here. */
  style?: StyleProp<ViewStyle>;
  /** Label color. */
  textColor?: string;
  /** Extra label text style (e.g. fontSize), merged after the themed font. */
  textStyle?: TextStyle;
  /** Emoji accent glyph size in px. */
  emojiSize?: number;
  /** Forwarded to the Pressable for tap-target padding. */
  hitSlop?: number;
}

export function ThemedFollowButton({
  following,
  onPress,
  label,
  style,
  textColor,
  textStyle,
  emojiSize = 13,
  hitSlop,
}: ThemedFollowButtonProps) {
  const accents = useProfileThemeAccents();

  return (
    <Pressable
      onPress={onPress}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityState={{ selected: following }}
      style={[styles.base, style]}
    >
      {accents ? (
        <RNText allowFontScaling={false} style={[styles.emoji, { fontSize: emojiSize }]}>
          {accents.follow}
        </RNText>
      ) : null}
      <ThemedProfileText
        variant="caption"
        weight="semibold"
        color={textColor}
        style={textStyle}
      >
        {label}
      </ThemedProfileText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  emoji: {
    // Tight line height so the glyph centers against the label baseline.
    textAlignVertical: 'center',
  },
});

export default ThemedFollowButton;
