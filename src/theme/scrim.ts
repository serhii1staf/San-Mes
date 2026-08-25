// The app's scrim ramp, defined once.
//
// WHY THIS FILE EXISTS
//   The top-of-screen and bottom-of-screen fades were written inline, per screen, with
//   slightly different colour stops and locations each time. Consequences:
//
//     - Screens drifted apart visually, and some (search) ended up with no scrim at
//       all, which is why it "isn't everywhere".
//     - Tuning it meant editing every copy, so a correction landed in one place and
//       not the others. That happened: the scrim was made too black in one pass and
//       only partially softened in the next.
//
//   One definition, imported everywhere, so "make it darker" or "make it softer" is a
//   single edit that lands on every surface at once.
//
// CALIBRATION
//   Dark themes ramp toward black rather than toward the theme's own near-black
//   surface: a scrim the same colour as what it covers cannot read as depth, which is
//   why the original looked flat. It deliberately stops SHORT of fully opaque — an
//   opaque end stop reads as a solid black bar rather than as content receding, which
//   is not what iOS or Android do behind their bars.
//
//   Light themes ramp toward the background colour instead of black, because black
//   over a light surface reads as a dirty smear rather than as depth.

export interface ScrimStops {
  /** Nearest the content — most transparent. */
  top: string;
  /** Midpoint of the ramp. */
  mid: string;
  /** Nearest the screen edge — most opaque. */
  end: string;
  /** Fully transparent, for whichever end of the gradient needs it. */
  clear: string;
}

// ─── Ramp shape ─────────────────────────────────────────────────────────────────
//
// The ramp used to be THREE stops (0 → 0.5 → 1 at alpha 0 → 0.55 → 0.86). A linear
// gradient interpolates straight lines between stops, so three stops produce two
// straight segments with DIFFERENT slopes — 1.10 alpha/unit over the first half, 0.62
// over the second. The eye is very good at spotting a slope discontinuity in a smooth
// field (Mach banding), so the midpoint read as a faint horizontal line, and the ramp's
// transparent end started at full slope, which read as a second line where the scrim
// began. That is the "strip" that stops it dissolving away.
//
// Fix: sample a curve with ZERO derivative at both the transparent end and the midpoint,
// so there is no slope to see anywhere. `smoothstep` has exactly that property. Nine
// evenly spaced stops is far more than needed to make the residual error invisible.
//
// Cost: unchanged. This is still ONE native gradient layer; a CAGradientLayer with nine
// colour stops rasterises identically to one with three.

const SCRIM_STOP_COUNT = 17;

/**
 * Shaping exponent applied to `smoothstep`.
 *
 * Pure `smoothstep` puts the ramp's midpoint at half the end alpha (0.43 in dark mode),
 * noticeably lighter than the 0.55 the three-stop version had, and the scrim's weight is
 * the part that was working. Raising it to 0.85 pulls the midpoint back to 0.477 —
 * within a hair of the original — while keeping the gentle approach at the transparent
 * end that removes the visible starting edge.
 */
const SCRIM_GAMMA = 0.7;

// ─── ONE strength ───────────────────────────────────────────────────────────────
//
// There was briefly a second, STRONGER ramp for the tops of screens and for composer
// screens. The reasoning: the tab bar's version only reads because its opaque glass capsule
// sits on the ramp's dark end and supplies contrast, and nothing does that at the top of a
// screen or behind a translucent composer.
//
// The reasoning was sound and the result was still wrong, because it answered a question
// nobody asked. The request was never "make the chat's scrim strong enough to read on its
// own" — it was "make it the same as the one under the navigation". Two strengths guarantees
// they are NOT the same, however well either one is tuned.
//
// So: one ramp, one length (BOTTOM_CHROME_SCRIM_HEIGHT), everywhere. topScrimColors and
// bottomScrimColorsStrong both return it; the second name survives only so the five composer
// screens need not all be touched again, and it is now a synonym.
//
// If the scrim ever needs to be stronger, the honest change is the STANDARD numbers in
// scrimStops — which moves every surface at once, including the tab bar. That property is
// the one worth protecting.
const SCRIM_GAMMA_STRONG = SCRIM_GAMMA;

/** Hermite `smoothstep`: 0 at x=0, 1 at x=1, zero derivative at both ends. */
function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}

/**
 * Gradient stop locations. Evenly spaced, which matters: it makes the location array its
 * own mirror, so a top scrim is the bottom scrim's colours reversed with no second
 * locations array to keep in step.
 */
export const SCRIM_LOCATIONS = Array.from(
  { length: SCRIM_STOP_COUNT },
  (_, i) => i / (SCRIM_STOP_COUNT - 1),
) as unknown as readonly [number, number, ...number[]];

