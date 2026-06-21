// Custom chat-bubble color palette + contrast helper.
//
// Used by the chat-bubble-color settings screen (swatch grid) and the chat
// screen (to render the outgoing bubble + pick a readable text color). Kept in
// one tiny module so both sides stay in sync and the helper is shared.

export interface BubbleSwatch {
  key: string;
  label: string;
  color: string;
}

// A curated set of saturated, "сочные" bubble colors that read well in both
// light and dark chats. The first entry (null at the call site) means "follow
// the theme accent" — these are the explicit overrides.
export const BUBBLE_COLORS: BubbleSwatch[] = [
  { key: 'blue',     label: 'Синий',      color: '#0A84FF' },
  { key: 'indigo',   label: 'Индиго',     color: '#5C6BC0' },
  { key: 'violet',   label: 'Фиалка',     color: '#8B5CF6' },
  { key: 'purple',   label: 'Пурпур',     color: '#BF5AF2' },
  { key: 'pink',     label: 'Розовый',    color: '#FF4FA3' },
  { key: 'rose',     label: 'Роза',       color: '#F43F7E' },
  { key: 'red',      label: 'Красный',    color: '#FF453A' },
  { key: 'sunset',   label: 'Закат',      color: '#FF7B54' },
  { key: 'orange',   label: 'Оранжевый',  color: '#FF9F0A' },
  { key: 'amber',    label: 'Янтарь',     color: '#F5A623' },
  { key: 'green',    label: 'Зелёный',    color: '#30D158' },
  { key: 'emerald',  label: 'Изумруд',    color: '#1DB954' },
  { key: 'teal',     label: 'Бирюза',     color: '#14B8A6' },
  { key: 'ocean',    label: 'Океан',      color: '#0EA5E9' },
  { key: 'graphite', label: 'Графит',     color: '#3A3A3C' },
];

// Relative luminance (sRGB) → pick black or white text for max readability.
// Handles 3- and 6-digit hex with or without a leading '#'. Falls back to
// white text on parse failure (matches the historical white-on-accent look).
export function readableTextOn(hex: string | null | undefined): string {
  if (!hex) return '#FFFFFF';
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return '#FFFFFF';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return '#FFFFFF';
  // Perceived luminance (ITU-R BT.601 weighting), 0–255.
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 150 ? '#1A1A1A' : '#FFFFFF';
}

// A translucent variant of a text color for secondary text (timestamp, reply
// preview) inside the bubble — keeps the same readable hue at reduced opacity.
export function bubbleSecondaryText(textColor: string, strong = false): string {
  const alpha = strong ? 'E6' : '99'; // ~90% / ~60%
  return textColor === '#FFFFFF' ? `rgba(255,255,255,${strong ? 0.9 : 0.6})` : `rgba(0,0,0,${strong ? 0.85 : 0.55})`;
}
