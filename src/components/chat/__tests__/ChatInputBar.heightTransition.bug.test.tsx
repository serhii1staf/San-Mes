// Bugfix spec: chat-input-animation-fix — Task 1
// Regression tests for the composer's height behaviour.
//
// WHY THIS FILE WAS REWRITTEN
// ---------------------------
// The first version of these tests asserted the MECHANISM: that a height change
// produced a `withTiming(...)` call and no `LayoutAnimation.configureNext`. Every
// one of them passed while the composer, on a real device, stopped growing
// altogether — because the implementation had moved the height onto an explicit
// animated value, and "a withTiming call happened" says nothing about whether
// the field can still resize. The tests validated the plumbing and missed the
// outcome, which is exactly how the regression shipped twice.
//
// These tests instead pin the STRUCTURAL property that makes growth work:
//
//   The composer's height must stay INTRINSIC. No JS-owned `height` may be
//   applied to the field wrapper, because the inner TextInput is
//   `alignSelf: 'stretch'` — a fixed parent height forces its frame and makes
//   growth depend entirely on `onContentSizeChange` landing.
//
// Smoothing is a Reanimated LAYOUT TRANSITION (the Fabric-correct mechanism —
// this app runs `newArchEnabled: true`, where `LayoutAnimation` is not honoured
// the way the old renderer did). A layout transition animates the view's real
// measured frame, so if it were ever a no-op the field would still grow. That
// ordering — growth structural, animation cosmetic — is what these tests lock in.
//
// Library: Jest (jest-expo preset) + react-test-renderer + fast-check — the repo
// convention (no @testing-library/react-native dependency).
//
//   _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TextInput, View, LayoutAnimation, StyleSheet } from 'react-native';
import fc from 'fast-check';

// ─── Mocks (minimal surface — only what ChatInputBar actually touches) ──────

// react-native-reanimated: deterministic mock. `Reanimated.View` renders as a
// plain RN View so the tree (and the styles/props applied to it) is observable.
// `LinearTransition` mimics the real builder's chainable shape and records the
// configuration so a test can assert a transition was actually attached.
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
  // Chainable stand-in for the real layout-transition builder.
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

// Liquid glass OFF → take the flat (non-glass) render path, which renders plain
// Views and keeps the tree simple. The height behaviour under test is identical
// on both paths: it is the TextInput's own measurement either way.
jest.mock('../../ui/LiquidGlass', () => {
  const React_ = require('react');
  const { View } = require('react-native');
  const Passthrough = ({ children, ...rest }: any) =>
    React_.createElement(View, rest, children);
  return {
    __esModule: true,
    useLiquidGlassActive: () => false,
    NativeGlassView: Passthrough,
  };
});

// Animated icons → trivial stand-ins (no SVG/Lottie work in the test tree).
jest.mock('../AnimatedKeyboardIcon', () => ({ AnimatedKeyboardIcon: () => null }));
jest.mock('../AnimatedEmojiIcon', () => ({ AnimatedEmojiIcon: () => null }));

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
jest.mock('../../../i18n/store', () => ({ useT: () => (_k: string, d?: string) => d ?? '' }));
jest.mock('../../../services/perfMonitor', () => ({
  perfMonitor: { markInputFocus: () => {} },
}));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));

// eslint-disable-next-line import/first
import { ChatInputBar, type ChatInputBarHandle } from '../ChatInputBar';

// ─── Harness ────────────────────────────────────────────────────────────────

const renderers: any[] = [];

interface BarState {
  hasPendingImages?: boolean;
  emojiOpen?: boolean;
  isEditing?: boolean;
}

function renderBar() {
  let renderer!: any;
  const ref = React.createRef<ChatInputBarHandle>();
  const el = (s: BarState) => (
    <ChatInputBar
      ref={ref}
      isEditing={!!s.isEditing}
      hasPendingImages={!!s.hasPendingImages}
      onSend={() => {}}
      onPickImages={() => {}}
      emojiOpen={!!s.emojiOpen}
      gifOpen={false}
      inputRowStyle={{}}
    />
  );
  act(() => {
    renderer = TestRenderer.create(el({}));
  });
  renderers.push(renderer);
  const ti = renderer.root.findByType(TextInput);
  const update = (s: BarState) => act(() => renderer.update(el(s)));
  return { renderer, ti, ref, update };
}

/**
 * Everything that can change the composer's state, as a step a test can replay: text of one to many
 * lines, clearing, pending photos, an open panel, editing. The TextInput's own measurement is not
 * reproducible in a test renderer, so what is checked is the part JS controls: that none of these
 * ever hands a view around the TextInput a fixed height.
 */
type Step = { kind: 'text'; lines: number } | { kind: 'clear' } | { kind: 'state'; state: BarState };

function apply(bar: ReturnType<typeof renderBar>, step: Step) {
  if (step.kind === 'text') act(() => bar.ref.current?.setText(Array.from({ length: step.lines }, (_, i) => `line ${i}`).join('\n')));
  else if (step.kind === 'clear') act(() => bar.ref.current?.clear());
  else bar.update(step.state);
}

const CASCADE: Step[] = [
  { kind: 'text', lines: 1 },
  { kind: 'text', lines: 3 },
  { kind: 'text', lines: 6 },
  { kind: 'state', state: { emojiOpen: true } },
  { kind: 'text', lines: 2 },
  { kind: 'state', state: { hasPendingImages: true } },
  { kind: 'clear' },
  { kind: 'state', state: { isEditing: true } },
  { kind: 'text', lines: 4 },
  { kind: 'state', state: {} },
  { kind: 'clear' },
];

