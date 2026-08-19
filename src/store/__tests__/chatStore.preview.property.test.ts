// Property-based tests for the chat-list preview kept in step by
// `chatStore.addMessage`.
//
// Library: fast-check (repo convention).
//
// Convention: each property test is tagged with
//   // Property {N}: {short description}
// and runs with at least 100 iterations: fc.assert(prop, { numRuns: 100 }).
//
// WHY THIS EXISTS
// `addMessage` is the single choke point every message addition flows through
// (optimistic send, realtime echo, canonical-id reconcile, cache merge), so the
// conversation row's `lastMessage` / `lastMessageAt` are advanced there. The rules
// are easy to break by accident and invisible when broken, so they are pinned:
//
//   1. the preview never moves BACKWARDS in time;
//   2. an unknown conversation id is never invented as a row;
//   3. `conversations` keeps its EXACT array identity when nothing changed —
//      the chat list subscribes to it, so allocating a new array per message
//      would re-render every row for nothing.

import fc from 'fast-check';
import { useChatStore } from '../chatStore';
import type { ChatMessage, Conversation } from '../../types';

const CONV = 'conv-1';

function conversation(over: Partial<Conversation> = {}): Conversation {
  return {
    id: CONV,
    participantId: 'u-1',
    participantName: 'Ann',
    participantUsername: 'ann',
    participantEmoji: '😀',
    lastMessage: '',
    lastMessageAt: '',
    unreadCount: 0,
    ...over,
  };
}

let msgSeq = 0;
function message(text: string, createdAt: string): ChatMessage {
  msgSeq += 1;
  return {
    id: `m-${msgSeq}`,
    conversationId: CONV,
    senderId: 'u-1',
    text,
    createdAt,
    isRead: false,
  };
}

function reset(conversations: Conversation[] = [conversation()]) {
  useChatStore.setState({ conversations, messages: {}, isLoading: false });
}

const iso = (ms: number) => new Date(ms).toISOString();

describe('chatStore.addMessage — chat-list preview', () => {
  beforeEach(() => {
    msgSeq = 0;
    reset();
  });

  it('advances the preview text and timestamp of the matching row', () => {
    useChatStore.getState().addMessage(CONV, message('hello', iso(1_000)));

    const row = useChatStore.getState().conversations[0];
    expect(row.lastMessage).toBe('hello');
    expect(row.lastMessageAt).toBe(iso(1_000));
  });

  it('leaves the text empty for a photo-only message but still advances the time', () => {
    // The store must not localize — the row renders its own "Photo" label off the
    // timestamp. Keeping the text empty is what makes that possible.
    useChatStore.getState().addMessage(CONV, message('', iso(2_000)));

    const row = useChatStore.getState().conversations[0];
    expect(row.lastMessage).toBe('');
    expect(row.lastMessageAt).toBe(iso(2_000));
  });

  it('never invents a row for an unknown conversation', () => {
    const before = useChatStore.getState().conversations;
    useChatStore.getState().addMessage('does-not-exist', message('x', iso(3_000)));

    const after = useChatStore.getState().conversations;
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(CONV);
    // Array identity preserved — nothing changed, so the list must not re-render.
    expect(after).toBe(before);
  });

  it('keeps the array identity when the incoming message is older', () => {
    useChatStore.getState().addMessage(CONV, message('newer', iso(5_000)));
    const afterNewer = useChatStore.getState().conversations;

    useChatStore.getState().addMessage(CONV, message('older', iso(4_000)));
    const afterOlder = useChatStore.getState().conversations;

    expect(afterOlder).toBe(afterNewer);
    expect(afterOlder[0].lastMessage).toBe('newer');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Property 1: the preview always ends on the NEWEST message, whatever order
  // the messages arrive in.
  it('Property 1: preview settles on the newest message regardless of arrival order', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 100_000 }), { minLength: 1, maxLength: 12 }),
        (stamps) => {
          reset();
          msgSeq = 0;

          stamps.forEach((ms) => {
            useChatStore.getState().addMessage(CONV, message(`t-${ms}`, iso(ms)));
          });

          const newest = Math.max(...stamps);
          const row = useChatStore.getState().conversations[0];
          expect(row.lastMessageAt).toBe(iso(newest));
          expect(row.lastMessage).toBe(`t-${newest}`);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 2: the preview timestamp is monotonically non-decreasing across the
  // whole sequence — it can never be observed going backwards.
  it('Property 2: preview timestamp never decreases', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100_000 }), { minLength: 2, maxLength: 15 }),
        (stamps) => {
          reset();
          msgSeq = 0;

          let prev = '';
          stamps.forEach((ms) => {
            useChatStore.getState().addMessage(CONV, message('x', iso(ms)));
            const at = useChatStore.getState().conversations[0].lastMessageAt || '';
            expect(at >= prev).toBe(true);
            prev = at;
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 3: rows other than the target are untouched, by value and identity.
  it('Property 3: only the target row is replaced; siblings keep their identity', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (ms) => {
        const other = conversation({ id: 'conv-2', participantId: 'u-2', participantName: 'Bob' });
        reset([conversation(), other]);
        msgSeq = 0;

        useChatStore.getState().addMessage(CONV, message('hi', iso(ms)));

        const after = useChatStore.getState().conversations;
        expect(after).toHaveLength(2);
        // Same object, not a copy — sibling rows must not re-render.
        expect(after[1]).toBe(other);
        expect(after[0].lastMessageAt).toBe(iso(ms));
      }),
      { numRuns: 100 },
    );
  });

  it('does not duplicate a message, and a duplicate does not disturb the preview', () => {
    const m = message('once', iso(9_000));
    useChatStore.getState().addMessage(CONV, m);
    const afterFirst = useChatStore.getState().conversations;

    useChatStore.getState().addMessage(CONV, m);

    expect(useChatStore.getState().messages[CONV]).toHaveLength(1);
    // The dedupe guard returns the untouched state, so identity holds here too.
    expect(useChatStore.getState().conversations).toBe(afterFirst);
  });
});
