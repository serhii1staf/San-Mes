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

// ── The rule that decides whether a sampler gap is evidence of anything ──────
//
// The detector used to call every gap over 120 ms a JS-thread long task. That produced false
// positives that were measured, not theorised: the app left idle for 20 s, `dumpsys gfxinfo`
// reporting 0 frames rendered and 0 missed vsyncs, and the monitor still logging long tasks.
//
// The cause is that `requestAnimationFrame` in React Native is a one-shot 1 ms native timer
// (`Libraries/Core/Timers/JSTimers.js`), not a vsync callback, so a gap means "this timer was
// serviced late" — which a blocked thread and an idle app produce identically.
//
// These tests pin the discriminator: a gap only counts as `LONG` when the app recorded work inside
// it. They matter because the whole reason to trust a long-task count is this one comparison.
describe('perfMonitor sampler-gap classification', () => {
  beforeEach(() => {
    perfMonitor.clearEvents();
  });

  it('calls a gap IDLE when no app work was recorded inside it', () => {
    // No marks at all since the clear, so nothing can vouch for the gap.
    expect(perfMonitor.classifyGap(Date.now() - 500)).toBe('IDLE');
  });

  it('calls a gap LONG when app work was recorded inside it', () => {
    const gapStart = Date.now();
    const spy = jest.spyOn(Date, 'now');
    // A mount landing AFTER the gap opened is the corroboration.
    spy.mockReturnValue(gapStart + 50);
    perfMonitor.mark('work-inside-the-gap');
    spy.mockRestore();

    expect(perfMonitor.classifyGap(gapStart)).toBe('LONG');
  });

  it('does not let work that predates the gap vouch for it', () => {
    const spy = jest.spyOn(Date, 'now');
    const past = Date.now();
    spy.mockReturnValue(past);
    perfMonitor.mark('work-before-the-gap');
    spy.mockRestore();

    // Gap opens after that mark, so the mark is not inside it.
    expect(perfMonitor.classifyGap(past + 10)).toBe('IDLE');
  });

  it('does not let the monitor\'s own diagnostics corroborate a gap', () => {
    // `recordError` writes a `slow`/`error` event. If those counted as activity, one long task
    // would vouch for the next and the false positives would come straight back.
    const gapStart = Date.now();
    const spy = jest.spyOn(Date, 'now');
    spy.mockReturnValue(gapStart + 50);
    perfMonitor.recordError('boom', 'stack');
    spy.mockRestore();

    expect(perfMonitor.classifyGap(gapStart)).toBe('IDLE');
  });

  it('clearEvents forgets the corroboration timestamp', () => {
    const gapStart = Date.now();
    const spy = jest.spyOn(Date, 'now');
    spy.mockReturnValue(gapStart + 50);
    perfMonitor.mark('work');
    spy.mockRestore();
    expect(perfMonitor.classifyGap(gapStart)).toBe('LONG');

    // After a clear, work the user asked to forget must not still vouch for the next gap.
    perfMonitor.clearEvents();
    expect(perfMonitor.classifyGap(gapStart)).toBe('IDLE');
  });
});

// ── Opening a screen must not be scored as the screen being janky ────────────
//
// Regression test. Two guards used to discard samples near a stall; #212 removed them because they
// hid real jank, which was right — but they were also the only thing keeping screen-MOUNT windows out
// of `worstFps`, which is a session minimum that never decays. The result was every route in the app
// reporting a low `worstFps` while reporting zero long tasks: 2, 20, 28, 32, 33, 37 across six routes
// in the reported snapshot, five of them with `longTaskCount: 0`.
//
// The same failure is written up in `PerfMonitorBubble.tsx` for the UI worklet: "`settings` — zero
// long tasks, zero mounts, zero images, an idle form — reported `worstFps: 3`". It was fixed once by
// accident and broken again by removing the accident.
describe('perfMonitor open-vs-in-use split', () => {
  beforeEach(() => {
    perfMonitor.clearEvents();
  });

  it('keeps a dip during the open burst out of worstFps, and reports it as worstOpenFps', () => {
    const t0 = Date.now();
    const spy = jest.spyOn(Date, 'now');

    // Navigate somewhere. This stamps the settle window.
    spy.mockReturnValue(t0);
    perfMonitor.recordNavigation('route/under-test', 120);

    // A terrible sample 200 ms later — i.e. inside the mount burst.
    spy.mockReturnValue(t0 + 200);
    perfMonitor.pushUiFps(3);
    spy.mockRestore();

    const hs = perfMonitor.getHotspots().find((h) => h.route === 'route/under-test');
    expect(hs).toBeDefined();
    // Not attributed to the screen being janky in use...
    expect(hs!.worstFps).toBe(60);
    expect(hs!.jankCount).toBe(0);
    // ...but not hidden either.
    expect(hs!.worstOpenFps).toBe(3);
  });

  it('still records a dip once the screen has settled', () => {
    const t0 = Date.now();
    const spy = jest.spyOn(Date, 'now');

    spy.mockReturnValue(t0);
    perfMonitor.recordNavigation('route/settled', 40);

    // Well past the settle window, so this is the screen misbehaving in use.
    spy.mockReturnValue(t0 + 5000);
    perfMonitor.pushUiFps(11);
    spy.mockRestore();

    const hs = perfMonitor.getHotspots().find((h) => h.route === 'route/settled');
    expect(hs).toBeDefined();
    expect(hs!.worstFps).toBe(11);
    expect(hs!.worstOpenFps).toBe(60);
  });
});
