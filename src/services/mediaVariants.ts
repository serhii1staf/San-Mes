/**
 * Which DERIVATIVES of a media asset are already decoded on this device.
 *
 * ── THE ONE CAUSE BEHIND "FULLSCREEN RELOADS THE GIF" ───────────────────────
 *
 * `CachedImage` hands expo-image `source={{ uri: finalUri }}`, and `finalUri` is the asset routed
 * through the weserv proxy at the width the caller asked for:
 *
 *     finalUri = proxiedImageUrl(uri, proxyWidth ?? style.width)   // → ...&w=<width × 2>...
 *
 * expo-image keys its memory and disk cache on that string. So the WIDTH IS PART OF THE CACHE KEY, and
 * two surfaces showing the same asset at different sizes are, as far as the cache is concerned, showing
 * two unrelated images.
 *
 * That is not a bug in any one screen — it is what the design implies, and it explains the whole class
 * of reports at once. Measured, not assumed:
 *
 *     comment GIF inline      style width 160, no proxyWidth   → w=320
 *     comments fullscreen     proxyWidth = SCREEN_WIDTH (390)  → w=780
 *
 * Tapping the GIF therefore starts a cold network fetch for an asset the user is looking at. The chat
 * happens to be correct only because its bubble and its viewer both pass `CHAT_IMG_MAX_W`, which is
 * exactly why chat felt instant and comments did not.
 *
 * ── WHY NOT SIMPLY MAKE THE WIDTHS MATCH ────────────────────────────────────
 *
 * Because then fullscreen would display a 320 px derivative stretched across the display. The viewer is
 * right to want more resolution than a 160 pt thumbnail; the mistake is making the user WAIT for it.
 *
 * So the fix is progressive, which is also what Telegram does: paint the derivative that is already
 * decoded immediately, and let the high-resolution one replace it when it arrives. The transition is
 * invisible for a GIF (same frames, more pixels) and the perceived open time drops to a single frame.
 *
 * ── WHY THIS REGISTRY EXISTS ────────────────────────────────────────────────
 *
 * To paint the already-decoded derivative, a viewer has to know WHICH one exists — i.e. the width some
 * other surface happened to request. Nothing knew that; each call site chose a width locally and told
 * no one.
 *
 * Every surface in the app already renders media through `CachedImage`, so recording completed loads in
 * one place there makes this automatic and total: chat, comments, profile, the GIF grid, the sticker
 * picker, the long-press preview and the fullscreen viewer all contribute and all benefit, with no
 * per-screen wiring and no screen that can be forgotten later.
 */

import { proxiedImageUrl } from '../components/ui/CachedImage';

/**
 * Bounded so a long session cannot grow this without limit. Keys are raw asset URLs and values are tiny
 * numeric sets, so the real memory here is the strings; a few hundred is far more than the handful of
 * assets a user can have on screen and in recent history at once.
 */
const MAX_TRACKED = 400;

/**
 * rawUri → widths (the `displayWidth` argument, NOT the doubled proxy width) whose load has COMPLETED.
 *
 * A `Map` rather than an object because insertion order gives eviction for free: the oldest key is the
 * first one the iterator yields.
 *
 * `0` is used for a load that bypassed the proxy entirely (`noProxy`), since that variant is addressed
 * by the raw URL and has no width in its key.
 */
const loaded = new Map<string, Set<number>>();

/** Record that `rawUri` finished loading at `width`. Called from `CachedImage`'s load handler. */
export function noteVariantLoaded(rawUri: string, width: number): void {
  if (!rawUri) return;
  let set = loaded.get(rawUri);
  if (!set) {
    // Re-inserting on every load would keep a hot asset permanently young but would also mean deleting
    // and re-adding on every frame of a scroll. Only NEW keys touch ordering, which is enough for
    // eviction to approximate least-recently-first-seen at no per-load cost.
    if (loaded.size >= MAX_TRACKED) {
      const oldest = loaded.keys().next();
      if (!oldest.done) loaded.delete(oldest.value);
    }
    set = new Set<number>();
    loaded.set(rawUri, set);
  }
  set.add(width);
}

/**
 * The URL of the best already-decoded derivative of `rawUri`, or `null` if none is known.
 *
 * "Best" is the LARGEST recorded width that is not larger than `desiredWidth` — the closest thing to
 * what the caller actually wants without upscaling something tiny more than necessary. If every
 * recorded variant is larger than desired (a thumbnail opening after fullscreen, say) the smallest of
 * those is returned instead, because any decoded variant beats a blank frame.
 *
 * A `noProxy` load (`0`) wins outright: it is the original asset at full resolution, so nothing else
 * can be better.
 */
export function bestLoadedVariantUrl(rawUri: string, desiredWidth: number): string | null {
  if (!rawUri) return null;
  const set = loaded.get(rawUri);
  if (!set || set.size === 0) return null;
  if (set.has(0)) return rawUri;

  let bestAtOrBelow = -1;
  let smallestAbove = Number.MAX_SAFE_INTEGER;
  for (const w of set) {
    if (w <= desiredWidth) {
      if (w > bestAtOrBelow) bestAtOrBelow = w;
    } else if (w < smallestAbove) {
      smallestAbove = w;
    }
  }

  const pick = bestAtOrBelow > 0 ? bestAtOrBelow : smallestAbove !== Number.MAX_SAFE_INTEGER ? smallestAbove : -1;
  if (pick < 0) return null;
  // Exactly what the caller is about to request anyway — handing it back as a placeholder would be a
  // pointless extra source on the same URL.
  if (pick === desiredWidth) return null;
  return proxiedImageUrl(rawUri, pick);
}

/** Test seam. Not used by the app. */
export function _resetVariantRegistry(): void {
  loaded.clear();
}
