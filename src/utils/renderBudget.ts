// One table controlling how much work a frame is allowed to cost.
//
// WHY CENTRALISE IT
//   `isWeakDevice()` already existed but had exactly ONE consumer: the ambient
//   particle effect on profile themes. So an iPhone 11 rendered the feed, the chat,
//   the blur surfaces and the pre-render window with the same settings as a
//   flagship. The classification was there; nothing acted on it.
//
//   Scattering `isWeak ? a : b` across screens would make the degradation
//   impossible to reason about or verify. One pure function means the
//   not-degraded path can be asserted byte-for-byte identical to today's
//   behaviour, which is what protects modern devices from a silent downgrade.

import type { PowerMode } from '../services/powerMode';

export interface RenderBudget {
  /** FlashList pre-render window, in px beyond the viewport. */
  drawDistance: number;
  /** How many feed hero images to warm ahead of the viewport. */
  heroWarmCount: number;
  /**
   * `memory-disk` downloads AND decodes; `disk` only downloads, deferring the
   * decode until the image is actually needed. Decode is the expensive half.
   */
  warmCachePolicy: 'disk' | 'memory-disk';
  /** Carousel slides mounted eagerly; Infinity = all of them. */
  carouselEagerSlides: number;
  /** May native liquid-glass surfaces be used? */
  glassAllowed: boolean;
  /** May the fading-blur header be used (vs. a plain gradient)? */
  fadingBlurAllowed: boolean;
  /** May decorative ambient particles run? */
  ambientParticles: boolean;
}

/**
 * Today's behaviour, stated explicitly so it can be asserted.
 *
 * Any device that is not weak and not in Low Power Mode must receive exactly
 * this — no visual or behavioural change whatsoever.
 */
export const BASELINE_BUDGET: RenderBudget = {
  drawDistance: 250,
  heroWarmCount: 4,
  warmCachePolicy: 'memory-disk',
  carouselEagerSlides: Number.POSITIVE_INFINITY,
  glassAllowed: true,
  fadingBlurAllowed: true,
  ambientParticles: true,
};

/**
 * Reduced budget for weak hardware and for Low Power Mode.
 *
 * Each number is a halving rather than a token trim, because the goal is to fit a
 * frame budget that the OS has genuinely cut, not to look like we tried:
 *   - drawDistance 250 → 120: roughly one screen of pre-render instead of two,
 *     so a fling triggers about half as many simultaneous image decodes.
 *   - heroWarmCount 4 → 2 and policy → 'disk': fewer bytes AND no eager decode.
 *   - carousel mounts the visible slide plus one neighbour instead of all of them.
 *   - glass/blur off: these are per-frame GPU compositing costs, and a plain
 *     gradient fallback for both already exists in the codebase.
 */
export const REDUCED_BUDGET: RenderBudget = {
  drawDistance: 120,
  heroWarmCount: 2,
  warmCachePolicy: 'disk',
  carouselEagerSlides: 2,
  glassAllowed: false,
  fadingBlurAllowed: false,
  ambientParticles: false,
};

export interface RenderBudgetInputs {
  isWeak: boolean;
  powerMode: PowerMode;
}

/**
 * Resolve the frame budget.
 *
 * Pure and total. `powerMode === 'unknown'` deliberately does NOT degrade: that is
 * the state of every binary currently installed, and an OTA update must not change
 * how they behave.
 */
export function renderBudget({ isWeak, powerMode }: RenderBudgetInputs): RenderBudget {
  const degraded = isWeak || powerMode === 'low_power';
  return degraded ? REDUCED_BUDGET : BASELINE_BUDGET;
}

/**
 * Resolve the budget outside React.
 *
 * For callbacks and services that must not be re-created when the power mode
 * flips — they read the current value at call time instead of closing over it.
 * Importing the power-mode getter lazily keeps this module free of a cycle with
 * the service layer.
 */
export function currentRenderBudget(): RenderBudget {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getPowerMode } = require('../services/powerMode') as typeof import('../services/powerMode');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isWeakDevice } = require('./deviceCapability') as typeof import('./deviceCapability');
  return renderBudget({ isWeak: isWeakDevice(), powerMode: getPowerMode() });
}
