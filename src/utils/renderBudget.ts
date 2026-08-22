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
  /** May decorative ambient particles run? */
  ambientParticles: boolean;
}

// ── WHAT THIS TABLE MAY AND MAY NOT CONTROL ─────────────────────────────────
//
// It controls how much WORK a frame costs. It does not control how the app LOOKS.
//
// `glassAllowed` and `fadingBlurAllowed` used to live here, and Low Power Mode set
// them to false. The result was that a phone kept in Low Power Mode had no liquid
// glass anywhere while the user's own toggle was still on — reported as "glass
// disappeared on iPhone". Buying frames by removing the product's appearance is not
// a trade that was ever agreed to, and it is invisible in review because the code
// reads as correct until the power state flips.
//
// Ambient decorative particles remain here because they are a purely additive
// background effect with no structural role, unlike glass surfaces which ARE the
// chrome.

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
  ambientParticles: true,
};

/**
 * INVISIBLE reductions, applied on weak hardware.
 *
 * Every field here changes how much work happens per frame WITHOUT changing what
 * the app looks like:
 *   - drawDistance 250 → 120: roughly one screen of pre-render instead of two, so
 *     a fling triggers about half as many simultaneous image decodes.
 *   - heroWarmCount 4 → 2 and policy → 'disk': fewer bytes AND no eager decode,
 *     which is the expensive half.
 *   - carousel mounts the visible slide plus one neighbour instead of all of them.
 *
 * Glass, blur and ambient particles are deliberately LEFT ON here — see
 * `LOW_POWER_BUDGET` for why.
 */
export const WEAK_DEVICE_BUDGET: RenderBudget = {
  drawDistance: 120,
  heroWarmCount: 2,
  warmCachePolicy: 'disk',
  carouselEagerSlides: 2,
  ambientParticles: true,
};

/**
 * Low Power Mode: the invisible reductions PLUS the visible ones.
 *
 * WHY THE SPLIT EXISTS
 *   An earlier version of this table switched glass, blur and ambient particles off
 *   on weak hardware too. That was wrong. Turning off glass changes how the app
 *   LOOKS, and an owner of an older phone did not ask for a different-looking app —
 *   they asked for a smooth one. Shipping a silent visual downgrade to a whole
 *   device class is a redesign nobody agreed to, and it is immediately noticeable
 *   (corner treatments and surface sizes differ between the glass and fallback
 *   paths).
 *
 *   Low Power Mode is different, and is the case the user actually asked about. There
 *   the OS itself has cut the CPU/GPU budget and capped the refresh rate, the state
 *   is explicitly chosen by the user, and it ends the moment they charge the device.
 *   Dropping per-frame GPU compositing there is a fair trade for keeping motion
 *   smooth; dropping it permanently because of a device's year class is not.
 */
export const LOW_POWER_BUDGET: RenderBudget = {
  drawDistance: 120,
  heroWarmCount: 2,
  warmCachePolicy: 'disk',
  carouselEagerSlides: 2,
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
 *
 * Low Power Mode wins over device class because it is the strictly stronger
 * constraint.
 */
export function renderBudget({ isWeak, powerMode }: RenderBudgetInputs): RenderBudget {
  if (powerMode === 'low_power') return LOW_POWER_BUDGET;
  return isWeak ? WEAK_DEVICE_BUDGET : BASELINE_BUDGET;
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
