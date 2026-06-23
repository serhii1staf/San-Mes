// Property-based tests for the per-account owner theme state
// (seasonal-profile-themes spec, Task 4.2).
//
// Library: fast-check + Jest (jest-expo preset), matching the project's existing
// PBT style (src/**/__tests__/*.property.test.ts).
//
// The store persists its per-account mirror to MMKV via the raw kvStore API. We
// mock that module with a pure in-memory map so the test never touches native
// storage and stays deterministic — the property under test is about the store's
// in-memory `byAccount` isolation, not durable persistence.

import fc from 'fast-check';

// ─── In-memory mock of the raw kvStore API used by profileThemeStore ──────────
jest.mock('../../services/kvStore', () => {
  const mem: Record<string, string> = {};
  return {
    __mem: mem,
    kvGetStringRawSync: (key: string): string | null =>
      key in mem ? mem[key] : null,
    kvSetStringRaw: (key: string, value: string): void => {
      mem[key] = value;
    },
    kvDeleteRaw: (key: string): void => {
      delete mem[key];
    },
  };
});

import { useProfileThemeStore } from '../profileThemeStore';

// The six known Theme_Ids (design §"Data Models"). Isolation holds for any
// string, but generating from the realistic id space keeps the test grounded.
const KNOWN_THEME_IDS = [
  'default-dark',
  'spring',
  'summer-beach',
  'autumn',
  'winter',
  'purple-pixel',
] as const;

const themeId = fc.constantFrom(...KNOWN_THEME_IDS);

function resetStore(): void {
  useProfileThemeStore.setState({ byAccount: {} });
}

describe('profileThemeStore — per-account isolation (Property 11 / Req 9.5)', () => {
  beforeEach(() => {
    resetStore();
  });

  // Feature: seasonal-profile-themes, Property 11: Theme_Id is isolated per account
  //
  // For any mapping of account ids to Theme_Ids and any single update
  // setThemeId(accountId, newId), after the update the entry for accountId
  // equals newId and every other account's stored Theme_Id is exactly equal to
  // its value before the update.
  //
  // **Validates: Requirements 9.5**
  it('setThemeId changes only the target account, leaving all others byte-identical', () => {
    fc.assert(
      fc.property(
        // initial mapping of accountId → Theme_Id
        fc.dictionary(fc.string(), themeId),
        // the account being updated (may or may not already exist)
        fc.string(),
        // the new Theme_Id to assign
        themeId,
        (initial, accountId, newId) => {
          // Fresh state for every run so prior iterations never leak.
          resetStore();

          const store = useProfileThemeStore.getState();

          // Seed the store via the public setter for each initial entry.
          for (const [acc, id] of Object.entries(initial)) {
            store.setThemeId(acc, id);
          }

          // Snapshot every account's value immediately before the update.
          const before = { ...useProfileThemeStore.getState().byAccount };

          // The single update under test.
          store.setThemeId(accountId, newId);

          const after = useProfileThemeStore.getState().byAccount;

          // setThemeId ignores empty account ids (guard in the store); in that
          // case nothing should change at all.
          if (!accountId) {
            expect(after).toEqual(before);
            return;
          }

          // The target account now holds exactly newId.
          expect(after[accountId]).toBe(newId);

          // Every OTHER account is exactly its pre-update value.
          for (const acc of Object.keys(before)) {
            if (acc === accountId) continue;
            expect(after[acc]).toBe(before[acc]);
          }

          // No other account keys appeared or disappeared.
          const expectedKeys = new Set(Object.keys(before));
          expectedKeys.add(accountId);
          expect(new Set(Object.keys(after))).toEqual(expectedKeys);
        }
      ),
      { numRuns: 100 }
    );
  });
});
