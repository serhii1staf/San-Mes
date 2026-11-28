/**
 * A theme built from any colour San AI is given: the parsing and the palette behind
 * `[ACTION:custom_theme:Name:colour]`. Pure functions, no imports at runtime.
 *
 * ── WHY THIS EXISTS (Nov 2026) ────────────────────────────────────────────────────────────────────
 *
 * Reported: asked for «Buttermilk #FFF1B5», San AI made the app black. Two causes, both fixed here
 * and in aiService.ts:
 *   1. The system prompt forbade light colours outright («НИКОГДА не используй белый или очень
 *      светлые цвета») and listed #2D3436, a near-black, among its "good" examples, so the model
 *      swapped the user's colour for a dark one.
 *   2. Even a light colour that got through became black: every AI theme switched the app to dark
 *      mode and took its backgrounds as 10-20% of the colour (#FFF1B5 → #191812), leaving the cream
 *      only on the buttons, where the white text on it could not be read.
 *
 * Now any colour and any shade is accepted, and it goes where it can be seen. A light colour
 * (luminance ≥ LIGHT_THEME_LUMINANCE: creams, pastels, white) becomes the page of a LIGHT theme, with
 * the buttons in the same hue made deep enough to carry white text. Anything else becomes the accent
 * of a DARK theme, as the built-in themes are; a colour that is itself dark enough to be a page
 * (navy, aubergine, black) becomes the page, and the accent is lifted so it stays visible on it.
 */
import type { ACCENT_COLORS, ThemeMode } from '../store/themeStore';

type ThemeOption = (typeof ACCENT_COLORS)[number];
type Rgb = [number, number, number];

/** At or above this a colour is a page, not a button (#FFF1B5 is 0.87, white 1, peach #FFBFA0 0.62). */
const LIGHT_THEME_LUMINANCE = 0.7;
/** White text on the accent of a light theme must reach this. */
const ACCENT_ON_WHITE = 2.6;
/** A grey accent needs more than a coloured one to read as the accent at all. */
const GREY_ACCENT_ON_WHITE = 4.5;
/** At or below this HSL lightness a colour is used as the dark page itself. */
const PAGE_LIGHTNESS = 0.2;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function rgbToHex([r, g, b]: Rgb): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

