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

/** Gradient stop locations paired with `ScrimStops`. */
export const SCRIM_LOCATIONS = [0, 0.5, 1] as const;

/**
 * Colour stops for a scrim, ordered transparent → opaque.
 *
 * `backgroundColor` must be a 6-digit hex (`#RRGGBB`); alpha is appended.
 */
export function scrimStops(isDark: boolean, backgroundColor: string): ScrimStops {
  if (isDark) {
    return {
      top: 'rgba(0,0,0,0.28)',
      mid: 'rgba(0,0,0,0.5)',
      end: 'rgba(0,0,0,0.82)',
      clear: 'rgba(0,0,0,0)',
    };
  }
  return {
    top: backgroundColor + '73',
    mid: backgroundColor + 'A6',
    end: backgroundColor + 'F2',
    clear: backgroundColor + '00',
  };
}

/**
 * Ready-made colour array for a scrim at the TOP of a screen: opaque at the screen
 * edge, fading into the content below.
 */
export function topScrimColors(isDark: boolean, backgroundColor: string): [string, string, string] {
  const s = scrimStops(isDark, backgroundColor);
  return [s.end, s.mid, s.clear];
}

/**
 * Ready-made colour array for a scrim at the BOTTOM of a screen: transparent where it
 * meets the content, opaque at the screen edge.
 */
export function bottomScrimColors(isDark: boolean, backgroundColor: string): [string, string, string] {
  const s = scrimStops(isDark, backgroundColor);
  return [s.clear, s.mid, s.end];
}
