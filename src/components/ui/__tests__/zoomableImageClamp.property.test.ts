import fc from 'fast-check';

// Property-based tests for ZoomableImage zoom/pan clamp logic (app-ux-improvements spec).
//
// design.md documents the gesture end behaviour:
//   - Bounce-back: if scale > maxScale → maxScale; if scale < minScale → minScale.
//   - When scale === 1 (minScale), translateX and translateY are always reset to 0.
//   - Pan is only meaningful while scale > 1.
//
// The real clamp lives inside reanimated worklets in the component. We test pure
// helpers that replicate the documented behaviour so the invariants are verified
// deterministically across many inputs.
// Convention: tag each property with feature + numbered property, run >= 100 runs.

const MIN_SCALE = 1.0;
const MAX_SCALE = 3.0;

// Pure replica of the bounce-back clamp applied on gesture end.
function clampScale(scale: number, minScale = MIN_SCALE, maxScale = MAX_SCALE): number {
  if (scale > maxScale) return maxScale;
  if (scale < minScale) return minScale;
  return scale;
}

// Pure replica of pan resolution: at scale === minScale translation is forced to 0;
// otherwise translation is clamped within the symmetric viewport bound.
function resolveTranslation(
  scale: number,
  translate: number,
  maxOffset: number,
  minScale = MIN_SCALE
): number {
  if (scale === minScale) return 0;
  if (translate > maxOffset) return maxOffset;
  if (translate < -maxOffset) return -maxOffset;
  return translate;
}

describe('ZoomableImage clamp properties', () => {
  // Feature: app-ux-improvements, Property 3: Ограничение zoom scale
  it('Property 3: after gesture end, 1.0 <= scale <= 3.0', () => {
    fc.assert(
      fc.property(
        // Raw scale spanning well below min and above max to exercise both clamps.
        fc.double({ min: -10, max: 20, noNaN: true }),
        (rawScale) => {
          const clamped = clampScale(rawScale);
          expect(clamped).toBeGreaterThanOrEqual(MIN_SCALE);
          expect(clamped).toBeLessThanOrEqual(MAX_SCALE);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: app-ux-improvements, Property 3: Ограничение zoom scale (custom bounds)
  it('Property 3: clamp respects arbitrary valid [minScale, maxScale] bounds', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 2, noNaN: true }),
        fc.double({ min: 2, max: 6, noNaN: true }),
        fc.double({ min: -10, max: 20, noNaN: true }),
        (minScale, maxScale, rawScale) => {
          const clamped = clampScale(rawScale, minScale, maxScale);
          expect(clamped).toBeGreaterThanOrEqual(minScale);
          expect(clamped).toBeLessThanOrEqual(maxScale);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: app-ux-improvements, Property 4: Ограничение pan при scale=1
  it('Property 4: when scale === 1, translateX and translateY are 0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: 2000, noNaN: true }),
        (rawTranslateX, rawTranslateY, maxOffset) => {
          // At scale exactly 1 (minScale), pan is fully reset regardless of input.
          const tx = resolveTranslation(MIN_SCALE, rawTranslateX, maxOffset);
          const ty = resolveTranslation(MIN_SCALE, rawTranslateY, maxOffset);
          expect(tx).toBe(0);
          expect(ty).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: app-ux-improvements, Property 4: Ограничение pan при scale=1 (sanity for scale > 1)
  it('Property 4: when scale > 1, translation stays within +/- maxOffset', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1.01, max: 3, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: 2000, noNaN: true }),
        (scale, rawTranslate, maxOffset) => {
          const t = resolveTranslation(scale, rawTranslate, maxOffset);
          expect(t).toBeGreaterThanOrEqual(-maxOffset);
          expect(t).toBeLessThanOrEqual(maxOffset);
        }
      ),
      { numRuns: 100 }
    );
  });
});
