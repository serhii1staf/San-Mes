// Bugfix spec: chat-input-animation-fix — Task 1
// Bug condition exploration test (Property 1: Bug Condition — Smooth Height Transition).
//
//   **Validates: Requirements 1.1, 1.2, 1.3, 1.4** (current/defect behavior)
//   **Encodes the Expected Behavior: Requirements 2.1, 2.2, 2.3, 2.4** (re-run in task 3.7)
//
// CRITICAL (bugfix methodology): this test MUST FAIL on the CURRENT (unfixed)
// code. The failure is the deliverable — it confirms the root cause: the field
// height is cushioned by a one-shot `LayoutAnimation.configureNext(INPUT_GROW_ANIM)`
// fired per line-count change (the snap mechanism) and there is NO time-based
// `withTiming` retargeting of a clamped height.
//
// The assertions encode the EXPECTED (fixed) behavior from design.md:
//   for kind="contentSizeChange": height retargets via `withTiming` toward
//   clamp(height, 22, 100) and NO `LayoutAnimation.configureNext` call is made;
//   for kind="chatOpen": no height animation is scheduled on the mount frame.
//
// Library: Jest (jest-expo preset) + react-test-renderer + fast-check — the
// repo convention (there is no @testing-library/react-native dependency; see
// MiniAppConsentDialog.test.tsx / ambientWiring.test.tsx). No new dependencies.

import React from 'react';
import { LayoutAnimation, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import fc from 'fast-check';

// ─── Mocks (minimal surface — only what ChatInputBar actually touches) ──────

// react-native-reanimated: deterministic mock. `withTiming` / `withSpring`
// become jest.fns so we can assert WHETHER the height retargets over time
// (withTiming, the fixed mechanism) vs. snaps (no withTiming on unfixed code).
// `Reanimated.View` renders as a plain RN View so the tree is observable.
jest.mock('react-native-reanimated', () => {
  const React_ = require('react');
  const { View } = require('react-native');
  const withTiming = jest.fn((toValue: number) => ({ __anim: 'timing', toValue }));
  const withSpring = jest.fn((toValue: number) => ({ __anim: 'spring', toValue }));
  const interpolate = jest.fn((_v: number, _in: number[], out: number[]) => out[0]);
  const useSharedValue = (init: number) => ({ value: init });
  const useAnimatedStyle = (fn: () => unknown) => {
    try {
      return fn();
    } catch {
      return {};
    }
  };
  const Easing = {
    linear: (t: number) => t,
    quad: (t: number) => t * t,
    out: (fn: (t: number) => number) => fn,
  };
  const ReanimatedView = ({ children, ...rest }: any) =>
    React_.createElement(View, rest, children);
  return {
    __esModule: true,
    default: { View: ReanimatedView },
    View: ReanimatedView,
    withTiming,
    withSpring,
    interpolate,
    useSharedValue,
    useAnimatedStyle,
    Easing,
  };
});

// Liquid glass OFF → take the flat (non-glass) render path. The bug is identical
// on both paths (height is the implicit TextInput height eased by LayoutAnimation),
// and the flat path renders plain Views, keeping the tree simple/observable.
jest.mock('../../ui/LiquidGlass', () => {
  const React_ = require('react');
  const { View } = require('react-native');
  const Passthrough = ({ children, ...rest }: any) =>
    React_.createElement(View, rest, children);
  return {
    __esModule: true,
    useLiquidGlassActive: () => false,
    NativeGlassView: Passthrough,
    GlassContainerView: Passthrough,
  };
});

// Animated icons → trivial stand-ins (no SVG/Lottie work in the test tree).
jest.mock('../AnimatedKeyboardIcon', () => ({ AnimatedKeyboardIcon: () => null }));
jest.mock('../AnimatedEmojiIcon', () => ({ AnimatedEmojiIcon: () => null }));
jest.mock('../AnimatedGifIcon', () => ({ AnimatedGifIcon: () => null }));

// expo-paste-input → no native wrapper, so ChatField renders the plain TextInput
// (its tree position is fixed, matching production's crash-safe fallback path).
jest.mock('expo-paste-input', () => ({}), { virtual: true });

// Theme / i18n / perf — minimal stand-ins.
jest.mock('../../../theme', () => ({
  useTheme: () => ({
    isDark: false,
    colors: {
      text: { primary: '#000', tertiary: '#999' },
      accent: { primary: '#3a82f7' },
      background: { elevated: '#fff' },
      border: { light: '#eee' },
    },
    fontFamily: { regular: 'System' },
  }),
}));
jest.mock('../../../i18n/store', () => ({ useT: () => (k: string) => k }));
jest.mock('../../../services/perfMonitor', () => ({
  perfMonitor: { markInputFocus: jest.fn() },
}));

import { ChatInputBar, ChatInputBarHandle } from '../ChatInputBar';
import * as Reanimated from 'react-native-reanimated';

const withTimingMock = (Reanimated as any).withTiming as jest.MockedFunction<any>;

const MIN_FIELD_HEIGHT = 22;
const MAX_FIELD_HEIGHT = 100;
const clamp = (h: number) =>
  Math.min(MAX_FIELD_HEIGHT, Math.max(MIN_FIELD_HEIGHT, h));

// Keep references so we can unmount between cases.
const renderers: TestRenderer.ReactTestRenderer[] = [];

function renderBar() {
  const ref = React.createRef<ChatInputBarHandle>();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ChatInputBar
        ref={ref}
        isEditing={false}
        hasPendingImages={false}
        onSend={jest.fn()}
        onPickImages={jest.fn()}
        onOpenGif={jest.fn()}
        inputRowStyle={{}}
      />,
    );
  });
  renderers.push(renderer);
  const ti = renderer.root.findByType(TextInput);
  return { renderer, ti, ref };
}

