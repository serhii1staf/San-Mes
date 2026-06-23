import React, { createContext, useContext } from 'react';
import {
  APP_DEFAULT_FONT,
  DEFAULT_THEME,
  type EmojiAccentSet,
  type ProfileTheme,
  type ThemeFont,
} from '../../theme/profileThemes';

/**
 * Seasonal Profile Themes — render-scope React context.
 *
 * Carries the resolved {@link ProfileTheme}, its {@link EmojiAccentSet} (or
 * `null`), and the {@link ThemeFont} to descendants of a `ProfileThemeScope`
 * (the like icon, post-overflow "…" menu, follow button, and themed text).
 *
 * CONTAINMENT GUARANTEE (Req 4.10, 6.5): the context DEFAULT value — used
 * whenever a component reads it WITHOUT an enclosing `ProfileThemeScope` — is
 * the {@link DEFAULT_THEME} with NO emoji accents and the app default font. So
 * theme attributes can never leak onto another screen: any element outside a
 * scope reads neutral defaults, exactly as if no theme were active.
 */
export interface ProfileThemeContextValue {
  /** The resolved, always-renderable theme for this subtree. */
  theme: ProfileTheme;
  /** The theme's emoji accents, or `null` when it defines none. */
  emojiAccents: EmojiAccentSet | null;
  /** The font descendants should apply (theme font when defined, else app default). */
  font: ThemeFont;
}

/**
 * Default context value (no provider in the tree). Neutral defaults guarantee
 * theme attributes never leak outside a `ProfileThemeScope`.
 */
export const DEFAULT_PROFILE_THEME_CONTEXT: ProfileThemeContextValue = {
  theme: DEFAULT_THEME,
  emojiAccents: null,
  font: APP_DEFAULT_FONT,
};

const ProfileThemeContext = createContext<ProfileThemeContextValue>(
  DEFAULT_PROFILE_THEME_CONTEXT,
);

ProfileThemeContext.displayName = 'ProfileThemeContext';

export const ProfileThemeProvider = ProfileThemeContext.Provider;

/**
 * Read the active profile theme context. Outside a `ProfileThemeScope` this
 * returns {@link DEFAULT_PROFILE_THEME_CONTEXT} (default theme, no accents, app
 * default font) so no theme styling leaks to unrelated screens (Req 4.10, 6.5).
 */
export function useProfileTheme(): ProfileThemeContextValue {
  return useContext(ProfileThemeContext);
}

/**
 * Convenience selector for the emoji accents only — used by the like icon,
 * post-overflow "…" menu area, and follow button to decide whether to render
 * an emoji accent (Req 4.6, 4.7). Returns `null` outside a scope.
 */
export function useProfileThemeAccents(): EmojiAccentSet | null {
  return useContext(ProfileThemeContext).emojiAccents;
}

/**
 * Convenience selector for the active profile font — used by themed profile
 * text. Returns {@link APP_DEFAULT_FONT} outside a scope (Req 4.9).
 */
export function useProfileThemeFont(): ThemeFont {
  return useContext(ProfileThemeContext).font;
}

export default ProfileThemeContext;
