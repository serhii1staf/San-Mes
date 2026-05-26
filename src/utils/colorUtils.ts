/**
 * Convert a hex color to rgba string
 */
export function hexToRgba(hex: string, alpha: number = 1): string {
  // Remove # if present
  const clean = hex.replace('#', '');

  let r: number, g: number, b: number;

  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length === 6) {
    r = parseInt(clean.substring(0, 2), 16);
    g = parseInt(clean.substring(2, 4), 16);
    b = parseInt(clean.substring(4, 6), 16);
  } else {
    // Fallback
    return `rgba(26,26,26,${alpha})`;
  }

  return `rgba(${r},${g},${b},${alpha})`;
}
