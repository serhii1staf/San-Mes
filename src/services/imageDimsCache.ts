// imageDimsCache
// --------------
// Remembers the natural pixel dimensions (width/height) of chat photos, keyed
// by their image URL, so a single-image bubble can mount at the CORRECT
// aspect-ratio box immediately instead of starting as a neutral square and
// then JUMPING to the real shape once expo-image reports `onLoad`.
//
// Why this exists: `SingleChatImage` initialises at 220×220 and only snaps to
// the photo's real size after the decode completes. Every time the chat
// re-opens (or a row recycles) the bubble re-mounts at the square, shows the
// loading spinner, then resizes — which reads to the user as the photo
// "reloading and changing size every time I open the chat". expo-image already
// keeps the decoded bitmap on disk, so the BYTES are instant on reopen; the
// only thing that was still janking was the LAYOUT not knowing the size up
// front. Caching the dimensions removes that last jump.
//
// Backed by the same MMKV/AsyncStorage KV the rest of the app uses, so the
// remembered sizes survive an app restart (the first-ever view of a photo
// still snaps once — unavoidable, we don't know the size until it loads — but
// every subsequent open is jump-free). An in-memory mirror makes reads
// synchronous and free on the render path; writes are debounced + bounded so
// the cache can never grow without limit or block a frame.

import { kvGetJSONSync, kvSetJSON } from './kvStore';

export type ImageDim = { w: number; h: number };

const KEY = 'chat_img_dims';
const MAX_ENTRIES = 600; // bound the persisted blob; trim oldest on overflow
const TRIM_TO = 480;
const FLUSH_DELAY_MS = 1000;

let mem: Record<string, ImageDim> | null = null;
let dirty = false;
let flushScheduled = false;

function load(): Record<string, ImageDim> {
  if (mem) return mem;
  try {
    mem = kvGetJSONSync<Record<string, ImageDim>>(KEY, {}) || {};
  } catch {
    mem = {};
  }
  return mem;
}

/** Read remembered natural dimensions for an image URL, or undefined. */
export function getImageDims(uri: string | undefined | null): ImageDim | undefined {
  if (!uri) return undefined;
  return load()[uri];
}

/** Remember an image's natural dimensions. No-op for invalid/zero sizes. */
export function setImageDims(uri: string | undefined | null, w: number, h: number): void {
  if (!uri || !w || !h || w <= 0 || h <= 0) return;
  const m = load();
  const prev = m[uri];
  if (prev && prev.w === w && prev.h === h) return;
  m[uri] = { w, h };
  dirty = true;
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    if (!dirty || !mem) return;
    dirty = false;
    const keys = Object.keys(mem);
    if (keys.length > MAX_ENTRIES) {
      // Keep the most-recently-inserted entries (object key order is insertion
      // order for string keys). Cheap, bounded, and good enough — a dropped
      // entry just means that one photo snaps once again on its next view.
      const trimmed: Record<string, ImageDim> = {};
      for (const k of keys.slice(keys.length - TRIM_TO)) trimmed[k] = mem[k];
      mem = trimmed;
    }
    try { kvSetJSON(KEY, mem); } catch {}
  }, FLUSH_DELAY_MS);
}
