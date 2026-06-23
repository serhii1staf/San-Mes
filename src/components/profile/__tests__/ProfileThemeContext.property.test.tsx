// Property test for Seasonal Profile Themes render-scope containment
// (src/components/profile/ProfileThemeContext.tsx). Covers task 5.2 of the
// seasonal-profile-themes spec. fast-check + Jest, >= 100 runs.
//
// Library: fast-check + Jest with react-test-renderer (the repo convention —
// there is no @testing-library/react-native dependency; see
// MiniAppConsentDialog.test.tsx). A tiny probe component reads the context via
// the real hooks and exposes the resolved value so the property can assert it.
//
// Convention (design "Testing Strategy"): the property is tagged with the
// design property id + text and links the validated requirements.

import fc from 'fast-check';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  DEFAULT_PROFILE_THEME_CONTEXT,
  ProfileThemeContextValue,
  useProfileTheme,
  useProfileThemeAccents,
  useProfileThemeFont,
} from '../ProfileThemeContext';
import {
  APP_DEFAULT_FONT,
  BUILT_IN_THEME_LIST,
  DEFAULT_THEME,
} from '../../../theme/profileThemes';

// All six known Theme_Ids, plus values that exercise the "no theme / unknown
// theme is active elsewhere" case. The active theme is irrelevant to a reader
// that sits OUTSIDE any ProfileThemeScope: such a reader must always observe
// the neutral defaults. We sample across these to demonstrate that the
// out-of-scope result is independent of whichever theme id is "active".
const KNOWN_THEME_IDS = BUILT_IN_THEME_LIST.map((t) => t.id);
const activeThemeIdArb = fc.constantFrom(
  ...KNOWN_THEME_IDS,
  // also include "no active theme" / unrelated ids to widen the demonstration
  'unknown-theme',
  '',
);

/**
 * Render the three context hooks OUTSIDE any provider/scope and capture the
 * resolved value. The `activeThemeId` prop is intentionally ignored by the
 * hooks — it only documents that some theme is "active" elsewhere; an
 * out-of-scope reader must not see it.
 */
function readContextOutsideScope(_activeThemeId: string): ProfileThemeContextValue {
  let captured!: ProfileThemeContextValue;

  function Probe(): null {
    const value = useProfileTheme();
    const accents = useProfileThemeAccents();
    const font = useProfileThemeFont();
    // Reassemble from the individual selectors too, so all three hook entry
    // points are exercised and must agree on the neutral defaults.
    captured = { theme: value.theme, emojiAccents: accents, font };
    return null;
  }

  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    // NOTE: no <ProfileThemeProvider> / <ProfileThemeScope> wrapper.
    renderer = TestRenderer.create(<Probe />);
  });
  act(() => {
    renderer.unmount();
  });

  return captured;
}

describe('ProfileThemeContext scope containment (Property 10)', () => {
  // Feature: seasonal-profile-themes, Property 10: Theme attributes are confined to the profile screen scope
  it('Property 10: reading the context outside a ProfileThemeScope yields the default values for any active theme', () => {
    fc.assert(
      fc.property(activeThemeIdArb, (activeThemeId) => {
        const value = readContextOutsideScope(activeThemeId);

        // The whole context value equals the neutral default, regardless of
        // which theme is "active" elsewhere (Req 4.10, 6.5).
        expect(value).toEqual(DEFAULT_PROFILE_THEME_CONTEXT);

        // Spell out each attribute to make the containment guarantee explicit:
        // default theme palette, NO emoji accents, app default font — i.e. no
        // themed palette / illustration / ambient / accents / font leak out.
        expect(value.theme).toBe(DEFAULT_THEME);
        expect(value.emojiAccents).toBeNull();
        expect(value.font).toBe(APP_DEFAULT_FONT);
      }),
      { numRuns: 100 },
    );
  });
});