const hsl = (h: number, s: number, l: number) => rgbToHex(hslToRgb(h, clamp01(s), clamp01(l)));

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * A colour in any of the forms people and models write it, as `#RRGGBB`, or null.
 * `#FFF1B5`, `FFF1B5`, `#fc0`, `#FFF1B5CC` (alpha dropped), `rgb(255, 241, 181)`, `hsl(49 100% 85%)`,
 * and a colour inside other text («#FFF1B5 (Buttermilk)»).
 */
export function parseColor(input: string | undefined | null): string | null {
  if (!input) return null;
  const s = input.trim();
  const hex = s.match(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])/i);
  if (hex) return expandHex(hex[1]);
  const rgb = s.match(/rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/i);
  if (rgb) {
    const v = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    return v.every((n) => n <= 255) ? rgbToHex(v as Rgb) : null;
  }
  const h = s.match(/hsla?\(\s*(-?[\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%/i);
  if (h) return hsl(Number(h[1]), Number(h[2]) / 100, Number(h[3]) / 100);
  // A bare code with no '#', the whole value: «FFF1B5».
  const bare = s.match(/^([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})$/i);
  return bare ? expandHex(bare[1]) : null;
}

function expandHex(h: string): string {
  const six = h.length <= 4 ? h.slice(0, 3).split('').map((c) => c + c).join('') : h.slice(0, 6);
  return '#' + six.toUpperCase();
}

/**
 * The key an AI theme is stored under. Plain Latin names keep the key they always had. Any other
 * name (Cyrillic, emoji, punctuation) used to collapse into dashes only, so «Сливочный» and «Лимонный»
 * shared `ai----------` and the second overwrote the first; those get a short hash of the name.
 */
export function aiThemeKey(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  if (/^[a-z0-9 -]*$/i.test(name)) return 'ai-' + slug;
  let h = 5381;
  for (const ch of name) h = ((h * 33) ^ (ch.codePointAt(0) || 0)) >>> 0;
  return 'ai-' + slug + '-' + h.toString(36);
}

/** The key the same name had before `aiThemeKey`, for themes created then. */
export function legacyAiThemeKey(name: string): string {
  return 'ai-' + name.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

/**
 * `Name:colour` (the action's value) split into its name and parsed colour. Also accepts the two the
 * other way round, which models sometimes write.
 */
export function splitThemeValue(value: string): { name: string; color: string } | null {
  const i = value.indexOf(':');
  if (i < 0) return null;
  const first = value.slice(0, i).trim();
  const rest = value.slice(i + 1).trim();
  const color = parseColor(rest);
  if (color && first) return { name: first, color };
  const flipped = parseColor(first);
  const restName = rest.split(':')[0].trim();
  if (flipped && restName && !parseColor(restName)) return { name: restName, color: flipped };
  return null;
}

/** The palette for `color` (already `#RRGGBB`), and the mode it reads best in. */
export function buildThemeFromColor(key: string, label: string, color: string): { theme: ThemeOption; mode: ThemeMode } {
  const rgb = hexToRgb(color);
  const [h, s, l] = rgbToHsl(rgb);
  const lum = luminance(rgb);
  // Below this the hue of a colour is noise (greys, near-black, near-white): keep it grey.
  const chromatic = s >= 0.06 && l > 0.02 && l < 0.98;
  const mode: ThemeMode = lum >= LIGHT_THEME_LUMINANCE ? 'light' : 'dark';

  // The accent: the colour itself on a dark theme; on a light one, the same hue made deep enough to
  // carry white text (the colour itself is the page there).
  let accent = color;
  // A muted colour keeps its own saturation: boosting it turned a grey-blue charcoal into a teal accent.
  const muted = s < 0.25;
  if (mode === 'light') {
    const target = chromatic ? ACCENT_ON_WHITE : GREY_ACCENT_ON_WHITE;
    const sat = chromatic ? (muted ? s : Math.max(s, 0.5)) : 0;
    let lo = 0;
    let hi = l;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (contrast(luminance(hslToRgb(h, sat, mid)), 1) >= target) lo = mid;
      else hi = mid;
    }
    accent = hsl(h, sat, lo);
  } else if (l <= PAGE_LIGHTNESS) {
    // Navy, aubergine, black: the page itself, so the accent is lifted off it.
    accent = hsl(h, chromatic ? (muted ? s : Math.max(s, 0.45)) : 0, 0.62);
  }

  // Dark-mode surfaces: the colour itself when it is already that dark, otherwise a deep tint of its
  // hue at the lightness steps the built-in themes use (page 8.5%, raised 11%, cards 14.5%, lines 20%).
  let darkBg: string;
  let darkSecondary: string;
  let darkElevated: string;
  let darkBorder: string;
  if (l <= PAGE_LIGHTNESS) {
    darkBg = color;
    darkSecondary = hsl(h, s, l + 0.03);
    darkElevated = hsl(h, s, l + 0.065);
    darkBorder = hsl(h, s, l + 0.12);
  } else {
    const tint = chromatic ? Math.min(0.3, Math.max(0.1, s * 0.35)) : 0;
    darkBg = hsl(h, tint, 0.085);
    darkSecondary = hsl(h, tint, 0.11);
    darkElevated = hsl(h, tint, 0.145);
    darkBorder = hsl(h, tint, 0.2);
  }

  // The light-mode page: the colour itself on a light theme, else a pale tint of it (built-in style).
  const light = mode === 'light' ? color : chromatic ? hsl(h, Math.min(s, 0.8), 0.965) : '#F8F8F8';

  return {
    theme: { key, label, color, accent, light, darkBg, darkElevated, darkSecondary, darkBorder },
    mode,
  };
}
