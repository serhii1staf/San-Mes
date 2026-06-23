import React from 'react';
import type { TextStyle } from 'react-native';

import { Text } from '../ui/Text';
import { APP_DEFAULT_FONT } from '../../theme/profileThemes';
import { effectiveFont } from '../../theme/profileThemeEffective';
import { useThemeFontState } from '../../hooks/useThemeFontState';
import { useProfileTheme } from './ProfileThemeContext';

/**
 * Seasonal Profile Themes — themed profile text (task 6.3).
 *
 * A thin wrapper around the shared {@link Text} UI primitive that applies the
 * active theme's {@link ThemeFont} ONLY when the theme defines one AND its
 * asset has loaded. If the theme defines no font, or the font errors / has not
 * loaded within 5 seconds, it renders with the app default font while the theme
 * palette continues to apply (Req 4.8, 4.9, 5.4).
 *
 * The font decision is delegated to the pure `effectiveFont` selector, so this
 * component holds no resolution logic of its own. Outside a `ProfileThemeScope`
 * the context resolves to the app default font, so no font styling leaks to
 * other screens (Req 4.10).
 *
 * All {@link Text} props are forwarded unchanged; only `fontFamily` is layered
 * on when a theme font is active.
 */
type ThemedProfileTextProps = React.ComponentProps<typeof Text>;

export function ThemedProfileText({ style, ...rest }: ThemedProfileTextProps) {
  const { theme } = useProfileTheme();
  const fontState = useThemeFontState(theme.themeFont);
  const font = effectiveFont(theme, fontState);

  // `effectiveFont` returns the exact APP_DEFAULT_FONT reference unless the
  // theme font is defined and loaded — so an identity check tells us whether a
  // themed font override should be applied. When it should not, we leave the
  // style untouched so the Text primitive uses its weight-based app font.
  const themedFontActive = font !== APP_DEFAULT_FONT;

  const mergedStyle: TextStyle | undefined = themedFontActive
    ? { ...(style ?? {}), fontFamily: font.family }
    : style;

  return <Text {...rest} style={mergedStyle} />;
}

export default ThemedProfileText;
