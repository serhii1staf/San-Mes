/**
 * Guards the store-level bail-out that stops screens blinking.
 *
 * The two failure modes are NOT symmetric, and the tests are weighted accordingly:
 *   - Comparing too much  → one extra render. Harmless.
 *   - Comparing too little → the update is SWALLOWED and the screen shows stale or
 *     missing content.
 *
 * The first version of this module used an allowlist of "fields that matter" and
 * omitted `imageUrls`, `isSpoilerImage`, `isRepost`, `originalPost`,
 * `authorVerified` and `authorBadge` — so a repost whose `originalPost` resolved
 * after first paint never rendered its embed. Most of what follows exists to make
 * that class of mistake impossible to reintroduce.
 */

import fc from 'fast-check';
import {
  conversationsEqual,
  listEqualIgnoring,
  postsEqual,
  POST_VOLATILE_FIELDS,
  rowEqualIgnoring,
  valueEqual,
} from '../utils/listEquality';

const post = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  authorId: 'a1',
  authorName: 'A',
  authorUsername: 'a',
  authorEmoji: '😊',
  content: 'hello',
  likesCount: 0,
  commentsCount: 0,
  sharesCount: 0,
  isLiked: false,
  isBookmarked: false,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('valueEqual', () => {
  it('compares primitives', () => {
    expect(valueEqual(1, 1)).toBe(true);
    expect(valueEqual('a', 'a')).toBe(true);
    expect(valueEqual(undefined, undefined)).toBe(true);
    expect(valueEqual(null, undefined)).toBe(false);
    expect(valueEqual(1, '1')).toBe(false);
  });

  it('compares arrays element-wise, not by reference', () => {
    // `imageUrls` is a fresh array on every fetch, so reference comparison would
    // report every refresh as a change and the guard would never fire.
    expect(valueEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(valueEqual(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(valueEqual(['a'], ['a', 'b'])).toBe(false);
    expect(valueEqual([], [])).toBe(true);
  });

  it('compares embedded objects structurally', () => {
    // `originalPost` on a repost is rebuilt each fetch.
    expect(valueEqual({ id: '1', content: 'x' }, { id: '1', content: 'x' })).toBe(true);
    expect(valueEqual({ id: '1', content: 'x' }, { id: '1', content: 'y' })).toBe(false);
  });

  it('treats an added or removed key as a difference', () => {
    expect(valueEqual({ id: '1' }, { id: '1', extra: 1 })).toBe(false);
  });

  it('handles a nested array inside an embedded object', () => {
    // originalPost.imageUrls — the shape that a one-level comparison would miss.
    expect(valueEqual({ id: '1', imageUrls: ['a'] }, { id: '1', imageUrls: ['a'] })).toBe(true);
    expect(valueEqual({ id: '1', imageUrls: ['a'] }, { id: '1', imageUrls: ['b'] })).toBe(false);
  });

  it('reports NOT equal rather than equal when it runs out of depth', () => {
    // Guessing "equal" past the depth limit is the failure mode that loses data, so
    // the fallback must be the safe direction.
    const deep = (n: number): unknown => (n === 0 ? 'leaf' : { next: deep(n - 1) });
    expect(valueEqual(deep(6), deep(6))).toBe(false);
  });

  it('does not treat an array and an object as equal', () => {
    expect(valueEqual([], {})).toBe(false);
  });
});

describe('rowEqualIgnoring / postsEqual', () => {
  it('treats structurally identical posts as equal', () => {
    expect(postsEqual([post()], [post()])).toBe(true);
  });

  /**
   * The exclusion that makes the guard useful. `isLiked` / `isBookmarked` are
   * optimistic local state and the server returns them as `false`; counting them
   * would mean the guard never fires.
   */
  it('ignores optimistic local state', () => {
    expect(postsEqual([post({ isLiked: true })], [post({ isLiked: false })])).toBe(true);
    expect(postsEqual([post({ isBookmarked: true })], [post({ isBookmarked: false })])).toBe(true);
  });

  it('ignores nothing else', () => {
    expect(POST_VOLATILE_FIELDS.size).toBe(2);
  });

  /**
   * THE REGRESSION TEST.
   *
   * Every one of these fields was missing from the original allowlist, so an update
   * that changed only that field was silently dropped. Each must break equality.
   */
  it.each([
    ['imageUrls', { imageUrls: ['https://a.jpg'] }],
    ['imageUrls reordered', { imageUrls: ['b', 'a'] }],
    ['isSpoilerImage', { isSpoilerImage: true }],
    ['isRepost', { isRepost: true }],
    ['originalPost', { originalPost: { id: 'o1', authorName: 'X', authorUsername: 'x', content: 'c' } }],
    ['authorVerified', { authorVerified: true }],
    ['authorBadge', { authorBadge: 'admin' }],
    ['authorAvatar', { authorAvatar: 'https://av.png' }],
    ['authorId', { authorId: 'other' }],
    ['content', { content: 'changed' }],
    ['likesCount', { likesCount: 5 }],
    ['createdAt', { createdAt: '2027-01-01T00:00:00Z' }],
  ])('detects a change in %s', (_label, change) => {
    const base = post({ imageUrls: ['a'] });
    expect(postsEqual([base], [post({ imageUrls: ['a'], ...change })])).toBe(false);
  });

  it('detects a resolved originalPost on an existing repost', () => {
    // The exact reported symptom: the embed never appeared because this update was
    // swallowed.
    const before = post({ isRepost: true, originalPost: undefined });
    const after = post({
      isRepost: true,
      originalPost: { id: 'o1', authorName: 'X', authorUsername: 'x', content: 'quoted' },
    });
    expect(postsEqual([before], [after])).toBe(false);
  });

  it('detects a field appearing that was previously absent', () => {
    expect(postsEqual([post()], [post({ someNewFieldAddedLater: 1 })])).toBe(false);
  });
});

describe('listEqualIgnoring', () => {
  it('short-circuits on reference identity', () => {
    const xs = [post()];
    expect(postsEqual(xs, xs)).toBe(true);
  });

  it('is false on a length change', () => {
    expect(postsEqual([post()], [post(), post({ id: 'p2' })])).toBe(false);
  });

  it('is false when an item is removed — deletions must land', () => {
    // "I delete messages and they come back" is what a swallowed removal looks like.
    expect(postsEqual([post({ id: 'p1' }), post({ id: 'p2' })], [post({ id: 'p1' })])).toBe(false);
    expect(postsEqual([post({ id: 'p1' })], [])).toBe(false);
  });

  it('is order-sensitive', () => {
    const a = [post({ id: 'p1' }), post({ id: 'p2' })];
    const b = [post({ id: 'p2' }), post({ id: 'p1' })];
    expect(postsEqual(a, b)).toBe(false);
  });

  it('handles empty, null and undefined without throwing', () => {
    expect(postsEqual([], [])).toBe(true);
    expect(postsEqual(null, null)).toBe(true);
    expect(postsEqual(undefined, undefined)).toBe(true);
    expect(postsEqual(null, [])).toBe(false);
    expect(postsEqual([], undefined)).toBe(false);
  });

  it('compares every conversation field', () => {
    const conv = (over: Record<string, unknown> = {}) => ({
      id: 'c1',
      participantId: 'u1',
      participantName: 'N',
      lastMessage: 'hi',
      lastMessageAt: '2026-01-01T00:00:00Z',
      ...over,
    });
    expect(conversationsEqual([conv()], [conv()])).toBe(true);
    expect(conversationsEqual([conv()], [conv({ lastMessage: 'bye' })])).toBe(false);
    expect(conversationsEqual([conv()], [conv({ unreadCount: 3 })])).toBe(false);
  });

  /**
   * The safety property, stated generally: if ANY non-ignored field differs anywhere
   * in the list, the lists must not be reported equal. This is what stops data being
   * swallowed regardless of which field a future change touches.
   */
  it('never reports equal when any non-ignored field differs', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 3 }),
            content: fc.string({ maxLength: 5 }),
            tags: fc.array(fc.string({ maxLength: 2 }), { maxLength: 3 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        fc.nat(),
        fc.constantFrom('id', 'content', 'tags'),
        (rows, idxRaw, field) => {
          const idx = idxRaw % rows.length;
          const mutated = rows.map((r, i) => {
            if (i !== idx) return r;
            if (field === 'tags') return { ...r, tags: [...r.tags, 'NEW'] };
            return { ...r, [field]: `${r[field as 'id' | 'content']}#` };
          });
          expect(listEqualIgnoring(rows, mutated, new Set())).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('is symmetric and reflexive', () => {
    const arb = fc.array(
      fc.record({ id: fc.string({ minLength: 1, maxLength: 3 }), n: fc.nat({ max: 4 }) }),
      { maxLength: 5 },
    );
    fc.assert(
      fc.property(arb, arb, (a, b) => {
        expect(listEqualIgnoring(a, a, new Set())).toBe(true);
        expect(listEqualIgnoring(a, b, new Set())).toBe(listEqualIgnoring(b, a, new Set()));
      }),
      { numRuns: 200 },
    );
  });

  it('ignoring a field means only that field is ignored', () => {
    const a = [{ id: '1', keep: 'x', drop: 1 }];
    const b = [{ id: '1', keep: 'x', drop: 2 }];
    const c = [{ id: '1', keep: 'y', drop: 1 }];
    expect(listEqualIgnoring(a, b, new Set(['drop']))).toBe(true);
    expect(listEqualIgnoring(a, c, new Set(['drop']))).toBe(false);
  });
});

describe('rowEqualIgnoring direct', () => {
  it('is reflexive', () => {
    const p = post();
    expect(rowEqualIgnoring(p, p, POST_VOLATILE_FIELDS)).toBe(true);
  });
});
