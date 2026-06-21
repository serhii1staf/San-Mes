// Message-color customization: solid swatches, gradient "combinations",
// opacity, and a contrast helper.
//
// Used by the message-color settings sheet (swatch + gradient grid, opacity
// slider) and the chat screen (renders the outgoing bubble + picks a readable
// text color). Kept in one tiny module so both sides stay in sync.

export interface BubbleStyle {
  /** 1 color = solid fill, 2+ = gradient (top-left → bottom-right). */
  colors: string[];
  /** 0.5–1 bubble opacity. */
  opacity: number;
}

export interface SolidSwatch {
  key: string;
  label: string;
  color: string;
}

export interface GradientPreset {
  key: string;
  label: string;
  emoji: string;
  colors: [string, string];
}

// Saturated, "сочные" solid colors that read well in light + dark chats.
export const BUBBLE_COLORS: SolidSwatch[] = [
  { key: 'blue',     label: 'Синий',     color: '#0A84FF' },
  { key: 'indigo',   label: 'Индиго',    color: '#5C6BC0' },
  { key: 'violet',   label: 'Фиалка',    color: '#8B5CF6' },
  { key: 'purple',   label: 'Пурпур',    color: '#BF5AF2' },
  { key: 'pink',     label: 'Розовый',   color: '#FF4FA3' },
  { key: 'red',      label: 'Красный',   color: '#FF453A' },
  { key: 'orange',   label: 'Оранжевый', color: '#FF9F0A' },
  { key: 'amber',    label: 'Янтарь',    color: '#F5A623' },
  { key: 'green',    label: 'Зелёный',   color: '#30D158' },
  { key: 'teal',     label: 'Бирюза',    color: '#14B8A6' },
  { key: 'ocean',    label: 'Океан',     color: '#0EA5E9' },
  { key: 'graphite', label: 'Графит',    color: '#3A3A3C' },
];

// Trendy 2-color gradient "combinations" — the stylish part. Each has an emoji
// so the grid reads young/modern. Rendered as a diagonal LinearGradient behind
// the bubble (GPU, opt-in — solid/theme bubbles never mount a gradient).
export const GRADIENT_PRESETS: GradientPreset[] = [
  { key: 'sunset',    label: 'Закат',    emoji: '🌅', colors: ['#FF6A88', '#FF9A8B'] },
  { key: 'grape',     label: 'Виноград', emoji: '🍇', colors: ['#7B2FF7', '#F107A3'] },
  { key: 'ocean',     label: 'Океан',    emoji: '🌊', colors: ['#2E3192', '#1BFFFF'] },
  { key: 'mint',      label: 'Мята',     emoji: '🌿', colors: ['#11998E', '#38EF7D'] },
  { key: 'peach',     label: 'Персик',   emoji: '🍑', colors: ['#FF512F', '#F09819'] },
  { key: 'flamingo',  label: 'Фламинго', emoji: '🦩', colors: ['#FF5F9E', '#FFC371'] },
  { key: 'aurora',    label: 'Аврора',   emoji: '🌌', colors: ['#4E54C8', '#8F94FB'] },
  { key: 'lime',      label: 'Лайм',     emoji: '🍏', colors: ['#A8E063', '#56AB2F'] },
  { key: 'candy',     label: 'Конфета',  emoji: '🍭', colors: ['#FC466B', '#3F5EFB'] },
  { key: 'fire',      label: 'Огонь',    emoji: '🔥', colors: ['#F12711', '#F5AF19'] },
  { key: 'sky',       label: 'Небо',     emoji: '☁️', colors: ['#2980B9', '#6DD5FA'] },
  { key: 'berry',     label: 'Ягода',    emoji: '🫐', colors: ['#8E2DE2', '#4A00E0'] },
];

export const MIN_OPACITY = 0.5;

// Relative luminance (sRGB) → pick black or white text for max readability.
// For gradients, the average of the stops is used.
export function readableTextOn(colors: string | string[] | null | undefined): string {
  if (!colors) return '#FFFFFF';
  const list = Array.isArray(colors) ? colors : [colors];
  if (list.length === 0) return '#FFFFFF';
  let sum = 0;
  let counted = 0;
  for (const hex of list) {
    const lum = luminanceOf(hex);
    if (lum >= 0) { sum += lum; counted++; }
  }
  if (counted === 0) return '#FFFFFF';
  return sum / counted > 150 ? '#1A1A1A' : '#FFFFFF';
}

function luminanceOf(hex: string): number {
  let h = (hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return -1;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return -1;
  return 0.299 * r + 0.587 * g + 0.114 * b; // ITU-R BT.601, 0–255
}

// Append an 8-bit alpha suffix to a #RRGGBB hex from a 0–1 opacity. Returns the
// color unchanged if it isn't a parseable 6-digit hex (e.g. already rgba()).
export function withOpacity(hex: string, opacity: number): string {
  let h = (hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return hex;
  const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
  return `#${h}${a.toString(16).padStart(2, '0').toUpperCase()}`;
}

// HSL → #RRGGBB. Used by the custom color creator's hue spectrum sliders, with
// fixed saturation/lightness for vibrant, readable bubble colors.
export function hslToHex(h: number, s = 0.72, l = 0.55): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60) { r = c; g = x; }
  else if (hue < 120) { r = x; g = c; }
  else if (hue < 180) { g = c; b = x; }
  else if (hue < 240) { g = x; b = c; }
  else if (hue < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${to(r)}${to(g)}${to(b)}`;
}

// Approximate hue (0–360) of a hex — lets the custom editor's slider position
// itself when a preset/solid is loaded in for tweaking.
export function hexToHue(hex: string): number {
  let h = (hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return 0;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let hue = 0;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  return (hue + 360) % 360;
}
