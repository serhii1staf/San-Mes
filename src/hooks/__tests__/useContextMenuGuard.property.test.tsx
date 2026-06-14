// Validates the actual fix for context-menu freezes (1.11/1.13).
// Drives the hook through a tiny react-test-renderer host so we can fire bursts
// of open() calls and assert at-most-one-target invariant without pulling in
// extra testing-library dependencies.

import React, { useImperativeHandle, forwardRef } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import fc from 'fast-check';
import { useContextMenuGuard } from '../useContextMenuGuard';

interface Handle {
  open: (item: { id: string }) => void;
  close: () => void;
  getTarget: () => { id: string } | null;
}

const Host = forwardRef<Handle>((_, ref) => {
  const guard = useContextMenuGuard<{ id: string }>({ lockMs: 500, closeLockMs: 350 });
  useImperativeHandle(ref, () => ({
    open: guard.open,
    close: guard.close,
    getTarget: () => guard.target,
  }));
  return null;
});
Host.displayName = 'TestHost';

// Make rAF synchronous-ish so the hook's deferred setState lands inside act().
beforeAll(() => {
  // @ts-ignore
  global.requestAnimationFrame = (cb: any) => setTimeout(cb, 0) as unknown as number;
  // @ts-ignore
  global.cancelAnimationFrame = (id: any) => clearTimeout(id);
});

const flushRaf = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

describe('useContextMenuGuard: rapid long-press storm yields ≤1 active target', () => {
  it('a burst of open() calls within the lock window keeps target stable at the first item', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 12 }), async (burst) => {
        const ref = React.createRef<Handle>();
        let renderer!: TestRenderer.ReactTestRenderer;
        await act(async () => { renderer = TestRenderer.create(<Host ref={ref} />); });
        await act(async () => {
          for (let i = 0; i < burst; i++) ref.current?.open({ id: `i-${i}` });
        });
        await flushRaf();
        // Only the first call accepted; the rest are no-ops while locked/open.
        expect(ref.current?.getTarget()?.id).toBe('i-0');
        await act(async () => { renderer.unmount(); });
      }),
      { numRuns: 30 }
    );
  });

  it('open is a no-op while a target is already active', async () => {
    const ref = React.createRef<Handle>();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<Host ref={ref} />); });

    await act(async () => { ref.current?.open({ id: 'first' }); });
    await flushRaf();
    expect(ref.current?.getTarget()?.id).toBe('first');

    await act(async () => { ref.current?.open({ id: 'second' }); });
    await flushRaf();
    expect(ref.current?.getTarget()?.id).toBe('first');

    await act(async () => { renderer.unmount(); });
  });

  it('close clears the target', async () => {
    const ref = React.createRef<Handle>();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<Host ref={ref} />); });

    await act(async () => { ref.current?.open({ id: 'x' }); });
    await flushRaf();
    expect(ref.current?.getTarget()).not.toBeNull();

    await act(async () => { ref.current?.close(); });
    expect(ref.current?.getTarget()).toBeNull();

    await act(async () => { renderer.unmount(); });
  });
});
