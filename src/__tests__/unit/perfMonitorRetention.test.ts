/**
 * Regression tests for two defects in the perf monitor's own measurement layer.
 * Both were found by reading a device snapshot rather than the code, and both
 * made that snapshot partly unreadable.
 *
 * 1. The per-host image-decode throttle was inert. The "memory hygiene" delete
 *    ran while the bucket array was still the one the call was about to push
 *    into, so the push landed in an array unreachable from the Map and the next
 *    call always started from empty. Documented ceiling: two marks per host per
 *    second. Observed on device: sixteen marks from one host in 1.01 s.
 *
 * 2. Long-task events shared the 64-entry ring with routine marks. On a route
 *    generating hundreds of image marks, the diagnostic `context` attached to
 *    each long task was overwritten within seconds — a snapshot showed 31 long
 *    tasks on `chat/[id]` with exactly one context surviving.
 */

jest.mock('../../store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ perfMonitorEnabled: true }),
  },
}));

// eslint-disable-next-line import/first -- must follow jest.mock, which is hoisted above imports
import { perfMonitor } from '../../services/perfMonitor';

describe('perfMonitor image-decode throttle', () => {
  beforeEach(() => {
    perfMonitor.clearEvents();
  });

  it('admits at most two marks per host inside the throttle window', () => {
    const now = 1_700_000_000_000;
    const spy = jest.spyOn(Date, 'now');
    // Sixteen decodes from one host across ~1.0 s — the exact shape the device
    // snapshot recorded from `pub-….r2.dev`.
    for (let i = 0; i < 16; i++) {
      spy.mockReturnValue(now + i * 60);
      perfMonitor.markImageDecode('https://cdn.example.com/a.webp', 20);
    }
    spy.mockRestore();

    const imgEvents = perfMonitor.snapshot().events.filter((e) => e.kind === 'IMG');
    expect(imgEvents).toHaveLength(2);
  });

  it('admits a further two once the window has passed', () => {
    const now = 1_700_000_000_000;
    const spy = jest.spyOn(Date, 'now');
    for (let i = 0; i < 5; i++) {
      spy.mockReturnValue(now + i * 10);
      perfMonitor.markImageDecode('https://window.example.com/a.webp', 20);
    }
    // Past IMG_THROTTLE_WINDOW_MS (1000 ms) — the bucket drains and refills.
    for (let i = 0; i < 5; i++) {
      spy.mockReturnValue(now + 1500 + i * 10);
      perfMonitor.markImageDecode('https://window.example.com/a.webp', 20);
    }
    spy.mockRestore();

    const imgEvents = perfMonitor.snapshot().events.filter((e) => e.kind === 'IMG');
    expect(imgEvents).toHaveLength(4);
  });

  it('throttles per host, not globally', () => {
    const now = 1_700_000_000_000;
    const spy = jest.spyOn(Date, 'now');
    spy.mockReturnValue(now);
    for (let i = 0; i < 5; i++) {
      perfMonitor.markImageDecode('https://one.example.com/a.webp', 20);
      perfMonitor.markImageDecode('https://two.example.com/a.webp', 20);
    }
    spy.mockRestore();

    const imgEvents = perfMonitor.snapshot().events.filter((e) => e.kind === 'IMG');
    expect(imgEvents).toHaveLength(4);
    expect(imgEvents.filter((e) => e.label === 'one.example.com')).toHaveLength(2);
    expect(imgEvents.filter((e) => e.label === 'two.example.com')).toHaveLength(2);
  });
});

describe('perfMonitor slow-event retention', () => {
  beforeEach(() => {
    perfMonitor.clearEvents();
  });

  it('keeps long-task events after a flood of routine marks evicts them from the main ring', () => {
    // One long task, recorded the way the detector records it (a `slow` event).
    perfMonitor.recordError('boom', 'stack');
    // Then far more routine marks than the 64-entry main ring can hold.
    for (let i = 0; i < 200; i++) perfMonitor.mark(`routine-${i}`);

    const events = perfMonitor.snapshot().events;
    const errors = events.filter((e) => e.kind === 'ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0].label).toBe('boom');
  });

  it('does not duplicate slow events that are still in the main ring', () => {
    perfMonitor.recordError('boom', 'stack');
    perfMonitor.mark('routine');

    const errors = perfMonitor.snapshot().events.filter((e) => e.kind === 'ERROR');
    expect(errors).toHaveLength(1);
  });

  it('returns events oldest-first after a merge', () => {
    // Distinct timestamps, because in a real session they are: the merge sorts by
    // `ts`, and a test loop that runs inside one millisecond cannot tell whether
    // the re-admitted event was placed correctly.
    const now = 1_700_000_000_000;
    const spy = jest.spyOn(Date, 'now');
    spy.mockReturnValue(now);
    perfMonitor.recordError('first', 'stack');
    for (let i = 0; i < 200; i++) {
      spy.mockReturnValue(now + 1 + i);
      perfMonitor.mark(`routine-${i}`);
    }
    spy.mockRestore();

    const events = perfMonitor.snapshot().events;
    const timestamps = events.map((e) => e.ts);
    const sorted = [...timestamps].sort((a, b) => a - b);
    expect(timestamps).toEqual(sorted);
    // The re-admitted long task is the oldest thing in the snapshot and stays
    // ahead of the marks that evicted it.
    expect(events[0].label).toBe('first');
  });

  it('clearEvents wipes the slow ring too', () => {
    perfMonitor.recordError('boom', 'stack');
    for (let i = 0; i < 200; i++) perfMonitor.mark(`routine-${i}`);
    perfMonitor.clearEvents();

    expect(perfMonitor.snapshot().events).toHaveLength(0);
  });
});
