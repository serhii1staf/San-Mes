// Bugfix spec: chat-input-animation-fix — Task 2
// Preservation baseline tests (Property 2: Preservation — Non-Buggy Input
// Behavior Unchanged).
//
//   **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
//
// METHODOLOGY (observation-first): these tests capture the OBSERVABLE baseline
// of the CURRENT (unfixed) ChatInputBar for inputs where `isBugCondition`
// returns FALSE — i.e. everything that is NOT a within-range line-count change
// and NOT a chat-open. They MUST PASS on the unfixed code (they record the
// behavior the fix must preserve) and are re-run unchanged in task 3.8.
//
// To stay valid across the fix (which swaps the height MECHANISM from a one-shot
// `LayoutAnimation.configureNext` to an interruptible `withTiming`), the
// assertions deliberately target mechanism-NEUTRAL observables that the fix
// leaves untouched:
//   - the `sw` swallow/expansion hysteresis (driven by `withSpring`, unchanged),
//   - the TextInput min/max-height clamp props (internal scroll, unchanged),
//   - send/clear collapse via `setExpanded(false)` (unchanged),
//   - per-keystroke render isolation to the memoized ChatField (unchanged),
//   - the import surface + `app.json` `ios.infoPlist` (no new native module /
//     permission — OTA-deliverable, Apple-compliant).
// For 3.1's dedupe we count *all* height schedules (configureNext + withTiming)
// so the "a duplicate height schedules nothing" assertion holds on BOTH the
// unfixed and the fixed mechanism.
//
// Library: Jest (jest-expo preset) + react-test-renderer + fast-check — repo
// convention, same mocking approach as ChatInputBar.heightTransition.bug.test.tsx.
// No new dependencies.

import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { LayoutAnimation, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import fc from 'fast-check';

// ─── Liquid-glass toggle (mutable so individual tests can pick the path) ────
// Prefixed `mock` so Jest's hoisted factory may reference it.
let mockGlassActive = false;

// react-native-reanimated: deterministic mock. `withSpring`/`withTiming` are
// jest.fns that RETURN their numeric target, so the shared value becomes a real
// number and `useAnimatedStyle`/`interpolate` evaluate without NaN. `interpolate`
// is a faithful clamped-linear implementation so collapsed/expanded style reads
// are meaningful. `Reanimated.View` renders as a plain RN View (observable tree).
jest.mock('react-native-reanimated', () => {
  const React_ = require('react');
  const { View } = require('react-native');
  const withTiming = jest.fn((toValue: number) => toValue);
  const withSpring = jest.fn((toValue: number) => toValue);
  const interpolate = jest.fn(
    (v: number, inRange: number[], outRange: number[]) => {
      const i0 = inRange[0];
      const i1 = inRange[inRange.length - 1];
      const o0 = outRange[0];
      const o1 = outRange[outRange.length - 1];
      if (v <= i0) return o0;
      if (v >= i1) return o1;
      const tt = (v - i0) / (i1 - i0);
      return o0 + tt * (o1 - o0);
    },
  );
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
  // Chainable stand-in for Reanimated's layout-transition builder. The composer
  // eases its (intrinsic) height change with `LinearTransition`, so the mock has
  // to support the `.duration(...).easing(...)` chain the component builds at
  // module scope — otherwise importing it throws before any test runs.
  const makeTransition = (config: Record<string, unknown> = {}) => ({
    __layoutTransition: 'linear',
    config,
    duration(ms: number) {
      return makeTransition({ ...config, duration: ms });
    },
    easing(fn: unknown) {
      return makeTransition({ ...config, easing: fn });
    },
  });
  const LinearTransition = makeTransition();
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
    LinearTransition,
  };
});

// LiquidGlass: `useLiquidGlassActive` is a jest.fn reading the mutable toggle.
// It is called EXACTLY ONCE per ChatInputBar (parent) render and by nothing
// else — so its call count is a clean parent-render counter for the render
// isolation test (3.6). Glass container/views are passthroughs.
jest.mock('../../ui/LiquidGlass', () => {
  const React_ = require('react');
  const { View } = require('react-native');
  const Passthrough = ({ children, ...rest }: any) =>
    React_.createElement(View, rest, children);
  return {
    __esModule: true,
    useLiquidGlassActive: jest.fn(() => mockGlassActive),
    NativeGlassView: Passthrough,
    GlassContainerView: Passthrough,
  };
});

