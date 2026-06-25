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

export interface HeaderItem {
  id: string;
  kind: HeaderItemKind;
  value: string; // emoji / sticker glyph
  x: number;     // 0..1 center X
  y: number;     // 0..1 center Y
  scale: number; // size multiplier (1 = BASE_ITEM_SIZE px)
  rotation: number; // degrees
}

export interface HeaderScene {
  version: 1;
  items: HeaderItem[];
  /** Named background gradient id (see HEADER_BACKGROUNDS), or null = none. */
  background?: string | null;
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
    });
    if (clean.length >= MAX_ITEMS) break;
  }
  const background = typeof obj.background === 'string' && BG_SET.has(obj.background) ? obj.background : null;
  return { version: 1, items: clean, background };
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
  return !s || ((s.items?.length ?? 0) === 0 && !s.background);
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
