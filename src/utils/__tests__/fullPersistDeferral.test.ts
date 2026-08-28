/**
 * The cross-conversation full-blob flush must be DEFERRED, and the durability flushes must NOT be.
 *
 * This models the scheduler from `app/chat/[id].tsx` rather than importing it, because that module is
 * a 7000-line screen whose import pulls in FlashList, Reanimated, gesture-handler, Ably and ~25 local
 * stores — none of which this behaviour depends on. What is worth locking down is the RULE, and the
 * rule is small enough to state exactly:
 *
 *   • switching conversations must not run a 1000-message `JSON.stringify` on the new screen's mount
 *     frame — it hands the write to a macrotask instead;
 *   • the pending write is detached BEFORE the timeout, so the incoming conversation cannot see a
 *     stale owner and double-flush it;
 *   • backgrounding and teardown still flush SYNCHRONOUSLY, because those are the frames nobody is
 *     looking at and the moment before an OS kill.
 *
 * If the screen's implementation ever diverges from this, the deferral was the fix for a measured
 * `MOUNT chat/[id]` of 252 ms inside a 267 ms long task whose named marks summed to 5 ms.
 */

// Mirrors the module-scope scheduler state in app/chat/[id].tsx.
let fullPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingFullWrite: (() => void) | null = null;
let pendingFullConv: string | null = null;

const FULL_PERSIST_DEBOUNCE_MS = 120000;

/** Synchronous flush — background / teardown only. */
function runPendingFullPersist(): void {
  if (fullPersistTimer) { clearTimeout(fullPersistTimer); fullPersistTimer = null; }
  const fn = pendingFullWrite;
  pendingFullWrite = null;
  pendingFullConv = null;
  if (fn) { try { fn(); } catch {} }
}

/** Deferred flush — the chat-switch path. */
function flushPendingFullPersistSoon(): void {
  if (fullPersistTimer) { clearTimeout(fullPersistTimer); fullPersistTimer = null; }
  const fn = pendingFullWrite;
  pendingFullWrite = null;
  pendingFullConv = null;
  if (!fn) return;
  setTimeout(() => { try { fn(); } catch {} }, 0);
}

function scheduleFullPersist(conversationId: string, write: () => void): void {
  if (pendingFullConv && pendingFullConv !== conversationId) flushPendingFullPersistSoon();
  pendingFullWrite = write;
  pendingFullConv = conversationId;
  if (fullPersistTimer) clearTimeout(fullPersistTimer);
  fullPersistTimer = setTimeout(runPendingFullPersist, FULL_PERSIST_DEBOUNCE_MS);
}

beforeEach(() => {
  jest.useFakeTimers();
  if (fullPersistTimer) clearTimeout(fullPersistTimer);
  fullPersistTimer = null;
  pendingFullWrite = null;
  pendingFullConv = null;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('full-blob persist scheduling', () => {
  it('does not run the previous conversation write on the switching frame', () => {
    const writeA = jest.fn();
    scheduleFullPersist('a', writeA);

    // Switching to B is what happens inside the NEW screen's mount window.
    const writeB = jest.fn();
    scheduleFullPersist('b', writeB);

    // The whole point: nothing ran synchronously.
    expect(writeA).not.toHaveBeenCalled();

    jest.advanceTimersByTime(0);
    expect(writeA).toHaveBeenCalledTimes(1);
    // B is still owed, on its own long debounce.
    expect(writeB).not.toHaveBeenCalled();
  });

  it('detaches the pending write before the timeout, so it cannot flush twice', () => {
    const writeA = jest.fn();
    scheduleFullPersist('a', writeA);
    scheduleFullPersist('b', jest.fn());
    // A third switch must not find A still owned and queue it again.
    scheduleFullPersist('c', jest.fn());
    jest.advanceTimersByTime(0);
    expect(writeA).toHaveBeenCalledTimes(1);
  });

  it('flushes SYNCHRONOUSLY on the durability path (background / teardown)', () => {
    const write = jest.fn();
    scheduleFullPersist('a', write);
    runPendingFullPersist();
    // No timer advance: backgrounding is the frame before an OS kill, so it must already be on disk.
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('a same-conversation re-schedule replaces the write rather than flushing it', () => {
    const first = jest.fn();
    const second = jest.fn();
    scheduleFullPersist('a', first);
    scheduleFullPersist('a', second);
    jest.advanceTimersByTime(0);
    // Neither ran: same owner, so this is coalescing, not a switch.
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    runPendingFullPersist();
    // Only the newest snapshot is written — that is what the debounce is for.
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('a throwing write cannot break the switch', () => {
    const boom = jest.fn(() => { throw new Error('mmkv full'); });
    scheduleFullPersist('a', boom);
    expect(() => {
      scheduleFullPersist('b', jest.fn());
      jest.advanceTimersByTime(0);
    }).not.toThrow();
    expect(boom).toHaveBeenCalledTimes(1);
  });

  it('flushing when nothing is owed schedules no timeout', () => {
    const spy = jest.spyOn(global, 'setTimeout');
    flushPendingFullPersistSoon();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
