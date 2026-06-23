import { BUILT_IN_THEME_LIST } from '../profileThemes';
import { KNOWN_THEME_IDS } from '../../../workers/api/src/themeIds';

// Lock-step test for the Seasonal Profile Themes feature (task 9.5).
//
// The Worker (`workers/api/src/themeIds.ts`) cannot import the React Native
// theme registry (`src/theme/profileThemes.ts`), so it keeps its own ordered
// copy of the Built_In_Theme_Set ids in `KNOWN_THEME_IDS`. This test guards the
// two lists from drifting: it asserts the Worker's id list deep-equals the RN
// registry's `BUILT_IN_THEME_LIST` ids — same ids in the same order — and that
// both equal the canonical six-id list (catches drift in either direction).
//
// _Requirements: 3.7, 1.1_

// Canonical Built_In_Theme_Set, in stable display order (design §"Data Models").
const CANONICAL_THEME_IDS = [
  'default-dark',
  'spring',
  'summer-beach',
  'autumn',
  'winter',
  'purple-pixel',
] as const;

describe('theme id lock-step: Worker KNOWN_THEME_IDS vs RN BUILT_IN_THEME_LIST', () => {
  const registryIds = BUILT_IN_THEME_LIST.map((t) => t.id);

  it("Worker id list deep-equals the RN registry's ids in the same order", () => {
    expect(KNOWN_THEME_IDS).toEqual(registryIds);
  });

  it('both lists equal the canonical six-id list', () => {
    expect(registryIds).toEqual(CANONICAL_THEME_IDS);
    expect([...KNOWN_THEME_IDS]).toEqual(CANONICAL_THEME_IDS);
  });

  it('both lists contain exactly six unique ids', () => {
    expect(KNOWN_THEME_IDS).toHaveLength(6);
    expect(new Set(KNOWN_THEME_IDS).size).toBe(6);
    expect(new Set(registryIds).size).toBe(6);
  });
});
