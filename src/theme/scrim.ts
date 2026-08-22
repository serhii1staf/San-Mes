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
const SCRIM_GAMMA = 0.85;

// ─── Two strengths ──────────────────────────────────────────────────────────────
//
// STANDARD is the ramp behind the floating tab bar. It works there, and it is the one
// place nothing should change.
//
// STRONG is for every surface that does NOT have a bright element sitting on the ramp's
// dark end. That distinction is the whole reason two strengths exist rather than one:
//
//   Under the tab bar, the darkest 24 pt of ramp is uncovered and butts straight against
//   an opaque glass capsule with a light rim. High local contrast, so the ramp reads as a
//   defined shelf even though it is black on a near-black background.
//
//   At the TOP of a screen there is no such element — the header chrome is small pills
//   floating over it — and on a composer screen the bottom has only a 44 pt translucent
//   field. With the same alpha the ramp there is black on near-black with nothing to
//   contrast against, which is exactly why it read as "there is no scrim in the chat".
//
// So STRONG raises the end alpha AND lowers the exponent, which lifts the whole middle of
// the curve rather than only the last stop:
//
//                       quarter   mid    3/4    end
//     dark standard      0.178   0.477  0.744  0.860
//     dark strong        0.255   0.589  0.858  0.970     (×1.43 / ×1.23 / ×1.15 / ×1.13)
//
// The end stop stays short of 1.0 on purpose. At exactly opaque the top of the screen is a
// hard black bar rather than content receding, and in light mode that is very obvious.
//
// The transparent end is still gentle: the first segment's slope is 0.608, against 1.10 for
// the old three-stop ramp, so strengthening does not bring back the visible starting edge
// that the smoothstep curve was introduced to remove.
const SCRIM_GAMMA_STRONG = 0.72;

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
  void backgroundColor;
  if (isDark) {
    return {
      top: 'rgba(0,0,0,0.28)',
      mid: 'rgba(0,0,0,0.55)',
      end: 'rgba(0,0,0,0.86)',
      clear: 'rgba(0,0,0,0)',
    };
  }
  return {
    top: 'rgba(0,0,0,0.14)',
    mid: 'rgba(0,0,0,0.3)',
    end: 'rgba(0,0,0,0.55)',
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
  const end = strong
    ? (isDark ? 0.97 : 0.72)
    : alphaOf(scrimStops(isDark, '#000000').end);
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

// Built once per theme and strength. Without this, every scrim would allocate 17 strings
// on every render of every screen that draws one.
const RAMP_DARK = buildRamp(true, false);
const RAMP_LIGHT = buildRamp(false, false);
const RAMP_DARK_STRONG = buildRamp(true, true);
const RAMP_LIGHT_STRONG = buildRamp(false, true);
const RAMP_DARK_STRONG_REVERSED = [...RAMP_DARK_STRONG].reverse();
const RAMP_LIGHT_STRONG_REVERSED = [...RAMP_LIGHT_STRONG].reverse();

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
  return (isDark ? RAMP_DARK_STRONG_REVERSED : RAMP_LIGHT_STRONG_REVERSED) as unknown as ScrimColors;
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
  return (isDark ? RAMP_DARK_STRONG : RAMP_LIGHT_STRONG) as unknown as ScrimColors;
}

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
 * History, because this value has moved twice and the reasons matter:
 *
 *   28 → 12  The ramp was a background-coloured fade at the time and it read as a haze
 *            hanging into the content, so it was pulled back to sit close to the header.
 *   12 → 28  Once the ramp became the black STRONG one, the same distance read as too
 *            short — a strong ramp compressed into 12 pt is a band, not a fade. Restored,
 *            and now it is the length that lets the stronger ramp actually dissolve.
 *
 * It must not be 0: the ramp needs distance to reach transparent, otherwise content
 * scrolling under the header pops at a hard edge. The bottom scrim behind the TAB BAR
 * gets away with no overhang because the opaque glass capsule sits on its dark end;
 * nothing equivalent exists at the top of a screen.
 */
export const HEADER_SCRIM_OVERHANG = 28;

/**
 * Paired heights for a screen's top scrim.
 *
 * `content` is what the scroll view should use as `paddingTop` so the first item clears
 * the header. `gradient` is the height of the scrim wrapper itself.
 */
export function headerScrimHeights(insetsTop: number): { content: number; gradient: number } {
  const content = insetsTop + HEADER_ROW_HEIGHT;
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
  return (
    COMPOSER_PADDING_TOP +
    COMPOSER_FIELD_HEIGHT +
    Math.max(insetsBottom, minBottomPad) +
    COMPOSER_SCRIM_OVERHANG
  );
}

/**
 * How far the bottom scrim reaches ABOVE the composer, into the transcript.
 *
 * This was 0 — the ramp stopped exactly at the composer's top edge. That was the right
 * answer for the ramp it had at the time: a weak, background-coloured fade reaching over
 * the messages read as a haze, so it was clipped to the chrome.
 *
 * With the STRONG black ramp the opposite is true. Ending it flush with the composer
 * means the ramp has only the composer's own 86 pt to travel from transparent to 0.97,
 * all of it hidden behind the composer, so from the transcript's point of view the scrim
 * starts and ends out of sight — which is why it read as not being there at all.
 *
 * 28 pt matches `HEADER_SCRIM_OVERHANG`, so the two ends of a chat screen now hang into
 * the content by the same amount. Deliberately symmetric: the previous asymmetry (top 12,
 * bottom 0) is what made the two edges look like different effects.
 */
export const COMPOSER_SCRIM_OVERHANG = 28;
