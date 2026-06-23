import fc from 'fast-check';
import {
  KNOWN_THEME_IDS,
  validateThemeId,
} from '../../../workers/api/src/themeIds';

// Property test for the backend `theme_id` validator
// (workers/api/src/themeIds.ts → validateThemeId), task 9.4 of the
// seasonal-profile-themes spec. The Worker uses vitest + has no fast-check
// dependency, so this property runs under the repo's root jest + fast-check
// stack (where the other seasonal-profile-themes property tests live),
// importing the pure validator via a relative path. >= 100 runs.
//
// Convention (design "Testing Strategy"): each property is tagged with the
// feature name and the numbered design property it validates.

// The six known Theme_Ids, as a plain string set for the iff check.
const KNOWN_ID_SET = new Set<string>(KNOWN_THEME_IDS);

// Arbitrary covering the validator's input domain: a known id, an arbitrary
// string (incl. empty), the number 123, null, or undefined.
const themeIdInput = fc.oneof(
  fc.constantFrom<unknown>(...KNOWN_THEME_IDS),
  fc.string(),
  fc.constant(123),
  fc.constant(null),
  fc.constant(undefined)
);

describe('server theme_id validation', () => {
  // Feature: seasonal-profile-themes, Property 12: Server accepts known Theme_Ids and rejects unknown ones without mutating state
  it('Property 12: validateThemeId is true iff the value is one of the six known id strings', () => {
    fc.assert(
      fc.property(themeIdInput, (input) => {
        const accepted = validateThemeId(input);

        // Accepted exactly when the input is a known id string. fc.string()
        // could in principle generate a known id, so test membership against
        // the set rather than which oneof branch produced the value.
        const isKnown = typeof input === 'string' && KNOWN_ID_SET.has(input);

        expect(accepted).toBe(isKnown);
        // The validator is a pure predicate: it always returns a boolean.
        expect(typeof accepted).toBe('boolean');
      }),
      { numRuns: 100 }
    );
  });
});