// Fire one `onContentSizeChange` with the given measured content height.
function fireHeight(ti: TestRenderer.ReactTestInstance, h: number) {
  act(() => {
    ti.props.onContentSizeChange({ nativeEvent: { contentSize: { height: h } } });
  });
}

// All `withTiming` target values requested for the height since the last reset.
function timingTargets(): number[] {
  return withTimingMock.mock.calls.map((c: unknown[]) => c[0] as number);
}

let configureNextSpy: jest.SpyInstance;

beforeEach(() => {
  // Spy on the snap mechanism. On unfixed code this fires once per line-count
  // change; the fix must remove it entirely.
  configureNextSpy = jest
    .spyOn(LayoutAnimation, 'configureNext')
    .mockImplementation(() => {});
  withTimingMock.mockClear();
});

afterEach(() => {
  while (renderers.length) {
    const r = renderers.pop();
    act(() => r?.unmount());
  }
  configureNextSpy.mockRestore();
});

describe('ChatInputBar height transition — bug condition exploration (Task 1)', () => {
  // ── Case 1: Grow snap (22→48→70 within < 260 ms) ─────────────────────────
  // _Requirements: 1.1 (defect) / 2.1 (expected)_
  it('grows smoothly via withTiming with NO LayoutAnimation snap (grow 22→48→70)', () => {
    const { ti } = renderBar();

    // Drive the grow sequence faster than the 260 ms one-shot would settle.
    fireHeight(ti, 22);
    fireHeight(ti, 48);
    fireHeight(ti, 70);

    // EXPECTED (fixed) behavior — height retargets over time, no global snap.
    expect(configureNextSpy).not.toHaveBeenCalled();
    expect(timingTargets()).toEqual(
      expect.arrayContaining([clamp(48), clamp(70)]),
    );
    // The latest retarget continues toward the newest clamped height.
    expect(timingTargets()[timingTargets().length - 1]).toBe(clamp(70));
  });

  // ── Case 2: Shrink snap (70→48→22 rapid) ─────────────────────────────────
  // _Requirements: 1.2 (defect) / 2.2 (expected)_
  it('shrinks smoothly via withTiming with NO LayoutAnimation snap (shrink 70→48→22)', () => {
    const { ti } = renderBar();

    fireHeight(ti, 70);
    fireHeight(ti, 48);
    fireHeight(ti, 22);

    expect(configureNextSpy).not.toHaveBeenCalled();
    expect(timingTargets()).toEqual(
      expect.arrayContaining([clamp(48), clamp(22)]),
    );
    expect(timingTargets()[timingTargets().length - 1]).toBe(clamp(22));
  });

  // ── Case 3: Multi-line cascade (22→48→70→92) ─────────────────────────────
  // Each step must be one continuous interpolation, NOT a separate global
  // layout transaction.
  // _Requirements: 1.3 (defect) / 2.3 (expected)_
  it('applies one continuous withTiming retarget per step, never a per-step layout transaction (cascade 22→48→70→92)', () => {
    const { ti } = renderBar();

    const seq = [22, 48, 70, 92];
    seq.forEach((h) => fireHeight(ti, h));

    // No global layout transaction is issued for any step.
    expect(configureNextSpy).not.toHaveBeenCalled();
    // Every within-range step retargets the clamped height via withTiming.
    expect(timingTargets()).toEqual(
      expect.arrayContaining([clamp(48), clamp(70), clamp(92)]),
    );
  });

  // ── Case 4: Chat-open mount-frame baseline ───────────────────────────────
  // Mounting the bar (the input-bar contribution to chat-open) must schedule
  // NO height animation on the mount/navigation frame.
  // _Requirements: 1.4 (defect) / 2.4 (expected)_
  it('schedules no height animation on the mount frame (chat-open baseline)', () => {
    renderBar(); // mount only — no content-size change yet

    expect(configureNextSpy).not.toHaveBeenCalled();
    expect(withTimingMock).not.toHaveBeenCalled();
  });

  // ── Scoped property: random monotonic / oscillating sequences ────────────
  // Deterministic reproduction over the bug-condition input space: any sequence
  // of within-range heights fed back-to-back must retarget via withTiming and
  // never fire LayoutAnimation.configureNext.
  // _Requirements: 2.1, 2.2, 2.3_
  it('property: any within-range height sequence retargets via withTiming, never via LayoutAnimation', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 22, max: 100 }), { minLength: 2, maxLength: 8 }),
        (heights) => {
          configureNextSpy.mockClear();
          withTimingMock.mockClear();
          const { ti, renderer } = renderBar();

          let prev = -1;
          const expectedTargets: number[] = [];
          heights.forEach((h) => {
            const rounded = Math.round(h);
            if (rounded !== prev) {
              expectedTargets.push(clamp(rounded));
              prev = rounded;
            }
            fireHeight(ti, h);
          });

          const okNoSnap = configureNextSpy.mock.calls.length === 0;
          const okRetarget =
            expectedTargets.length === 0 ||
            expectedTargets.every((t) => timingTargets().includes(t));

          act(() => renderer.unmount());
          renderers.pop();

          return okNoSnap && okRetarget;
        },
      ),
      { numRuns: 50 },
    );
  });
});
