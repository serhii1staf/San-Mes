// Property-based tests for the per-conversation pinned-message store.
//
// Library: fast-check (repo convention).
//
// Convention: each property test is tagged with
//   // Property {N}: {short description}
// and runs with at least 100 iterations: fc.assert(prop, { numRuns: 100 }).
//
// WHY THIS EXISTS
// A pin is a small piece of state with several rules that are silent when broken:
//
//   1. at most ONE pin per conversation, and conversations never leak into each
//      other (pinning in chat A must not touch chat B);
//   2. `toggle` on the already-pinned id UNPINS — the same control does both, so a
//      regression here makes the button feel dead;
//   3. re-pinning the SAME id returns the identical state object, so no subscriber
//      re-renders for a no-op;
//   4. `resolvePinned` never returns a stale message: an id that is no longer in
//      the transcript resolves to null (the bar disappears) while the stored pin is
//      left alone, because a message outside the bounded in-memory window can come
//      back when older history is hydrated.

import fc from 'fast-check';
import { usePinnedMessagesStore, resolvePinned, selectPinnedId } from '../pinnedMessagesStore';

// The store persists through kvStore. MMKV is unavailable under jest, so the real
// module already degrades to a no-op write path — no mock needed, but we reset the
// in-memory state between tests so runs are independent.
beforeEach(() => {
  usePinnedMessagesStore.setState({ pinned: {} });
});

const convId = () => fc.stringMatching(/^c-[a-z0-9]{1,8}$/);
const msgId = () => fc.stringMatching(/^m-[a-z0-9]{1,8}$/);

describe('pinnedMessagesStore', () => {
  // Property 1: at most one pin per conversation, and pins never cross conversations
  it('keeps exactly one pin per conversation and never leaks across conversations', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(convId(), msgId()), { minLength: 1, maxLength: 30 }), (ops) => {
        usePinnedMessagesStore.setState({ pinned: {} });
        const expected = new Map<string, string>();
        for (const [c, m] of ops) {
          usePinnedMessagesStore.getState().pin(c, m);
          expected.set(c, m);
        }
        const { pinned } = usePinnedMessagesStore.getState();
        expect(Object.keys(pinned).sort()).toEqual([...expected.keys()].sort());
        for (const [c, m] of expected) expect(pinned[c]).toBe(m);
      }),
      { numRuns: 100 },
    );
  });

  // Property 2: toggle is its own inverse for the same id
  it('toggling the same message twice leaves nothing pinned', () => {
    fc.assert(
      fc.property(convId(), msgId(), (c, m) => {
        usePinnedMessagesStore.setState({ pinned: {} });
        const { toggle } = usePinnedMessagesStore.getState();
        toggle(c, m);
        expect(usePinnedMessagesStore.getState().pinned[c]).toBe(m);
        toggle(c, m);
        expect(usePinnedMessagesStore.getState().pinned[c]).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  // Property 3: toggling a DIFFERENT id replaces the pin rather than adding one
  it('toggling a different message replaces the conversation pin', () => {
    fc.assert(
      fc.property(convId(), msgId(), msgId(), (c, a, b) => {
        fc.pre(a !== b);
        usePinnedMessagesStore.setState({ pinned: {} });
        const { toggle } = usePinnedMessagesStore.getState();
        toggle(c, a);
        toggle(c, b);
        expect(usePinnedMessagesStore.getState().pinned[c]).toBe(b);
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
  it('unpinning an unpinned conversation does not allocate new state', () => {
    fc.assert(
      fc.property(convId(), (c) => {
        usePinnedMessagesStore.setState({ pinned: {} });
        const before = usePinnedMessagesStore.getState().pinned;
        usePinnedMessagesStore.getState().unpin(c);
        expect(usePinnedMessagesStore.getState().pinned).toBe(before);
      }),
      { numRuns: 100 },
    );
  });

  // Property 6: empty ids are rejected outright
  it('ignores empty conversation or message ids', () => {
    const { pin, toggle } = usePinnedMessagesStore.getState();
    pin('', 'm-1');
    pin('c-1', '');
    toggle('', 'm-1');
    toggle('c-1', '');
    expect(usePinnedMessagesStore.getState().pinned).toEqual({});
  });

  // Property 7: selectPinnedId mirrors the map, and misses read as undefined
  it('selectPinnedId returns the stored id or undefined', () => {
    fc.assert(
      fc.property(convId(), msgId(), convId(), (c, m, other) => {
        fc.pre(c !== other);
        usePinnedMessagesStore.setState({ pinned: {} });
        usePinnedMessagesStore.getState().pin(c, m);
        const state = usePinnedMessagesStore.getState();
        expect(selectPinnedId(c)(state)).toBe(m);
        expect(selectPinnedId(other)(state)).toBeUndefined();
        expect(selectPinnedId(undefined)(state)).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});

describe('resolvePinned', () => {
  // Property 8: resolves to the message AND its index whenever the id is present
  it('returns the matching message with its index', () => {
    fc.assert(
      fc.property(
        fc.array(msgId(), { minLength: 1, maxLength: 20 }).map((ids) => Array.from(new Set(ids))),
        fc.nat(),
        (ids, pick) => {
          const messages = ids.map((id) => ({ id }));
          const index = pick % messages.length;
          const got = resolvePinned(messages, messages[index].id);
          expect(got).not.toBeNull();
          expect(got!.index).toBe(index);
          expect(got!.message.id).toBe(messages[index].id);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 9: an id outside the transcript resolves to null — never a stale row
  it('returns null for an id that is not in the transcript', () => {
    fc.assert(
      fc.property(fc.array(msgId(), { maxLength: 20 }), msgId(), (ids, missing) => {
        fc.pre(!ids.includes(missing));
        expect(resolvePinned(ids.map((id) => ({ id })), missing)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  // Property 10: degenerate inputs resolve to null instead of throwing
  it('handles undefined transcripts and undefined ids', () => {
    expect(resolvePinned(undefined, 'm-1')).toBeNull();
    expect(resolvePinned([], 'm-1')).toBeNull();
    expect(resolvePinned([{ id: 'm-1' }], undefined)).toBeNull();
  });
});
