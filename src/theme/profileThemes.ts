import { colors } from './tokens';
import { fontFamily } from './fonts';

/**
 * Seasonal Profile Themes — registry + total resolver.
 *
 * Single source of truth for the Built_In_Theme_Set and the resolver that turns
 * a raw, possibly-unknown theme id (from a profile row / cache) into a fully
 * renderable theme. The resolver is TOTAL: it never throws and never returns
 * `undefined`; unknown or missing ids collapse to the Default_Theme.
 *
 * PLACEHOLDER phase (design "Asset dependency"): no illustration or font files
 * exist in the repo yet, so every theme ships with `backgroundIllustration:
 * null` and `themeFont.asset: null`. Themes resolve palette-only via the same
 * fallback path used for a failed image load until licensed assets are sourced.
 */

export type ProfileThemeId =
  | 'default-dark'
  | 'spring'
  | 'summer-beach'
  | 'autumn'
  | 'winter'
  | 'purple-pixel'
  | 'night'
  | 'sunset'
  | 'ocean'
  | 'desert'
  | 'forest'
  | 'sakura'
  | 'aurora'
  | 'city'
  | 'galaxy'
  | 'lavender';

export type AmbientAnimationType = 'snow' | 'leaves';

export interface ThemePalette {
  /** 2–5 gradient stops, top→bottom. */
  gradient: string[];
  text: string; // primary text
  secondaryText: string; // secondary text
  accent: string; // accent color
}

export interface EmojiAccentSet {
  like: string; // single system-emoji glyph for the like icon
  menu: string; // post-overflow "…" menu area
  follow: string; // follow ("Подписаться") button
}

export interface ThemeFont {
  key: string; // e.g. 'pixel'
  family: string; // RN fontFamily once loaded
  asset?: number | null; // require()'d bundled font, null until sourced
}

export interface ProfileTheme {
  id: ProfileThemeId;
  label: string;
  palette: ThemePalette;
  /** require()'d bundled image, or null when palette-only / asset pending. */
  backgroundIllustration: number | null;
  ambientAnimation: AmbientAnimationType | null;
  emojiAccents: EmojiAccentSet | null;
  themeFont: ThemeFont | null;
}

export const DEFAULT_THEME_ID: ProfileThemeId = 'default-dark';

/**
 * The app default font, exposed as a renderable ThemeFont. A theme whose
 * `themeFont` is `null` renders with this font; it is kept here so the resolver
 * and effective-font selectors always have a concrete app-default reference.
 */
export const APP_DEFAULT_FONT: ThemeFont = {
  key: 'inter',
  family: fontFamily.regular,
  asset: null,
};

/**
 * Built_In_Theme_Set — exactly six themes keyed by Theme_Id (Req 1.1).
 *
 * Every theme keeps `backgroundIllustration: null` and (where defined)
 * `themeFont.asset: null` during the PLACEHOLDER phase.
 */