jest.mock('../AnimatedKeyboardIcon', () => ({ AnimatedKeyboardIcon: () => null }));
jest.mock('../AnimatedEmojiIcon', () => ({ AnimatedEmojiIcon: () => null }));
jest.mock('../AnimatedGifIcon', () => ({ AnimatedGifIcon: () => null }));
jest.mock('expo-paste-input', () => ({}), { virtual: true });

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
import * as LiquidGlass from '../../ui/LiquidGlass';

const withSpringMock = (Reanimated as any).withSpring as jest.MockedFunction<any>;
const withTimingMock = (Reanimated as any).withTiming as jest.MockedFunction<any>;
const useLiquidGlassActiveMock =
  (LiquidGlass as any).useLiquidGlassActive as jest.MockedFunction<any>;

const MIN_FIELD_HEIGHT = 22;
const MAX_FIELD_HEIGHT = 100;

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

function fireHeight(ti: TestRenderer.ReactTestInstance, h: number) {
  act(() => {
    ti.props.onContentSizeChange({ nativeEvent: { contentSize: { height: h } } });
  });
}

// `withSpring` is the ONLY driver of the swallow/expansion shared value `sw`.
// Its recorded target values (1 = expand, 0 = collapse) are the observable
// hysteresis decision sequence.
function expansionTransitions(): number[] {
  return withSpringMock.mock.calls.map((c: unknown[]) => c[0] as number);
}

// Total scheduled height animations, mechanism-neutral: the unfixed code uses
// LayoutAnimation.configureNext (counted via the spy); the fixed code would use
// withTiming. Counting both keeps the dedupe assertion (3.1) valid across the fix.
let configureNextSpy: jest.SpyInstance;
function heightScheduleCount(): number {
  return configureNextSpy.mock.calls.length + withTimingMock.mock.calls.length;
}

beforeEach(() => {
  mockGlassActive = false;
  configureNextSpy = jest
    .spyOn(LayoutAnimation, 'configureNext')
    .mockImplementation(() => {});
  withSpringMock.mockClear();
  withTimingMock.mockClear();
  useLiquidGlassActiveMock.mockClear();
});

afterEach(() => {
  while (renderers.length) {
    const r = renderers.pop();
    act(() => r?.unmount());
  }
  configureNextSpy.mockRestore();
});

