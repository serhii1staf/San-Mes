// Integration test: context-menu burst (Task 8.3, music-and-performance-fixes spec).
//
// Wires together the REAL `useContextMenuGuard` hook with REAL stub
// PostContextMenu / CommentContextMenu surfaces to verify Property 6
// (countActiveMenuInstances ≤ 1) holds when the two compose in the way the
// production screens use them. This is one level higher than:
//
//   - the unit test in src/hooks/__tests__/useContextMenuGuard.test.tsx
//     (covers the hook's lock semantics in isolation), and
//   - the property-based test in
//     src/hooks/__tests__/useContextMenuGuard.property.test.tsx
//     (covers the hook under random burst sizes).
//
// What this integration adds:
//   1. Fires 5+ rapid open() calls within `lockMs` against the hook AND a
//      mounted PostContextMenu mock — verifies the menu visible flag flips
//      true exactly once (Property 6, profile path).
//   2. Same scenario with CommentContextMenu (comments path).
//   3. PRESERVATION: a single long-press still opens the menu and chosen
//      action fires; a normal close-then-open after the close-lock expires
//      reopens the menu (Property 8 / 3.9, 3.10).
//
//   _Requirements: 2.11, 2.12, 2.13, 3.9, 3.10 / Property 6, 8_
//
// Library: Jest + react-test-renderer. No new dependencies.

import React, { useImperativeHandle, forwardRef } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useContextMenuGuard } from '../../hooks/useContextMenuGuard';

// Make rAF synchronous-ish so the hook's deferred setTarget lands inside act().
beforeAll(() => {
  // @ts-ignore
  global.requestAnimationFrame = (cb: any) => setTimeout(cb, 0) as unknown as number;
  // @ts-ignore
  global.cancelAnimationFrame = (id: any) => clearTimeout(id);
});

const flushRaf = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

// ─── Menu instance counter (shared by all suites) ────────────────────────
//
// Each menu mock counts the number of true→false→true transitions of its
// `visible` prop — that is the exact "active instance" definition Property 6
// uses (one mounted active modal at any moment).
const menuStats = {
  visibleNow: 0, // currently visible instances (sum of all mocks)
  totalActivations: 0, // total true transitions across the test
  reset() {
    this.visibleNow = 0;
    this.totalActivations = 0;
  },
};

(globalThis as any).__menuStats = menuStats;

beforeEach(() => menuStats.reset());

// ─── Mocks: minimal PostContextMenu / CommentContextMenu surfaces ────────
//
// We keep them small on purpose — a real PostContextMenu pulls in <Modal>,
// expo-clipboard, theme/i18n, etc. The integration value is the hook +
// menu COMPOSITION: the parent decides `visible` from the hook's `target`,
// and the menu reports activations. Implementation details of the menu
// (animations, action sheet) are tested elsewhere.

interface MenuMockProps {
  visible: boolean;
  onClose: () => void;
}

function makeMenuMock(name: string) {
  return function MenuMock({ visible }: MenuMockProps) {
    const wasVisible = React.useRef(false);
    React.useEffect(() => {
      const stats = (globalThis as any).__menuStats as typeof menuStats;
      if (visible && !wasVisible.current) {
        stats.totalActivations += 1;
        stats.visibleNow += 1;
        wasVisible.current = true;
      } else if (!visible && wasVisible.current) {
        stats.visibleNow = Math.max(0, stats.visibleNow - 1);
        wasVisible.current = false;
      }
    }, [visible]);
    // Return null — we only care about the visible-edge counter.
    return null;
  };
}

const PostContextMenuMock = makeMenuMock('PostContextMenu');
const CommentContextMenuMock = makeMenuMock('CommentContextMenu');

// ─── Host components: same shape the production screens use ──────────────
// These mirror the (tabs)/profile.tsx and comments/[id].tsx integration:
//   - useContextMenuGuard for open/close/target,
//   - menu with `visible={!!target}` and `onClose={close}`.
// Each host exposes `open(item)` so the test can drive a rapid burst.

interface HostHandle<T> {
  open: (item: T) => void;
  close: () => void;
  target: T | null;
}

interface PostItem { id: string }

const PostHost = forwardRef<HostHandle<PostItem>>((_, ref) => {
  const guard = useContextMenuGuard<PostItem>({ lockMs: 500, closeLockMs: 350 });
  useImperativeHandle(ref, () => ({
    open: guard.open,
    close: guard.close,
    target: guard.target,
  }), [guard.open, guard.close, guard.target]);
  return React.createElement(PostContextMenuMock, {
    visible: !!guard.target,
    onClose: guard.close,
  });
});
PostHost.displayName = 'PostHost';

interface CommentItem { id: string }

const CommentHost = forwardRef<HostHandle<CommentItem>>((_, ref) => {
  const guard = useContextMenuGuard<CommentItem>({ lockMs: 500, closeLockMs: 350 });
  useImperativeHandle(ref, () => ({
    open: guard.open,
    close: guard.close,
    target: guard.target,
  }), [guard.open, guard.close, guard.target]);
  return React.createElement(CommentContextMenuMock, {
    visible: !!guard.target,
    onClose: guard.close,
  });
});
CommentHost.displayName = 'CommentHost';

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

