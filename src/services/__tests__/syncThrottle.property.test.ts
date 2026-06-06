import fc from 'fast-check';
import { shouldSync, resetThrottle } from '../syncThrottle';

// Property-based tests for the per-account sync throttle timing logic.
//
// `shouldSync(key, intervalMs)` reads the wall clock via `Date.now()` and
// returns `true` only when at least `intervalMs` has elapsed since the last
// successful sync for that key (recording the new timestamp on success).
// We drive time deterministically by spying on `Date.now`.
//
// The throttle module keeps an in-memory timestamp cache that persists across
// calls within a test run, so every property iteration starts by calling
// `resetThrottle(key)` to guarantee a clean slate for the generated key.

describe('syncThrottle timing properties', () => {
  let now = 0;
  let dateNowSpy: jest.SpyInstance;

  // A baseline far larger than any generated interval so that the *first*
  // shouldSync (lastSync === 0) always satisfies `now - 0 >= interval`.
  const BASE_TIME = 1_700_000_000_000; // ~Nov 2023 in ms

  beforeEach(() => {
    now = BASE_TIME;
    dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  // Feature: per-account-cache, Property 6: shouldSync подавляет повторную синхронизацию внутри окна
  it('Property 6: suppresses re-sync inside the interval window, allows it after expiry', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.integer({ min: 1, max: 30 * 60 * 1000 }), // interval: 1ms .. 30min
        fc.integer({ min: 0 }), // raw offset, mapped into the window below
        fc.integer({ min: 0, max: 60 * 60 * 1000 }), // overshoot past the window
        async (key, interval, rawWithin, overshoot) => {
          // Clean slate for this key (module cache persists across iterations).
          resetThrottle(key);

          // First sync at BASE_TIME must be allowed (nothing recorded yet).
          now = BASE_TIME;
          const first = await shouldSync(key, interval);
          expect(first).toBe(true);

          // Any call strictly inside [BASE_TIME, BASE_TIME + interval) is suppressed.
          const within = rawWithin % interval; // 0 .. interval-1
          now = BASE_TIME + within;
          const insideWindow = await shouldSync(key, interval);
          expect(insideWindow).toBe(false);

          // Once the window has fully elapsed, sync is allowed again.
          now = BASE_TIME + interval + overshoot;
          const afterWindow = await shouldSync(key, interval);
          expect(afterWindow).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: per-account-cache, Property 7: resetThrottle снимает подавление
  it('Property 7: resetThrottle clears suppression so the next shouldSync returns true', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.integer({ min: 1, max: 30 * 60 * 1000 }),
        async (key, interval) => {
          resetThrottle(key);

          // Suppress the key: first call records the timestamp and returns true.
          now = BASE_TIME;
          expect(await shouldSync(key, interval)).toBe(true);

          // Immediately retrying at the same instant is suppressed.
          expect(await shouldSync(key, interval)).toBe(false);

          // Resetting the throttle removes the recorded timestamp.
          resetThrottle(key);

          // The very next call (same instant) is allowed again.
          expect(await shouldSync(key, interval)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
