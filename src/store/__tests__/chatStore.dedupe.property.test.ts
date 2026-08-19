// Property-based tests for message deduplication across the TWO message identities.
//
// Library: fast-check (repo convention).
//
// Convention: each property test is tagged with
//   // Property {N}: {short description}
// and runs with at least 100 iterations: fc.assert(prop, { numRuns: 100 }).
//
// WHY THIS EXISTS
// A message can be known by two ids: the stable local `id` a row keeps for its whole
// life (`m-<timestamp>` for an optimistic send) and the server's uuid, recorded in
// `serverId`. The local id is deliberately NOT overwritten when the server replies,
// because `id` is the list's React key and rewriting it remounts a mounted row —
// which re-measures the newest bubble with autoscroll armed and nudges the viewport
// on every send.
//
// The cost of that decision is that deduplication can no longer be a single `===`.
// Two copies of the same logical message may arrive with the ids swapped between the
// `id` and `serverId` fields depending on which path produced them (optimistic send,
// realtime echo, history fetch, cache merge). If the predicate misses ANY of those
// combinations the user sees the message twice — the duplication bug this codebase
// has fought before. So every combination is pinned here.

import fc from 'fast-check';
import { useChatStore, isSameMessage } from '../chatStore';
import type { ChatMessage, Conversation } from '../../types';

const CONV = 'conv-1';

function conversation(): Conversation {
  return {
    id: CONV,
    participantId: 'u-1',
    participantName: 'Ann',
    participantUsername: 'ann',
    participantEmoji: '😀',
    lastMessage: '',
    lastMessageAt: '',
    unreadCount: 0,
  };
}

function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm-1',
    conversationId: CONV,
    senderId: 'u-me',
    text: 'hi',
    createdAt: '2026-01-01T00:00:00.000Z',
    isRead: true,
    ...over,
  };
}

beforeEach(() => {
  useChatStore.setState({ conversations: [conversation()], messages: {}, isLoading: false });
});

describe('isSameMessage', () => {
  // Property 1: the four ways two copies of one message can match
  it('matches on every combination of local id and server id', () => {
    const local = message({ id: 'm-1', serverId: 'uuid-1' });

    // Same local id.
    expect(isSameMessage([local], message({ id: 'm-1' }))).toBe(true);
    // Incoming copy keyed by the SERVER uuid (the realtime echo / history fetch).
    expect(isSameMessage([local], message({ id: 'uuid-1' }))).toBe(true);
    // Incoming copy carrying the LOCAL id as its serverId (a cache round-trip).
    expect(isSameMessage([local], message({ id: 'other', serverId: 'm-1' }))).toBe(true);
    // Two server-keyed copies.
    expect(isSameMessage([local], message({ id: 'other', serverId: 'uuid-1' }))).toBe(true);
  });

  // Property 2: genuinely different messages never match
  it('does not match unrelated messages', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^m-[a-z0-9]{4,10}$/),
        fc.stringMatching(/^m-[a-z0-9]{4,10}$/),
        fc.stringMatching(/^u-[a-z0-9]{4,10}$/),
        fc.stringMatching(/^u-[a-z0-9]{4,10}$/),
        (idA, idB, srvA, srvB) => {
          fc.pre(new Set([idA, idB, srvA, srvB]).size === 4);
          const list = [message({ id: idA, serverId: srvA })];
          expect(isSameMessage(list, message({ id: idB, serverId: srvB }))).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 3: an empty list never matches
  it('returns false against an empty list', () => {
    expect(isSameMessage([], message())).toBe(false);
  });

  // Property 4: a missing serverId must not match another missing serverId.
  // `undefined === undefined` is true, so a naive implementation would collapse every
  // message that has no server id into one — catastrophic.
  it('does not treat two absent serverIds as a match', () => {
    const list = [message({ id: 'm-1' })];
    expect(isSameMessage(list, message({ id: 'm-2' }))).toBe(false);
  });
});

describe('addMessage deduplication', () => {
  // Property 5: the realtime echo of a message we already sent is dropped
  it('drops an echo that arrives keyed by the server uuid', () => {
    const { addMessage, setMessages } = useChatStore.getState();
    setMessages(CONV, [message({ id: 'm-1', serverId: 'uuid-1' })]);
    addMessage(CONV, message({ id: 'uuid-1', text: 'hi' }));
    expect(useChatStore.getState().messages[CONV]).toHaveLength(1);
    // And the local row is untouched, so its React key never changed.
    expect(useChatStore.getState().messages[CONV][0].id).toBe('m-1');
  });

  // Property 6: an echo that arrives BEFORE the server id is recorded still dedupes
  // once the server copy comes back the other way round
  it('drops a local copy when the server-keyed one is already present', () => {
    const { addMessage, setMessages } = useChatStore.getState();
    setMessages(CONV, [message({ id: 'uuid-1' })]);
    addMessage(CONV, message({ id: 'm-1', serverId: 'uuid-1' }));
    expect(useChatStore.getState().messages[CONV]).toHaveLength(1);
  });

  // Property 7: any number of repeated adds of the same message stay at one row
  it('never grows past one row for repeated adds of the same message', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (times) => {
        useChatStore.setState({ conversations: [conversation()], messages: {} });
        const { addMessage } = useChatStore.getState();
        addMessage(CONV, message({ id: 'm-1', serverId: 'uuid-1' }));
        for (let i = 0; i < times; i++) {
          // Alternate which identity the incoming copy is keyed by.
          addMessage(CONV, message({ id: i % 2 === 0 ? 'uuid-1' : 'm-1' }));
        }
        expect(useChatStore.getState().messages[CONV]).toHaveLength(1);
      }),
      { numRuns: 100 },
    );
  });

  // Property 8: distinct messages are all kept, in arrival order
  it('appends genuinely distinct messages in order', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), (count) => {
        useChatStore.setState({ conversations: [conversation()], messages: {} });
        const { addMessage } = useChatStore.getState();
        for (let i = 0; i < count; i++) {
          addMessage(
            CONV,
            message({
              id: `m-${i}`,
              serverId: `uuid-${i}`,
              createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
            }),
          );
        }
        const list = useChatStore.getState().messages[CONV];
        expect(list).toHaveLength(count);
        expect(list.map((m) => m.id)).toEqual(Array.from({ length: count }, (_, i) => `m-${i}`));
      }),
      { numRuns: 100 },
    );
  });
});