/**
 * Colour stops for a scrim, ordered transparent → opaque.
 *
 * `backgroundColor` must be a 6-digit hex (`#RRGGBB`); alpha is appended.
 */
export function scrimStops(isDark: boolean, backgroundColor: string): ScrimStops {
  // Black in BOTH themes.
  //
  // The light theme used to ramp toward the background colour instead, on the
  // reasoning that black over a light surface reads as a smear. In practice that made
  // the scrim invisible in light mode — it was the background fading into itself — and
  // it meant the two themes had structurally different chrome. The instruction was
  // explicit and repeated: dark, like the one under the bottom navigation, everywhere.
  //
  // Light mode gets a gentler ramp than dark mode, because the same alpha over a white
  // surface is visually much stronger than over a near-black one. Same colour, same
  // structure, calibrated per theme.
  // ── STRENGTH ────────────────────────────────────────────────────────────────
  //
  // Raised once, deliberately, on a direct instruction ("make the dimming stronger").
  // Measured against the previous values, at the same geometry:
  //
  //                      before    now
  //     end alpha         0.860    0.940
  //     midpoint alpha    0.477    0.579     (SCRIM_GAMMA 0.85 -> 0.70)
  //     quarter alpha     0.178    0.256
  //
  // This is the ONE lever for "make it read stronger", and it is deliberately global: it
  // moves the tab bar, every screen header and every composer together. Reaching for length
  // instead (an overhang past the chrome) was tried twice and is what produces "the dimming
  // sticks out over the messages", because extra length is ramp laid on top of content
  // rather than on top of chrome.
  void backgroundColor;
  if (isDark) {
    return {
      top: 'rgba(0,0,0,0.28)',
      mid: 'rgba(0,0,0,0.58)',
      end: 'rgba(0,0,0,0.94)',
      clear: 'rgba(0,0,0,0)',
    };
  }
  return {
    top: 'rgba(0,0,0,0.16)',
    mid: 'rgba(0,0,0,0.36)',
    end: 'rgba(0,0,0,0.64)',
    clear: 'rgba(0,0,0,0)',
  };
}

export type ScrimColors = readonly [string, string, ...string[]];

/**
 * The ramp, transparent → opaque, as `SCRIM_STOP_COUNT` black stops.
 *
 * ONE curve across the whole ramp, deliberately — the `mid` stop is no longer an anchor.
 * Pinning the midpoint forced the two halves to rise by different amounts (0.55 then
 * 0.31) over equal distances, so the slope stepped down by a factor of 1.8 as it crossed
 * the middle. Shaping each half separately moved that kink around but could not remove
 * it; only dropping the anchor does.
 *
 * Measured against the three-stop version it replaces:
 *
 *     midpoint alpha    0.550 → 0.477   (weight preserved)
 *     end alpha         0.860 → 0.860   (unchanged — this is the part that reads)
 *     slope at the transparent end  1.100 → 0.303   (3.6× gentler: no visible edge)
 *     slope discontinuities         1 → 0
 */
function buildRamp(isDark: boolean, strong: boolean): string[] {
  // strong is now a synonym for standard — see the ONE strength note above. The parameter
  // is kept so the two ramp builds below stay symmetric and the diff that removed the second
  // strength is one line rather than a restructure.
  const end = alphaOf(scrimStops(isDark, '#000000').end);
  void strong;
  const gamma = strong ? SCRIM_GAMMA_STRONG : SCRIM_GAMMA;
  const out: string[] = [];
  for (let i = 0; i < SCRIM_STOP_COUNT; i++) {
    const t = i / (SCRIM_STOP_COUNT - 1);
    const a = end * Math.pow(smoothstep(t), gamma);
    out.push(`rgba(0,0,0,${Math.round(a * 1000) / 1000})`);
  }
  return out;
}

function alphaOf(rgba: string): number {
  const m = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(rgba);
  return m ? parseFloat(m[1]) : 1;
}

// Built once per theme. Without this, every scrim would allocate 17 strings on every render
// of every screen that draws one. Two arrays, not four — the reversed pair is what a TOP
// scrim uses, and there is no longer a second strength to build.
const RAMP_DARK = buildRamp(true, false);
const RAMP_LIGHT = buildRamp(false, false);
const RAMP_DARK_REVERSED = [...RAMP_DARK].reverse();
const RAMP_LIGHT_REVERSED = [...RAMP_LIGHT].reverse();

