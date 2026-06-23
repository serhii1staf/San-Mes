// Feature: seasonal-profile-themes
//
// AmbientAnimationLayer — a bounded, UI-thread particle system layered over a
// profile theme's background illustration (Layer 2 of the profile render
// stack; see design §"Rendering layer stack"). It renders falling snow
// (`winter`) or drifting leaves (`autumn`).
//
// PERFORMANCE / CORRECTNESS GUARANTEES:
//  - A FIXED pool is allocated exactly once at mount via `computeParticlePoolSize`.
//    The pool size is memoised with empty deps so it can never grow at runtime,
//    proving the on-screen particle count never exceeds PARTICLE_CAP (Req 6.1)
//    and is exactly 0 on weak devices (the gate passes `particleCap = 0`) (Req 7.1).
//  - Every particle loops entirely on the UI thread via `withRepeat(withTiming)`
//    so a JS long-task can never stutter it; only transforms + the particle's
//    own opacity are animated (no layout thrash, never wraps a glass view),
//    targeting >=55 FPS (Req 6.6, 7.6).
//  - `paused` freezes the animations in place (cancelAnimation) while keeping
//    the pool mounted, so the gradient + illustration remain as a static
//    background (Req 6.2, 6.3, 6.4, 6.7). Pause takes effect promptly because
//    the prop is set synchronously by the scroll/AppState/focus drivers.
//  - The layer is `pointerEvents="none"` + `StyleSheet.absoluteFill`, and only
//    ever mounts inside a ProfileThemeScope when the gate enables it (Req 6.5).

import React, { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions } from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { computeParticlePoolSize, PARTICLE_CAP } from './ambientParticles';
import type { AmbientAnimationType } from '../../theme/profileThemes';

export interface AmbientAnimationLayerProps {
  /** Which ambient effect to render. */
  type: AmbientAnimationType; // 'snow' | 'leaves'
  /** Master gate from `useAmbientAnimationGate` — false → render nothing. */
  active: boolean;
  /** Transient pause (scroll / backgrounded / off-screen) — freezes in place. */
  paused: boolean;
  /**
   * Effective particle cap from the gate. The caller passes 0 on weak devices
   * so the pool collapses to nothing. Defaults to PARTICLE_CAP when omitted.
   */
  particleCap?: number;
}

/** Desired particle count per effect, before the cap is applied. Kept tiny. */
const DESIRED_COUNT: Record<AmbientAnimationType, number> = {
  snow: 12,
  leaves: 9,
};

// Per-effect glyph + sizing. System glyphs only (Apple §3.3.4 — no bundled
// emoji assets); cheap to render as <Text>.
const GLYPH: Record<AmbientAnimationType, string> = {
  snow: '❄',
  leaves: '🍂',
};

interface ParticleConfig {
  /** Horizontal start position as a fraction of screen width [0,1]. */
  xFraction: number;
  /** Fall duration in ms (randomised for organic motion). */
  duration: number;
  /** Initial progress offset [0,1) so particles start spread across the screen. */
  initialOffset: number;
  /** Horizontal drift / sway amplitude in px. */
  drift: number;
  /** Font size of the glyph. */
  size: number;
  /** Peak opacity. */
  opacity: number;
  /** Rotation amplitude in degrees (leaves sway/tumble; snow ~0). */
  rotate: number;
}

// Deterministic-enough pseudo-random spread keyed by index so the pool looks
// organic without pulling in a PRNG dependency. Computed once per mount.
function buildParticleConfig(index: number, poolSize: number, type: AmbientAnimationType): ParticleConfig {
  const r = (seed: number) => {
    const x = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    return x - Math.floor(x); // fractional part in [0,1)
  };

  const isLeaves = type === 'leaves';
  // Spread x evenly across the width, then jitter so columns don't line up.
  const xFraction = poolSize > 0 ? (index + 0.5) / poolSize + (r(1) - 0.5) * (0.6 / poolSize) : 0.5;
  // Snow falls slowly; leaves a touch faster and more variable.
  const baseDuration = isLeaves ? 6500 : 9000;
  const duration = baseDuration + r(2) * (isLeaves ? 4000 : 5000);
  const initialOffset = r(3); // distribute particles down the screen at mount
  const drift = (isLeaves ? 28 : 14) + r(4) * (isLeaves ? 34 : 16);
  const size = (isLeaves ? 18 : 10) + r(5) * (isLeaves ? 10 : 8);
  const opacity = (isLeaves ? 0.65 : 0.7) + r(6) * 0.3;
  const rotate = isLeaves ? 35 + r(7) * 55 : 0;

  return {
    xFraction: Math.min(Math.max(xFraction, 0), 1),
    duration,
    initialOffset,
    drift,
    size,
    opacity,
    rotate,
  };
}