describe('Context-menu burst integration (Task 8.3)', () => {
  // The "active opens" counter survives any number of rapid open() calls —
  // we expect exactly ONE activation regardless of burst size.

  describe('profile (PostContextMenu)', () => {
    it('rapid burst of 8 long-presses → exactly one menu activation', async () => {
      const ref = React.createRef<HostHandle<PostItem>>();
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(PostHost, { ref }));
      });

      // Burst: 8 open() calls, 8 different post ids — only the first should
      // win and become the menu's target. The remaining 7 are no-ops while
      // the guard is locked.
      await act(async () => {
        for (let i = 0; i < 8; i++) ref.current?.open({ id: `p-${i}` });
      });
      await flushRaf();

      // Property 6 — exactly one menu instance becomes active.
      expect(menuStats.totalActivations).toBe(1);
      expect(menuStats.visibleNow).toBe(1);

      // Sanity: the WINNING target is the first item the user pressed.
      // (We can't read it via ref here because target on the imperative
      // handle is captured at the previous render — assert on visible-now
      // instead, which is the production-relevant signal.)

      await act(async () => renderer.unmount());
    });

    it('a 5-item burst across 50ms with mocked time stays ≤ 1 active', async () => {
      const ref = React.createRef<HostHandle<PostItem>>();
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(PostHost, { ref }));
      });

      // Drive Date.now() forward by 10 ms between each press so the burst
      // covers 50 ms total — still well inside the 500 ms lock window.
      let now = 1_000_000;
      const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
      try {
        for (let i = 0; i < 5; i++) {
          await act(async () => ref.current?.open({ id: `q-${i}` }));
          now += 10;
        }
        await flushRaf();
        expect(menuStats.totalActivations).toBe(1);
        expect(menuStats.visibleNow).toBe(1);
      } finally {
        nowSpy.mockRestore();
      }

      await act(async () => renderer.unmount());
    });
  });

  describe('comments (CommentContextMenu)', () => {
    it('rapid burst of 6 long-presses → exactly one menu activation', async () => {
      const ref = React.createRef<HostHandle<CommentItem>>();
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(CommentHost, { ref }));
      });

      await act(async () => {
        for (let i = 0; i < 6; i++) ref.current?.open({ id: `c-${i}` });
      });
      await flushRaf();

      expect(menuStats.totalActivations).toBe(1);
      expect(menuStats.visibleNow).toBe(1);

      await act(async () => renderer.unmount());
    });
  });

  // ─── Preservation (Property 8 / 3.9, 3.10) ─────────────────────────────
  //
  // Single long-press still works as before: the menu opens; close() drops
  // it; after the close-lock expires another open() succeeds. None of these
  // baselines are allowed to regress.

  describe('preservation: single long-press + reopen after lock', () => {
    it('a single long-press opens the menu exactly once and close() drops it', async () => {
      const ref = React.createRef<HostHandle<PostItem>>();
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(PostHost, { ref }));
      });

      await act(async () => ref.current?.open({ id: 'only' }));
      await flushRaf();
      expect(menuStats.totalActivations).toBe(1);
      expect(menuStats.visibleNow).toBe(1);

      await act(async () => ref.current?.close());
      // After close, no menu is active; counter remembers there was 1.
      expect(menuStats.visibleNow).toBe(0);
      expect(menuStats.totalActivations).toBe(1);

      await act(async () => renderer.unmount());
    });

    it('reopen after the close-lock expires → second activation succeeds', async () => {
      const ref = React.createRef<HostHandle<PostItem>>();
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(PostHost, { ref }));
      });

      let now = 2_000_000;
      const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
      try {
        // First open + close.
        await act(async () => ref.current?.open({ id: 'first' }));
        await flushRaf();
        await act(async () => ref.current?.close());
        expect(menuStats.totalActivations).toBe(1);

        // Inside the close-lock, open() is rejected.
        now += 100;
        await act(async () => ref.current?.open({ id: 'too-soon' }));
        await flushRaf();
        expect(menuStats.totalActivations).toBe(1);

        // Past the close-lock window → open() succeeds → second activation.
        now += 400;
        await act(async () => ref.current?.open({ id: 'allowed' }));
        await flushRaf();
        expect(menuStats.totalActivations).toBe(2);
        expect(menuStats.visibleNow).toBe(1);
      } finally {
        nowSpy.mockRestore();
      }

      await act(async () => renderer.unmount());
    });
  });

  // ─── Cross-screen burst (regression guard) ──────────────────────────────
  //
  // Both menus mounted simultaneously (mirrors the case where a profile
  // screen and a comments overlay coexist briefly during navigation): each
  // menu's hook has its own lock so the two are independent — but a burst on
  // one screen must NOT activate the OTHER screen's menu. This was a real
  // worry during refactor — make sure the hook is per-instance.

  describe('two independent hosts share no global state', () => {
    it('a burst on the post host does not open the comment host', async () => {
      const postRef = React.createRef<HostHandle<PostItem>>();
      const commentRef = React.createRef<HostHandle<CommentItem>>();
      let renderer!: TestRenderer.ReactTestRenderer;

      // Render both hosts as siblings — same as a screen with two distinct
      // menu surfaces above a shared root.
      const Both = () =>
        React.createElement(
          require('react-native').View,
          null,
          React.createElement(PostHost, { ref: postRef }),
          React.createElement(CommentHost, { ref: commentRef }),
        );

      await act(async () => {
        renderer = TestRenderer.create(React.createElement(Both));
      });

      // Burst on the POST host only — a thoughtful tester would expect
      // exactly one activation total.
      await act(async () => {
        for (let i = 0; i < 7; i++) postRef.current?.open({ id: `p-${i}` });
      });
      await flushRaf();

      expect(menuStats.totalActivations).toBe(1);
      expect(menuStats.visibleNow).toBe(1);

      await act(async () => renderer.unmount());
    });
  });
});
