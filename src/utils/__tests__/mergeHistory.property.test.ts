/**
 * Property tests for `mergeHistory`.
 *
 * The merge is the load-bearing part of the direct-message read path: it is what lets the
 * client fetch the server's copy of a conversation without duplicating its own optimistic
 * sends or dropping the ones the server has not seen yet. Both failure modes are silent and
 * both are user-visible as "my messages are wrong", so the guarantees are stated as
 * properties rather than as a handful of examples.
 */

import fc from 'fast-check';
import { mergeHistory, knownIds, sortByCreatedAt, MergeableItem } from '../mergeHistory';

interface Msg extends MergeableItem {
  text: string;
}

/** An ISO-8601 timestamp inside a range wide enough to produce plenty of ordering variety. */
const isoArb = fc
  .integer({ min: 1_600_000_000_000, max: 1_800_000_000_000 })
  .map((ms) => new Date(ms).toISOString());

const msgArb = (idPrefix: string) =>
  fc.record({
    id: fc.integer({ min: 0, max: 40 }).map((n) => `${idPrefix}${n}`),
    createdAt: isoArb,
    text: fc.string({ maxLength: 8 }),
  });

/** A local item that has already learned its server uuid — the duplicate-prone shape. */
const optimisticArb = fc.record({
  id: fc.integer({ min: 0, max: 20 }).map((n) => `m-${n}`),
  serverId: fc.integer({ min: 0, max: 20 }).map((n) => `srv-${n}`),
  createdAt: isoArb,
  text: fc.string({ maxLength: 8 }),
});

const dedupeById = <T extends MergeableItem>(items: T[]): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const i of items) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    out.push(i);
  }
  return out;
};