export const BUILT_IN_THEMES: Record<ProfileThemeId, ProfileTheme> = {
  // Default neutral dark skin — the fallback. No illustration, ambient, emoji,
  // or font override; renders with the app default font (Req 1.6, 5.6).
  'default-dark': {
    id: 'default-dark',
    label: 'По умолчанию',
    palette: {
      gradient: [colors.charcoal[800], colors.charcoal[900]],
      text: colors.cream[50],
      secondaryText: colors.charcoal[300],
      accent: colors.sage[400],
    },
    backgroundIllustration: null,
    ambientAnimation: null,
    emojiAccents: null,
    themeFont: null,
  },

  spring: {
    id: 'spring',
    label: 'Весна',
    palette: {
      gradient: ['#E8F5E9', '#A5D6A7', '#66BB6A'],
      text: '#1B3A1B',
      secondaryText: '#4A6B4A',
      accent: '#43A047',
    },
    backgroundIllustration: null,
    ambientAnimation: null,
    emojiAccents: { like: '🌷', menu: '🌿', follow: '🌱' },
    themeFont: null,
  },

  'summer-beach': {
    id: 'summer-beach',
    label: 'Пляж',
    palette: {
      gradient: ['#FFE0C7', '#FFD3A5', '#7FD8D8'],
      text: '#5A3A20',
      secondaryText: '#8A6A4A',
      accent: colors.coral[400],
    },
    backgroundIllustration: null,
    ambientAnimation: null,
    emojiAccents: { like: '🌴', menu: '🐚', follow: '☀️' },
    themeFont: null,
  },

  autumn: {
    id: 'autumn',
    label: 'Осень',
    palette: {
      gradient: ['#5C2E0D', '#A0522D', '#E89A4D'],
      text: '#FFF3E6',
      secondaryText: '#E0C9B0',
      accent: colors.gold[500],
    },
    backgroundIllustration: null,
    ambientAnimation: 'leaves',
    emojiAccents: { like: '🍂', menu: '🌰', follow: '🎃' },
    themeFont: null,
  },

  winter: {
    id: 'winter',
    label: 'Зима',
    palette: {
      gradient: ['#E3F2FD', '#90CAF9', '#42A5F5'],
      text: '#0D2A45',
      secondaryText: '#3A5A75',
      accent: '#4FC3F7',
    },
    backgroundIllustration: null,
    ambientAnimation: 'snow',
    emojiAccents: { like: '❄️', menu: '🧣', follow: '🎄' },
    themeFont: null,
  },

  'purple-pixel': {
    id: 'purple-pixel',
    label: 'Пиксель',
    palette: {
      gradient: ['#2A1A3D', '#6B4F9E', '#B39DDB'],
      text: '#F3E5F5',
      secondaryText: '#C5B0E0',
      accent: '#9C27B0',
    },
    backgroundIllustration: null,
    ambientAnimation: null,
    emojiAccents: { like: '👾', menu: '🕹️', follow: '⭐' },
    themeFont: { key: 'pixel', family: 'pixel', asset: null },
  },

  night: {
    id: 'night',
    label: 'Ночь',
    palette: { gradient: ['#0B1E3D', '#16335E', '#2E5A8F'], text: '#EAF2FF', secondaryText: '#9DB6D6', accent: '#7FB2FF' },
    backgroundIllustration: null,
    ambientAnimation: null,
    emojiAccents: { like: '🌙', menu: '⭐', follow: '✨' },
    themeFont: null,
  },
  sunset: {
    id: 'sunset',
    label: 'Закат',
    palette: { gradient: ['#FFC18A', '#FF7E79', '#7A4A86'], text: '#FFF1E8', secondaryText: '#F3CFC6', accent: '#FF6F61' },
    backgroundIllustration: null,
    ambientAnimation: null,
    emojiAccents: { like: '🌅', menu: '🌇', follow: '🧡' },
    themeFont: null,
  },
  ocean: {
    id: 'ocean',
    label: 'Океан',
    palette: { gradient: ['#CDEFFF', '#7FC9EC', '#1E6FA8'], text: '#06324F', secondaryText: '#2E6F92', accent: '#0FB5C9' },
    backgroundIllustration: null,
    ambientAnimation: null,
    emojiAccents: { like: '🌊', menu: '🐚', follow: '⚓' },
    themeFont: null,
  },
  desert: {
    id: 'desert',
    label: 'Пустыня',
    palette: { gradient: ['#FCE8BE', '#F4C56E', '#DC8A3C'], text: '#5A3A12', secondaryText: '#8A6230', accent: '#E0892F' },
    backgroundIllustration: null,
    ambientAnimation: null,
    emojiAccents: { like: '🌵', menu: '🦂', follow: '🐪' },
    themeFont: null,
  },
  forest: {
    id: 'forest',
    label: 'Лес',
    palette: { gradient: ['#CFE9C7', '#7FB069', '#27531F'], text: '#15300F', secondaryText: '#3E5E36', accent: '#3E8E43' },
    backgroundIllustration: null,
    ambientAnimation: null,
    emojiAccents: { like: '🌲', menu: '🍄', follow: '🦌' },
    themeFont: null,
  },
  sakura: {
    id: 'sakura',
    label: 'Сакура',
    palette: { gradient: ['#FFE9F0', '#FBC9DA', '#F49AB6'], text: '#5A2A3E', secondaryText: '#8A5A6E', accent: '#F06292' },
    backgroundIllustration: null,
    ambientAnimation: null,
    emojiAccents: { like: '🌸', menu: '🍡', follow: '🦋' },
    themeFont: null,
  },
  aurora: {
    id: 'aurora',
    label: 'Сияние',
    palette: { gradient: ['#06121F', '#0E2A3A', '#123048'], text: '#E6F7FF', secondaryText: '#9FC7D6', accent: '#5FE0B0' },
    backgroundIllustration: null,
    ambientAnimation: null,
    emojiAccents: { like: '🌌', menu: '❄️', follow: '💫' },
    themeFont: null,
  },
  city: {
    id: 'city',
    label: 'Город',
    palette: { gradient: ['#16203A', '#2C3A63', '#4E5E96'], text: '#EAF0FF', secondaryText: '#A9B6DA', accent: '#FFB74D' },
    backgroundIllustration: null,
    ambientAnimation: null,
    emojiAccents: { like: '🏙️', menu: '🌃', follow: '🚕' },
    themeFont: null,
  },
  galaxy: {
    id: 'galaxy',
    label: 'Галактика',
    palette: { gradient: ['#0A0420', '#241252', '#4B2A8A'], text: '#EDE3FF', secondaryText: '#B6A6E0', accent: '#B388FF' },
    backgroundIllustration: null,
    ambientAnimation: null,
    emojiAccents: { like: '🪐', menu: '🌌', follow: '🚀' },
    themeFont: null,
  },
  lavender: {
    id: 'lavender',
    label: 'Лаванда',
    palette: { gradient: ['#ECE3F7', '#CBB3EA', '#9B7FD0'], text: '#3A2A55', secondaryText: '#6E5A8E', accent: '#7E57C2' },
    backgroundIllustration: null,
    ambientAnimation: null,
    emojiAccents: { like: '💜', menu: '🌿', follow: '🐝' },
    themeFont: null,
  },
};

