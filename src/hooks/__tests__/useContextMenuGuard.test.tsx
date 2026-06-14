// Unit tests for useContextMenuGuard (music-and-performance-fixes spec, Task 8.1).
//
// Deterministic, single-shot examples that complement the property-based test
// in useContextMenuGuard.property.test.tsx. Specifically covers the parts of
// the contract NOT exercised by the burst test:
//   - the lock window after open() rejects subsequent open() calls,
//   - close() arms a NEW lock window (closeLockMs) so a trailing long-press
//     cannot immediately reopen the menu,
//   - after the close-lock elapses, open() is accepted again.
//
// Time is advanced by mocking Date.now() — Date.now drives lockUntil in the
// hook, while requestAnimationFrame is shimmed to setTimeout(0) so deferred
// state updates land synchronously inside act().

import React, { useImperativeHandle, forwardRef } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useContextMenuGuard } from '../useContextMenuGuard';

interface Item {
  id: string;
}
interface Handle {
  open: (item: Item) => void;
  close: () => void;
  getTarget: () => Item | null;
}

const Host = forwardRef<Handle, { lockMs?: number; closeLockMs?: number }>((props, ref) => {
  const guard = useContextMenuGuard<Item>({
    lockMs: props.lockMs ?? 500,
    closeLockMs: props.closeLockMs ?? 350,
  });
  useImperativeHandle(ref, () => ({
    open: guard.open,
    close: guard.close,
    getTarget: () => guard.target,
  }));
  return null;
});
Host.displayName = 'TestHost';

beforeAll(() => {
  // @ts-ignore
  global.requestAnimationFrame = (cb: any) => setTimeout(cb, 0) as unknown as number;
  // @ts-ignore
  global.cancelAnimationFrame = (id: any) => clearTimeout(id);
});

const flushRaf = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe('useContextMenuGuard — open lock + close-lock extension', () => {
  let nowSpy: jest.SpyInstance;
  let now = 0;

  beforeEach(() => {
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('lockMs window after open() rejects further open() calls', async () => {
    const ref = React.createRef<Handle>();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<Host ref={ref} lockMs={500} closeLockMs={350} />);
    });

    await act(async () => ref.current?.open({ id: 'first' }));
    await flushRaf();
    expect(ref.current?.getTarget()?.id).toBe('first');

    // Advance 100 ms — still inside the 500 ms lock.
    now += 100;
    // close() so openRef goes back to false; but the time-lock still applies.
    await act(async () => ref.current?.close());
    expect(ref.current?.getTarget()).toBeNull();
    // close() arms its own 350 ms lock from the new "now". Inside that window
    // open() is a no-op.
    await act(async () => ref.current?.open({ id: 'still-locked' }));
    await flushRaf();
    expect(ref.current?.getTarget()).toBeNull();

    await act(async () => renderer.unmount());
  });

  it('close() extends the lock — open() right after close() is ignored, then accepted after closeLockMs', async () => {
    const ref = React.createRef<Handle>();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<Host ref={ref} lockMs={500} closeLockMs={350} />);
    });

    await act(async () => ref.current?.open({ id: 'a' }));
    await flushRaf();
    expect(ref.current?.getTarget()?.id).toBe('a');

    // User dismisses the menu — close() arms a 350 ms lock from now.
    await act(async () => ref.current?.close());
    expect(ref.current?.getTarget()).toBeNull();

    // Trailing long-press 50 ms later — well inside the close-lock.
    now += 50;
    await act(async () => ref.current?.open({ id: 'trailing' }));
    await flushRaf();
    expect(ref.current?.getTarget()).toBeNull();

    // Just before the close-lock expires — still ignored.
    now += 290;
    await act(async () => ref.current?.open({ id: 'still-locked' }));
    await flushRaf();
    expect(ref.current?.getTarget()).toBeNull();

    // Past the close-lock window — open() succeeds.
    now += 20;
    await act(async () => ref.current?.open({ id: 'allowed' }));
    await flushRaf();
    expect(ref.current?.getTarget()?.id).toBe('allowed');

    await act(async () => renderer.unmount());
  });

  it('close() with no menu open still arms the lock window', async () => {
    const ref = React.createRef<Handle>();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<Host ref={ref} lockMs={500} closeLockMs={350} />);
    });

    // close() called with nothing open (defensive).
    await act(async () => ref.current?.close());
    expect(ref.current?.getTarget()).toBeNull();

    // Immediately attempting to open() is still rejected for closeLockMs ms.
    await act(async () => ref.current?.open({ id: 'too-soon' }));
    await flushRaf();
    expect(ref.current?.getTarget()).toBeNull();

    now += 360;
    await act(async () => ref.current?.open({ id: 'ok-now' }));
    await flushRaf();
    expect(ref.current?.getTarget()?.id).toBe('ok-now');

    await act(async () => renderer.unmount());
  });
});
