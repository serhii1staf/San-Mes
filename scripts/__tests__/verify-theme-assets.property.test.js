'use strict';

const fc = require('fast-check');

const {
  verifyThemeAssets,
  DISTRIBUTION_PROHIBITED,
} = require('../verify-theme-assets');

// Property-based tests for the Seasonal Profile Themes build-time license gate
// (Apple Developer Program License Agreement §3.3.4; Req 8.1, 8.2, 8.4, 8.5, 8.6).
//
// verifyThemeAssets(manifest, refs) is a PURE function: it returns
//   { ok: boolean, missing: string[] }
// where `ok` is true iff every shipped asset ref has a COMPLETE,
// distribution-permitting license record, and `missing` names every ref that
// lacks one. System-emoji accents are OS glyphs (never files), so they are
// never present in `refs` and are therefore never required to have a record.
//
// Convention: tag each property with feature + numbered property, run >= 100 runs.

// --- Independent oracle (re-implemented here, not imported, so the test does
// not lean on the module's own helpers) -------------------------------------

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function permitsDistribution(licenseType) {
  if (!nonEmpty(licenseType)) return false;
  return !DISTRIBUTION_PROHIBITED.has(licenseType.trim().toLowerCase());
}

function isCompleteRecord(record) {
  return (
    !!record &&
    nonEmpty(record.assetPath) &&
    nonEmpty(record.licenseType) &&
    permitsDistribution(record.licenseType) &&
    nonEmpty(record.source) &&
    nonEmpty(record.owner)
  );
}

function normalizePath(p) {
  return String(p).replace(/\\/g, '/');
}

function expectedResult(manifest, refs) {
  const records =
    manifest && Array.isArray(manifest.records) ? manifest.records : [];
  const safeRefs = Array.isArray(refs) ? refs : [];
  const missing = [];
  for (const ref of safeRefs) {
    if (!ref || !nonEmpty(ref.assetPath)) continue;
    const wanted = normalizePath(ref.assetPath);
    const record = records.find(
      (r) => r && nonEmpty(r.assetPath) && normalizePath(r.assetPath) === wanted
    );
    if (!isCompleteRecord(record)) missing.push(ref.assetPath);
  }
  return { ok: missing.length === 0, missing };
}

// --- Generators -------------------------------------------------------------

// Small shared pool of asset names so refs and records overlap frequently,
// while still exercising backslash/forward-slash normalization.
const ASSET_NAMES = ['spring.png', 'beach.jpg', 'autumn.webp', 'winter.png', 'pixel.ttf', 'meadow.svg'];

const assetPathArb = fc.oneof(
  fc.constantFrom(...ASSET_NAMES.map((n) => `assets/profile-themes/${n}`)),
  // Same paths but with Windows separators to exercise normalizePath matching.
  fc.constantFrom(...ASSET_NAMES.map((n) => `assets\\profile-themes\\${n}`)),
  fc.string()
);

const VALID_LICENSES = ['MIT', 'OFL-1.1', 'CC0-1.0', 'CC-BY-4.0', 'Apache-2.0', 'owned'];
const PROHIBITED_LICENSES = Array.from(DISTRIBUTION_PROHIBITED);

const licenseTypeArb = fc.oneof(
  fc.constantFrom(...VALID_LICENSES),
  fc.constantFrom(...PROHIBITED_LICENSES),
  // Uppercase prohibited values to confirm case-insensitive denylist matching.
  fc.constantFrom(...PROHIBITED_LICENSES.map((l) => l.toUpperCase())),
  fc.constantFrom('', '   '),
  fc.string()
);

// A field that is sometimes empty/whitespace (incomplete) and sometimes valid.
const maybeEmptyStringArb = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0)
);

const refArb = fc.record({
  assetPath: assetPathArb,
  type: fc.constantFrom('illustration', 'font'),
});

const recordArb = fc.record({
  assetPath: assetPathArb,
  licenseType: licenseTypeArb,
  source: maybeEmptyStringArb,
  owner: maybeEmptyStringArb,
});

const manifestArb = fc.record({
  records: fc.array(recordArb, { maxLength: 8 }),
});

const refsArb = fc.array(refArb, { maxLength: 8 });

describe('Asset-license verifier properties', () => {
  // Feature: seasonal-profile-themes, Property 14: Asset-license verifier passes iff every shipped asset has a valid record
  it('Property 14: passes iff every shipped asset has a valid record, and names every offender', () => {
    fc.assert(
      fc.property(manifestArb, refsArb, (manifest, refs) => {
        const result = verifyThemeAssets(manifest, refs);
        const expected = expectedResult(manifest, refs);

        // Shape is always a well-formed result object.
        expect(typeof result.ok).toBe('boolean');
        expect(Array.isArray(result.missing)).toBe(true);

        // Passes IFF there are no offending assets.
        expect(result.ok).toBe(expected.missing.length === 0);
        expect(result.ok).toBe(expected.ok);

        // When it fails, the error names EVERY asset lacking a valid record
        // (order-independent set equality).
        expect([...result.missing].sort()).toEqual([...expected.missing].sort());

        // ok is exactly the empty-missing condition.
        expect(result.ok).toBe(result.missing.length === 0);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: seasonal-profile-themes, Property 14: Asset-license verifier passes iff every shipped asset has a valid record
  // Emoji-accent glyphs are OS-provided and never appear as file refs, so with
  // no shipped asset refs the gate always passes regardless of the manifest.
  it('Property 14 (emoji never required): empty refs always pass for any manifest', () => {
    fc.assert(
      fc.property(manifestArb, (manifest) => {
        const result = verifyThemeAssets(manifest, []);
        expect(result.ok).toBe(true);
        expect(result.missing).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: seasonal-profile-themes, Property 14: Asset-license verifier passes iff every shipped asset has a valid record
  // Whenever a shipped asset has a complete, distribution-permitting record,
  // it must NOT appear in `missing`; whenever it lacks one, it MUST.
  it('Property 14 (membership): missing contains exactly the unbacked shipped assets', () => {
    fc.assert(
      fc.property(manifestArb, refsArb, (manifest, refs) => {
        const { missing } = verifyThemeAssets(manifest, refs);
        const records = manifest.records || [];

        for (const ref of refs) {
          if (!nonEmpty(ref.assetPath)) continue;
          const wanted = normalizePath(ref.assetPath);
          const record = records.find(
            (r) => r && nonEmpty(r.assetPath) && normalizePath(r.assetPath) === wanted
          );
          const hasValidRecord = isCompleteRecord(record);
          if (hasValidRecord) {
            expect(missing).not.toContain(ref.assetPath);
          } else {
            expect(missing).toContain(ref.assetPath);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
