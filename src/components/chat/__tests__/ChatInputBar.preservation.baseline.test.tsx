// Composer behaviour: what the Nov 2026 redesign must keep, and what it now does.
//
// HISTORY. This file began as the preservation baseline of the chat-input-animation-fix spec and
// pinned the horizontal "swallow" (the field sliding over the photo button at a 28/34 pt content
// height hysteresis). The swallow was removed on purpose: with our own glass the photo button stayed
// visible through the expanded field (reported as the leftover rounded button), and the GIF chip and
// the top-left emoji button became one emoji button. Asserting the old hysteresis would only keep a
// removed feature alive, so those cases were replaced by the new behaviour:
//
//   - the send transition: a round send button outside the field while it is empty; once there is
//     something to send, the field's surface covers that place and a pill inside the field sends.
//     One UI-thread transition per empty ⇄ non-empty flip, never per keystroke.
//   - one emoji button inside the field (keyboard icon while a panel is open), no GIF button.
//
// Kept unchanged from the baseline: the TextInput's min/max height clamp, per-keystroke render
// isolation to the memoized ChatField, the import surface (no new native module, so still
// OTA-deliverable) and the exact `app.json` `ios.infoPlist` key set (the iOS permission surface).
//
// Library: Jest (jest-expo preset) + react-test-renderer + fast-check, the repo convention.

import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { LayoutAnimation, TextInput, StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import fc from 'fast-check';

// ─── Liquid-glass toggle (mutable so individual tests can pick the path) ────
// Prefixed `mock` so Jest's hoisted factory may reference it.
let mockGlassActive = false;

// react-native-reanimated: deterministic mock. `withTiming`/`withSpring` are jest.fns that RETURN
// their numeric target, so a shared value becomes a real number. Their recorded targets are the
// observable animation decisions. `Reanimated.View` renders as a plain RN View (observable tree).
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
    cubic: (t: number) => t * t * t,
    out: (fn: (t: number) => number) => fn,
  };
  // Chainable stand-in for Reanimated's layout-transition builder (built at module scope).
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

// LiquidGlass: `useLiquidGlassActive` is a jest.fn reading the mutable toggle. It is called EXACTLY
// ONCE per ChatInputBar (parent) render and by nothing else, so its call count is a clean
// parent-render counter for the render isolation test. Glass views are passthroughs.
jest.mock('../../ui/LiquidGlass', () => {
  const React_ = require('react');
  const { View } = require('react-native');
  const Passthrough = ({ children, ...rest }: any) =>
    React_.createElement(View, rest, children);
  return {
    __esModule: true,
    useLiquidGlassActive: jest.fn(() => mockGlassActive),
    NativeGlassView: Passthrough,
  };
});

jest.mock('../AnimatedKeyboardIcon', () => ({ AnimatedKeyboardIcon: () => null }));
jest.mock('../AnimatedEmojiIcon', () => ({ AnimatedEmojiIcon: () => null }));
jest.mock('expo-paste-input', () => ({}), { virtual: true });
// The real icon component loads its font asynchronously and sets state outside `act`.
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));

