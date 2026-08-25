import type { TextStyle } from 'react-native';

/**
 * Metrics for rendering a colour emoji glyph without it being clipped on Android.
 *
 * ── THE BUG, AND WHY IT KEPT COMING BACK ────────────────────────────────────
 *
 * Reported: on Android emoji are cut off — on the registration screen, in the emoji-picker sheet, and
 * in other places.
 *
 * This exact defect was already diagnosed and fixed ONCE in this codebase, in
 * `src/components/ui/TypingIndicator.tsx`, and it took two attempts there. That file's notes are the
 * source of everything below, and they are worth restating because the first attempt is the obvious one
 * and it does not work:
 *
 *   1. A colour emoji is drawn TALLER than a Latin glyph of the same point size, so a default line box
 *      is shorter than the bitmap and trims the top and bottom.
 *
 *   2. Adding `lineHeight` alone is NOT enough on Android. The text view's height comes from the font's
 *      ascent + descent metrics, and an emoji's bitmap routinely exceeds them — so the glyph overflows a
 *      box that `lineHeight` merely suggested, and RN clips to the measured view rather than to the line
 *      box. The box has to be made explicit with `height`.
 *
 *   3. `includeFontPadding: false` is then required, or Android's extra ascent/descent padding pushes
 *      the glyph off-centre inside that taller box.
 *
 * So the working recipe is four properties that have to travel together. That is precisely the kind of
 * thing that does not survive being re-derived per call site: twenty-six places in the app render an
 * emoji glyph and exactly two of them had all four. The rest had `fontSize` and nothing else.
 *
 * This is the fourth time this session the same shape of fix has applied — the scrims drifted while each
 * screen inlined its own gradient stops, decode pacing was unreachable from a `renderItem`, and Android
 * surfaces had two independent families. One definition, imported everywhere, is the only version of this
 * that stays fixed.
 *
 * ── WHY A STYLE HELPER RATHER THAN A COMPONENT ──────────────────────────────
 *
 * Because most of these live in `StyleSheet.create` blocks, not in JSX, so a component would mean
 * restructuring twenty-odd render paths to fix a styling bug. `emojiTextStyle(26)` drops into a
 * stylesheet entry and into an inline `style` prop equally well.
 */

/**
 * How much taller than the point size the glyph's box must be.
 *
 * 1.3 is what `TypingIndicator` settled on after the two rounds described above (17 pt in a 22 pt box).
 * Rounded rather than fractional because a fractional height lands on a half-pixel at some densities,
 * which is its own source of a hairline of clipping.
 */
const EMOJI_BOX_RATIO = 1.3;

/**
 * Text style for a single emoji glyph at `size` points.
 *
 * Spread it into a stylesheet entry (`emojiCell: emojiTextStyle(24)`) or pass it straight as a `style`.
 * Pair with `allowFontScaling={false}` on the `Text` for anything laid out in a fixed-size cell — an
 * accessibility text scale would otherwise grow the glyph past a box that is deliberately exact.
 */
export function emojiTextStyle(size: number): TextStyle {
  const box = Math.round(size * EMOJI_BOX_RATIO);
  return {
    fontSize: size,
    lineHeight: box,
    // The load-bearing one. See point 2 above: without an explicit height the view is measured from font
    // metrics that the emoji bitmap exceeds, and no `lineHeight` can rescue it.
    height: box,
    textAlignVertical: 'center',
    includeFontPadding: false,
  };
}
