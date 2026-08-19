// Property-based tests for the chat-list header's "active today" selector.
//
// Library: fast-check (repo convention — see the other *.property.test.ts files).
//
// Convention: each property test is tagged with
//   // Property {N}: {short description}
// and runs with at least 100 iterations: fc.assert(prop, { numRuns: 100 }).
//
// `selectActiveToday` is the whole feature's logic: it turns the locally cached
// conversation list into "who did I talk to in the last 24 h", newest first,
// capped. It is pure and takes an injectable `now`, so all of this is testable
// without rendering or mocking a clock.

import fc from 'fast-check';
import { selectActiveToday } from '../ActiveTodayAvatars';
import type { Conversation } from '../../../types';

const NOW = Date.parse('2026-08-18T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AVATARS = 3;

/** Minimal Conversation with only the fields the selector reads. */
function conv(id: string, lastMessageAt: string, emoji?: string): Conversation {
  return {
    id,
    participantId: `u-${id}`,
    participantName: `N-${id}`,
    participantUsername: `n-${id}`,
    participantEmoji: emoji,
    lastMessage: 'x',
    lastMessageAt,
    unreadCount: 0,
  };
}

// BOUNDARY: the selector keeps everything with `at >= now - 24h`, i.e. a message
// exactly 24 h old still counts as "active today". That inclusive edge is pinned
// by its own test below, and the generators here stay strictly on one side of it
// so the properties can never straddle it.
//
// (Worth stating because getting this wrong is invisible: fast-check biases hard
// toward the boundary values of a range, so an "outside" generator starting at
// exactly DAY_MS produced a conversation the selector legitimately KEPT, and the
// property failed on maybe one run in five.)
/** Offsets strictly inside the active window (1 ms .. just under 24 h ago). */
const insideWindowMs = fc.integer({ min: 1, max: DAY_MS - 1 });
/** Offsets strictly outside it (older than 24 h — past the inclusive edge). */
const outsideWindowMs = fc.integer({ min: DAY_MS + 1, max: 40 * DAY_MS });

describe('selectActiveToday', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Property 1: only conversations inside the 24 h window are ever returned
  it('Property 1: never returns a conversation older than 24 h', () => {
    fc.assert(
      fc.property(
        fc.array(insideWindowMs, { maxLength: 6 }),
        fc.array(outsideWindowMs, { maxLength: 6 }),
        (recentOffsets, staleOffsets) => {
          const recent = recentOffsets.map((off, i) =>
            conv(`recent-${i}`, new Date(NOW - off).toISOString()),
          );
          const stale = staleOffsets.map((off, i) =>
            conv(`stale-${i}`, new Date(NOW - off).toISOString()),
          );

          const ids = selectActiveToday([...stale, ...recent], NOW).map((e) => e.id);

          // Nothing stale leaks through...
          expect(ids.every((id) => !id.startsWith('stale-'))).toBe(true);
          // ...and we surface as many recent ones as the cap allows.
          expect(ids.length).toBe(Math.min(recent.length, MAX_AVATARS));
        },
      ),
      { numRuns: 100 },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Property 2: result is newest-first and capped
  it('Property 2: newest first, never more than the cap, no duplicates', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(insideWindowMs, { minLength: 1, maxLength: 12 }),
        (offsets) => {
          const list = offsets.map((off, i) =>
            conv(`c-${i}`, new Date(NOW - off).toISOString()),
          );
          const picked = selectActiveToday(list, NOW);

          expect(picked.length).toBe(Math.min(offsets.length, MAX_AVATARS));

          // No id appears twice.
          expect(new Set(picked.map((p) => p.id)).size).toBe(picked.length);

          // Newest first: map each returned id back to its age and assert the
          // ages are non-decreasing (smaller offset = more recent).
          const ageById = new Map(list.map((c, i) => [c.id, offsets[i]]));
          const ages = picked.map((p) => ageById.get(p.id)!);
          for (let i = 1; i < ages.length; i++) {
            expect(ages[i - 1]).toBeLessThanOrEqual(ages[i]);
          }

          // And the ones we picked really are the freshest available.
          const freshest = [...offsets].sort((a, b) => a - b).slice(0, MAX_AVATARS);
          expect(ages).toStrictEqual(freshest);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Property 3: malformed / missing / future timestamps never crash or win
  it('Property 3: unparseable, absent and future timestamps are ignored', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constant(''),
            fc.constant('not-a-date'),
            fc.constant('2026-13-45T99:99:99Z'),
            // Clock skew: a message "from the future" must not sort to the top.
            fc.integer({ min: 1, max: 10 * DAY_MS }).map((ms) =>
              new Date(NOW + ms).toISOString(),
            ),
          ),
          { maxLength: 8 },
        ),
        insideWindowMs,
        (junkStamps, goodOffset) => {
          const junk = junkStamps.map((s, i) => conv(`junk-${i}`, s));
          const good = conv('good', new Date(NOW - goodOffset).toISOString());

          const picked = selectActiveToday([...junk, good], NOW);

          // The one legitimate entry is the only survivor.
          expect(picked.map((p) => p.id)).toStrictEqual(['good']);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Property 4: an emoji is always supplied, so the disc is never blank
  it('Property 4: always yields a non-empty emoji, falling back when absent', () => {
    fc.assert(
      fc.property(
        fc.option(fc.constantFrom('😀', '🐱', '🎧'), { nil: undefined }),
        insideWindowMs,
        (emoji, off) => {
          const picked = selectActiveToday(
            [conv('c', new Date(NOW - off).toISOString(), emoji)],
            NOW,
          );
          expect(picked).toHaveLength(1);
          expect(picked[0].emoji.length).toBeGreaterThan(0);
          if (emoji) expect(picked[0].emoji).toBe(emoji);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns nothing for an empty list (header renders no cluster)', () => {
    expect(selectActiveToday([], NOW)).toStrictEqual([]);
  });

  // The 24 h edge is INCLUSIVE. Pinned explicitly rather than left implicit,
  // because the property generators above are built around this fact and would
  // silently start failing at random if the comparison ever flipped.
  it('treats the 24 h edge as inclusive, and one millisecond past it as stale', () => {
    const exactly24h = conv('edge', new Date(NOW - DAY_MS).toISOString());
    expect(selectActiveToday([exactly24h], NOW).map((e) => e.id)).toStrictEqual(['edge']);

    const justOver = conv('over', new Date(NOW - DAY_MS - 1).toISOString());
    expect(selectActiveToday([justOver], NOW)).toStrictEqual([]);
  });
});