/**
 * Ready-made colour array for a scrim at the TOP of a screen: opaque at the screen edge,
 * fading into the content below.
 *
 * Always the STRONG ramp. There is no weak top scrim anywhere in the app, because there is
 * no screen whose top edge has a bright element parked on the ramp's dark end the way the
 * tab bar's glass capsule is parked on the bottom one.
 */
export function topScrimColors(isDark: boolean, backgroundColor: string): ScrimColors {
  void backgroundColor;
  return (isDark ? RAMP_DARK_REVERSED : RAMP_LIGHT_REVERSED) as unknown as ScrimColors;
}

/**
 * Ready-made colour array for a scrim at the BOTTOM of a screen: transparent where it
 * meets the content, opaque at the screen edge.
 *
 * The STANDARD strength — this is the ramp behind the floating tab bar, and it is the one
 * surface that must not change.
 */
export function bottomScrimColors(isDark: boolean, backgroundColor: string): ScrimColors {
  void backgroundColor;
  return (isDark ? RAMP_DARK : RAMP_LIGHT) as unknown as ScrimColors;
}

/**
 * Bottom scrim for screens with a text COMPOSER rather than the tab bar.
 *
 * Same ramp shape, strong strength. The tab bar's version reads at standard strength only
 * because its opaque glass capsule sits on the ramp's dark end and supplies the contrast;
 * a composer has nothing there but a 44 pt translucent field, so at standard strength the
 * ramp was black on near-black with nothing to read against — reported, correctly, as the
 * chat simply not having a scrim at the bottom.
 */
export function bottomScrimColorsStrong(isDark: boolean, backgroundColor: string): ScrimColors {
  void backgroundColor;
  return (isDark ? RAMP_DARK : RAMP_LIGHT) as unknown as ScrimColors;
}

/**
 * The length of the scrim behind the TAB BAR, and only the tab bar.
 *
 * This is the tab bar's own footprint — the 60 pt glass capsule plus its 24 pt bottom
 * margin. `CustomTabBar` derives `BAR_FADE_HEIGHT` from this rather than computing its own,
 * so the two cannot drift.
 *
 * DO NOT use this on a composer screen. It was briefly used on all five of them, on the
 * reasoning that "the same as the one under the navigation" means the same NUMBER. It does
 * not, and that misreading cost five rounds:
 *
 *   the property that makes the tab bar's scrim look right is that it ends EXACTLY at the
 *   top of the chrome it belongs to — 84 is not a good length, it is the tab bar's length
 *
 * A composer is 86 pt tall (`COMPOSER_PADDING_TOP + COMPOSER_FIELD_HEIGHT + max(inset, pad)`),
 * so an 84 pt scrim stops 2 pt below the top of the input field. That 2 pt strip of
 * un-dimmed transcript directly above the field is what "the dimming is lower than the input
 * field" describes, and it is why matching the number made the two look LESS alike rather
 * than more.
 *
 * The rule that actually transfers is flush-with-own-chrome. Composer screens state it with
 * `composerScrimHeight`, the tab bar states it with this constant, and both are the same
 * rule applied to different chrome.
 */
export const BOTTOM_CHROME_SCRIM_HEIGHT = 84;

// ─── Header geometry ────────────────────────────────────────────────────────────
//
// The height of a top scrim was written out longhand on eleven screens
// (`insets.top + 48`, then `+ 28` for the gradient). Same drift problem as the colour
// stops had: a correction lands on one screen and not the other ten.

/** Height of the header row itself, below the status-bar inset. */
export const HEADER_ROW_HEIGHT = 48;

/**
 * How far the top scrim extends PAST the header row, into the content.
 *
 * NOW ZERO, which is the same rule `BAR_FADE_HEIGHT` follows for the tab bar: the scrim
 * spans exactly the chrome and stops. This value has moved three times and the sequence is
 * worth keeping, because each move was correct for the ramp it had at the time:
 *
 *   28 → 12  The ramp was a background-coloured fade. At 28 pt it read as a haze sitting on
 *            the content, so it was pulled back toward the header.
 *   12 → 28  The ramp became the black STRONG one, and a strong ramp compressed into 12 pt
 *            reads as a band rather than a fade, so it was given room.
 *   28 →  0  Room was the wrong lever. A ramp hanging 28 pt past the header dims the content
 *            BELOW the chrome — visible as darkening that reaches past the back button. The
 *            fix for "it should read stronger" is the ramp's alpha, not its length.
 *
 * Zero is only viable because the ramp is now strong: the earlier weak ramp genuinely did
 * need the extra distance to be seen at all, which is what sent this value up and down.
 * With `SCRIM_GAMMA_STRONG` the ramp reaches 0.29 by its first quarter, so the whole effect
 * lands inside the chrome's own height.
 */
