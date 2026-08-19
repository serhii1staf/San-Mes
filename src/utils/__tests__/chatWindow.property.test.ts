// Property-based tests for the chat transcript's rendered-window start.
//
// Library: fast-check (repo convention).
//
// Convention: each property test is tagged with
//   // Property {N}: {short description}
// and runs with at least 100 iterations: fc.assert(prop, { numRuns: 100 }).
//
// WHY THIS EXISTS
// The window's front edge moving FORWARD is what produced the reported "a message
// disappears, then suddenly appears, and it teleports me": with the naive
// `start = total - renderWindow`, a single append removed the oldest row from the
// front of the rendered data in the same commit that added a new row at the back,
// and a post-commit effect then put it back one frame later. Two content-height
// changes above the viewport in consecutive frames, and
// `maintainVisibleContentPosition` cannot absorb the first because a front removal
// is not a prepend.
//
// The fix is an invariant, so it is pinned as one: the start is NON-INCREASING for a
// given conversation. These tests exist to stop that being "simplified" back.

import fc from 'fast-check';
import { computeWindowStart } from '../chatWindow';

describe('computeWindowStart', () => {
  // Property 1: the result is always a valid index into the array
  it('always returns an index inside the array', () => {
    fc.assert(
      fc.property(fc.nat({ max: 5000 }), fc.nat({ max: 5000 }), fc.option(fc.nat({ max: 5000 }), { nil: null }), (total, renderWindow, previousStart) => {
        const start = computeWindowStart({ total, renderWindow, previousStart });
        expect(start).toBeGreaterThanOrEqual(0);
        if (total === 0) expect(start).toBe(0);
        else expect(start).toBeLessThanOrEqual(total - 1);
      }),
      { numRuns: 100 },
    );
  });

  // Property 2: THE core invariant — the front edge never moves forward
  it('never returns a start greater than the previous start', () => {
    fc.assert(
      fc.property(fc.nat({ max: 5000 }), fc.nat({ max: 5000 }), fc.nat({ max: 5000 }), (total, renderWindow, previousStart) => {
        fc.pre(total > 0);
        const start = computeWindowStart({ total, renderWindow, previousStart });
        expect(start).toBeLessThanOrEqual(previousStart);
      }),
      { numRuns: 100 },
    );
  });

  // Property 3: appending messages does not move the window.
  // This is the exact scenario that used to drop the oldest rendered row.
  it('is unchanged when only the total grows', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 1, max: 200 }),
        (total, renderWindow, appended) => {
          const first = computeWindowStart({ total, renderWindow, previousStart: null });
          const after = computeWindowStart({
            total: total + appended,
            renderWindow,
            previousStart: first,
          });
          expect(after).toBe(first);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 4: repeated appends never move it either — the invariant has to hold
  // across a whole session, not just one step
  it('is stable across a long run of appends', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), fc.integer({ min: 1, max: 500 }), (total, renderWindow) => {
        let start = computeWindowStart({ total, renderWindow, previousStart: null });
        const initial = start;
        let n = total;
        for (let i = 0; i < 50; i++) {
          n += 1;
          start = computeWindowStart({ total: n, renderWindow, previousStart: start });
        }
        expect(start).toBe(initial);
      }),
      { numRuns: 100 },
    );
  });

  // Property 5: growing renderWindow reveals older history (start decreases or stays)
  it('decreases or holds when the render window grows', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 3000 }),
        (total, renderWindow, growth) => {
          const before = computeWindowStart({ total, renderWindow, previousStart: null });
          const after = computeWindowStart({
            total,
            renderWindow: renderWindow + growth,
            previousStart: before,
          });
          expect(after).toBeLessThanOrEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 6: a render window covering everything shows everything
  it('returns 0 when the window covers the whole history', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3000 }), (total) => {
        expect(computeWindowStart({ total, renderWindow: total, previousStart: null })).toBe(0);
        expect(computeWindowStart({ total, renderWindow: total + 500, previousStart: null })).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  // Property 7: a fresh conversation ignores the previous start.
  // Without this, switching chats would inherit a window position from the last one.
  it('recomputes from scratch when previousStart is null', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3000 }), fc.integer({ min: 1, max: 3000 }), (total, renderWindow) => {
        const expected = Math.max(0, Math.min(Math.max(0, total - renderWindow), total - 1));
        expect(computeWindowStart({ total, renderWindow, previousStart: null })).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  // Property 8: a shrinking transcript (deletes) is clamped, never left past the end
  it('clamps into the array when the transcript shrinks below the previous start', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 200, max: 3000 }), (total, previousStart) => {
        const start = computeWindowStart({ total, renderWindow: 30, previousStart });
        expect(start).toBeLessThanOrEqual(total - 1);
        expect(start).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });

  // Property 9: degenerate inputs do not produce a negative or NaN index
  it('handles an empty transcript and a zero window', () => {
    expect(computeWindowStart({ total: 0, renderWindow: 30, previousStart: null })).toBe(0);
    expect(computeWindowStart({ total: 0, renderWindow: 0, previousStart: 5 })).toBe(0);
    expect(computeWindowStart({ total: 10, renderWindow: 0, previousStart: null })).toBe(9);
    expect(computeWindowStart({ total: 1, renderWindow: 30, previousStart: null })).toBe(0);
  });
});
