import type { ProfileTheme } from '../theme/profileThemes';
import { PARTICLE_CAP, PARTICLE_CAP_WEAK } from '../components/profile/ambientParticles';
import { useWeakDevice } from '../utils/deviceCapability';
import { useReducedMotion } from './useReducedMotion';

// Feature: seasonal-profile-themes
//
// Animation gating: centralizes every condition that suppresses the ambient
// particle animation, returning the effective `{ enabled, particleCap }` state.
//
// IMPORTANT SCOPE NOTE (design §"Components and Interfaces #5"): this gate owns
// ONLY the permanent master switch (`enabled`) and the particle cap. The
// TRANSIENT pause conditions — app backgrounded (`AppState`) or the profile
// screen scrolled out of view / unfocused — must drive a separate `paused` prop
// on the AmbientAnimationLayer, NOT `enabled` (Req 6.7). Keeping those out of
// the gate lets the animation resume instantly when the app returns to the
// foreground, instead of tearing down and reallocating the particle pool.
//
// Static theme attributes (palette, illustration, emoji accents) are applied
// INDEPENDENTLY of this gate, so weak-device / reduced-motion users still get
// the full static look (Req 7.5).

export interface AmbientGateResult {
  /** false → render a static background with no particle pool. */
  enabled: boolean;
  /** PARTICLE_CAP normally, or PARTICLE_CAP_WEAK (0) on a weak device. */
  particleCap: number;
}

export interface AmbientGateInputs {
  /** Whether the resolved theme defines an ambient animation at all. */
  hasAnimation: boolean;
  /** Whether the device is classified as a Weak_Device. */
  isWeak: boolean;
  /** Whether the OS reduce-motion setting is enabled. */
  reducedMotion: boolean;
}

/**
 * Pure core of the animation gate. Ambient animation is enabled ONLY when the
 * theme defines an animation AND the device is not weak AND reduced motion is
 * off; any suppressing condition forces `enabled = false` (Req 7.1, 7.2). The
 * particle cap is 0 on weak devices and `PARTICLE_CAP` otherwise (Req 7.1).
 *
 * Pure and total — no React, no side effects — so it is unit/property-testable
 * in isolation.
 */
export function computeAmbientGate({
  hasAnimation,
  isWeak,
  reducedMotion,
}: AmbientGateInputs): AmbientGateResult {
  const enabled = hasAnimation && !isWeak && !reducedMotion;
  const particleCap = isWeak ? PARTICLE_CAP_WEAK : PARTICLE_CAP;
  return { enabled, particleCap };
}

/**
 * Hook composing `computeAmbientGate` with the live weak-device and
 * reduced-motion signals. `hasAnimation` is derived from the resolved theme
 * (`ambientAnimation != null`). Reacts to runtime reduce-motion toggles via
 * `useReducedMotion`, so the gate flips within ~500 ms without a remount
 * (Req 7.2, 7.3).
 */
export function useAmbientAnimationGate(theme: ProfileTheme): AmbientGateResult {
  const isWeak = useWeakDevice();
  const reducedMotion = useReducedMotion();

  return computeAmbientGate({
    hasAnimation: theme.ambientAnimation != null,
    isWeak,
    reducedMotion,
  });
}
