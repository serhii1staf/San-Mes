// headerScene
// -----------
// "Build-your-own" profile header. A HeaderScene is an optional BACKGROUND
// (a named gradient) plus a list of freely-placed sticker items the user
// arranges on the frosted header card. Stored:
//   • LOCALLY (per-account MMKV) keyed by user id — instant + offline for the
//     owner; and
//   • on the PROFILE ROW via PATCH /v1/profiles/me `header_scene` (the Worker
//     persists it as TEXT JSON and returns it on GET /v1/profiles/:id), so
//     OTHER users render it too.
//
// Coordinates are NORMALIZED (0..1) within the card box so a scene renders
// identically on any device width. `scale` is relative to BASE_ITEM_SIZE;
// `rotation` is degrees.

import { kvGetJSONSync, kvSetJSON } from './kvStore';

export type HeaderItemKind = 'emoji';
export type HeaderItemAnim = 'none' | 'float' | 'pulse' | 'spin' | 'swing';

export interface HeaderItem {
  id: string;
  kind: HeaderItemKind;
  value: string; // emoji / sticker glyph
  x: number;     // 0..1 center X
  y: number;     // 0..1 center Y
  scale: number; // size multiplier (1 = BASE_ITEM_SIZE px)
  rotation: number; // degrees
  anim?: HeaderItemAnim; // optional looping animation (default 'none')
}

export interface HeaderScene {
  version: 1;
  items: HeaderItem[];
  /** Named background gradient id (see HEADER_BACKGROUNDS), or null = none. */
  background?: string | null;
  /** When true, a chosen background is drawn semi-transparently so the user's
   *  banner photo shows through (background + banner combined). */
  bgBlend?: boolean;
  /** Freehand strokes the user drew for a custom background (normalized 0..100
   *  coordinate space). Rendered behind the stickers. */
  drawing?: HeaderDrawStroke[];
}

/** One freehand stroke: an SVG path in a 0..100 viewBox, a colour and width. */
export interface HeaderDrawStroke {
  d: string;
  color: string;
  w: number;
}

export const BASE_ITEM_SIZE = 40;
export const MAX_ITEMS = 24;
export const EMPTY_SCENE: HeaderScene = { version: 1, items: [], background: null };

const keyFor = (userId: string) => `header_scene:${userId}`;

// ── Background gradients ──────────────────────────────────────────────────
export interface HeaderBackground { id: string; label: string; colors: string[] }
// Vertical, multi-stop palettes that read like LANDSCAPES (sky → horizon →
// ground), not flat diagonal fills. Rendered top→bottom.
export const HEADER_BACKGROUNDS: HeaderBackground[] = [
  { id: 'sunset', label: 'Закат', colors: ['#2A1A3D', '#7A4A86', '#FF7E79', '#FFC18A'] },
  { id: 'dawn', label: 'Рассвет', colors: ['#1B2A4A', '#8A5A8E', '#C96F8B', '#FFD3A5'] },
  { id: 'ocean', label: 'Океан', colors: ['#CDEFFF', '#7FC9EC', '#2E86C1', '#0B3A5B'] },
  { id: 'meadow', label: 'Луг', colors: ['#AEE3FF', '#CFF0B8', '#8FCB6A', '#3E7D33'] },
  { id: 'forest', label: 'Лес', colors: ['#BFE3F5', '#7FB069', '#3E7D33', '#15300F'] },
  { id: 'desert', label: 'Пустыня', colors: ['#FBE3B3', '#F4C56E', '#DC8A3C', '#8A4B20'] },
  { id: 'galaxy', label: 'Галактика', colors: ['#0A0420', '#241252', '#4B2A8A', '#B388FF'] },
  { id: 'aurora', label: 'Сияние', colors: ['#06121F', '#0E2A3A', '#1E6F62', '#5FE0B0'] },
  { id: 'sakura', label: 'Сакура', colors: ['#FFF0F5', '#FBC9DA', '#F49AB6', '#C75B86'] },
  { id: 'snow', label: 'Снег', colors: ['#EAF4FF', '#CFE6F7', '#9BBEDC', '#5E7FA0'] },
  { id: 'lavender', label: 'Лаванда', colors: ['#F3ECFB', '#CBB3EA', '#9B7FD0', '#5E3F94'] },
  { id: 'fire', label: 'Пламя', colors: ['#2B0A0A', '#7A1F1F', '#E04A1F', '#FFB347'] },
  { id: 'mint', label: 'Мята', colors: ['#EAFFF6', '#9CE7C9', '#39B58C', '#0E6B53'] },
  { id: 'night', label: 'Ночь', colors: ['#05070F', '#0B1E3D', '#16335E', '#2E5A8F'] },
];
const BG_SET = new Set(HEADER_BACKGROUNDS.map((b) => b.id));
export function backgroundColors(id: string | null | undefined): string[] | null {
  if (!id || !BG_SET.has(id)) return null;
  return HEADER_BACKGROUNDS.find((b) => b.id === id)!.colors;
}