/**
 * Stable display order for the picker (Req 2.1). Default first, then seasonal.
 */
export const BUILT_IN_THEME_LIST: ProfileTheme[] = [
  BUILT_IN_THEMES['default-dark'],
  BUILT_IN_THEMES.spring,
  BUILT_IN_THEMES['summer-beach'],
  BUILT_IN_THEMES.autumn,
  BUILT_IN_THEMES.winter,
  BUILT_IN_THEMES.sakura,
  BUILT_IN_THEMES.forest,
  BUILT_IN_THEMES.ocean,
  BUILT_IN_THEMES.sunset,
  BUILT_IN_THEMES.desert,
  BUILT_IN_THEMES.lavender,
  BUILT_IN_THEMES.night,
  BUILT_IN_THEMES.aurora,
  BUILT_IN_THEMES.city,
  BUILT_IN_THEMES.galaxy,
  BUILT_IN_THEMES['purple-pixel'],
];

/**
 * The Default_Theme: the `default-dark` member of the Built_In_Theme_Set,
 * always available with a complete neutral dark palette and the app default
 * font (its `themeFont` is `null`, meaning render with `APP_DEFAULT_FONT`).
 * Every fallback path resolves here (Req 1.6, 5.6).
 */
export const DEFAULT_THEME: ProfileTheme = BUILT_IN_THEMES[DEFAULT_THEME_ID];

/** Type guard: true only for the six known Theme_Ids. */
export function isKnownThemeId(id: unknown): id is ProfileThemeId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(BUILT_IN_THEMES, id);
}

/**
 * Total function: ALWAYS returns a renderable ProfileTheme with a non-empty
 * palette. Unknown, empty, `null`, or `undefined` ids collapse to the
 * Default_Theme (Req 1.7, 3.5, 3.6, 5.1, 5.2, 5.5, 5.6, 9.6). Never throws,
 * never returns `undefined`.
 */
export function resolveProfileTheme(id: string | null | undefined): ProfileTheme {
  if (isKnownThemeId(id)) {
    return BUILT_IN_THEMES[id];
  }
  return DEFAULT_THEME;
}

/**
 * Resolution result that also reports whether a fallback occurred. The raw
 * `requestedId` is preserved unchanged for round-tripping, while `theme` is the
 * renderable result and `isFallback` is true exactly when the requested id is
 * not a known Theme_Id (Req 9.7).
 */
export function resolveProfileThemeResult(id: string | null | undefined): {
  theme: ProfileTheme;
  requestedId: string | null;
  isFallback: boolean;
} {
  const known = isKnownThemeId(id);
  return {
    theme: known ? BUILT_IN_THEMES[id] : DEFAULT_THEME,
    requestedId: id ?? null,
    isFallback: !known,
  };
}