export const HEADER_SCRIM_OVERHANG = 0;

/**
 * Paired heights for a screen's top scrim.
 *
 * `content` is what the scroll view should use as `paddingTop` so the first item clears
 * the header. `gradient` is the height of the scrim wrapper itself.
 *
 * Use `content` VERBATIM — no `+ 8` for breathing room. The chat's list header spacer had
 * exactly that, and since the gradient is `content` tall, the extra 8 pt put the first
 * message 8 pt below where the scrim ends. Result: a strip of fully-lit content between the
 * bottom of the ramp and the top of the transcript, reported as the top dimming "ending
 * higher than the content". Home passes `content` straight through as `paddingTop`, the two
 * edges coincide, and that is the whole reason its header reads as one continuous piece.
 */
export function headerScrimHeights(
  insetsTop: number,
  /**
   * Extra height for screens whose header carries a second row of chrome under the title.
   *
   * Applied to BOTH `content` and `gradient`, never to one of them. That coupling is the
   * whole point: the gradient's bottom edge and the first row of content have to coincide,
   * or you get either a lit strip below the ramp (spacer taller than gradient) or dimming
   * laid over the transcript (gradient taller than spacer). Both have been reported, from
   * exactly those two mistakes.
   *
   * Chat and fullscreen pass 8 so the ramp reaches a little further down past the back pill,
   * which is what "the top dimming should sit a bit lower" asks for, and the transcript
   * starts 8 pt lower with it so the two edges stay together.
   */
  extra = 0,
): { content: number; gradient: number } {
  const content = insetsTop + HEADER_ROW_HEIGHT + extra;
  return { content, gradient: content + HEADER_SCRIM_OVERHANG };
}

// ─── Composer geometry ──────────────────────────────────────────────────────────
//
// The bottom scrim on every screen with a text composer (user chat, AI chat, music
// chat, comments, fullscreen) was taller than the composer it sits behind:
//
//     chat 106, ai 150, music 150, comments 154   vs a composer footprint of 86
//
// The excess is ramp hanging ABOVE the composer, over the transcript, which is what
// "it protrudes above the input field" describes. The tab bar does not have this
// problem because `BAR_FADE_HEIGHT` is defined as exactly the capsule's height plus
// its bottom margin, so the ramp finishes level with the top of the navigation.
//
// These constants let the composer screens state the same rule.

/** Height of the rounded field capsule in every composer (`minHeight: 44`). */
export const COMPOSER_FIELD_HEIGHT = 44;

/** Gap above the field, between it and the content behind (`paddingTop: 8`). */
export const COMPOSER_PADDING_TOP = 8;

/**
 * The composer's own footprint, measured from the screen's bottom edge to the top of
 * the composer — the direct analogue of `BAR_FADE_HEIGHT` for the tab bar, and the
 * correct height for a bottom scrim on a composer screen.
 *
 * `minBottomPad` is the floor each screen applies to the safe-area inset, so the value
 * tracks that screen's actual `paddingBottom` rather than assuming one.
 *
 * The composer can grow taller than this — a reply banner, image attachments, several
 * lines of text — and the scrim deliberately does NOT follow. It is fixed chrome, like
 * the tab bar's fade; the grown parts carry their own backgrounds. Sizing it to the live
 * height would mean animating a gradient's frame on every keystroke.
 */
export function composerScrimHeight(insetsBottom: number, minBottomPad = 12): number {
  // ── `COMPOSER_PADDING_TOP` IS DELIBERATELY NOT INCLUDED ─────────────────────
  //
  // It was, and that put the ramp's top edge 8 pt ABOVE the top of the input field —
  // the composer's own 8 pt of breathing room sits between the field and the transcript,
  // and covering it means the ramp starts over the messages rather than over the chrome.
  // Reported precisely: "raise it so it sits right under the field, but not above the
  // field."
  //
  // So the scrim now spans the FIELD plus the safe-area padding beneath it, and its top
  // edge lands exactly on the field's top edge. The 8 pt gap above stays undimmed, which
  // is what makes the field read as floating on the ramp the way the tab bar capsule does.
  return COMPOSER_FIELD_HEIGHT + Math.max(insetsBottom, minBottomPad) + COMPOSER_SCRIM_OVERHANG;
}

