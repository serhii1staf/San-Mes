import fc from 'fast-check';
import en from '../locales/en';
import ru from '../locales/ru';

// Property-based test for the mini-app-content-policy-consent spec (task 1.2).
//
// The Consent_Dialog renders all of its strings from the `mini_apps.consent.*`
// i18n namespace. Both locale dictionaries (`en.ts`, `ru.ts`) are flat
// `Record<string, string>` maps keyed by dotted identifiers. For the dialog to
// render on either active language without missing strings or raw key
// identifiers, the two dictionaries must declare the EXACT same set of
// `mini_apps.consent.*` keys, and every such value must be a non-empty string.

const CONSENT_PREFIX = 'mini_apps.consent.';

function consentKeys(dict: Record<string, string>): string[] {
  return Object.keys(dict).filter((k) => k.startsWith(CONSENT_PREFIX));
}

const enConsentKeys = consentKeys(en);
const ruConsentKeys = consentKeys(ru);
const unionKeys = Array.from(new Set([...enConsentKeys, ...ruConsentKeys]));

describe('mini-app-content-policy-consent i18n parity properties', () => {
  // Feature: mini-app-content-policy-consent, Property 7: Паритет ключей локализации Consent_Dialog
  it('Property 7: en and ru declare identical mini_apps.consent.* keys with non-empty string values', () => {
    fc.assert(
      // The key set is deterministic, but fast-check exercises set-equality and
      // value validity by sampling random keys from the union of both locales:
      // every sampled consent key must exist in BOTH dictionaries and map to a
      // non-empty string in each. This catches a key present in only one file
      // (the sampled key would be missing on the other side) as well as any
      // empty/blank value.
      fc.property(fc.constantFrom(...unionKeys), (key) => {
        // Set equality: the key must be present in both dictionaries.
        expect(Object.prototype.hasOwnProperty.call(en, key)).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(ru, key)).toBe(true);

        const enValue = en[key];
        const ruValue = ru[key];

        // Each value is a non-empty string in BOTH dictionaries.
        expect(typeof enValue).toBe('string');
        expect(typeof ruValue).toBe('string');
        expect(enValue.trim().length).toBeGreaterThan(0);
        expect(ruValue.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );

    // Direct set-equality assertion to make the parity guarantee explicit and
    // to guard against the (impossible-by-construction) empty union case.
    expect([...enConsentKeys].sort()).toEqual([...ruConsentKeys].sort());
    expect(unionKeys.length).toBeGreaterThan(0);
  });
});