jest.mock('../../../theme', () => ({
  useTheme: () => ({
    isDark: false,
    colors: {
      text: { primary: '#000', secondary: '#555', tertiary: '#999' },
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

interface BarProps {
  hasPendingImages?: boolean;
  emojiOpen?: boolean;
  gifOpen?: boolean;
  isEditing?: boolean;
}

function element(ref: React.RefObject<ChatInputBarHandle | null>, handlers: Record<string, jest.Mock>, props: BarProps) {
  return (
    <ChatInputBar
      ref={ref}
      isEditing={props.isEditing ?? false}
      hasPendingImages={props.hasPendingImages ?? false}
      onSend={handlers.onSend}
      onPickImages={handlers.onPickImages}
      onOpenEmoji={handlers.onOpenEmoji}
      onToggleEmoji={handlers.onToggleEmoji}
      emojiOpen={props.emojiOpen}
      gifOpen={props.gifOpen}
      inputRowStyle={{}}
    />
  );
}

function renderBar(props: BarProps = {}) {
  const ref = React.createRef<ChatInputBarHandle>();
  const handlers = {
    onSend: jest.fn(),
    onPickImages: jest.fn(),
    onOpenEmoji: jest.fn(),
    onToggleEmoji: jest.fn(),
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element(ref, handlers, props));
  });
  renderers.push(renderer);
  const rerender = (next: BarProps) => {
    act(() => renderer.update(element(ref, handlers, next)));
  };
  return { renderer, ref, handlers, rerender, ti: renderer.root.findByType(TextInput) };
}

// `withTiming` drives the send transition (1 = something to send, 0 = empty). Its recorded targets
// are the observable decision sequence.
function sendTransitions(): number[] {
  return withTimingMock.mock.calls.map((c: unknown[]) => c[0] as number);
}

/** The outermost instance with a testID (the component the bar rendered, not its host view). */
function byTestId(renderer: TestRenderer.ReactTestRenderer, id: string): TestRenderer.ReactTestInstance {
  const all = renderer.root.findAll((n) => n.props.testID === id);
  expect(all.length).toBeGreaterThan(0);
  return all[0];
}

/** One host node per rendered button carrying the accessibility label. */
function buttons(renderer: TestRenderer.ReactTestRenderer, label: string): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityLabel === label);
}

/** Press the button a host node belongs to (the nearest ancestor with `onPress`). */
function press(node: TestRenderer.ReactTestInstance) {
  let cur: TestRenderer.ReactTestInstance | null = node;
  while (cur && typeof cur.props.onPress !== 'function') cur = cur.parent;
  expect(cur).not.toBeNull();
  act(() => cur!.props.onPress());
}

/** Which send button takes touches: the pill inside the field, or the round one outside it. */
function sendWrappers(renderer: TestRenderer.ReactTestRenderer) {
  return {
    inner: byTestId(renderer, 'composer-send-pill'),
    outer: byTestId(renderer, 'composer-send-round'),
  };
}

let configureNextSpy: jest.SpyInstance;

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

describe('ChatInputBar composer behaviour', () => {
  // ── Keystrokes schedule nothing ──────────────────────────────────────────
  it('schedules no animation on mount or for keystrokes that keep the field non-empty', () => {
    const { ref } = renderBar();
    expect(sendTransitions()).toEqual([]);

    act(() => ref.current?.setText('a'));
    expect(sendTransitions()).toEqual([1]);

    act(() => ref.current?.setText('ab'));
    act(() => ref.current?.setText('abc'));
    act(() => ref.current?.insert('😀'));
    expect(sendTransitions()).toEqual([1]);
    expect(withSpringMock).not.toHaveBeenCalled();
    expect(configureNextSpy).not.toHaveBeenCalled();
  });

  // ── Max-height internal scroll (unchanged) ────────────────────────────────
  it('keeps TextInput minHeight 22 / maxHeight 100 so content above the cap scrolls internally', () => {
    const { ti, ref } = renderBar();

    expect(ti.props.style.minHeight).toBe(MIN_FIELD_HEIGHT);
    expect(ti.props.style.maxHeight).toBe(MAX_FIELD_HEIGHT);
    expect(ti.props.multiline).toBe(true);

    act(() => ref.current?.setText('line\n'.repeat(40)));
    const tiAfter = renderers[renderers.length - 1].root.findByType(TextInput);
    expect(tiAfter.props.style.maxHeight).toBe(MAX_FIELD_HEIGHT);
    expect(tiAfter.props.style.minHeight).toBe(MIN_FIELD_HEIGHT);
  });

  // ── The send transition ───────────────────────────────────────────────────
  it('moves send into the field once there is text, and back out when it is cleared (both paths)', () => {
    for (const glass of [false, true]) {
      mockGlassActive = glass;
      withTimingMock.mockClear();
      const { ref, renderer } = renderBar();

      // Empty: only the round button outside the field takes touches.
      let w = sendWrappers(renderer);
      expect(w.outer?.props.pointerEvents).toBe('auto');
      expect(w.inner?.props.pointerEvents).toBe('none');

      act(() => ref.current?.setText('hello'));
      w = sendWrappers(renderer);
      expect(w.outer?.props.pointerEvents).toBe('none');
      expect(w.inner?.props.pointerEvents).toBe('auto');

      act(() => ref.current?.clear());
      w = sendWrappers(renderer);
      expect(w.outer?.props.pointerEvents).toBe('auto');
      expect(w.inner?.props.pointerEvents).toBe('none');

      expect(sendTransitions()).toEqual([1, 0]);
    }
  });

  it('treats whitespace-only text as empty', () => {
    const { ref } = renderBar();
    act(() => ref.current?.setText('   \n  '));
    expect(sendTransitions()).toEqual([]);
  });

  it('shows the send pill for pending photos with no text, and hides it when they go', () => {
    const { rerender, renderer } = renderBar({ hasPendingImages: false });
    rerender({ hasPendingImages: true });
    expect(sendWrappers(renderer).inner?.props.pointerEvents).toBe('auto');
    rerender({ hasPendingImages: false });
    expect(sendWrappers(renderer).inner?.props.pointerEvents).toBe('none');
    expect(sendTransitions()).toEqual([1, 0]);
  });

  it('sends the text from the pill and clears the field', () => {
    const { ref, renderer, handlers } = renderBar();
    act(() => ref.current?.setText('draft'));
    // Two send buttons: the pill inside the field (rendered first) and the round one outside it.
    const send = buttons(renderer, 'chat.composer.send_a11y');
    expect(send).toHaveLength(2);
    press(send[0]);
    expect(handlers.onSend).toHaveBeenCalledWith('draft');
    expect(ref.current?.getText()).toBe('');
    expect(sendTransitions()).toEqual([1, 0]);
  });

  it('labels both send buttons as save while editing', () => {
    const { renderer } = renderBar({ isEditing: true });
    expect(buttons(renderer, 'chat.composer.save_a11y')).toHaveLength(2);
    expect(buttons(renderer, 'chat.composer.send_a11y')).toHaveLength(0);
  });

  // ── The text column never changes width ───────────────────────────────────
  it('keeps the field box padding constant, so typing never re-wraps the text', () => {
    const { ref, renderer } = renderBar();
    const before = StyleSheet.flatten(byTestId(renderer, 'composer-field').props.style);
    act(() => ref.current?.setText('hello'));
    const after = StyleSheet.flatten(byTestId(renderer, 'composer-field').props.style);
    expect(after.paddingLeft).toBe(before.paddingLeft);
    expect(after.paddingRight).toBe(before.paddingRight);
    // The send button's slot is reserved inside the box rather than taken from it.
    expect(after.paddingRight).toBeGreaterThan(after.paddingLeft as number);
    expect(after.width).toBeUndefined();
    expect(after.height).toBeUndefined();
  });

  // ── One emoji button; GIFs live in the panel ──────────────────────────────
  it('has one emoji button that opens the panel, and a keyboard button while a panel is open', () => {
    const { renderer, handlers, rerender } = renderBar();

    expect(buttons(renderer, 'chat.composer.emoji_a11y')).toHaveLength(1);
    press(buttons(renderer, 'chat.composer.emoji_a11y')[0]);
    expect(handlers.onOpenEmoji).toHaveBeenCalledTimes(1);

    for (const open of [{ emojiOpen: true }, { gifOpen: true }]) {
      rerender(open);
      expect(buttons(renderer, 'chat.composer.emoji_a11y')).toHaveLength(0);
      expect(buttons(renderer, 'chat.composer.keyboard_a11y')).toHaveLength(1);
    }
    press(buttons(renderer, 'chat.composer.keyboard_a11y')[0]);
    expect(handlers.onToggleEmoji).toHaveBeenCalledTimes(1);
  });

  it('keeps the photo button outside the field', () => {
    const { renderer, handlers } = renderBar();
    const photo = buttons(renderer, 'chat.composer.attach_a11y');
    expect(photo).toHaveLength(1);
    const field = byTestId(renderer, 'composer-field');
    expect(field.findAll((n) => n === photo[0])).toHaveLength(0);
    press(photo[0]);
    expect(handlers.onPickImages).toHaveBeenCalledTimes(1);
  });

  // ── Render isolation (unchanged) ──────────────────────────────────────────
  // Typing re-renders ONLY the memoized ChatField, never the parent ChatInputBar, except for the
  // single empty⇄non-empty flip that drives send. `useLiquidGlassActive` is called once per parent
  // render, so its call count is the parent render counter.
  it('isolates per-keystroke renders to ChatField (parent renders only on empty⇄non-empty flip)', () => {
    const { ref } = renderBar();

    const rendersAtMount = useLiquidGlassActiveMock.mock.calls.length;

    act(() => ref.current?.setText('a'));
    const rendersAfterFirstChar = useLiquidGlassActiveMock.mock.calls.length;

    act(() => ref.current?.setText('ab'));
    act(() => ref.current?.setText('abc'));
    act(() => ref.current?.setText('abcd'));
    const rendersAfterTyping = useLiquidGlassActiveMock.mock.calls.length;

    expect(rendersAfterFirstChar - rendersAtMount).toBe(1);
    expect(rendersAfterTyping - rendersAfterFirstChar).toBe(0);
  });

  // ── No new native module / permission (OTA + Apple compliance) ───────────
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
      // Pure-TS constants module (MAX_MESSAGE_CHARS). Not a native module, so it does not weaken
      // what this test guards: no new native surface, still OTA-deliverable, no Info.plist change.
      '../../utils/textLimits',
      '../ui/LiquidGlass',
      './AnimatedKeyboardIcon',
      './AnimatedEmojiIcon',
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
        // Back in Nov 2026, deliberately: the profile QR screen's "Сканировать QR-код" button reads
        // QR codes with expo-camera. Used only while scanning; nothing is recorded or sent. The
        // image-picker and expo-camera plugins carry the same string (app.json), with no microphone.
        'NSCameraUsageDescription',
        'NSPhotoLibraryAddUsageDescription',
        'NSPhotoLibraryUsageDescription',
        // Not a permission: React Native's release level, read by ExpoReactNativeFactory. It turns
        // on `preventShadowTreeCommitExhaustion`, which Reanimated's commit-pausing flag needs.
        // See scripts/eas-build-pre-install.js and .kiro/steering/apple-compliance.md.
        'ReactNativeReleaseLevel',
        'UIBackgroundModes',
      ].sort(),
    );
    // No tracking / motion / mic / location keys snuck in (compliance).
    expect(keys).not.toContain('NSUserTrackingUsageDescription');
    expect(keys).not.toContain('NSMotionUsageDescription');
    expect(keys).not.toContain('NSMicrophoneUsageDescription');
    // The camera string must say what the camera is for: QR scanning, nothing recorded.
    expect(String(appJson.expo.ios.infoPlist.NSCameraUsageDescription)).toMatch(/QR/);
  });

  // ── Property: one transition per emptiness flip, whatever is typed ────────
  it('property: any sequence of edits produces exactly one transition per empty ⇄ non-empty flip', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.constant(''), fc.constant('  '), fc.string({ minLength: 1, maxLength: 6 })), { minLength: 1, maxLength: 12 }),
        (texts) => {
          withTimingMock.mockClear();
          const { ref, renderer } = renderBar();

          let had = false;
          const expected: number[] = [];
          texts.forEach((s) => {
            const has = s.trim().length > 0;
            if (has !== had) {
              had = has;
              expected.push(has ? 1 : 0);
            }
          });

          texts.forEach((s) => act(() => ref.current?.setText(s)));

          const ok = JSON.stringify(sendTransitions()) === JSON.stringify(expected);
          act(() => renderer.unmount());
          renderers.pop();
          return ok;
        },
      ),
      { numRuns: 50 },
    );
  });
});
