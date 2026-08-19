// Property-based tests for the per-conversation pinned-message store.
//
// Library: fast-check (repo convention).
//
// Convention: each property test is tagged with
//   // Property {N}: {short description}
// and runs with at least 100 iterations: fc.assert(prop, { numRuns: 100 }).
//
// WHY THIS EXISTS
// Pins are small state with several rules that are silent when broken:
//
//   1. conversations never leak into each other (pinning in chat A must not touch
//      chat B), and a message is never pinned twice;
//   2. `toggle` on an already-pinned id UNPINS — the same control does both, so a
//      regression here makes the button feel dead;
//   3. a redundant pin returns the identical state object, so no subscriber
//      re-renders for a no-op;
//   4. the per-conversation cap holds, dropping the OLDEST pin;
//   5. `resolvePinned` never returns a stale message: ids no longer in the
//      transcript are skipped (the bar shows one fewer pin) while the stored pin is
//      left alone, because a message outside the bounded in-memory window can come
//      back when older history is hydrated;
//   6. `resolvePinned` returns pins in TRANSCRIPT order, not pin order, so paging
//      through them moves the viewport in one direction.

import fc from 'fast-check';
import { usePinnedMessagesStore, resolvePinned, selectPinnedIds } from '../pinnedMessagesStore';

// The store persists through kvStore. MMKV is unavailable under jest, so the real
// module already degrades to a no-op write path — no mock needed, but we reset the
// in-memory state between tests so runs are independent.
beforeEach(() => {
  usePinnedMessagesStore.setState({ pinned: {} });
});

const convId = () => fc.stringMatching(/^c-[a-z0-9]{1,8}$/);
const msgId = () => fc.stringMatching(/^m-[a-z0-9]{1,8}$/);

