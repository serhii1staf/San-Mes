// Example / unit tests for Seasonal Profile Themes ambient-animation WIRING
// (task 5.5 of the seasonal-profile-themes spec). These exercise the real
// runtime behaviour that the profile-screen integration (task 6.1/6.2) relies
// on, at the boundary where it is actually implemented today:
//
//   * AmbientAnimationLayer (task 5.4) — honours the `paused` prop that the
//     scroll handlers / AppState / screen-focus drivers feed it:
//       - onScrollBeginDrag  → paused=true  → particles FREEZE (Req 6.2)
//       - onScrollEndDrag / onMomentumScrollEnd → paused=false → RESUME (Req 6.3)
//       - AppState 'background' → paused=true → FREEZE (Req 6.7)
//       - screen blur (unfocused) → paused=true → FREEZE (Req 6.7)
//     and while paused the fixed particle pool stays MOUNTED (frozen) so the
//     gradient + illustration remain visible as a static background (Req 6.4).
//
//   * useReducedMotion + useAmbientAnimationGate (task 3.4) — toggling the OS
//     reduce-motion setting at runtime flips the gate to `enabled=false` so the
//     ambient layer is suppressed, WITHOUT remounting the consumer (Req 7.3).
//
// Library: Jest + react-test-renderer (the repo convention — there is no
// @testing-library/react-native dependency; see MiniAppConsentDialog.test.tsx
// and ProfileThemeContext.property.test.tsx).
//
//   _Requirements: 6.2, 6.3, 6.4, 6.7, 7.3_

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

// ─── Mocks ────────────────────────────────────────────────────────────────

// react-native-reanimated: a minimal deterministic mock. `withRepeat` /
// `withTiming` / `cancelAnimation` become jest.fns so we can assert WHEN a
// particle starts looping (resume) vs. freezes (pause). `Reanimated.View`
// renders as a plain RN View so the particle pool is observable in the tree.
jest.mock('react-native-reanimated', () => {
  const React_ = require('react');
  const { View } = require('react-native');
  const withTiming = jest.fn((toValue: number) => ({ __anim: 'timing', toValue }));
  const withRepeat = jest.fn((anim: unknown) => anim);
  const cancelAnimation = jest.fn();
  const useSharedValue = (init: number) => ({ value: init });
  const useAnimatedStyle = (fn: () => unknown) => {
    try {
      return fn();
    } catch {
      return {};
    }
  };
  const Easing = { linear: (t: number) => t };
  const ReanimatedView = ({ children, ...rest }: any) =>
    React_.createElement(View, rest, children);
  return {
    __esModule: true,
    default: { View: ReanimatedView },
    View: ReanimatedView,
    withTiming,
    withRepeat,
    cancelAnimation,
    useSharedValue,
    useAnimatedStyle,
    Easing,
  };
});

// Weak-device detection: force "not weak" so the gate's enable/disable decision
// is driven purely by the theme + reduce-motion inputs under test. (The
// weak-device → 0 particles path is covered by the particle-pool property test.)
jest.mock('../../../utils/deviceCapability', () => ({
  useWeakDevice: () => false,
  isWeakDevice: () => false,
}));

import {
  withRepeat,
  cancelAnimation,
} from 'react-native-reanimated';
import { AmbientAnimationLayer } from '../AmbientAnimationLayer';
import { computeParticlePoolSize, PARTICLE_CAP } from '../ambientParticles';
import { useAmbientAnimationGate, AmbientGateResult } from '../../../hooks/useAmbientAnimationGate';
import { BUILT_IN_THEMES } from '../../../theme/profileThemes';

const mockedWithRepeat = withRepeat as jest.MockedFunction<typeof withRepeat>;
const mockedCancelAnimation = cancelAnimation as jest.MockedFunction<typeof cancelAnimation>;

// The glyph the layer renders for falling snow (system glyph, no bundled asset).
const SNOW_GLYPH = '❄';
// DESIRED_COUNT.snow = 12, clamped by the default PARTICLE_CAP (14).
const EXPECTED_SNOW_POOL = computeParticlePoolSize(Math.min(12, PARTICLE_CAP), false);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Count how many times `glyph` appears as a Text child in the rendered tree
 *  (i.e. how many particles are currently mounted in the fixed pool). */
