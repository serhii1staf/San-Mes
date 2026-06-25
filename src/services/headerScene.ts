// headerScene
// -----------
// "Build-your-own" profile header decorations. A HeaderScene is a small list
// of freely-placed items (emoji / sticker glyphs) the user arranges on top of
// the frosted header card. It is stored:
//   • LOCALLY (per-account MMKV) keyed by user id, so the owner sees their
//     scene instantly and offline; and
//   • on the PROFILE ROW (best-effort, via updateProfile → PATCH /v1/profiles/me
//     `header_scene`) so OTHER users fetch and render it through getProfile.
//
// Coordinates are NORMALIZED (0..1) relative to the header card box, so a scene
// renders identically across device widths. `scale` is relative to a base glyph
// size; `rotation` is in degrees.

import { kvGetJSONSync, kvSetJSON } from './kvStore';

export type HeaderItemKind = 'emoji';

export interface HeaderItem {
  id: string;
  kind: HeaderItemKind;
  value: string; // the emoji / sticker glyph
  x: number;     // 0..1 (left → right) center position within the card
  y: number;     // 0..1 (top → bottom) center position within the card
  scale: number; // size multiplier (1 = BASE_ITEM_SIZE px)
  rotation: number; // degrees
}

export interface HeaderScene {
  version: 1;
  items: HeaderItem[];
}

/** Base glyph size (px) at scale = 1. */
export const BASE_ITEM_SIZE = 40;
/** Hard cap on items so a scene can never bloat the profile row / a frame. */
export const MAX_ITEMS = 24;

export const EMPTY_SCENE: HeaderScene = { version: 1, items: [] };

const keyFor = (userId: string) => `header_scene:${userId}`;

/** Normalize any unknown/legacy value into a safe, renderable HeaderScene. */
export function normalizeScene(raw: unknown): HeaderScene {
  if (!raw || typeof raw !== 'object') return EMPTY_SCENE;
  const anyRaw = raw as any;
  const items = Array.isArray(anyRaw.items) ? anyRaw.items : [];
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
  return { version: 1, items: clean };
}

/** Read the locally-cached scene for a user (synchronous, cheap). */
export function getLocalScene(userId: string | null | undefined): HeaderScene {
  if (!userId) return EMPTY_SCENE;
  try {
    return normalizeScene(kvGetJSONSync<HeaderScene>(keyFor(userId), EMPTY_SCENE as any));
  } catch {
    return EMPTY_SCENE;
  }
}

/** Persist the scene locally (per-account). */
export function setLocalScene(userId: string | null | undefined, scene: HeaderScene): void {
  if (!userId) return;
  try { kvSetJSON(keyFor(userId), normalizeScene(scene)); } catch {}
}

// ── Sticker library ─────────────────────────────────────────────────────────
// Curated, grouped glyphs the user drags onto the card. Kept as plain emoji so
// it renders everywhere with zero assets; richer sticker packs (pixel icons,
// animated) can be layered on later behind the same HeaderItem model.
export interface StickerGroup { key: string; label: string; items: string[] }

export const STICKER_LIBRARY: StickerGroup[] = [
  { key: 'space', label: 'Космос', items: ['🌙', '⭐', '🌟', '✨', '💫', '🪐', '🚀', '🌌', '☄️', '🛸', '👽', '🌠'] },
  { key: 'nature', label: 'Природа', items: ['🌸', '🌷', '🌹', '🌻', '🌿', '🍃', '🌲', '🌴', '🍀', '🌊', '🔥', '🌈', '☀️', '⛅', '❄️', '🍄'] },
  { key: 'cute', label: 'Милое', items: ['🐱', '🐶', '🦊', '🐼', '🐰', '🐻', '🦋', '🐝', '🐙', '🦄', '🐧', '🐢', '🦔', '🐸'] },
  { key: 'love', label: 'Любовь', items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '🩷', '💖', '💗', '💕', '💞', '💘', '💝'] },
  { key: 'fun', label: 'Фан', items: ['😎', '🥳', '🤩', '😈', '👾', '🤖', '🎮', '🕹️', '🎲', '🎯', '🎸', '🎧', '👑', '💎', '⚡', '💥'] },
  { key: 'signs', label: 'Знаки', items: ['✅', '❌', '❗', '❓', '💯', '♾️', '☯️', '☮️', '🔮', '🧿', '🪬', '🏆', '🥇', '🎀'] },
];
