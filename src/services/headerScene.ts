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
export const HEADER_BACKGROUNDS: HeaderBackground[] = [
  { id: 'sunset', label: 'Закат', colors: ['#FFC18A', '#FF7E79', '#7A4A86'] },
  { id: 'ocean', label: 'Океан', colors: ['#CDEFFF', '#7FC9EC', '#1E6FA8'] },
  { id: 'forest', label: 'Лес', colors: ['#CFE9C7', '#7FB069', '#27531F'] },
  { id: 'galaxy', label: 'Галактика', colors: ['#0A0420', '#241252', '#4B2A8A'] },
  { id: 'sakura', label: 'Сакура', colors: ['#FFE9F0', '#FBC9DA', '#F49AB6'] },
  { id: 'aurora', label: 'Сияние', colors: ['#06121F', '#0E2A3A', '#123048'] },
  { id: 'lavender', label: 'Лаванда', colors: ['#ECE3F7', '#CBB3EA', '#9B7FD0'] },
  { id: 'fire', label: 'Пламя', colors: ['#2B0A0A', '#7A1F1F', '#FF6A3D'] },
  { id: 'mint', label: 'Мята', colors: ['#E6FFF4', '#9CE7C9', '#39B58C'] },
  { id: 'night', label: 'Ночь', colors: ['#0B1E3D', '#16335E', '#2E5A8F'] },
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
  { key: 'space', label: 'Космос', items: ['🌙', '⭐', '🌟', '✨', '💫', '☄️', '🪐', '🌌', '🚀', '🛸', '👽', '🌠', '🔭', '🌕', '🌑', '🪨'] },
  { key: 'nature', label: 'Природа', items: ['🌸', '🌷', '🌹', '🌻', '🌼', '🌿', '🍃', '🍀', '🌲', '🌴', '🌵', '🍄', '🌊', '🏔️', '🌈', '🍁'] },
  { key: 'cute', label: 'Милые', items: ['🐱', '🐶', '🦊', '🐼', '🐰', '🐻', '🐨', '🐸', '🦋', '🐝', '🐧', '🐙', '🦄', '🦔', '🐢', '🐹'] },
  { key: 'love', label: 'Любовь', items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '🩷', '💖', '💗', '💕', '💞', '💘', '💝', '😍', '🥰'] },
  { key: 'badges', label: 'Значки', items: ['✅', '⭐', '🏆', '🥇', '🥈', '🥉', '👑', '💎', '🔰', '🎖️', '🏅', '💯', '✔️', '⚜️', '🛡️', '🎗️'] },
  { key: 'fun', label: 'Фан', items: ['😎', '🥳', '🤩', '😈', '👾', '🤖', '🎮', '🕹️', '🎲', '🎯', '🎸', '🎧', '🔥', '⚡', '💥', '🎉'] },
];
