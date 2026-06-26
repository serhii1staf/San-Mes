// imageDiskCacheGuard — proactively cap expo-image's on-disk cache size.
//
// Why this exists
// ---------------
// expo-image with `cachePolicy="memory-disk"` keeps decoded images on disk and
// has NO built-in size cap. Over weeks of heavy image scrolling that on-disk
// cache grows unbounded until the device runs low on storage and the app starts
// crashing — at which point only a reinstall reclaims the space. We cap it
// proactively so that never happens.
//
// We REUSE the already-shipped, fully-guarded primitives in `imageCacheStore`
// (measure / clear / measurability check) — this module only adds the policy:
// "if the on-disk image cache is over the cap, clear it".
//
// Tradeoff behind the cap value
// ------------------------------
// Clearing the whole cache when over the cap is cheap for the USER: every image
// is served through our CDN image proxy (weserv) and re-downloads on demand the
// next time it scrolls into view. So a clear costs a one-time re-fetch per
// visible image, not data loss. That makes a conservative cap safe.
//
// Why clear-ALL instead of an LRU trim
// ------------------------------------
// expo-image exposes no partial / LRU disk-trim API on the SDK 54 native
// binary — only `clearDiskCache()` (all-or-nothing). So "clear everything once
// we exceed the cap" is the correct pragmatic approach: it bounds worst-case
// disk usage with the only lever the platform gives us. The cache simply
// re-warms from the CDN as the user keeps using the app.

import {
  measureImageCacheBytes,
  clearImageCache,
  isImageCacheMeasurable,
} from './imageCacheStore';

/**
 * Hard cap for expo-image's on-disk cache. 400 MB is conservative: large
 * enough that normal use never trips it (so we don't thrash the cache and pay
 * needless re-downloads), but small enough that it can never grow into the
 * storage-exhaustion / crash territory we're guarding against. Images
 * re-download cheaply via the CDN proxy on demand, so clearing when over this
 * cap is safe and low-cost.
 */
export const MAX_IMAGE_DISK_CACHE_BYTES = 400 * 1024 * 1024; // 400 MB

// Run at most once per app session. Even if the deferred idle block (or some
// future caller) invokes this again, we no-op after the first attempt — the
// cap only needs enforcing once per launch, and measuring the disk repeatedly
// would be wasted work.
let hasRunThisSession = false;

/**
 * Enforce the on-disk image-cache cap. Best-effort and fully guarded — a
 * failure here must NEVER throw to the caller (it runs on the startup idle
 * path; a crash here would be worse than an oversized cache).
 *
 * Behaviour:
 *   • Older binary where measurement isn't possible → no-op.
 *   • Cache size unmeasurable right now (null) → no-op.
 *   • Over the cap → clear the whole expo-image disk + memory cache.
 *   • At/under the cap → leave it alone.
 */
export async function enforceImageDiskCacheCap(): Promise<void> {
  if (hasRunThisSession) return;
  hasRunThisSession = true;

  try {
    // Older native binary that can't size the disk cache — nothing we can
    // safely do, so leave the cache untouched.
    if (!isImageCacheMeasurable()) return;

    // Pass [] — we only need the total, so rely on the known cache-dir names
    // rather than probing specific URLs.
    const bytes = await measureImageCacheBytes([]);

    // null = genuinely unmeasurable on this binary right now. Don't guess; a
    // blind clear could throw away a healthy cache for no reason.
    if (bytes === null) return;

    if (bytes > MAX_IMAGE_DISK_CACHE_BYTES) {
      await clearImageCache();
    }
  } catch {
    // Swallow everything — this is a best-effort maintenance task on the
    // startup idle path and must never surface an error to the caller.
  }
}
