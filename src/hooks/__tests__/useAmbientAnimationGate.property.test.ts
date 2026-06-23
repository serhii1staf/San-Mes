import fc from 'fast-check';

import { computeAmbientGate } from '../useAmbientAnimationGate';
import {
  PARTICLE_CAP,
  PARTICLE_CAP_WEAK,
} from '../../components/profile/ambientParticles';

// Property-based tests for the ambient animation gate (seasonal-profile-themes spec).
//
// computeAmbientGate({ hasAnimation, isWeak, reducedMotion }) is the pure core of
// the animation gate. Ambient animation is enabled ONLY when the theme defines an
// animation AND the device is not weak AND reduced motion is off; any suppressing
// condition forces enabled = false. The particle cap is 0 on weak devices and
// PARTICLE_CAP otherwise.
//
// Convention: tag each property with feature + numbered property, run >= 100 runs.

describe('Ambient animation gate properties', () => {
  // Feature: seasonal-profile-themes, Property 9: Ambient animation is disabled under any suppressing condition
  it('Property 9: enabled iff hasAnimation && !isWeak && !reducedMotion; particleCap 0 when weak', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (hasAnimation, isWeak, reducedMotion) => {
          const { enabled, particleCap } = computeAmbientGate({
            hasAnimation,
            isWeak,
            reducedMotion,
          });

          // Enabled only when an animation exists AND no suppressing condition holds.
          expect(enabled).toBe(hasAnimation && !isWeak && !reducedMotion);

          // Particle cap is exactly 0 on weak devices, PARTICLE_CAP otherwise.
          expect(particleCap).toBe(isWeak ? PARTICLE_CAP_WEAK : PARTICLE_CAP);
        }
      ),
      { numRuns: 200 }
    );
  });
});
