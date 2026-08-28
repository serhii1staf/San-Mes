// Example tests for `useScreenMountMark` — the shared replacement for the hand-rolled
// `useRef(Date.now())` + effect mount timer that nine screens each carried a copy of.
//
// The three behaviours worth pinning, because each one was a bug in the version this replaces or in
// the version before that:
//
//   * The window STARTS at first render, not at the effect. The old copies were pasted partway down
//     the hook list, so everything above them — in `app/chat/[id].tsx` that included the `seedMessages`
//     MMKV read and JSON.parse — was excluded. An on-device log showed 36 ms reported inside a
//     measured 150 ms long task on the same screen.
//   * The window ENDS one frame after commit, not at the first passive effect, so the rest of React's
//     commit is inside it.
//   * Nothing is recorded while the perf monitor is off, and the flag is read at effect time rather
//     than subscribed to — a subscription re-fired the effect on a later toggle with a long-stale
//     start stamp, which is what produced fake multi-minute mount durations in the panel.
//
// Library: Jest + react-test-renderer, the repo convention (see useContextMenuGuard.test.tsx).

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// ─── Controllable mock state ─────────────────────────────────────────────────
// (jest.mock factories may only close over vars prefixed `mock*`.)

let mockPerfEnabled = true;
const mockMarkScreenMount = jest.fn();

jest.mock('../../services/perfMonitor', () => ({
  perfMonitor: {
    markScreenMount: (...args: unknown[]) => mockMarkScreenMount(...(args as [])),
  },
}));

jest.mock('../../store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ perfMonitorEnabled: mockPerfEnabled }),
  },
}));

import { useScreenMountMark } from '../useScreenMountMark';

// ─── rAF shim ────────────────────────────────────────────────────────────────
// The hook defers its mark by one frame; map that onto a macrotask so it can be flushed
// deterministically inside `act`.

let rafCallbacks: Array<{ id: number; cb: () => void }> = [];
let rafSeq = 0;

beforeAll(() => {
  // @ts-ignore
  global.requestAnimationFrame = (cb: () => void) => {
    const id = ++rafSeq;
    rafCallbacks.push({ id, cb });
    return id as unknown as number;
  };
  // @ts-ignore
  global.cancelAnimationFrame = (id: number) => {
    rafCallbacks = rafCallbacks.filter((entry) => entry.id !== id);
  };
});

beforeEach(() => {
  mockPerfEnabled = true;
  mockMarkScreenMount.mockClear();
  rafCallbacks = [];
  rafSeq = 0;
});

/** Run every pending frame callback. */
function flushFrame() {
  act(() => {
    rafCallbacks.splice(0).forEach((entry) => entry.cb());
  });
}

/**
 * A component that calls the hook FIRST and then does measurable work in a later hook, standing in
 * for the expensive memos that used to sit above the old inline stamp.
 */
function Screen({ label, costMs = 0 }: { label: string; costMs?: number }) {
  useScreenMountMark(label);
  // A second hook whose cost must land INSIDE the measured window.
  React.useMemo(() => {
    if (costMs > 0) advanceClock(costMs);
    return null;
  }, [costMs]);
  return null;
}

// ─── Clock ───────────────────────────────────────────────────────────────────

let now = 0;
let nowSpy: jest.SpyInstance;
function advanceClock(ms: number) {
  now += ms;
}

beforeEach(() => {
  now = 1_000_000;
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  nowSpy.mockRestore();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useScreenMountMark — the measured window', () => {
  it('records nothing until a frame has passed after commit', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Screen label="chat/[id]" />);
    });

    // Committed, effects flushed — and deliberately still silent. The old version reported here.
    expect(mockMarkScreenMount).not.toHaveBeenCalled();

    flushFrame();
    expect(mockMarkScreenMount).toHaveBeenCalledTimes(1);
    expect(mockMarkScreenMount.mock.calls[0][0]).toBe('chat/[id]');

    act(() => renderer.unmount());
  });

  it('includes work done by hooks that run AFTER the call — the whole point of calling it first', () => {
    // 120 ms of render-phase work in a later hook, plus 30 ms between commit and the frame.
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Screen label="(tabs)/index" costMs={120} />);
    });
    advanceClock(30);
    flushFrame();

    expect(mockMarkScreenMount).toHaveBeenCalledTimes(1);
    // 120 (render-phase memo) + 30 (commit → frame). The old shape captured neither reliably.
    expect(mockMarkScreenMount.mock.calls[0][1]).toBe(150);

    act(() => renderer.unmount());
  });

  it('reports nothing for a screen unmounted before its frame lands', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Screen label="profile/[id]" />);
    });
    act(() => renderer.unmount());

    // The cleanup cancelled the frame; flushing must not resurrect it.
    flushFrame();
    expect(mockMarkScreenMount).not.toHaveBeenCalled();
  });
});

describe('useScreenMountMark — the perf-monitor flag', () => {
  it('records nothing while the monitor is off, and never schedules a frame', () => {
    mockPerfEnabled = false;

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Screen label="(tabs)/messages" />);
    });

    // The flag is checked before the frame is requested, so there is nothing queued at all.
    expect(rafCallbacks).toHaveLength(0);
    flushFrame();
    expect(mockMarkScreenMount).not.toHaveBeenCalled();

    act(() => renderer.unmount());
  });

  it('does not re-report on a later re-render', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Screen label="comments/[id]" />);
    });
    flushFrame();
    expect(mockMarkScreenMount).toHaveBeenCalledTimes(1);

    // A re-render must not arm a second mark — the effect is mount-only.
    act(() => {
      renderer.update(<Screen label="comments/[id]" />);
    });
    flushFrame();
    expect(mockMarkScreenMount).toHaveBeenCalledTimes(1);

    act(() => renderer.unmount());
  });
});