describe('pinnedMessagesStore', () => {
  // Property 1: pins accumulate per conversation, deduped, and never cross over
  it('accumulates deduped pins per conversation without leaking across them', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(convId(), msgId()), { minLength: 1, maxLength: 30 }), (ops) => {
        usePinnedMessagesStore.setState({ pinned: {} });
        const expected = new Map<string, string[]>();
        for (const [c, m] of ops) {
          usePinnedMessagesStore.getState().pin(c, m);
          const list = expected.get(c) ?? [];
          if (!list.includes(m)) list.push(m);
          expected.set(c, list);
        }
        const { pinned } = usePinnedMessagesStore.getState();
        expect(Object.keys(pinned).sort()).toEqual([...expected.keys()].sort());
        for (const [c, ids] of expected) expect(pinned[c]).toEqual(ids);
      }),
      { numRuns: 100 },
    );
  });

  // Property 2: toggle is its own inverse for the same id
  it('toggling the same message twice leaves it unpinned', () => {
    fc.assert(
      fc.property(convId(), msgId(), (c, m) => {
        usePinnedMessagesStore.setState({ pinned: {} });
        const { toggle } = usePinnedMessagesStore.getState();
        toggle(c, m);
        expect(usePinnedMessagesStore.getState().pinned[c]).toEqual([m]);
        toggle(c, m);
        expect(usePinnedMessagesStore.getState().pinned[c]).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  // Property 3: a second, different id is ADDED — not a replacement
  it('pinning a different message keeps the earlier pin', () => {
    fc.assert(
      fc.property(convId(), msgId(), msgId(), (c, a, b) => {
        fc.pre(a !== b);
        usePinnedMessagesStore.setState({ pinned: {} });
        const { toggle } = usePinnedMessagesStore.getState();
        toggle(c, a);
        toggle(c, b);
        expect(usePinnedMessagesStore.getState().pinned[c]).toEqual([a, b]);
      }),
      { numRuns: 100 },
    );
  });

  // Property 4: a redundant pin is a true no-op (identical state reference)
  it('re-pinning the same id does not allocate new state', () => {
    fc.assert(
      fc.property(convId(), msgId(), (c, m) => {
        usePinnedMessagesStore.setState({ pinned: {} });
        usePinnedMessagesStore.getState().pin(c, m);
        const before = usePinnedMessagesStore.getState().pinned;
        usePinnedMessagesStore.getState().pin(c, m);
        expect(usePinnedMessagesStore.getState().pinned).toBe(before);
      }),
      { numRuns: 100 },
    );
  });

  // Property 5: unpinning something that is not pinned is a no-op
  it('unpinning an unpinned message does not allocate new state', () => {
    fc.assert(
      fc.property(convId(), msgId(), (c, m) => {
        usePinnedMessagesStore.setState({ pinned: {} });
        const before = usePinnedMessagesStore.getState().pinned;
        usePinnedMessagesStore.getState().unpin(c, m);
        expect(usePinnedMessagesStore.getState().pinned).toBe(before);
      }),
      { numRuns: 100 },
    );
  });

  // Property 6: the cap holds, and it is the OLDEST pin that goes
  it('caps pins per conversation, dropping the oldest', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `m-${i}`);
    const { pin } = usePinnedMessagesStore.getState();
    for (const idValue of ids) pin('c-1', idValue);
    const stored = usePinnedMessagesStore.getState().pinned['c-1'];
    expect(stored).toHaveLength(20);
    expect(stored).toEqual(ids.slice(5));
  });

  // Property 7: unpinAll clears only the target conversation
  it('unpinAll clears one conversation and leaves others alone', () => {
    const { pin, unpinAll } = usePinnedMessagesStore.getState();
    pin('c-1', 'm-1');
    pin('c-2', 'm-2');
    unpinAll('c-1');
    const { pinned } = usePinnedMessagesStore.getState();
    expect(pinned['c-1']).toBeUndefined();
    expect(pinned['c-2']).toEqual(['m-2']);
  });

  // Property 8: empty ids are rejected outright
  it('ignores empty conversation or message ids', () => {
    const { pin, toggle } = usePinnedMessagesStore.getState();
    pin('', 'm-1');
    pin('c-1', '');
    toggle('', 'm-1');
    toggle('c-1', '');
    expect(usePinnedMessagesStore.getState().pinned).toEqual({});
  });

  // Property 9: selectPinnedIds mirrors the map and returns a STABLE empty array
  it('selectPinnedIds returns stored ids, or the same empty array on a miss', () => {
    fc.assert(
      fc.property(convId(), msgId(), convId(), (c, m, other) => {
        fc.pre(c !== other);
        usePinnedMessagesStore.setState({ pinned: {} });
        usePinnedMessagesStore.getState().pin(c, m);
        const state = usePinnedMessagesStore.getState();
        expect(selectPinnedIds(c)(state)).toEqual([m]);
        // Reference equality on the miss path matters: a fresh `[]` each call would
        // make zustand re-render the chat screen on every unrelated store update.
        expect(selectPinnedIds(other)(state)).toBe(selectPinnedIds(undefined)(state));
      }),
      { numRuns: 100 },
    );
  });
});

describe('resolvePinned', () => {
  // Property 10: resolves each present id with its transcript index
  it('returns matching messages with their indices', () => {
    fc.assert(
      fc.property(
        fc.array(msgId(), { minLength: 1, maxLength: 20 }).map((ids) => Array.from(new Set(ids))),
        fc.nat(),
        (ids, pick) => {
          const messages = ids.map((id) => ({ id }));
          const index = pick % messages.length;
          const got = resolvePinned(messages, [messages[index].id]);
          expect(got).toHaveLength(1);
          expect(got[0].index).toBe(index);
          expect(got[0].message.id).toBe(messages[index].id);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 11: output is in TRANSCRIPT order regardless of pin order
  it('orders results by transcript position, not pin order', () => {
    const messages = ['m-a', 'm-b', 'm-c', 'm-d'].map((id) => ({ id }));
    const got = resolvePinned(messages, ['m-d', 'm-b']);
    expect(got.map((r) => r.message.id)).toEqual(['m-b', 'm-d']);
    expect(got.map((r) => r.index)).toEqual([1, 3]);
  });

  // Property 12: ids outside the transcript are SKIPPED — never a stale row
  it('skips ids that are not in the transcript', () => {
    fc.assert(
      fc.property(fc.array(msgId(), { maxLength: 20 }), msgId(), (ids, missing) => {
        fc.pre(!ids.includes(missing));
        const unique = Array.from(new Set(ids));
        const got = resolvePinned(unique.map((id) => ({ id })), [missing]);
        expect(got).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  // Property 13: degenerate inputs resolve to an empty list instead of throwing
  it('handles undefined transcripts and empty pin lists', () => {
    expect(resolvePinned(undefined, ['m-1'])).toEqual([]);
    expect(resolvePinned([], ['m-1'])).toEqual([]);
    expect(resolvePinned([{ id: 'm-1' }], undefined)).toEqual([]);
    expect(resolvePinned([{ id: 'm-1' }], [])).toEqual([]);
  });
});
