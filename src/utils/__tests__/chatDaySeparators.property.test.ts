// Property-based tests for the chat transcript's day separators.
//
// Library: fast-check (repo convention).
//
// Convention: each property test is tagged with
//   // Property {N}: {short description}
// and runs with at least 100 iterations: fc.assert(prop, { numRuns: 100 }).
//
// These are pure functions with an injectable `now`, so the risky part — calendar
// boundaries in the DEVICE's local zone — is testable without mocking a clock.

import fc from 'fast-check';
import {
  buildDaySeparators,
  classifyDay,
  formatDaySeparator,
  localDayKey,
  __resetDaySeparatorCaches,
} from '../chatDaySeparators';

/** Build an ISO string for a specific LOCAL date/time (not UTC). */
function localIso(y: number, m: number, d: number, hh = 12, mm = 0): string {
  return new Date(y, m, d, hh, mm, 0, 0).toISOString();
}

const t = (_k: string, fallback?: string) => fallback ?? '';

beforeEach(() => {
  __resetDaySeparatorCaches();
});

describe('localDayKey', () => {
  it('groups two times on the same local day, and splits across local midnight', () => {
    const early = new Date(2026, 7, 18, 0, 5);
    const late = new Date(2026, 7, 18, 23, 55);
    const nextDay = new Date(2026, 7, 19, 0, 5);

    expect(localDayKey(early)).toBe(localDayKey(late));
    expect(localDayKey(late)).not.toBe(localDayKey(nextDay));
  });

  // Property 1: the key is a function of the local calendar fields ONLY —
  // never of the UTC date, which is what makes it correct in every time zone.
  it('Property 1: key depends only on local Y/M/D', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 23 }),
        (y, m, d, h1, h2) => {
          const a = new Date(y, m, d, h1);
          const b = new Date(y, m, d, h2);
          expect(localDayKey(a)).toBe(localDayKey(b));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('buildDaySeparators', () => {
  it('marks the first message and every later day change', () => {
    const msgs = [
      { id: 'a', createdAt: localIso(2026, 7, 16, 9) },
      { id: 'b', createdAt: localIso(2026, 7, 16, 20) },
      { id: 'c', createdAt: localIso(2026, 7, 17, 8) },
      { id: 'd', createdAt: localIso(2026, 7, 17, 9) },
      { id: 'e', createdAt: localIso(2026, 7, 19, 9) },
    ];
    expect([...buildDaySeparators(msgs).keys()]).toStrictEqual(['a', 'c', 'e']);
  });

  it('ignores unusable timestamps without breaking the surrounding day run', () => {
    const msgs = [
      { id: 'a', createdAt: localIso(2026, 7, 16, 9) },
      { id: 'junk', createdAt: 'not-a-date' },
      { id: 'none' },
      // Same day as `a` — the junk between them must NOT introduce a chip here.
      { id: 'b', createdAt: localIso(2026, 7, 16, 10) },
      { id: 'c', createdAt: localIso(2026, 7, 17, 10) },
    ];
    expect([...buildDaySeparators(msgs).keys()]).toStrictEqual(['a', 'c']);
  });

  // Property 2: one chip per distinct local day, never two for the same day,
  // and the marked message is always the FIRST of its day.
  it('Property 2: exactly one separator per distinct local day', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 25 }),
        (dayOffsets) => {
          // Oldest → newest, as the transcript is ordered.
          const sorted = [...dayOffsets].sort((a, b) => a - b);
          const msgs = sorted.map((off, i) => ({
            id: `m-${i}`,
            createdAt: localIso(2026, 7, 10 + off, 12),
          }));

          const seps = buildDaySeparators(msgs);
          const distinctDays = new Set(sorted).size;
          expect(seps.size).toBe(distinctDays);

          // Every marked id is the first occurrence of its day.
          for (const [id, iso] of seps) {
            const idx = msgs.findIndex((m) => m.id === id);
            const key = localDayKey(new Date(Date.parse(iso)));
            const earlierSameDay = msgs
              .slice(0, idx)
              .some((m) => localDayKey(new Date(Date.parse(m.createdAt!))) === key);
            expect(earlierSameDay).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns nothing for an empty transcript', () => {
    expect(buildDaySeparators([]).size).toBe(0);
  });
});

describe('classifyDay', () => {
  const now = new Date(2026, 7, 18, 15, 30).getTime();

  it('recognises today, yesterday, this year and older years', () => {
    expect(classifyDay(localIso(2026, 7, 18, 1), now)).toBe('today');
    expect(classifyDay(localIso(2026, 7, 18, 23, 59), now)).toBe('today');
    expect(classifyDay(localIso(2026, 7, 17, 23, 59), now)).toBe('yesterday');
    expect(classifyDay(localIso(2026, 7, 16, 12), now)).toBe('thisYear');
    expect(classifyDay(localIso(2025, 11, 31, 12), now)).toBe('olderYear');
  });

  it('handles month and year rollover when computing "yesterday"', () => {
    // 1st of a month → yesterday is the last day of the previous month.
    const firstOfMonth = new Date(2026, 7, 1, 10).getTime();
    expect(classifyDay(localIso(2026, 6, 31, 22), firstOfMonth)).toBe('yesterday');

    // Jan 1st → yesterday is Dec 31st of the previous YEAR, and must be
    // "yesterday" rather than falling through to the older-year branch.
    const newYearsDay = new Date(2026, 0, 1, 10).getTime();
    expect(classifyDay(localIso(2025, 11, 31, 22), newYearsDay)).toBe('yesterday');
  });

  it('returns null for unusable input', () => {
    expect(classifyDay('nope', now)).toBeNull();
    expect(classifyDay('', now)).toBeNull();
  });
});

describe('formatDaySeparator', () => {
  const now = new Date(2026, 7, 18, 15, 30).getTime();

  it('uses the dictionary for today/yesterday', () => {
    const tt = (k: string) => (k === 'chat.day.today' ? 'TODAY' : 'YESTERDAY');
    expect(formatDaySeparator(localIso(2026, 7, 18, 9), now, 'ru', tt)).toBe('TODAY');
    expect(formatDaySeparator(localIso(2026, 7, 17, 9), now, 'ru', tt)).toBe('YESTERDAY');
  });

  it('omits the year within the current year and includes it for older ones', () => {
    const sameYear = formatDaySeparator(localIso(2026, 2, 5, 9), now, 'en', t)!;
    const olderYear = formatDaySeparator(localIso(2024, 2, 5, 9), now, 'en', t)!;

    expect(sameYear).not.toMatch(/2026/);
    expect(olderYear).toMatch(/2024/);
  });

  // Property 3: never throws and never returns an empty label, for any locale
  // tag (including malformed ones) and any in-range date.
  it('Property 3: always yields a non-empty label or null, never throws', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('ru', 'en', 'en-US', 'de-DE', 'ar-EG', 'ja', 'xx-YY', '', 'not a locale'),
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 1, max: 28 }),
        (locale, y, m, d) => {
          const label = formatDaySeparator(localIso(y, m, d, 12), now, locale, t);
          expect(label === null || label.length > 0).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns null for unusable input so no chip is rendered', () => {
    expect(formatDaySeparator('garbage', now, 'ru', t)).toBeNull();
  });
});
