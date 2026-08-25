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

/**
 * Forget a GIF entirely — the other half of a delete.
 *
 * ── WHY DELETING A STICKER LOOKED LIKE IT "MOVED TO ANOTHER SLOT" ───────────
 *
 * Reported exactly that way, and it was literally true. A custom sticker lives in TWO lists once it
 * has been sent: `customGifsStore` (the user's imports) and this one (recently used). `pushRecentGif`
 * stores the WHOLE `GiphyItem`, `custom:` id and all, so the two copies are indistinguishable.
 *
 * The GIF grid concatenates them — own first, then recent, then trending, deduped by id. So deleting
 * removed the entry from `own`, at the FRONT of the grid, while the identical copy survived in
 * `recent`, immediately after it. The cell vanished from where it was and reappeared a few positions
 * later: one sticker, two homes, one of them cleaned.
 *
 * And it got worse on the second attempt. The surviving copy still carries the `custom:` prefix, which
 * is what the long-press menu tests to decide whether to offer Delete — so Delete appeared again and
 * filtered an id that was no longer in `customGifsStore` at all. A no-op. That is the "it just stays"
 * half of the report.
 *
 * There was no remover here at all; this list only ever grew. Returns the updated list so the caller
 * can push it into React state in one hop, mirroring `pushRecentGif`.
 */
export function removeRecentGif(id: string): GiphyItem[] {
  if (!id) return getRecentGif();
  const next = getRecentGif().filter((x) => x.id !== id);
  kvSetJSON(KEY, next);
  return next;
}