function countGlyphs(renderer: TestRenderer.ReactTestRenderer, glyph: string): number {
  let count = 0;
  // Count host nodes only (typeof type === 'string'); composite components and
  // their host node both carry the same `children`, which would double-count.
  renderer.root.findAll((n) => typeof n.type === 'string').forEach((node) => {
    const children = node.props?.children;
    if (children === glyph) count += 1;
    else if (Array.isArray(children)) {
      children.forEach((c) => {
        if (c === glyph) count += 1;
      });
    }
  });
  return count;
}

function renderLayer(props: { active: boolean; paused: boolean; particleCap?: number }) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <AmbientAnimationLayer type="snow" {...props} />,
    );
  });
  return renderer;
}

// ─── AmbientAnimationLayer pause / resume wiring ─────────────────────────────

describe('AmbientAnimationLayer — scroll / AppState / focus pause wiring', () => {
  beforeEach(() => {
    mockedWithRepeat.mockClear();
    mockedCancelAnimation.mockClear();
  });

  it('allocates the fixed pool and starts every particle looping when active and not paused', () => {
    const renderer = renderLayer({ active: true, paused: false });

    // Fixed pool mounted (≤ PARTICLE_CAP) and each particle started its UI-thread loop.
    expect(countGlyphs(renderer, SNOW_GLYPH)).toBe(EXPECTED_SNOW_POOL);
    expect(EXPECTED_SNOW_POOL).toBeLessThanOrEqual(PARTICLE_CAP);
    expect(mockedWithRepeat).toHaveBeenCalledTimes(EXPECTED_SNOW_POOL);

    act(() => renderer.unmount());
  });

  it('pauses on scroll begin and resumes on scroll end / momentum end (Req 6.2, 6.3, 6.4)', () => {
    // Not scrolling: animating.
    const renderer = renderLayer({ active: true, paused: false });
    expect(mockedWithRepeat).toHaveBeenCalledTimes(EXPECTED_SNOW_POOL);
    const poolWhileAnimating = countGlyphs(renderer, SNOW_GLYPH);

    // onScrollBeginDrag → paused=true: every particle is frozen (cancelAnimation)
    // and NO new loop is started. The pool stays mounted (static frozen background).
    mockedWithRepeat.mockClear();
    mockedCancelAnimation.mockClear();
    act(() => {
      renderer.update(<AmbientAnimationLayer type="snow" active paused />);
    });
    expect(mockedWithRepeat).not.toHaveBeenCalled();
    expect(mockedCancelAnimation.mock.calls.length).toBeGreaterThanOrEqual(EXPECTED_SNOW_POOL);
    // Req 6.4: pool remains mounted while paused → static background still shown.
    expect(countGlyphs(renderer, SNOW_GLYPH)).toBe(poolWhileAnimating);

    // onScrollEndDrag / onMomentumScrollEnd → paused=false: loops restart.
    mockedWithRepeat.mockClear();
    act(() => {
      renderer.update(<AmbientAnimationLayer type="snow" active paused={false} />);
    });
    expect(mockedWithRepeat).toHaveBeenCalledTimes(EXPECTED_SNOW_POOL);
    expect(countGlyphs(renderer, SNOW_GLYPH)).toBe(poolWhileAnimating);

    act(() => renderer.unmount());
  });

  it('freezes when the app is backgrounded (AppState) — paused keeps the pool mounted (Req 6.7, 6.4)', () => {
    const renderer = renderLayer({ active: true, paused: false });
    const pool = countGlyphs(renderer, SNOW_GLYPH);

    // AppState 'background' / 'inactive' → the screen drives paused=true.
    mockedWithRepeat.mockClear();
    mockedCancelAnimation.mockClear();
    act(() => {
      renderer.update(<AmbientAnimationLayer type="snow" active paused />);
    });
    expect(mockedWithRepeat).not.toHaveBeenCalled();
    expect(mockedCancelAnimation).toHaveBeenCalled();
    expect(countGlyphs(renderer, SNOW_GLYPH)).toBe(pool); // frozen, still mounted

    act(() => renderer.unmount());
  });

  it('freezes when the profile screen is blurred / scrolled out of view (Req 6.7)', () => {
    const renderer = renderLayer({ active: true, paused: false });
    const pool = countGlyphs(renderer, SNOW_GLYPH);

    // useIsFocused() === false (screen blurred) → the screen drives paused=true.
    mockedWithRepeat.mockClear();
    mockedCancelAnimation.mockClear();
    act(() => {
      renderer.update(<AmbientAnimationLayer type="snow" active paused />);
    });
    expect(mockedWithRepeat).not.toHaveBeenCalled();
    expect(mockedCancelAnimation).toHaveBeenCalled();
    expect(countGlyphs(renderer, SNOW_GLYPH)).toBe(pool);

    act(() => renderer.unmount());
  });

  it('renders no particle pool when the gate disables the animation (active=false)', () => {
    // When the gate reports enabled=false (e.g. reduced motion), the scope
    // passes active=false and the layer renders nothing at all.
    const renderer = renderLayer({ active: false, paused: false });
    expect(countGlyphs(renderer, SNOW_GLYPH)).toBe(0);
    expect(mockedWithRepeat).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('renders no particle pool when the effective particle cap is 0 (weak device)', () => {
    const renderer = renderLayer({ active: true, paused: false, particleCap: 0 });
    expect(countGlyphs(renderer, SNOW_GLYPH)).toBe(0);
    expect(mockedWithRepeat).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});

// ─── Runtime reduce-motion suppression (no remount) ──────────────────────────

describe('useAmbientAnimationGate — runtime reduce-motion suppression (Req 7.3)', () => {
  let reduceMotionListener: ((enabled: boolean) => void) | null;
  let isReduceMotionSpy: jest.SpyInstance;
  let addListenerSpy: jest.SpyInstance;

  beforeEach(() => {
    reduceMotionListener = null;
    isReduceMotionSpy = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    addListenerSpy = jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockImplementation((event: string, cb: any) => {
        if (event === 'reduceMotionChanged') reduceMotionListener = cb;
        return { remove: jest.fn() } as any;
      });
  });

  afterEach(() => {
    isReduceMotionSpy.mockRestore();
    addListenerSpy.mockRestore();
  });

  it('flips the gate to enabled=false when reduce-motion turns on at runtime, without remounting the consumer', async () => {
    const winter = BUILT_IN_THEMES.winter; // defines an ambient animation ('snow')
    const gateValues: AmbientGateResult[] = [];
    let mountCount = 0;

    function Probe(): null {
      const gate = useAmbientAnimationGate(winter);
      gateValues.push(gate);
      React.useEffect(() => {
        mountCount += 1;
      }, []);
      return null;
    }

    let renderer!: TestRenderer.ReactTestRenderer;
    // create + flush the initial isReduceMotionEnabled() promise resolution.
    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    // Initially: theme has an animation, device not weak, reduce-motion off → enabled.
    expect(gateValues[gateValues.length - 1].enabled).toBe(true);
    expect(mountCount).toBe(1);
    expect(reduceMotionListener).toBeTruthy();

    // OS reduce-motion toggled ON at runtime → gate suppresses the animation.
    act(() => {
      reduceMotionListener!(true);
    });
    expect(gateValues[gateValues.length - 1].enabled).toBe(false);
    // No remount: the same consumer instance re-rendered with the new value
    // (its mount effect ran exactly once) — satisfies "without reloading the
    // profile screen" (Req 7.3).
    expect(mountCount).toBe(1);

    // Toggling it back OFF re-enables the animation, still without a remount.
    act(() => {
      reduceMotionListener!(false);
    });
    expect(gateValues[gateValues.length - 1].enabled).toBe(true);
    expect(mountCount).toBe(1);

    act(() => renderer.unmount());
  });
});