/**
 * How far the bottom scrim reaches ABOVE the composer, into the transcript.
 *
 * Zero, matching `HEADER_SCRIM_OVERHANG` and the tab bar's `BAR_FADE_HEIGHT`: on every
 * surface in the app the scrim now spans exactly its own chrome.
 *
 * This was briefly 28, on the reasoning that a ramp confined behind the composer does all
 * its work out of sight. True, but the cure was worse than the disease: 28 pt of ramp above
 * the composer is darkening laid over the messages, which is the "it sticks out above the
 * input field" complaint — the same complaint the ORIGINAL 106/150/154 pt scrims produced.
 *
 * The lever for "make it read" is the ramp's alpha, not its length. `SCRIM_GAMMA_STRONG`
 * now reaches 0.29 by the first quarter, so the effect is legible within the composer's own
 * height instead of needing to borrow space from the transcript.
 */
export const COMPOSER_SCRIM_OVERHANG = 0;

// ─── SURFACE SCRIM: THE SAME CURVE, RAMPED TO THE BACKGROUND INSTEAD OF BLACK ──
//
// Asked for by comparison: the fade on the imported-stickers screen should be used in the chat
// "exactly the same". Worth being precise about what the difference actually was, because it is not
// the softness.
//
// The ramps above go to BLACK with rising alpha, so they DIM whatever is underneath. The stickers
// screen was drawing something else — the BACKGROUND COLOUR with rising alpha — so content there does
// not darken as it approaches the chrome, it dissolves into the page and vanishes. That is the effect
// being asked for, and it reads as much softer even at identical geometry, because there is no colour
// shift to notice: the content simply stops existing where the page begins.
//
// This is added as a shared builder rather than copied into the chat, for the reason this file already
// states at length: the stickers screen had hand-rolled its own six inline stops, which is exactly the
// per-screen drift that made the scrims inconsistent before. Six linear stops are also crude next to
// the seventeen-stop `smoothstep × gamma` curve above, which was tuned specifically to have no slope
// discontinuity anywhere — so reusing the curve makes the stickers screen SOFTER too, not just
// consistent.
//
// Deliberately NOT applied to the tab bar or to other screen headers. Those were set to black on an
// explicit, recorded instruction ("dark, like the one under the bottom navigation, everywhere"), and
// quietly reversing that globally because a different surface was requested would be the same mistake
// in the opposite direction. Chat and the sticker library share this; everything else keeps the black
// ramp until asked.

/**
 * Alpha ramp over an arbitrary background colour, using the identical `smoothstep × SCRIM_GAMMA`
 * curve and stop count as the black ramps, so softness can never drift between the two.
 *
 * `backgroundColor` must be a 6-digit `#RRGGBB` hex — every caller passes
 * `theme.colors.background.primary`, which is that shape.
 */
function buildSurfaceRamp(backgroundColor: string): string[] {
  const base = backgroundColor.length === 7 ? backgroundColor : '#000000';
  const out: string[] = [];
  for (let i = 0; i < SCRIM_STOP_COUNT; i++) {
    const t = i / (SCRIM_STOP_COUNT - 1);
    // Full opacity at the chrome end. A surface scrim has no reason to stop short the way a dimming
    // one does: it IS the page, so anything less would let content ghost through the header.
    const a = Math.pow(smoothstep(t), SCRIM_GAMMA);
    const hex = Math.round(Math.min(1, Math.max(0, a)) * 255)
      .toString(16)
      .padStart(2, '0');
    out.push(base + hex);
  }
  return out;
}

// Cached per background colour. Two themes means two entries in practice, and without this every
// screen drawing a surface scrim would allocate seventeen strings on every render.
const surfaceRampCache = new Map<string, string[]>();

function surfaceRamp(backgroundColor: string): string[] {
  let r = surfaceRampCache.get(backgroundColor);
  if (!r) {
    r = buildSurfaceRamp(backgroundColor);
    surfaceRampCache.set(backgroundColor, r);
  }
  return r;
}

/**
 * TOP surface scrim: solid background at the screen edge, dissolving into the content below.
 *
 * Pair with `SCRIM_LOCATIONS` exactly like the black ramps — the stop positions are evenly spaced, so
 * the top variant is the bottom variant reversed and there is no second locations array to maintain.
 */
export function topSurfaceScrimColors(backgroundColor: string): ScrimColors {
  const cacheKey = 'top:' + backgroundColor;
  let r = surfaceRampCache.get(cacheKey);
  if (!r) {
    r = [...surfaceRamp(backgroundColor)].reverse();
    surfaceRampCache.set(cacheKey, r);
  }
  return r as unknown as ScrimColors;
}

/** BOTTOM surface scrim: transparent at the top, solid background at the screen edge. */
export function bottomSurfaceScrimColors(backgroundColor: string): ScrimColors {
  return surfaceRamp(backgroundColor) as unknown as ScrimColors;
}