/**
 * Every `height` applied to a View on the TextInput's ANCESTOR chain.
 *
 * Scoped to that chain on purpose. The bar legitimately contains fixed-size
 * chrome (the 44 pt round photo/send buttons, the 32 pt send pill, the 24 pt
 * emoji button) whose heights are correct and must not be flagged. The defect is
 * specifically a height on a view that ENCLOSES the TextInput, because that is
 * what caps the field's own measurement and stops it growing.
 *
 * `minHeight` is deliberately not collected: the capsule's `minHeight: 44` is
 * what gives the collapsed composer its resting size and is not a pin — it sets
 * a floor, it does not prevent growth.
 */
function pinnedAncestorHeights(renderer: any): unknown[] {
  const out: unknown[] = [];
  let node: any = renderer.root.findByType(TextInput).parent;
  while (node) {
    if (node.type === View) {
      const style = StyleSheet.flatten(node.props?.style) as Record<string, unknown> | undefined;
      if (style?.height !== undefined) out.push(style.height);
    }
    node = node.parent;
  }
  return out;
}

/** The View carrying the layout transition (the field content row). */
function transitionedViews(renderer: any): any[] {
  return renderer.root
    .findAllByType(View)
    .filter((n: any) => n.props?.layout?.__layoutTransition === 'linear');
}

let configureNextSpy: jest.SpyInstance;

beforeEach(() => {
  // `LayoutAnimation` is the wrong tool on the New Architecture; the fix must
  // not reach for it. Spied so any reintroduction fails loudly.
  configureNextSpy = jest
    .spyOn(LayoutAnimation, 'configureNext')
    .mockImplementation(() => {});
});

afterEach(() => {
  while (renderers.length) {
    const r = renderers.pop();
    act(() => r?.unmount());
  }
  configureNextSpy.mockRestore();
});

describe('ChatInputBar composer height — stays intrinsic', () => {
  // ── The core regression ──────────────────────────────────────────────────
  // _Requirements: 2.1, 2.2, 2.3_
  it('never applies a JS-owned height to the composer, so growth stays intrinsic', () => {
    const bar = renderBar();

    // Nothing pinned on the mount frame...
    expect(pinnedAncestorHeights(bar.renderer)).toStrictEqual([]);

    // ...and nothing pinned through a full cascade of composer states either. This is the
    // assertion the first version of this file lacked: it is what fails if the height is ever
    // moved back into JS.
    CASCADE.forEach((step) => {
      apply(bar, step);
      expect(pinnedAncestorHeights(bar.renderer)).toStrictEqual([]);
    });
  });

  it('does not listen to content-size changes at all (nothing in JS needs the height)', () => {
    const { ti } = renderBar();
    expect(ti.props.onContentSizeChange).toBeUndefined();
  });

  it('eases the resulting frame change with a Reanimated layout transition', () => {
    const { renderer } = renderBar();

    const transitioned = transitionedViews(renderer);
    // Exactly the field content row carries it — not every view in the bar.
    expect(transitioned).toHaveLength(1);
    // Configured with a real, bounded duration rather than left at the default.
    expect(transitioned[0].props.layout.config.duration).toBeGreaterThan(0);
    expect(transitioned[0].props.layout.config.duration).toBeLessThanOrEqual(300);
  });

  it('does not reach for LayoutAnimation (unsupported shape on Fabric)', () => {
    const bar = renderBar();
    CASCADE.forEach((step) => apply(bar, step));
    expect(configureNextSpy).not.toHaveBeenCalled();
  });

  // ── Preservation: the TextInput keeps its own bounds ─────────────────────
  // _Requirements: 3.1, 3.2_
  it('leaves the TextInput to bound itself (minHeight 22 / maxHeight 100, multiline)', () => {
    const { ti } = renderBar();
    const style = StyleSheet.flatten(ti.props.style) as Record<string, unknown>;

    expect(ti.props.multiline).toBe(true);
    expect(style.minHeight).toBe(22);
    // The cap is what makes the field scroll internally instead of growing
    // without limit (Requirement 3.2).
    expect(style.maxHeight).toBe(100);
    // And the TextInput itself must not be handed a fixed height either.
    expect(style.height).toBeUndefined();
  });

  // ── Scoped property over the whole bug-condition input space ─────────────
  // _Requirements: 2.1, 2.2, 2.3_
  it('property: no sequence of composer states, in any order, ever pins a height', () => {
    const step: fc.Arbitrary<Step> = fc.oneof(
      // Up to 12 lines: past the 100 pt cap (5 lines), where the TextInput scrolls internally.
      fc.integer({ min: 1, max: 12 }).map((lines) => ({ kind: 'text', lines }) as Step),
      fc.constant({ kind: 'clear' } as Step),
      fc
        .record({ hasPendingImages: fc.boolean(), emojiOpen: fc.boolean(), isEditing: fc.boolean() })
        .map((state) => ({ kind: 'state', state }) as Step),
    );
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 10 }), (steps) => {
        const bar = renderBar();
        let ok = true;
        steps.forEach((s) => {
          apply(bar, s);
          if (pinnedAncestorHeights(bar.renderer).length > 0) ok = false;
        });
        const noLayoutAnim = configureNextSpy.mock.calls.length === 0;

        act(() => bar.renderer.unmount());
        renderers.pop();
        return ok && noLayoutAnim;
      }),
      { numRuns: 50 },
    );
  });
});