// ── Drawn landscape scenes ────────────────────────────────────────────────
// Each background renders as a SIMPLE DRAWN LANDSCAPE — a sky, an optional
// sun/moon, and one or two layered silhouettes (mountains / hills / waves /
// stars) — instead of a flat colour gradient. It is rendered by
// <HeaderLandscape/> (SVG, viewBox-based) so the swatch, the editor preview
// and the live profile card all draw identically at any size.
export type LandscapeKind = 'mountains' | 'hills' | 'waves' | 'space';
export interface LandscapeScene {
  sky: [string, string]; // sky gradient: top → horizon
  layers: string[];       // silhouette colours, back → front
  kind: LandscapeKind;
  celestial: 'sun' | 'moon' | null;
  celestialColor: string;
}

// Silhouette shape per background id.
const LANDSCAPE_KIND: Record<string, LandscapeKind> = {
  sunset: 'mountains', dawn: 'mountains', ocean: 'waves', meadow: 'hills',
  forest: 'hills', desert: 'mountains', galaxy: 'space', aurora: 'space',
  sakura: 'hills', snow: 'mountains', lavender: 'hills', fire: 'mountains',
  mint: 'hills', night: 'space',
};
// Sun / moon (or none) per background id.
const CELESTIAL: Record<string, 'sun' | 'moon' | null> = {
  sunset: 'sun', dawn: 'sun', ocean: 'sun', meadow: 'sun', forest: null,
  desert: 'sun', galaxy: 'moon', aurora: 'moon', sakura: 'sun', snow: 'sun',
  lavender: 'moon', fire: 'sun', mint: 'sun', night: 'moon',
};
// Warm-vs-cool celestial body tint per background id.
const CELESTIAL_COLOR: Record<string, string> = {
  sunset: '#FFE3A0', dawn: '#FFE0B8', ocean: '#FFF4C8', meadow: '#FFF6CE',
  desert: '#FFEAB0', sakura: '#FFF0F5', snow: '#FFFBEF', fire: '#FFD27A',
  mint: '#F2FFF6', galaxy: '#DCE6FF', aurora: '#E6FFF4', lavender: '#F0EAFF',
  night: '#E6EEFF',
};

/** Full drawn-landscape descriptor for a background id (or null if unknown). */
export function backgroundScene(id: string | null | undefined): LandscapeScene | null {
  if (!id || !BG_SET.has(id)) return null;
  const c = HEADER_BACKGROUNDS.find((b) => b.id === id)!.colors;
  const celestial = id in CELESTIAL ? CELESTIAL[id] : 'sun';
  return {
    sky: [c[0], c[1]],
    layers: [c[2] ?? c[1], c[3] ?? c[2] ?? c[1]],
    kind: LANDSCAPE_KIND[id] ?? 'mountains',
    celestial,
    celestialColor: CELESTIAL_COLOR[id] ?? (celestial === 'moon' ? '#E6EEFF' : '#FFE8A3'),
  };
}

/**
 * Sanitize a freehand SVG path `d` into a SAFE string for react-native-svg's
 * native parser. Critically, it rebuilds the path from only FULLY-MATCHED
 * "M x y" / "L x y" commands, so a value that was truncated mid-number (e.g.
 * by a length cap) can never reach the native parser — a partial trailing
 * number there throws `characterAtIndex: out of bounds` and crashes the app.
 * Returns null when there's nothing valid to draw. Also length-bounds the
 * result by keeping whole commands only (never cutting inside a token).
 */
export function sanitizePathD(input: unknown, maxLen = 1400): string | null {
  if (typeof input !== 'string') return null;
  // Reject anything with characters outside the safe path alphabet.
  if (!/^[MLZmlz0-9.\-\s]*$/.test(input)) return null;
  // Extract only complete move/line commands with two finite coordinates.
  const cmds = input.match(/[ML]\s*-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?/gi);
  if (!cmds || cmds.length === 0) return null;
  // Normalize each command's internal spacing and keep whole commands until
  // the length budget is reached (so the result is always valid SVG).
  const out: string[] = [];
  let len = 0;
  for (const c of cmds) {
    const norm = c.replace(/\s+/g, ' ').trim();
    if (len + norm.length + 1 > maxLen) break;
    out.push(norm);
    len += norm.length + 1;
  }
  if (out.length === 0) return null;
  // A path must start with a moveto; if the budget dropped the leading M,
  // promote the first lineto to a moveto so it still renders.
  if (!/^M/i.test(out[0])) out[0] = out[0].replace(/^L/i, 'M');
  return out.join(' ');
}