describe('mergeHistory', () => {
  it('is ADDITIVE: every local item survives, by reference', () => {
    fc.assert(
      fc.property(fc.array(msgArb('l'), { maxLength: 25 }), fc.array(msgArb('r'), { maxLength: 25 }), (l, r) => {
        const local = dedupeById(l as Msg[]);
        const merged = mergeHistory<Msg>(local, r as Msg[]);
        for (const item of local) {
          expect(merged).toContain(item); // identity, not deep equality
        }
      }),
      { numRuns: 200 },
    );
  });

  it('never produces a duplicate id', () => {
    fc.assert(
      fc.property(fc.array(msgArb('x'), { maxLength: 30 }), fc.array(msgArb('x'), { maxLength: 30 }), (l, r) => {
        const local = dedupeById(l as Msg[]);
        const merged = mergeHistory<Msg>(local, r as Msg[]);
        const ids = merged.map((m) => m.id);
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 200 },
    );
  });

  it('does not re-add a remote row that a local row already claims via serverId', () => {
    fc.assert(
      fc.property(fc.array(optimisticArb, { maxLength: 20 }), (rawLocal) => {
        const local = dedupeById(rawLocal as Msg[]);
        // The server's view of those same messages: keyed by the SERVER uuid only.
        const remote: Msg[] = local.map((m) => ({
          id: m.serverId as string,
          createdAt: m.createdAt,
          text: m.text,
        }));
        const merged = mergeHistory<Msg>(local, remote);
        // Nothing was new, so the merge must be a strict no-op — same array reference.
        expect(merged).toBe(local);
      }),
      { numRuns: 200 },
    );
  });

  it('is IDEMPOTENT: merging the same remote array twice changes nothing', () => {
    fc.assert(
      fc.property(fc.array(msgArb('l'), { maxLength: 25 }), fc.array(msgArb('r'), { maxLength: 25 }), (l, r) => {
        const local = dedupeById(l as Msg[]);
        const once = mergeHistory<Msg>(local, r as Msg[]);
        const twice = mergeHistory<Msg>(once, r as Msg[]);
        expect(twice).toBe(once);
      }),
      { numRuns: 200 },
    );
  });

  it('returns the SAME array reference when there is nothing to add', () => {
    fc.assert(
      fc.property(fc.array(msgArb('l'), { maxLength: 20 }), (l) => {
        const local = dedupeById(l as Msg[]);
        expect(mergeHistory<Msg>(local, [])).toBe(local);
        expect(mergeHistory<Msg>(local, local)).toBe(local);
      }),
      { numRuns: 100 },
    );
  });

  // The sortedness guarantee is conditional, and the first version of this test got it wrong
  // by asserting it unconditionally. fast-check produced the counterexample in 16 runs:
  //
  //     local  = [ l0 @ ...40.001Z , l1 @ ...40.000Z ]      (out of order)
  //     remote = []
  //
  // With nothing to add, `mergeHistory` returns `local` BY REFERENCE and does not touch it —
  // which is deliberate: re-ordering an array the caller owns as a side effect of "check for
  // updates" would be a nasty surprise, and the whole point of returning the same reference
  // is to let the caller skip a store write. So the honest property is: the result is either
  // `local` untouched, or a sorted union. Both halves are asserted.
  it('returns either `local` untouched or a chronologically sorted union', () => {
    fc.assert(
      fc.property(fc.array(msgArb('l'), { maxLength: 25 }), fc.array(msgArb('r'), { maxLength: 25 }), (l, r) => {
        const local = dedupeById(l as Msg[]);
        const merged = mergeHistory<Msg>(local, r as Msg[]);
        if (merged === local) return; // untouched — nothing was added, nothing is promised
        for (let i = 1; i < merged.length; i++) {
          const prev = merged[i - 1];
          const cur = merged[i];
          const ordered =
            prev.createdAt < cur.createdAt || (prev.createdAt === cur.createdAt && prev.id <= cur.id);
          expect(ordered).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('leaves `local` unmutated in every case', () => {
    fc.assert(
      fc.property(fc.array(msgArb('l'), { maxLength: 25 }), fc.array(msgArb('r'), { maxLength: 25 }), (l, r) => {
        const local = dedupeById(l as Msg[]);
        const before = [...local];
        mergeHistory<Msg>(local, r as Msg[]);
        // `sortByCreatedAt` sorts in place, so a merge that forgot to copy would reorder the
        // caller's array underneath it.
        expect(local).toStrictEqual(before);
      }),
      { numRuns: 200 },
    );
  });

  it('is DETERMINISTIC: same inputs give an identically ordered result', () => {
    fc.assert(
      fc.property(fc.array(msgArb('l'), { maxLength: 20 }), fc.array(msgArb('r'), { maxLength: 20 }), (l, r) => {
        const local = dedupeById(l as Msg[]);
        const a = mergeHistory<Msg>(local, r as Msg[]).map((m) => m.id);
        const b = mergeHistory<Msg>(local, r as Msg[]).map((m) => m.id);
        expect(a).toStrictEqual(b);
      }),
      { numRuns: 100 },
    );
  });

  it('tolerates a remote array containing the same id twice', () => {
    const local: Msg[] = [];
    const dupe: Msg = { id: 'a', createdAt: '2026-01-01T00:00:00.000Z', text: 'x' };
    const merged = mergeHistory<Msg>(local, [dupe, { ...dupe }]);
    expect(merged.filter((m) => m.id === 'a')).toHaveLength(1);
  });

  it('drops remote rows with no id rather than adding a broken row', () => {
    const merged = mergeHistory<Msg>(
      [],
      [{ id: '', createdAt: '2026-01-01T00:00:00.000Z', text: 'x' } as Msg],
    );
    expect(merged).toHaveLength(0);
  });

  it('handles empty inputs on both sides', () => {
    expect(mergeHistory<Msg>([], [])).toStrictEqual([]);
    const only: Msg[] = [{ id: 'a', createdAt: '2026-01-01T00:00:00.000Z', text: 'x' }];
    expect(mergeHistory<Msg>([], only)).toHaveLength(1);
    expect(mergeHistory<Msg>(only, [])).toBe(only);
  });
});

describe('knownIds', () => {
  it('claims both id and serverId for every item', () => {
    fc.assert(
      fc.property(fc.array(optimisticArb, { maxLength: 20 }), (items) => {
        const ids = knownIds(items as Msg[]);
        for (const i of items) {
          expect(ids.has(i.id)).toBe(true);
          expect(ids.has(i.serverId as string)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('sortByCreatedAt', () => {
  it('orders ISO strings the same way Date comparison would', () => {
    fc.assert(
      fc.property(fc.array(msgArb('s'), { maxLength: 25 }), (items) => {
        const byString = sortByCreatedAt([...(items as Msg[])]).map((m) => m.createdAt);
        const byDate = [...(items as Msg[])]
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          .map((m) => m.createdAt);
        expect(byString).toStrictEqual(byDate);
      }),
      { numRuns: 200 },
    );
  });
});
