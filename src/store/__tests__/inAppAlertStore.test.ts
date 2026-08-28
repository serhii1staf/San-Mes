/**
 * The queue's job is to stay smooth under spam, so these pin the three rules that keep the animation
 * from restarting: coalesce a repeat from the same source, bound the waiting list dropping OLDEST, and
 * advance by content swap.
 */
import { useInAppAlert } from '../inAppAlertStore';

const base = { kind: 'message' as const, emoji: '🙂', name: 'Anna', actorId: 'u1' };

beforeEach(() => {
  useInAppAlert.getState().clear();
});

describe('inAppAlertStore', () => {
  it('shows the first alert immediately', () => {
    useInAppAlert.getState().push(base);
    expect(useInAppAlert.getState().current?.name).toBe('Anna');
    expect(useInAppAlert.getState().current?.repeat).toBe(1);
  });

  it('collapses repeats from the same source into the visible pill instead of queueing', () => {
    const s = useInAppAlert.getState();
    s.push(base);
    s.push(base);
    s.push(base);
    // Ten messages from one person must be ONE pill reading "3 messages", not three animations.
    expect(useInAppAlert.getState().current?.repeat).toBe(3);
    expect(useInAppAlert.getState().pending).toHaveLength(0);
  });

  it('coalesces by name when no actor id is available', () => {
    const s = useInAppAlert.getState();
    s.push({ kind: 'message', emoji: '🙂', name: 'Anna' });
    s.push({ kind: 'message', emoji: '🙂', name: 'Anna' });
    expect(useInAppAlert.getState().current?.repeat).toBe(2);
  });

  it('treats a different kind from the same actor as a separate alert', () => {
    const s = useInAppAlert.getState();
    s.push(base);
    s.push({ ...base, kind: 'like' });
    expect(useInAppAlert.getState().pending).toHaveLength(1);
    expect(useInAppAlert.getState().pending[0].kind).toBe('like');
  });

  it('bumps a waiting entry rather than appending a duplicate', () => {
    const s = useInAppAlert.getState();
    s.push(base);
    s.push({ ...base, kind: 'like' });
    s.push({ ...base, kind: 'like' });
    expect(useInAppAlert.getState().pending).toHaveLength(1);
    expect(useInAppAlert.getState().pending[0].repeat).toBe(2);
  });

  it('bounds the waiting list and drops the OLDEST, keeping what the user has not seen', () => {
    const s = useInAppAlert.getState();
    s.push(base);
    for (const n of ['b', 'c', 'd', 'e']) {
      s.push({ kind: 'message', emoji: '🙂', name: n, actorId: n });
    }
    const pending = useInAppAlert.getState().pending;
    expect(pending).toHaveLength(3);
    expect(pending.map((p) => p.name)).toEqual(['c', 'd', 'e']);
  });

  it('advance promotes the next pending alert, then empties', () => {
    const s = useInAppAlert.getState();
    s.push(base);
    s.push({ kind: 'comment', emoji: '🙂', name: 'Bob', actorId: 'u2' });
    useInAppAlert.getState().advance();
    expect(useInAppAlert.getState().current?.name).toBe('Bob');
    expect(useInAppAlert.getState().pending).toHaveLength(0);
    useInAppAlert.getState().advance();
    expect(useInAppAlert.getState().current).toBeNull();
  });

  it('gives each distinct alert its own id so the host can key a content swap', () => {
    const s = useInAppAlert.getState();
    s.push(base);
    const firstId = useInAppAlert.getState().current?.id;
    s.push({ kind: 'follow', emoji: '🙂', name: 'Bob', actorId: 'u2' });
    useInAppAlert.getState().advance();
    expect(useInAppAlert.getState().current?.id).not.toBe(firstId);
  });

  it('clear drops everything so nothing is mid-flight after a background trip', () => {
    const s = useInAppAlert.getState();
    s.push(base);
    s.push({ kind: 'like', emoji: '🙂', name: 'Bob', actorId: 'u2' });
    useInAppAlert.getState().clear();
    expect(useInAppAlert.getState().current).toBeNull();
    expect(useInAppAlert.getState().pending).toHaveLength(0);
  });
});