interface ParticleProps {
  config: ParticleConfig;
  glyph: string;
  screenWidth: number;
  screenHeight: number;
  active: boolean;
  paused: boolean;
}

const Particle = React.memo(function Particle({
  config,
  glyph,
  screenWidth,
  screenHeight,
  active,
  paused,
}: ParticleProps) {
  const { duration, initialOffset, drift, size, opacity, rotate } = config;

  // `progress` drives the whole particle on the UI thread: 0 = just above the
  // top, 1 = just below the bottom. It loops 0→1 forever via withRepeat.
  const progress = useSharedValue(initialOffset);

  const startLoop = useCallback(() => {
    // Animate from the CURRENT value to 1 (so resuming continues from where it
    // froze), then repeat 0→1 indefinitely. Linear easing keeps a steady fall.
    progress.value = withRepeat(
      withTiming(1, { duration, easing: Easing.linear }),
      -1,
      false,
    );
  }, [duration, progress]);

  useEffect(() => {
    if (active && !paused) {
      startLoop();
    } else {
      // Freeze in place — keeps the particle visible as part of the static
      // background while paused / inactive (Req 6.4).
      cancelAnimation(progress);
    }
    return () => {
      cancelAnimation(progress);
    };
  }, [active, paused, startLoop, progress]);

  const startX = config.xFraction * screenWidth;
  const travelY = screenHeight + size * 2;

  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    const p = progress.value;
    // Top→bottom translation. Starts one glyph-height above the top edge.
    const translateY = -size + p * travelY;
    // Gentle side-to-side sway over the fall (one full swing).
    const sway = Math.sin(p * Math.PI * 2) * drift;
    // Fade in at the top, hold, fade out near the bottom so the 0→1 wrap is
    // invisible.
    let alpha: number;
    if (p < 0.08) alpha = (p / 0.08) * opacity;
    else if (p > 0.92) alpha = ((1 - p) / 0.08) * opacity;
    else alpha = opacity;

    return {
      opacity: alpha,
      transform: [
        { translateX: sway },
        { translateY },
        { rotate: rotate ? `${sway * (rotate / Math.max(drift, 1))}deg` : '0deg' },
      ],
    };
  });

  return (
    <Reanimated.View
      pointerEvents="none"
      style={[
        styles.particle,
        { left: startX, width: size * 2, height: size * 2 },
        animatedStyle,
      ]}
    >
      <Text style={{ fontSize: size }} allowFontScaling={false}>
        {glyph}
      </Text>
    </Reanimated.View>
  );
});

export function AmbientAnimationLayer({
  type,
  active,
  paused,
  particleCap,
}: AmbientAnimationLayerProps) {
  const { width, height } = useWindowDimensions();

  // FIXED pool, computed exactly ONCE at mount and never grown (Req 6.1). The
  // requested count is the per-effect desired count clamped by the effective
  // cap the gate supplies (0 on weak devices → empty pool, Req 7.1).
  const poolSize = useMemo(() => {
    const cap = particleCap ?? PARTICLE_CAP;
    const requested = Math.min(DESIRED_COUNT[type], cap);
    return computeParticlePoolSize(requested, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const configs = useMemo(
    () => Array.from({ length: poolSize }, (_, i) => buildParticleConfig(i, poolSize, type)),
    [poolSize, type],
  );

  // Nothing to render when the layer is inactive or the pool is empty
  // (weak device / no particles). The gradient + illustration still show.
  if (!active || poolSize === 0) {
    return null;
  }

  const glyph = GLYPH[type];

  return (
    <Reanimated.View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {configs.map((config, i) => (
        <Particle
          key={i}
          config={config}
          glyph={glyph}
          screenWidth={width}
          screenHeight={height}
          active={active}
          paused={paused}
        />
      ))}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  particle: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AmbientAnimationLayer;
