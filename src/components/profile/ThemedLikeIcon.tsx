import React from 'react';
import { Text as RNText } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useProfileThemeAccents } from './ProfileThemeContext';

/**
 * Seasonal Profile Themes — themed like icon (task 6.3).
 *
 * Renders the active theme's `like` emoji glyph when the theme defines an
 * Emoji_Accent_Set, otherwise the existing Feather like icon unchanged
 * (Req 4.6, 4.7). Accents are read from {@link useProfileThemeAccents}, which
 * yields `null` outside a `ProfileThemeScope`, so the default control is used
 * everywhere else (Req 4.10).
 *
 * This is an icon-level control: callers wrap it in their own pressable / glass
 * chrome exactly as they do today with `<Feather name="heart" />`.
 */
interface ThemedLikeIconProps {
  /** Icon / glyph size in px. */
  size?: number;
  /** Color of the Feather icon when no emoji accent is active. */
  color?: string;
  /**
   * Feather glyph used when no emoji accent is active. Defaults to `heart`
   * (matching the current profile like control).
   */
  iconName?: React.ComponentProps<typeof Feather>['name'];
  /** Optional style applied to the emoji glyph text node. */
  style?: StyleProp<TextStyle>;
}

export function ThemedLikeIcon({
  size = 12,
  color,
  iconName = 'heart',
  style,
}: ThemedLikeIconProps) {
  const accents = useProfileThemeAccents();

  if (accents) {
    return (
      <RNText
        // The emoji is decorative; the surrounding pressable owns the label.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        allowFontScaling={false}
        style={[{ fontSize: size, lineHeight: size * 1.2 }, style]}
      >
        {accents.like}
      </RNText>
    );
  }

  return <Feather name={iconName} size={size} color={color} />;
}

export default ThemedLikeIcon;
