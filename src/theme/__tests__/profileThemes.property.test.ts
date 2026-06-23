import fc from 'fast-check';
import {
  BUILT_IN_THEMES,
  BUILT_IN_THEME_LIST,
  DEFAULT_THEME,
  DEFAULT_THEME_ID,
  isKnownThemeId,
  resolveProfileTheme,
  resolveProfileThemeResult,
  type ProfileTheme,
  type ProfileThemeId,
} from '../profileThemes';

// Property/unit tests for the Seasonal Profile Themes registry + total resolver
// (src/theme/profileThemes.ts). Covers tasks 1.2–1.6 of the
// seasonal-profile-themes spec. fast-check + Jest, >= 100 runs per property.
//
// Convention (design "Testing Strategy"): each property is tagged with the
// feature name and the numbered design property it validates.

// The six known Theme_Ids, per design Data Models + Requirement 1.1.
const KNOWN_IDS: ProfileThemeId[] = [
  'default-dark',
  'spring',
  'summer-beach',
  'autumn',
  'winter',
  'purple-pixel',
];

// Arbitrary covering the resolver's full input domain: a known id, an arbitrary
// string (incl. empty), null, or undefined.
const themeIdInput = fc.oneof(
  fc.constantFrom<ProfileThemeId | string>(...KNOWN_IDS),
  fc.string(),
  fc.constant(null),
  fc.constant(undefined)
);

