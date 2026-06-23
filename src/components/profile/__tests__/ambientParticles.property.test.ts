import fc from 'fast-check';

import {
  PARTICLE_CAP,
  PARTICLE_CAP_WEAK,
  computeParticlePoolSize,
} from '../ambientParticles';

// Property-based tests for ambient particle-pool sizing (seasonal-profile-themes spec).
//
// computeParticlePoolSize(requestedCount, isWeak) is a pure, total function that
// clamps the requested particle count into [0, PARTICLE_CAP], floors non-integer
// requests, defends against NaN / non-finite inputs (returns 0), and always
// returns 0 when the device is classified as a Weak_Device.
//
// Convention: tag each property with feature + numbered property, run >= 100 runs.

describe('Ambient particle-pool sizing properties', () => {
  // Feature: seasonal-profile-themes, Property 7: Particle count never exceeds the Particle_Cap
  it('Property 7: 0 <= size <= PARTICLE_CAP, integer, and 0 when weak', () => {
    fc.assert(
      fc.property(
        // Include negatives and large values via the full integer space.
        fc.integer(),
        fc.boolean(),
        (requestedCount, isWeak) => {
          const size = computeParticlePoolSize(requestedCount, isWeak);

          // Bounded into the inclusive range [0, PARTICLE_CAP].
          expect(size).toBeGreaterThanOrEqual(0);
          expect(size).toBeLessThanOrEqual(PARTICLE_CAP);

          // Result is always an integer.
          expect(Number.isInteger(size)).toBe(true);

          // Weak devices render exactly zero particles.
          if (isWeak) {
            expect(size).toBe(PARTICLE_CAP_WEAK);
            expect(size).toBe(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  // Feature: seasonal-profile-themes, Property 7: Particle count never exceeds the Particle_Cap
  // Defensive handling: non-finite / fractional requests still clamp into range.
  it('Property 7 (defensive): non-finite requests return 0, doubles stay bounded', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double(),
          fc.constant(Number.NaN),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.constant(Number.NEGATIVE_INFINITY)
        ),
        fc.boolean(),
        (requestedCount, isWeak) => {
          const size = computeParticlePoolSize(requestedCount, isWeak);

          expect(size).toBeGreaterThanOrEqual(0);
          expect(size).toBeLessThanOrEqual(PARTICLE_CAP);
          expect(Number.isInteger(size)).toBe(true);

          if (isWeak) {
            expect(size).toBe(0);
          }

          // Non-finite (NaN / ±Infinity) requests are defended to 0 on non-weak devices.
          if (!isWeak && !Number.isFinite(requestedCount)) {
            expect(size).toBe(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
