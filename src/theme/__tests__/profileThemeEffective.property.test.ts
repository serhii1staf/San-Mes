import fc from 'fast-check';
import {
  APP_DEFAULT_FONT,
  BUILT_IN_THEME_LIST,
  type ProfileTheme,
} from '../profileThemes';
import {
  effectiveEmojiAccents,
  effectiveFont,
  effectiveIllustration,
  effectiveStaticAttributes,
  type FontLoadState,
  type IllustrationLoadState,
} from '../profileThemeEffective';

// Property tests for the Seasonal Profile Themes effective-render selectors
// (src/theme/profileThemeEffective.ts). Covers tasks 2.2–2.5 of the
// seasonal-profile-themes spec. fast-check + Jest, >= 100 runs per property.
//
// Convention (design "Testing Strategy"): each property is tagged with the
// feature name and the numbered design property it validates.

// Arbitrary over the Built_In_Theme_Set (stable-order registry list).
const themeArb = fc.constantFrom<ProfileTheme>(...BUILT_IN_THEME_LIST);

// Arbitrary over the four font load states.
const fontStateArb = fc.constantFrom<FontLoadState>(
  'loaded',
  'loading',
  'error',
  'absent'
);

// Arbitrary over the four illustration load states.
const illustrationStateArb = fc.constantFrom<IllustrationLoadState>(
  'ok',
  'error',
  'timeout',
  'absent'
);

describe('profileThemeEffective selectors', () => {
  // ---- Task 2.2 ----------------------------------------------------------
  // Feature: seasonal-profile-themes, Property 4: Emoji accents are rendered exactly when the theme defines them
  it('Property 4: emoji accents returned iff the theme defines them; all three slots when present', () => {
    fc.assert(
      fc.property(themeArb, (theme) => {
        const accents = effectiveEmojiAccents(theme);

        if (theme.emojiAccents != null) {
          // Present exactly when the theme defines them, and the exact set.
          expect(accents).not.toBeNull();
          expect(accents).toBe(theme.emojiAccents);

          // All three slots are returned as the theme's single glyphs.
          expect(accents!.like).toBe(theme.emojiAccents.like);
          expect(accents!.menu).toBe(theme.emojiAccents.menu);
          expect(accents!.follow).toBe(theme.emojiAccents.follow);
        } else {
          // Absent → null (controls render their default, non-emoji form).
          expect(accents).toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });

  // ---- Task 2.3 ----------------------------------------------------------
  // Feature: seasonal-profile-themes, Property 5: Profile font is the theme font when present and loaded, otherwise the app default
  it('Property 5: theme font only when defined AND loaded, else the app default font', () => {
    fc.assert(
      fc.property(themeArb, fontStateArb, (theme, fontState) => {
        const font = effectiveFont(theme, fontState);

        if (theme.themeFont != null && fontState === 'loaded') {
          // The theme's own font is used only when defined and loaded.
          expect(font).toBe(theme.themeFont);
        } else {
          // No font defined, or still loading / errored / absent → app default.
          expect(font).toBe(APP_DEFAULT_FONT);
        }
      }),
      { numRuns: 100 }
    );
  });

  // ---- Task 2.4 ----------------------------------------------------------
  // Feature: seasonal-profile-themes, Property 6: Illustration load failure degrades to palette-only
  it('Property 6: illustration returned only on ok with a non-null asset, else null (palette-only)', () => {
    fc.assert(
      fc.property(themeArb, illustrationStateArb, (theme, loadState) => {
        const illustration = effectiveIllustration(theme, loadState);

        if (loadState === 'ok' && theme.backgroundIllustration != null) {
          expect(illustration).toBe(theme.backgroundIllustration);
        } else {
          // absent / error / timeout (or null asset) → palette-only.
          expect(illustration).toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });

  // ---- Task 2.5 ----------------------------------------------------------
  // Feature: seasonal-profile-themes, Property 8: Static theme attributes are independent of the animation gate
  it('Property 8: static attributes are identical whether or not the animation is enabled', () => {
    fc.assert(
      fc.property(themeArb, fc.boolean(), (theme, animationEnabled) => {
        const withFlag = effectiveStaticAttributes(theme, animationEnabled);
        const withoutFlag = effectiveStaticAttributes(theme, !animationEnabled);

        // Palette/illustration/emoji are independent of the animation flag.
        expect(withFlag).toEqual(withoutFlag);

        // And both equal the theme's own static attributes.
        expect(withFlag.palette).toBe(theme.palette);
        expect(withFlag.illustrationAsset).toBe(theme.backgroundIllustration);
        expect(withFlag.emojiAccents).toBe(theme.emojiAccents ?? null);
      }),
      { numRuns: 100 }
    );
  });
});
