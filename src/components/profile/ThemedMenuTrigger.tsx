import React from 'react';
import { Text as RNText } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useProfileThemeAccents } from './ProfileThemeContext';

/**
 * Seasonal Profile Themes — themed post-overflow ("…") menu trigger (task 6.3).
 *
 * Renders the active theme's `menu` emoji glyph when the theme defines an
 * Emoji_Accent_Set, otherwise the existing Feather overflow icon unchanged
 * (Req 4.6, 4.7). Accents come from {@link useProfileThemeAccents}, which
 * yields `null` outside a `ProfileThemeScope` (Req 4.10).
 *
 * Icon-level control: callers keep their own pressable + glass/blur chrome
 * exactly as they do today with `<Feather name="more-horizontal" />`.
 */
interface ThemedMenuTriggerProps {
  /** Icon / glyph size in px. */
  size?: number;
  /** Color of the Feather icon when no emoji accent is active. */
  color?: string;
  /**
   * Feather glyph used when no emoji accent is active. Defaults to
   * `more-horizontal` (matching the current profile overflow control).
   */
  iconName?: React.ComponentProps<typeof Feather>['name'];
  /** Optional style applied to the emoji glyph text node. */
  style?: StyleProp<TextStyle>;
}

export function ThemedMenuTrigger({
  size = 18,
  color,
  iconName = 'more-horizontal',
  style,
}: ThemedMenuTriggerProps) {
  const accents = useProfileThemeAccents();

  if (accents) {
    return (
      <RNText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        allowFontScaling={false}
        style={[{ fontSize: size, lineHeight: size * 1.2 }, style]}
      >
        {accents.menu}
      </RNText>
    );
  }

  return <Feather name={iconName} size={size} color={color} />;
}

export default ThemedMenuTrigger;
