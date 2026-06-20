// recentGif — most-recently-used GIFs, persisted per account in MMKV (kvStore
// applies the account namespace). Shown first in the GIF tab so the GIFs a user
// sends often are instantly reusable — the GIF twin of recentEmoji.

import { kvGetJSONSync, kvSetJSON } from './kvStore';
import { GiphyItem } from './giphy';

const KEY = 'recent_gif';
const MAX = 24;

/** Read the MRU GIF list (most-recent first). Always returns an array. */
export function getRecentGif(): GiphyItem[] {
  try {
    const a = kvGetJSONSync<GiphyItem[]>(KEY, []);
    return Array.isArray(a) ? a.filter((x) => x && typeof (x as any).id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Record a just-sent GIF: move it to the front, dedupe by id, cap at MAX.
 * Returns the updated list so the caller can update React state in one hop.
 */
export function pushRecentGif(item: GiphyItem): GiphyItem[] {
  if (!item || !item.id) return getRecentGif();
  const cur = getRecentGif();
  const next = [item, ...cur.filter((x) => x.id !== item.id)].slice(0, MAX);
  kvSetJSON(KEY, next);
  return next;
}