describe('profileThemes registry + resolver', () => {
  // ---- Task 1.2 ----------------------------------------------------------
  // Feature: seasonal-profile-themes, Property 1: Resolver is total and pure with a complete output
  it('Property 1: resolver is total, pure, and returns a complete renderable theme', () => {
    fc.assert(
      fc.property(themeIdInput, (input) => {
        let theme!: ProfileTheme;
        // Never throws.
        expect(() => {
          theme = resolveProfileTheme(input as string | null | undefined);
        }).not.toThrow();

        // Never undefined; always a renderable theme.
        expect(theme).toBeDefined();

        // Complete output: palette gradient has at least 2 stops.
        expect(Array.isArray(theme.palette.gradient)).toBe(true);
        expect(theme.palette.gradient.length).toBeGreaterThanOrEqual(2);

        // Font reference is defined: themeFont is either a ThemeFont or null
        // (null means "render with the app default font"), but never undefined.
        expect(theme.themeFont).not.toBeUndefined();

        // Pure: repeated calls with the same input yield the same theme id.
        const again = resolveProfileTheme(input as string | null | undefined);
        expect(again.id).toBe(theme.id);
        expect(again).toBe(theme);
      }),
      { numRuns: 100 }
    );
  });

  // ---- Task 1.3 ----------------------------------------------------------
  // Feature: seasonal-profile-themes, Property 2: Missing or unknown ids resolve to the Default_Theme
  it('Property 2: missing/unknown ids resolve to default-dark; known ids resolve to themselves', () => {
    fc.assert(
      fc.property(themeIdInput, (input) => {
        const resolved = resolveProfileTheme(input as string | null | undefined);
        if (isKnownThemeId(input)) {
          // Known id → that exact theme.
          expect(resolved.id).toBe(input);
        } else {
          // null, undefined, empty string, or any unknown string → default.
          expect(resolved.id).toBe('default-dark');
          expect(resolved.id).toBe(DEFAULT_THEME_ID);
        }
      }),
      { numRuns: 100 }
    );
  });

  // ---- Task 1.4 ----------------------------------------------------------
  // Feature: seasonal-profile-themes, Property 3: Fallback resolution preserves the requested id and flags the fallback
  it('Property 3: resolveProfileThemeResult preserves requestedId and flags fallback', () => {
    fc.assert(
      fc.property(themeIdInput, (input) => {
        const result = resolveProfileThemeResult(input as string | null | undefined);

        // requestedId is the raw input coalesced to null (input ?? null).
        expect(result.requestedId).toBe((input ?? null) as string | null);

        // isFallback is true exactly when the input is not a known Theme_Id.
        expect(result.isFallback).toBe(!isKnownThemeId(input));

        // On fallback the renderable theme is the default.
        if (result.isFallback) {
          expect(result.theme.id).toBe('default-dark');
        } else {
          expect(result.theme.id).toBe(input);
        }
      }),
      { numRuns: 100 }
    );
  });

  // ---- Task 1.5 ----------------------------------------------------------
  // Feature: seasonal-profile-themes, Property 15: Every built-in palette is structurally valid
  it('Property 15: every built-in theme has a structurally valid palette/accents/font', () => {
    fc.assert(
      fc.property(fc.constantFrom<ProfileTheme>(...BUILT_IN_THEME_LIST), (theme) => {
        // Gradient: between 2 and 5 stops, each a non-empty string.
        expect(theme.palette.gradient.length).toBeGreaterThanOrEqual(2);
        expect(theme.palette.gradient.length).toBeLessThanOrEqual(5);
        for (const stop of theme.palette.gradient) {
          expect(typeof stop).toBe('string');
          expect(stop.length).toBeGreaterThan(0);
        }

        // Non-empty text / secondaryText / accent.
        expect(theme.palette.text.length).toBeGreaterThan(0);
        expect(theme.palette.secondaryText.length).toBeGreaterThan(0);
        expect(theme.palette.accent.length).toBeGreaterThan(0);

        // When emojiAccents is defined, all three slots are non-empty glyphs.
        if (theme.emojiAccents) {
          expect(theme.emojiAccents.like.length).toBeGreaterThan(0);
          expect(theme.emojiAccents.menu.length).toBeGreaterThan(0);
          expect(theme.emojiAccents.follow.length).toBeGreaterThan(0);
        }

        // When themeFont is defined, its family is a non-empty string.
        if (theme.themeFont) {
          expect(typeof theme.themeFont.family).toBe('string');
          expect(theme.themeFont.family.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  // ---- Task 1.6 ----------------------------------------------------------
  // Unit test: registry shape (Requirements 1.1, 1.6).
  describe('registry shape', () => {
    it('BUILT_IN_THEME_LIST has exactly six ids equal to the expected set', () => {
      expect(BUILT_IN_THEME_LIST).toHaveLength(6);

      const listIds = BUILT_IN_THEME_LIST.map((t) => t.id);
      // Exact set match (order-independent).
      expect([...listIds].sort()).toEqual([...KNOWN_IDS].sort());
      // No duplicates.
      expect(new Set(listIds).size).toBe(6);

      // BUILT_IN_THEMES keys match the same set.
      expect(Object.keys(BUILT_IN_THEMES).sort()).toEqual([...KNOWN_IDS].sort());

      // Each list entry is the same object referenced in the record.
      for (const id of KNOWN_IDS) {
        expect(BUILT_IN_THEMES[id].id).toBe(id);
      }
    });

    it('default-dark has null illustration/ambient/emoji/font and a complete palette', () => {
      const def = BUILT_IN_THEMES['default-dark'];

      // It is the exported Default_Theme.
      expect(DEFAULT_THEME).toBe(def);
      expect(DEFAULT_THEME_ID).toBe('default-dark');

      // Neutral and attribute-free.
      expect(def.backgroundIllustration).toBeNull();
      expect(def.ambientAnimation).toBeNull();
      expect(def.emojiAccents).toBeNull();
      expect(def.themeFont).toBeNull();

      // Complete palette: 2..5 gradient stops, non-empty colors.
      expect(def.palette.gradient.length).toBeGreaterThanOrEqual(2);
      expect(def.palette.gradient.length).toBeLessThanOrEqual(5);
      expect(def.palette.text.length).toBeGreaterThan(0);
      expect(def.palette.secondaryText.length).toBeGreaterThan(0);
      expect(def.palette.accent.length).toBeGreaterThan(0);
    });
  });
});
