import React, { useMemo } from 'react';

import {
  APP_DEFAULT_FONT,
  resolveProfileTheme,
} from '../../theme/profileThemes';
import { effectiveEmojiAccents } from '../../theme/profileThemeEffective';
import { ProfileThemeScene } from './ProfileThemeScene';
import {
  ProfileThemeProvider,
  type ProfileThemeContextValue,
} from './ProfileThemeContext';

interface ProfileThemeScopeProps {
  /** Raw value from the profile row (may be unknown/missing/null). */
  themeId: string | null | undefined;
  /** True while a Profile_Scroll is in progress (drives the ambient pause). */
  scrollActive: boolean;
  /** `useIsFocused()` of the profile screen (drives ambient pause off-screen). */
  screenFocused: boolean;
  /** Existing profile content (cards, header) — rendered ON TOP of the layers. */
  children: React.ReactNode;
}

/**
 * Seasonal Profile Themes — render scope for a profile screen.
 *
 * Resolves the raw `themeId` to an always-renderable theme (Req 4.1–4.3) and
 * renders the bottom of the profile layer stack:
 *
 *   Layer 0  palette gradient (`expo-linear-gradient`, absolute fill)
 *   Layer 1  Background_Illustration   — (5.3 `ProfileThemeBackground`)
 *   Layer 2  AmbientAnimationLayer      — (5.4, bounded particles)
 *   Layer 3  profile content (children) — glass cards + emoji accents + font
 *
 * GLASS-SAFETY RULE (design rendering-stack): the background gradient and the
 * later illustration / ambient layers are SIBLINGS BENEATH `children`. The
 * profile's glass content cards sit ON TOP as siblings and are NEVER wrapped in
 * an animated/opacity parent — animating opacity on a parent of a glass view is
 * forbidden, so each animating layer owns its own opacity beneath the content.
 *
 * The resolved theme, emoji accents, and font are provided to descendants
 * through {@link ProfileThemeProvider}, scoped to this subtree only. Outside the
 * scope the context yields neutral defaults, so theme attributes never leak to
 * other screens (Req 4.10, 6.5).
 */
export function ProfileThemeScope({
  themeId,
  scrollActive,
  screenFocused,
  children,
}: ProfileThemeScopeProps) {
  // `scrollActive` / `screenFocused` are accepted now so the profile-screen
  // wiring (task 6.1/6.2) is stable; they feed the ambient pause once the
  // AmbientAnimationLayer (task 5.4) is mounted as a sibling below.
  void scrollActive;
  void screenFocused;

  const theme = useMemo(() => resolveProfileTheme(themeId), [themeId]);

  const contextValue = useMemo<ProfileThemeContextValue>(
    () => ({
      theme,
      emojiAccents: effectiveEmojiAccents(theme),
      // Theme font when the theme defines one, else the app default. The
      // load-state fallback (Req 4.8/4.9/5.4) is applied by themed-text
      // components (task 6.3); in the PLACEHOLDER phase fonts are unsourced so
      // descendants fall back to the app default.
      font: theme.themeFont ?? APP_DEFAULT_FONT,
    }),
    [theme],
  );

  return (
    <ProfileThemeProvider value={contextValue}>
      {/* Layer 0/1: the real vector LANDSCAPE for this theme — bottom-most,
          absolute fill, static (no particles), non-interactive. Identical to
          the Theme_Selection_Screen preview (same component). */}
      <ProfileThemeScene theme={theme} />

      {/* Layer 3: profile content — siblings ON TOP of the background scene. */}
      {children}
    </ProfileThemeProvider>
  );
}

export default ProfileThemeScope;
