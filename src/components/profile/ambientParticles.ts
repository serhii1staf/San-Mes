// Feature: seasonal-profile-themes
//
// Pure particle-pool sizing logic for the ambient animation layer.
// This module contains NO React / Reanimated code so it can be unit- and
// property-tested in isolation. The AmbientAnimationLayer allocates a fixed
// pool sized once at mount via computeParticlePoolSize, guaranteeing the
// on-screen particle count provably never exceeds PARTICLE_CAP (Req 6.1) and
// is exactly 0 on weak devices (Req 7.1).

/** Hard upper bound on simultaneously rendered ambient particles, all platforms. */
export const PARTICLE_CAP = 14;

/** Weak devices render no ambient particles. */
export const PARTICLE_CAP_WEAK = 0;

/**
 * Compute the fixed particle-pool size for an ambient animation.
 *
 * Pure and total: defends against negative, NaN, and non-integer requests by
 * flooring and clamping into the inclusive range [0, PARTICLE_CAP]. Weak
 * devices always yield 0.
 *
 * @param requestedCount the theme/config-requested particle count
 * @param isWeak whether the device is classified as a Weak_Device
 * @returns an integer in [0, PARTICLE_CAP]; 0 when isWeak
 *
 * Requirements: 6.1, 7.1
 */
export function computeParticlePoolSize(requestedCount: number, isWeak: boolean): number {
  if (isWeak) {
    return PARTICLE_CAP_WEAK;
  }

  // Defend against NaN / non-finite inputs.
  if (!Number.isFinite(requestedCount)) {
    return 0;
  }

  // Floor non-integers, then clamp into [0, PARTICLE_CAP].
  const floored = Math.floor(requestedCount);
  if (floored <= 0) {
    return 0;
  }
  if (floored >= PARTICLE_CAP) {
    return PARTICLE_CAP;
  }
  return floored;
}
