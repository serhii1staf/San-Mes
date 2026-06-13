/**
 * Theme-color → pixel-icon matcher.
 *
 * Given a hex color (the accent of a theme the AI just applied), returns
 * a curated set of ~12 PixelIcons drawn from 2 packs whose mood matches
 * the color's hue/saturation. The picker carousel in the AI chat
 * (`ThemeIconCarousel`) feeds the resulting list into a horizontal
 * FlatList so the user can swipe-pick one as their home-header icon.
 *
 * Determinism is required — the same hex MUST always yield the same
 * icon list and the same order. The user shouldn't see the suggestions
 * shuffle when they re-create the same theme. We achieve this by:
 *  1. Bucketing the color by HSL hue (and saturation for monochrome).
 *  2. Walking PIXEL_ICONS in registry order, picking the first 6 from
 *     each chosen pack, deduping by id, capping at 12.
 *
 * No randomness, no sorting, no Date.now. Pure function of the hex.
 *
 * Pack-mood mapping (per the design spec):
 *   Warm        red/orange/coral       → pack-9-ultra-memes + pack-4-memes
 *   Yellow/gold yellow/amber           → pack-9-ultra-memes + pack-4-memes
 *   Green/sage  green/teal             → pack-1 + pack-3
 *   Cool        blue/teal/cyan         → pack-1 + pack-3
 *   Purple      purple/violet          → pack-3 + pack-7-anime
 *   Pink/lav.   pink/lavender          → pack-8-kawaii-spooky + pack-7-anime
 *   Dark/mono   low-saturation         → pack-3 + pack-1
 *   Fallback    invalid hex            → first 10 icons across all packs
 */

import { PIXEL_ICONS } from './registry';
import type { PixelIcon } from './registry';

interface Hsl {
  /** Hue in degrees [0, 360). */
  h: number;
  /** Saturation [0, 1]. */
  s: number;
  /** Lightness [0, 1]. */
  l: number;
}

/**
 * Convert `#rgb` or `#rrggbb` to HSL. Returns `null` for malformed
 * input — the caller falls back to a safe default icon list.
 */
export function hexToHsl(hex: string): Hsl | null {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hue = 0;
  let sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  // Normalize hue to [0, 360).
  if (hue < 0) hue += 360;
  if (hue >= 360) hue -= 360;
  return { h: hue, s: sat, l };
}

type Pack =
  | 'pack-1'
  | 'pack-3'
  | 'pack-7-anime'
  | 'pack-8-kawaii-spooky'
  | 'pack-4-memes'
  | 'pack-6-memes'
  | 'pack-9-ultra-memes';

/**
 * Pick a pair of packs that best matches the hex's mood.
 * Returns 2 packs in the order they should be drawn from
 * (first pack contributes the leading icons in the carousel).
 */
function packsForHsl(hsl: Hsl | null): Pack[] {
  if (!hsl) return ['pack-1', 'pack-3'];
  const { h, s, l } = hsl;
  // Low saturation → grayscale / monochrome → mystical+adventurer.
  if (s < 0.18) return ['pack-3', 'pack-1'];
  // Very dark colors (near-black) treat like monochrome too.
  if (l < 0.12) return ['pack-3', 'pack-1'];

  // Hue ranges (degrees) — checked top-down. Wraparound handled at edges.
  // 0-15 + 340-360 → red/coral
  if (h < 15 || h >= 340) return ['pack-9-ultra-memes', 'pack-4-memes'];
  // 15-45 → orange
  if (h < 45) return ['pack-9-ultra-memes', 'pack-4-memes'];
  // 45-70 → yellow/gold
  if (h < 70) return ['pack-9-ultra-memes', 'pack-4-memes'];
  // 70-170 → green/sage
  if (h < 170) return ['pack-1', 'pack-3'];
  // 170-220 → cyan/teal
  if (h < 220) return ['pack-1', 'pack-3'];
  // 220-260 → blue
  if (h < 260) return ['pack-1', 'pack-3'];
  // 260-310 → purple/violet
  if (h < 310) return ['pack-3', 'pack-7-anime'];
  // 310-340 → pink / lavender
  return ['pack-8-kawaii-spooky', 'pack-7-anime'];
}

const MAX_ICONS = 12;
const PER_PACK = 6;

/**
 * Curated 12-icon list for the given theme accent color.
 * Deterministic — same hex → same list, same order.
 */
export function iconsForThemeColor(hex: string): PixelIcon[] {
  const hsl = hexToHsl(hex);
  if (!hsl) {
    // Fallback: first 10 icons across all packs (registry-order).
    return PIXEL_ICONS.slice(0, 10);
  }
  const packs = packsForHsl(hsl);
  const seen = new Set<string>();
  const out: PixelIcon[] = [];
  for (const pack of packs) {
    let taken = 0;
    for (const ic of PIXEL_ICONS) {
      if (ic.pack !== pack) continue;
      if (seen.has(ic.id)) continue;
      seen.add(ic.id);
      out.push(ic);
      taken++;
      if (taken >= PER_PACK) break;
      if (out.length >= MAX_ICONS) return out;
    }
    if (out.length >= MAX_ICONS) return out;
  }
  return out;
}
