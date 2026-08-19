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
jest.mock('../../../i18n/store', () => ({ useT: () => (_k: string, d?: string) => d ?? '' }));
jest.mock('../../../services/perfMonitor', () => ({
  perfMonitor: { markInputFocus: () => {} },
}));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));

// eslint-disable-next-line import/first
import { ChatInputBar } from '../ChatInputBar';

// ─── Harness ────────────────────────────────────────────────────────────────

const renderers: any[] = [];

function renderBar() {
  let renderer!: any;
  act(() => {
    renderer = TestRenderer.create(
      <ChatInputBar
        isEditing={false}
        hasPendingImages={false}
        onSend={() => {}}
        onPickImages={() => {}}
        onOpenGif={() => {}}
        emojiOpen={false}
        gifOpen={false}
        inputRowStyle={{}}
      />,
    );
  });
  renderers.push(renderer);
  const ti = renderer.root.findByType(TextInput);
  return { renderer, ti };
}

/** Simulate the TextInput reporting a new measured content height. */
function fireHeight(ti: any, h: number) {
  act(() => {
    ti.props.onContentSizeChange({ nativeEvent: { contentSize: { height: h } } });
  });
}

/**
 * Every `height` applied to a View on the TextInput's ANCESTOR chain.
 *
 * Scoped to that chain on purpose. The bar legitimately contains fixed-size
 * chrome (the 44 pt send/attach capsules, the 30 pt emoji button, the 24 pt GIF
 * slot) whose heights are correct and must not be flagged. The defect is
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
    const { renderer, ti } = renderBar();

    // Nothing pinned on the mount frame...
    expect(pinnedAncestorHeights(renderer)).toStrictEqual([]);

    // ...and nothing pinned after a full grow/shrink cascade either. This is the
    // assertion the previous version of this file lacked: it is what fails if
    // the height is ever moved back into JS.
    [22, 48, 70, 92, 70, 22].forEach((h) => fireHeight(ti, h));
    expect(pinnedAncestorHeights(renderer)).toStrictEqual([]);
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
    const { ti } = renderBar();
    [22, 48, 70, 92].forEach((h) => fireHeight(ti, h));
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
  it('property: no height sequence, in any order, ever pins a height', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 140 }), { minLength: 1, maxLength: 10 }),
        (heights) => {
          const { renderer, ti } = renderBar();
          heights.forEach((h) => fireHeight(ti, h));

          const pinned = pinnedAncestorHeights(renderer);
          const noLayoutAnim = configureNextSpy.mock.calls.length === 0;

          act(() => renderer.unmount());
          renderers.pop();

          // Deliberately covers out-of-range values (0, >100) too: clamping used
          // to live in JS, and its removal must not resurrect a pinned height.
          return pinned.length === 0 && noLayoutAnim;
        },
      ),
      { numRuns: 50 },
    );
  });
});
