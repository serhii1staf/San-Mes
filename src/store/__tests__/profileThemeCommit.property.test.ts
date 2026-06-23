// Property-based tests for the optimistic commit / revert flow of the
// Theme_Selection_Screen (seasonal-profile-themes spec, Task 7.3).
//
// Library: fast-check + Jest (jest-expo preset), matching the project's existing
// PBT style (src/**/__tests__/*.property.test.ts). >= 100 runs per property.
//
// The persistence orchestration is extracted into the pure
// `persistThemeSelection` helper (src/store/profileThemeCommit.ts) so it can be
// driven without React or the network. We test it against the REAL
// `profileThemeStore` (its MMKV-backed kvStore mocked with an in-memory map) so
// the per-account active id transitions are exercised end-to-end, with the
// injected `persist` function forced to succeed / reject / never-resolve and
// fake timers driving the 5 s race.

import fc from 'fast-check';

// ─── In-memory mock of the raw kvStore API used by profileThemeStore ──────────
jest.mock('../../services/kvStore', () => {
  const mem: Record<string, string> = {};
  return {
    __mem: mem,
    __clear: () => {
      for (const k of Object.keys(mem)) delete mem[k];
    },
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
import { persistThemeSelection, type PersistResult } from '../profileThemeCommit';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const kvMock = require('../../services/kvStore') as { __clear: () => void };

const ACCOUNT_ID = 'acc-1';

// The six known Theme_Ids (design §"Data Models"). Property 13 is over a
// previously persisted Theme_Id and a newly selected KNOWN Theme_Id.
const KNOWN_THEME_IDS = [
  'default-dark',
  'spring',
  'summer-beach',
  'autumn',
  'winter',
  'purple-pixel',
] as const;

const knownId = fc.constantFrom(...KNOWN_THEME_IDS);
// The previously persisted id may be any known id, or absent (no prior value).
const prevArb = fc.option(knownId, { nil: undefined });
const selectedArb = knownId;

// Four persistence outcomes. 'success' retains the selection; the rest are
// failures that must revert: an explicit error result, a thrown rejection, and
// a never-resolving promise that only loses to the 5 s timeout.
type Outcome = 'success' | 'reject-error' | 'reject-throw' | 'never';
const outcomeArb = fc.constantFrom<Outcome>(
  'success',
  'reject-error',
  'reject-throw',
  'never',
);

function makePersist(outcome: Outcome): () => Promise<PersistResult> {
  switch (outcome) {
    case 'success':
      return () => Promise.resolve({ error: null });
    case 'reject-error':
      return () => Promise.resolve({ error: 'persist_failed' });
    case 'reject-throw':
      return () => Promise.reject(new Error('boom'));
    case 'never':
      return () => new Promise<PersistResult>(() => {});
  }
}

function resetAll(): void {
  useProfileThemeStore.setState({ byAccount: {} });
  kvMock.__clear();
}

describe('persistThemeSelection — optimistic commit / revert (Property 13)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetAll();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  // Feature: seasonal-profile-themes, Property 13: Selection commits optimistically and reverts on persistence failure
  //
  // For any previously persisted Theme_Id and any newly selected known
  // Theme_Id, confirming the selection sets the per-account active id to the
  // selected id; then if persistence rejects or does not complete within 5
  // seconds, both the displayed selection and the active id return to the
  // previously persisted id (and an error indication is shown); on success the
  // selected id is retained.
  //
  // **Validates: Requirements 2.4, 2.6, 3.8**
  it('commits optimistically, then retains on success and reverts on reject/timeout', async () => {
    await fc.assert(
      fc.asyncProperty(
        prevArb,
        selectedArb,
        outcomeArb,
        async (prevId, selectedId, outcome) => {
          // Fresh store + storage every run so prior iterations never leak.
          resetAll();
          const store = useProfileThemeStore.getState();

          // Seed the previously persisted value (absent when prevId === undefined).
          if (prevId !== undefined) store.setThemeId(ACCOUNT_ID, prevId);

          // Capture the prior value exactly as the screen does, before the write.
          const captured = store.getThemeId(ACCOUNT_ID);
          expect(captured).toBe(prevId);

          let committedWith: string | undefined;
          let errorShown = false;

          const settled = persistThemeSelection({
            accountId: ACCOUNT_ID,
            nextId: selectedId,
            prevId: captured,
            persist: makePersist(outcome),
            setThemeId: store.setThemeId,
            revertThemeId: store.revertThemeId,
            onSuccess: (id) => {
              committedWith = id;
            },
            onError: () => {
              errorShown = true;
            },
            timeoutMs: 5000,
          });

          // Optimistic commit happens synchronously before the first await:
          // the active id is the selected id immediately (Req 2.4).
          expect(useProfileThemeStore.getState().byAccount[ACCOUNT_ID]).toBe(
            selectedId,
          );

          // Drive the 5 s race: the never-resolving persist only settles via the
          // timeout, which counts as a failure (Req 2.5).
          if (outcome === 'never') {
            jest.advanceTimersByTime(5000);
          }

          const result = await settled;
          const activeAfter =
            useProfileThemeStore.getState().byAccount[ACCOUNT_ID];

          if (outcome === 'success') {
            // Selected id retained; success mirror called; no error shown.
            expect(result).toBe('committed');
            expect(activeAfter).toBe(selectedId);
            expect(committedWith).toBe(selectedId);
            expect(errorShown).toBe(false);
          } else {
            // Reject / throw / timeout → revert to the previously persisted
            // value (undefined ⇒ entry removed) and show an error (Req 2.6, 3.8).
            expect(result).toBe('reverted');
            expect(activeAfter).toBe(prevId);
            expect(errorShown).toBe(true);
            expect(committedWith).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