/** Normalize any unknown/legacy value (object OR JSON string) into a safe scene. */
export function normalizeScene(raw: unknown): HeaderScene {
  let obj: any = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return EMPTY_SCENE;
    try { obj = JSON.parse(raw); } catch { return EMPTY_SCENE; }
  }
  if (!obj || typeof obj !== 'object') return EMPTY_SCENE;
  const items = Array.isArray(obj.items) ? obj.items : [];
  const clean: HeaderItem[] = [];
  const ANIMS = new Set(['none', 'float', 'pulse', 'spin', 'swing']);
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    if (typeof it.value !== 'string' || !it.value) continue;
    const x = Number(it.x); const y = Number(it.y);
    const scale = Number(it.scale); const rotation = Number(it.rotation);
    clean.push({
      id: typeof it.id === 'string' && it.id ? it.id : `i-${Math.random().toString(36).slice(2)}`,
      kind: 'emoji',
      value: String(it.value).slice(0, 8),
      x: isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5,
      y: isFinite(y) ? Math.min(1, Math.max(0, y)) : 0.5,
      scale: isFinite(scale) ? Math.min(4, Math.max(0.4, scale)) : 1,
      rotation: isFinite(rotation) ? ((rotation % 360) + 360) % 360 : 0,
      anim: typeof it.anim === 'string' && ANIMS.has(it.anim) ? (it.anim as any) : 'none',
    });
    if (clean.length >= MAX_ITEMS) break;
  }
  const background = typeof obj.background === 'string' && BG_SET.has(obj.background) ? obj.background : null;
  const bgBlend = obj.bgBlend === true;
  // Freehand drawing — bounded so the serialized scene stays under the 8 KB
  // server cap. Strokes capped, each path string length-capped.
  let drawing: HeaderDrawStroke[] | undefined;
  if (Array.isArray(obj.drawing)) {
    const strokes: HeaderDrawStroke[] = [];
    for (const s of obj.drawing) {
      if (!s || typeof s !== 'object') continue;
      const d = sanitizePathD(s.d);
      if (!d) continue; // drop malformed / truncated strokes (crash-safe)
      strokes.push({
        d,
        color: typeof s.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(s.color) ? s.color : '#FFFFFF',
        w: isFinite(Number(s.w)) ? Math.min(12, Math.max(0.5, Number(s.w))) : 2,
      });
      if (strokes.length >= 60) break;
    }
    if (strokes.length > 0) drawing = strokes;
  }
  return { version: 1, items: clean, background, bgBlend, drawing };
}

export function getLocalScene(userId: string | null | undefined): HeaderScene {
  if (!userId) return EMPTY_SCENE;
  try { return normalizeScene(kvGetJSONSync<HeaderScene>(keyFor(userId), EMPTY_SCENE as any)); }
  catch { return EMPTY_SCENE; }
}

export function setLocalScene(userId: string | null | undefined, scene: HeaderScene): void {
  if (!userId) return;
  try { kvSetJSON(keyFor(userId), normalizeScene(scene)); } catch {}
}

/** True when a scene has nothing to render (used to skip layers). */
export function isEmptyScene(s: HeaderScene | null | undefined): boolean {
  return !s || ((s.items?.length ?? 0) === 0 && !s.background && (s.drawing?.length ?? 0) === 0);
}

// ── Sticker library ─────────────────────────────────────────────────────────
// Tightly-themed groups; each glyph belongs to its category's topic.
export interface StickerGroup { key: string; label: string; items: string[] }

export const STICKER_LIBRARY: StickerGroup[] = [
  { key: 'space', label: 'Космос', items: ['🌙', '⭐', '🌟', '✨', '💫', '☄️', '🪐', '🌌', '🚀', '🛸', '👽', '🌠', '🔭', '🌕', '🌑', '🌗', '🌘', '🌖', '🪨', '🌞', '🌛', '🌜', '🌚', '🛰️'] },
  { key: 'nature', label: 'Природа', items: ['🌸', '🌷', '🌹', '🌻', '🌼', '🌺', '🌿', '🍃', '🍀', '🌱', '🌲', '🌳', '🌴', '🌵', '🍄', '🌊', '🏔️', '⛰️', '🌈', '🍁', '🍂', '🌾', '💐', '🪷'] },
  { key: 'cute', label: 'Милые', items: ['🐱', '🐶', '🦊', '🐼', '🐰', '🐻', '🐨', '🐸', '🦋', '🐝', '🐧', '🐙', '🦄', '🦔', '🐢', '🐹', '🐥', '🦉', '🦦', '🦝', '🐳', '🐬', '🦭', '🐞'] },
  { key: 'love', label: 'Любовь', items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '🩷', '🩵', '🤎', '🖤', '💖', '💗', '💕', '💞', '💘', '💝', '💟', '❣️', '😍', '🥰', '😘', '🫶', '💌'] },
  { key: 'badges', label: 'Значки', items: ['✅', '⭐', '🏆', '🥇', '🥈', '🥉', '👑', '💎', '🔰', '🎖️', '🏅', '💯', '✔️', '⚜️', '🛡️', '🎗️', '🔱', '⚡', '🚩', '🏵️', '📛', '🆒', '🆕', '🔥'] },
  { key: 'fun', label: 'Фан', items: ['😎', '🥳', '🤩', '😈', '👾', '🤖', '🎮', '🕹️', '🎲', '🎯', '🎸', '🎧', '🎤', '🎹', '🎺', '🪩', '🍿', '🎈', '🎉', '🎊', '💥', '💢', '🤙', '🤘'] },
];
