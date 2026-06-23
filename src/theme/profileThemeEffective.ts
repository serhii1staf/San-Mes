import {
  APP_DEFAULT_FONT,
  type EmojiAccentSet,
  type ProfileTheme,
  type ThemeFont,
  type ThemePalette,
} from './profileThemes';

/**
 * Seasonal Profile Themes — effective-render selectors (pure logic).
 *
 * These pure functions decide what a profile screen *actually* renders for a
 * resolved {@link ProfileTheme} given the runtime load/animation state. They
 * contain no React and no side effects, so they can be unit- and
 * property-tested directly.
 *
 * Key invariant across all selectors: the Theme_Palette is NEVER dropped.
 * Failures (missing/erroring illustration or font) degrade only the failing
 * attribute while the palette — and any Emoji_Accent_Set — is retained
 * (Req 4.5, 4.9, 5.3, 5.4, 7.7).
 */

/** Runtime load state of a Theme_Font asset. */
export type FontLoadState = 'loaded' | 'loading' | 'error' | 'absent';

/** Runtime load state of a Background_Illustration asset. */
export type IllustrationLoadState = 'ok' | 'error' | 'timeout' | 'absent';

/**
 * The Emoji_Accent_Set a profile screen should render for `theme`, or `null`
 * when the theme defines none.
 *
 * Rendered exactly when the theme defines an Emoji_Accent_Set; otherwise the
 * like icon, post-overflow "…" menu area, and follow button render their
 * default (non-emoji) controls (Req 4.6, 4.7).
 */
export function effectiveEmojiAccents(theme: ProfileTheme): EmojiAccentSet | null {
  return theme.emojiAccents ?? null;
}

/**
 * The font a profile screen should apply for `theme` given the current
 * `fontState`.
 *
 * Returns the theme's own {@link ThemeFont} ONLY when the theme defines one AND
 * its asset has finished loading (`fontState === 'loaded'`). In every other
 * case — the theme defines no font, or the font is still loading, errored, or
 * is absent (including the 5s timeout case, surfaced as `'error'`/`'absent'`) —
 * it returns {@link APP_DEFAULT_FONT}. The palette is unaffected either way; the
 * caller continues to apply `theme.palette` (Req 4.8, 4.9, 5.4).
 */
export function effectiveFont(theme: ProfileTheme, fontState: FontLoadState): ThemeFont {
  if (theme.themeFont != null && fontState === 'loaded') {
    return theme.themeFont;
  }
  return APP_DEFAULT_FONT;
}

/**
 * The Background_Illustration asset a profile screen should render for `theme`
 * given the current `loadState`, or `null` for a palette-only render.
 *
 * Returns the theme's `backgroundIllustration` ONLY when it loaded successfully
 * (`loadState === 'ok'`) AND the asset reference is non-null. When the asset is
 * absent, errors, or has not loaded within 5 seconds (`'absent'`/`'error'`/
 * `'timeout'`), the illustration is disabled and the screen renders palette-only
 * while retaining the Theme_Palette (Req 4.5, 5.3, 7.7).
 */
export function effectiveIllustration(
  theme: ProfileTheme,
  loadState: IllustrationLoadState,
): number | null {
  if (loadState === 'ok' && theme.backgroundIllustration != null) {
    return theme.backgroundIllustration;
  }
  return null;
}

/**
 * The static visual attributes a profile screen applies — Theme_Palette,
 * resolved Background_Illustration asset, and Emoji_Accent_Set.
 *
 * Computed IDENTICALLY regardless of `animationEnabled`: disabling the
 * Ambient_Animation (via a Weak_Device or the Reduced_Motion_Setting) must
 * never remove the palette, illustration, or emoji accents. The
 * `animationEnabled` flag is accepted only to make this independence explicit
 * and testable; it does not affect the result (Req 7.5).
 *
 * Note: the illustration here reports the theme's bundled asset (its
 * `backgroundIllustration`, possibly `null` in the PLACEHOLDER phase). The
 * load-state degradation lives in {@link effectiveIllustration}; this selector
 * deliberately does not vary with the animation gate.
 */
export function effectiveStaticAttributes(
  theme: ProfileTheme,
  animationEnabled: boolean,
): {
  palette: ThemePalette;
  illustrationAsset: number | null;
  emojiAccents: EmojiAccentSet | null;
} {
  // `animationEnabled` is intentionally ignored: static attributes are
  // independent of the animation gate (Req 7.5).
  void animationEnabled;
  return {
    palette: theme.palette,
    illustrationAsset: theme.backgroundIllustration,
    emojiAccents: theme.emojiAccents ?? null,
  };
}