describe('ChatInputBar preservation baseline (Task 2 — ¬isBugCondition behavior)', () => {
  // ── 3.1 Single-line stability + dedupe ───────────────────────────────────
  // A single-line height keeps the field collapsed (no expansion), and a
  // keystroke that does NOT change content height schedules no height animation
  // (deduped by lastHeightRef).
  // _Requirements: 3.1_
  it('keeps single-line collapsed and schedules nothing for a duplicate (unchanged) height', () => {
    const { ti } = renderBar();

    // Single-line content height (≤ 34) — must NOT expand the swallow.
    fireHeight(ti, MIN_FIELD_HEIGHT);
    expect(expansionTransitions()).not.toContain(1);

    const afterFirst = heightScheduleCount();
    // Same height again (a keystroke that doesn't change the line count).
    fireHeight(ti, MIN_FIELD_HEIGHT);
    const afterDuplicate = heightScheduleCount();

    // The duplicate scheduled zero additional height animations (dedupe).
    expect(afterDuplicate - afterFirst).toBe(0);
    // Still collapsed.
    expect(expansionTransitions()).not.toContain(1);
  });

  // ── 3.2 Max-height internal scroll ───────────────────────────────────────
  // The TextInput keeps minHeight: 22 / maxHeight: 100 so the OS caps growth at
  // ~5 lines and scrolls the content internally past that point. Driving a
  // content height above the cap does not alter those clamp props.
  // _Requirements: 3.2_
  it('keeps TextInput minHeight 22 / maxHeight 100 so content above the cap scrolls internally', () => {
    const { ti } = renderBar();

    expect(ti.props.style.minHeight).toBe(MIN_FIELD_HEIGHT);
    expect(ti.props.style.maxHeight).toBe(MAX_FIELD_HEIGHT);
    expect(ti.props.multiline).toBe(true);

    // Content far above the cap — clamp props are unchanged (internal scroll).
    fireHeight(ti, 150);
    const tiAfter = renderers[renderers.length - 1].root.findByType(TextInput);
    expect(tiAfter.props.style.maxHeight).toBe(MAX_FIELD_HEIGHT);
    expect(tiAfter.props.style.minHeight).toBe(MIN_FIELD_HEIGHT);
  });

  // ── 3.3 Horizontal swallow + emoji reveal hysteresis (28 / 34) ───────────
  // setExpanded(true) at h > 34, setExpanded(false) at h < 28; the dead band
  // [28, 34] holds the current state. The emoji overlay reveal rides the SAME
  // `sw` value, so the single expansion decision sequence covers both.
  // _Requirements: 3.3_
  it('expands at h>34, collapses at h<28, and holds within the 28–34 dead band', () => {
    const { ti, renderer } = renderBar();

    fireHeight(ti, 40); // > 34 → expand
    fireHeight(ti, 30); // dead band (still expanded) → no change
    fireHeight(ti, 26); // < 28 → collapse
    fireHeight(ti, 32); // dead band (still collapsed) → no change
    fireHeight(ti, 36); // > 34 → expand

    expect(expansionTransitions()).toEqual([1, 0, 1]);

    // The emoji reveal overlay is present and animated off `sw` (it renders a
    // Reanimated.View sibling inside the field wrapper).
    const animatedViews = renderer.root.findAllByType((Reanimated as any).View);
    expect(animatedViews.length).toBeGreaterThan(0);
  });

  // ── 3.4 Glass union once-per-transition ──────────────────────────────────
  // With liquid glass active, the glass-merge flips via the threshold-snapped
  // swallow. The flip fires ONCE per expand/collapse (guarded by the expansion
  // ref), NOT once per height frame — so a whole cascade of growing/shrinking
  // heights produces exactly one expand and one collapse.
  // _Requirements: 3.4_
  it('flips the glass-merge once per expand/collapse, not per height frame (glass active)', () => {
    mockGlassActive = true;
    const { ti } = renderBar();

    // Cascade of growing heights, all in the expanded zone (> 34).
    [40, 55, 70, 90].forEach((h) => fireHeight(ti, h));
    // Cascade of shrinking heights, all in the collapsed zone (< 28).
    [26, 24, 22].forEach((h) => fireHeight(ti, h));

    // Exactly one expand (1) and one collapse (0) — not one per frame.
    expect(expansionTransitions()).toEqual([1, 0]);
  });

  // ── 3.5 Send/clear collapse ──────────────────────────────────────────────
  // clear() and setText('') both reset the field to its base/empty state and
  // collapse the swallow via setExpanded(false).
  // _Requirements: 3.5_
  it('collapses and clears text on clear()', () => {
    const { ti, ref } = renderBar();

    fireHeight(ti, 40); // expand first
    expect(expansionTransitions()).toEqual([1]);

    act(() => ref.current?.setText('hello'));
    expect(ref.current?.getText()).toBe('hello');

    act(() => ref.current?.clear());

    expect(ref.current?.getText()).toBe('');
    // Last expansion decision is collapse (0).
    expect(expansionTransitions()[expansionTransitions().length - 1]).toBe(0);
  });

  it('collapses on setText("") (send path)', () => {
    const { ti, ref } = renderBar();

    fireHeight(ti, 40); // expand
    act(() => ref.current?.setText('draft'));
    act(() => ref.current?.setText('')); // send/clear path

    expect(ref.current?.getText()).toBe('');
    expect(expansionTransitions()[expansionTransitions().length - 1]).toBe(0);
  });

  // ── 3.6 Render isolation ─────────────────────────────────────────────────
  // Typing (setText through the field handle) re-renders ONLY the memoized
  // ChatField, never the parent ChatInputBar — except for the single empty⇄
  // non-empty flip that drives send-enable. `useLiquidGlassActive` is called
  // once per parent render, so its call count is the parent render counter.
  // _Requirements: 3.6_
  it('isolates per-keystroke renders to ChatField (parent renders only on empty⇄non-empty flip)', () => {
    const { ref } = renderBar();

    const rendersAtMount = useLiquidGlassActiveMock.mock.calls.length; // 1

    act(() => ref.current?.setText('a')); // empty → non-empty: one parent render
    const rendersAfterFirstChar = useLiquidGlassActiveMock.mock.calls.length;

    act(() => ref.current?.setText('ab'));
    act(() => ref.current?.setText('abc'));
    act(() => ref.current?.setText('abcd')); // non-empty → non-empty: no parent render
    const rendersAfterTyping = useLiquidGlassActiveMock.mock.calls.length;

    // The first character flipped emptiness → exactly one parent render.
    expect(rendersAfterFirstChar - rendersAtMount).toBe(1);
    // Subsequent keystrokes did NOT re-render the parent.
    expect(rendersAfterTyping - rendersAfterFirstChar).toBe(0);
  });

  // ── 3.7 No new native module / permission (OTA + Apple compliance) ───────
  // The change set imports no new native module, and app.json ios.infoPlist
  // (the iOS permission surface) is unchanged. These guard the OTA-deliverable,
  // Apple-compliant contract.
  // _Requirements: 3.7_
  it('imports only the established module surface (no new native module)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../ChatInputBar.tsx'),
      'utf8',
    );
    const specifiers = new Set<string>();
    const importRe = /from\s+['"]([^'"]+)['"]/g;
    const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(src)) !== null) specifiers.add(m[1]);
    while ((m = requireRe.exec(src)) !== null) specifiers.add(m[1]);

    const expected = new Set<string>([
      'react',
      'react-native',
      'react-native-reanimated',
      '@expo/vector-icons',
      '../../theme',
      '../../i18n/store',
      '../../services/perfMonitor',
      '../ui/LiquidGlass',
      './AnimatedKeyboardIcon',
      './AnimatedEmojiIcon',
      './AnimatedGifIcon',
      'expo-paste-input',
    ]);

    expect([...specifiers].sort()).toEqual([...expected].sort());
  });

  it('leaves app.json ios.infoPlist (iOS permission surface) unchanged', () => {
    const appJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../../app.json'), 'utf8'),
    );
    const keys = Object.keys(appJson.expo.ios.infoPlist).sort();
    expect(keys).toEqual(
      [
        'ITSAppUsesNonExemptEncryption',
        'NSCameraUsageDescription',
        'NSPhotoLibraryAddUsageDescription',
        'NSPhotoLibraryUsageDescription',
        'UIBackgroundModes',
      ].sort(),
    );
    // No tracking / motion / mic / location keys snuck in (compliance).
    expect(keys).not.toContain('NSUserTrackingUsageDescription');
    expect(keys).not.toContain('NSMotionUsageDescription');
    expect(keys).not.toContain('NSMicrophoneUsageDescription');
  });

  // ── Property: swallow hysteresis is unchanged across random height sequences ─
  // For any sequence of content heights, the observed expansion decisions match
  // a reference hysteresis (expand at h>34, collapse at h<28, dead band holds,
  // consecutive duplicates deduped) — exercising edge cases exactly at 28/34.
  // _Requirements: 3.3_
  it('property: random height sequences reproduce the exact 28/34 hysteresis decisions', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 10, max: 120 }), { minLength: 1, maxLength: 12 }),
        (heights) => {
          withSpringMock.mockClear();
          const { ti, renderer } = renderBar();

          // Reference model of the preserved hysteresis + lastHeightRef dedupe.
          let expanded = false;
          let prev = -1;
          const expected: number[] = [];
          heights.forEach((h) => {
            const r = Math.round(h);
            if (r === prev) return; // deduped — early return, no decision
            prev = r;
            if (!expanded && r > 34) {
              expanded = true;
              expected.push(1);
            } else if (expanded && r < 28) {
              expanded = false;
              expected.push(0);
            }
          });

          heights.forEach((h) => fireHeight(ti, h));

          const ok =
            JSON.stringify(expansionTransitions()) === JSON.stringify(expected);

          act(() => renderer.unmount());
          renderers.pop();
          return ok;
        },
      ),
      { numRuns: 50 },
    );
  });
});
