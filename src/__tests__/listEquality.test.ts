/**
 * Guards the store-level bail-out that stops screens blinking.
 *
 * The risk cuts both ways and both directions are tested:
 *   - Too eager → a real change is swallowed and the UI shows stale data. That is
 *     worse than a flicker, so every visible field must break equality.
 *   - Too strict → the guard never fires and the blinking comes back.
 */

import fc from 'fast-check';
import {
  CONVERSATION_FIELDS,
  listEqualOn,
  POST_FIELDS,
  rowEqualOn,
} from '../utils/listEquality';

const post = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  content: 'hello',
  imageUrl: undefined as string | undefined,
  likesCount: 0,
  commentsCount: 0,
  sharesCount: 0,
  createdAt: '2026-01-01T00:00:00Z',
  authorName: 'A',
  authorUsername: 'a',
  authorEmoji: '😊',
  isLiked: false,
  isBookmarked: false,
  ...over,
});

const conv = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  participantId: 'u1',
  participantName: 'Name',
  participantUsername: 'name',
  participantEmoji: '😀',
  participantVerified: false,
  participantBadge: null,
  lastMessage: 'hi',
  lastMessageAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('rowEqualOn', () => {
  it('is reflexive and identity-short-circuits', () => {
    const p = post();
    expect(rowEqualOn(p, p, POST_FIELDS)).toBe(true);
  });

  it('treats structurally identical rows as equal', () => {
    expect(rowEqualOn(post(), post(), POST_FIELDS)).toBe(true);
  });

  it('breaks on every listed field', () => {
    // If any of these stopped breaking equality, a real change would be swallowed
    // and the user would see stale content — worse than the flicker being fixed.
    const changes: Record<string, unknown> = {
      id: 'other',
      content: 'changed',
      imageUrl: 'https://img',
      likesCount: 1,
      commentsCount: 1,
      sharesCount: 1,
      createdAt: '2026-02-02T00:00:00Z',
      authorName: 'B',
      authorUsername: 'b',
      authorEmoji: '🙂',
    };
    for (const [field, value] of Object.entries(changes)) {
      expect(rowEqualOn(post(), post({ [field]: value }), POST_FIELDS)).toBe(false);
    }
  });

  /**
   * The single most important exclusion. `isLiked` / `isBookmarked` are optimistic
   * local state and the server returns them as `false`. If they counted, EVERY
   * refresh would look like a change, the guard would never fire, and the blinking
   * would be exactly as bad as before while appearing to be fixed.
   */
  it('ignores optimistic local state', () => {
    expect(rowEqualOn(post({ isLiked: true }), post({ isLiked: false }), POST_FIELDS)).toBe(true);
    expect(
      rowEqualOn(post({ isBookmarked: true }), post({ isBookmarked: false }), POST_FIELDS),
    ).toBe(true);
  });

  it('breaks on every listed conversation field', () => {
    const changes: Record<string, unknown> = {
      id: 'c2',
      participantId: 'u2',
      participantName: 'Other',
      participantUsername: 'other',
      participantEmoji: '😐',
      participantVerified: true,
      participantBadge: 'admin',
      lastMessage: 'bye',
      lastMessageAt: '2026-03-03T00:00:00Z',
    };
    for (const [field, value] of Object.entries(changes)) {
      expect(rowEqualOn(conv(), conv({ [field]: value }), CONVERSATION_FIELDS)).toBe(false);
    }
  });
});

describe('listEqualOn', () => {
  it('short-circuits on reference identity', () => {
    const xs = [post()];
    expect(listEqualOn(xs, xs, POST_FIELDS)).toBe(true);
  });

  it('compares element-wise for distinct arrays with the same content', () => {
    expect(listEqualOn([post(), post({ id: 'p2' })], [post(), post({ id: 'p2' })], POST_FIELDS)).toBe(
      true,
    );
  });

  it('is false on a length change', () => {
    expect(listEqualOn([post()], [post(), post({ id: 'p2' })], POST_FIELDS)).toBe(false);
  });

  /**
   * Order matters. A conversation moving to the top, or a newer post arriving, IS a
   * visible change and must repaint — an order-insensitive comparator would leave
   * the list looking stale.
   */
  it('is order-sensitive', () => {
    const a = [post({ id: 'p1' }), post({ id: 'p2' })];
    const b = [post({ id: 'p2' }), post({ id: 'p1' })];
    expect(listEqualOn(a, b, POST_FIELDS)).toBe(false);
  });

  it('handles empty, null and undefined without throwing', () => {
    expect(listEqualOn([], [], POST_FIELDS)).toBe(true);
    expect(listEqualOn(null, null, POST_FIELDS)).toBe(true);
    expect(listEqualOn(undefined, undefined, POST_FIELDS)).toBe(true);
    expect(listEqualOn(null, [], POST_FIELDS)).toBe(false);
    expect(listEqualOn([], undefined, POST_FIELDS)).toBe(false);
  });

  it('is symmetric and reflexive for any generated pair', () => {
    const arb = fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 4 }),
        content: fc.string({ maxLength: 6 }),
        likesCount: fc.nat({ max: 5 }),
        isLiked: fc.boolean(),
      }),
      { maxLength: 5 },
    );
    fc.assert(
      fc.property(arb, arb, (a, b) => {
        const fields = ['id', 'content', 'likesCount'] as const;
        expect(listEqualOn(a, a, fields)).toBe(true);
        expect(listEqualOn(a, b, fields)).toBe(listEqualOn(b, a, fields));
      }),
      { numRuns: 200 },
    );
  });

  it('never reports equal when a compared field differs anywhere in the list', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ id: fc.string({ minLength: 1, maxLength: 3 }) }), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.nat(),
        (rows, idxRaw) => {
          const idx = idxRaw % rows.length;
          const mutated = rows.map((r, i) => (i === idx ? { id: `${r.id}#` } : r));
          expect(listEqualOn(rows, mutated, ['id'] as const)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});
