// imageCacheStore — measure + clear the on-disk image cache (expo-image).
//
// Why this exists
// ---------------
// The Storage screen historically summed ONLY the MMKV/AsyncStorage JSON
// (feed, profiles, chats…) — a few hundred KB. The bytes that actually grow
// to Telegram-like sizes are the DECODED IMAGES expo-image keeps on disk
// (`cachePolicy="memory-disk"`), and expo-image does not expose a single
// "total disk cache size" API. So the screen reported ~160 KB and users
// concluded caching was broken, when in reality the images were cached but
// simply never counted.
//
// This module measures that on-disk image cache and exposes a clear action,
// using only APIs that are part of the SDK 54 native binary:
//   • expo-image:        Image.getCachePathAsync(cacheKey)  → locate the dir
//                        Image.clearDiskCache()             → clear it
//                        Image.clearMemoryCache()
//   • expo-file-system:  Paths.cache (cache root Directory)
//                        new Directory(uri).size            → recursive bytes
//                        new Directory(uri).exists
//
// EVERYTHING that touches a native module is behind a guarded lazy require so
// that an OTA delivered to an OLDER native binary (one that predates a given
// API) degrades to "unavailable" instead of crashing. When measurement is
// unavailable we return `null`, and the UI hides the Images/Media category
// rather than showing a wrong number.

import { proxiedImageUrl } from '../components/ui/CachedImage';

// ─── Guarded module access ───────────────────────────────────────────────

// expo-image is already a hard dependency used across the app, but we still
// guard the require so a stripped/older binary can't crash the storage screen.
function getExpoImage(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-image');
    return mod?.Image ?? null;
  } catch {
    return null;
  }
}

// expo-file-system ships inside expo core on SDK 54, but the module may be
// absent on an older native binary an OTA lands on. The require + every
// property access below is therefore fully guarded.
function getFileSystem(): { Paths: any; Directory: any } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-file-system');
    if (mod?.Directory && mod?.Paths) return { Paths: mod.Paths, Directory: mod.Directory };
    return null;
  } catch {
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Strip the trailing path segment from a `file://…/dir/file` URI → `file://…/dir`. */
function parentDir(uri: string): string | null {
  if (!uri) return null;
  const normalized = uri.startsWith('file://') || uri.startsWith('/') ? uri : `file://${uri}`;
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return null;
  return normalized.slice(0, idx);
}

/** Join a base directory URI and a child name with a single slash. */
function joinUri(base: string, child: string): string {
  return base.endsWith('/') ? `${base}${child}` : `${base}/${child}`;
}

/**
 * Reduce a set of directory URIs to "roots" — drop any directory that is a
 * descendant of another in the set, so summing them never double-counts the
 * same bytes (e.g. `…/SDImageCache` already includes `…/SDImageCache/default`).
 */
function dedupeRoots(uris: string[]): string[] {
  const unique = Array.from(new Set(uris.filter(Boolean)));
  return unique.filter((candidate) => {
    return !unique.some((other) => {
      if (other === candidate) return false;
      const otherPrefix = other.endsWith('/') ? other : `${other}/`;
      return candidate.startsWith(otherPrefix);
    });
  });
}

// Known on-disk image-cache directory names used by expo-image's native
// backends, relative to the app cache directory:
//   • iOS  → SDWebImage  → `com.hackemist.SDImageCache`
//   • Android → Glide    → `image_manager_disk_cache`
// The extras are defensive in case a future expo-image bumps its backend.
const KNOWN_CACHE_DIR_NAMES = [
  'com.hackemist.SDImageCache',
  'image_manager_disk_cache',
  'imageCache',
  'ExpoImageCache',
];

/**
 * Discover candidate image-cache directories. Combines:
 *   1. Dynamic discovery — ask expo-image where a known-cached image lives via
 *      getCachePathAsync, then take that file's parent directory.
 *   2. Known directory names under the app cache root.
 * Returns deduped roots so the caller never double-counts nested dirs.
 */
async function discoverCacheDirs(candidateRawUris: string[]): Promise<string[]> {
  const dirs: string[] = [];

  // Strategy 1 — dynamic discovery via expo-image. Best-effort: a cache key
  // only resolves to a path if that exact image is currently on disk, so we
  // probe a handful of likely-cached URLs at the widths the app actually
  // requests (feed/profile heroes are warmed at the default proxy width).
  const Image = getExpoImage();
  if (Image?.getCachePathAsync) {
    const probes: string[] = [];
    for (const raw of candidateRawUris.slice(0, 8)) {
      if (!raw) continue;
      // Match the cache keys the app produces: the proxied form at the
      // default feed/profile width, plus the raw URL as a fallback.
      try { probes.push(proxiedImageUrl(raw, 600)); } catch {}
      probes.push(raw);
    }
    for (const key of probes) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const path = await Image.getCachePathAsync(key);
        if (path) {
          const dir = parentDir(path);
          if (dir) dirs.push(dir);
        }
      } catch {
        // ignore — this key simply isn't on disk
      }
    }
  }

  // Strategy 2 — known directory names under the cache root.
  const fs = getFileSystem();
  if (fs) {
    try {
      const cacheRootUri: string | undefined = fs.Paths?.cache?.uri;
      if (cacheRootUri) {
        for (const name of KNOWN_CACHE_DIR_NAMES) {
          dirs.push(joinUri(cacheRootUri, name));
        }
      }
    } catch {
      // Paths.cache threw — older/odd binary; rely on Strategy 1 results.
    }
  }

  return dedupeRoots(dirs);
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Measure the on-disk image cache in bytes.
 *
 * @param candidateRawUris A few raw (un-proxied) image URLs the app is likely
 *   to have cached (e.g. feed hero / profile banner URLs). Used only to
 *   dynamically discover the cache directory; pass `[]` to rely on the known
 *   directory names alone.
 * @returns total bytes, or `null` when the measurement is genuinely
 *   unavailable (expo-file-system missing on this binary, or no cache
 *   directory could be located). `0` is a valid result (cache empty).
 */
export async function measureImageCacheBytes(candidateRawUris: string[] = []): Promise<number | null> {
  const fs = getFileSystem();
  // Without expo-file-system we cannot size anything on disk. Be honest:
  // return null so the UI hides the category instead of showing 0.
  if (!fs) return null;

  let dirs: string[];
  try {
    dirs = await discoverCacheDirs(candidateRawUris);
  } catch {
    return null;
  }
  if (dirs.length === 0) return null;

  let total = 0;
  let measuredAny = false;
  for (const uri of dirs) {
    try {
      const dir = new fs.Directory(uri);
      // `exists` and `size` are guarded property accesses — a binary lacking
      // the native impl throws here and we skip this directory.
      if (dir?.exists) {
        const size = dir.size; // recursive bytes, or null if unreadable
        if (typeof size === 'number' && size >= 0) {
          total += size;
          measuredAny = true;
        }
      } else if (dir) {
        // Directory simply doesn't exist on this platform — that's a valid
        // "measured, contributes 0" outcome, not a failure.
        measuredAny = true;
      }
    } catch {
      // This directory couldn't be read; try the others.
    }
  }

  return measuredAny ? total : null;
}

/**
 * Clear expo-image's on-disk (and in-memory) cache. Fully guarded; resolves
 * to `true` only when the disk cache was actually cleared.
 */
export async function clearImageCache(): Promise<boolean> {
  const Image = getExpoImage();
  if (!Image) return false;
  let cleared = false;
  try {
    if (Image.clearDiskCache) {
      cleared = (await Image.clearDiskCache()) === true;
    }
  } catch {
    cleared = false;
  }
  // Best-effort memory clear too so the in-RAM bitmaps don't immediately
  // re-populate the on-disk cache estimate. Failure here is non-fatal.
  try {
    await Image.clearMemoryCache?.();
  } catch {
    // ignore
  }
  return cleared;
}

/** Whether on-disk image-cache measurement is possible on this binary. */
export function isImageCacheMeasurable(): boolean {
  return getFileSystem() !== null;
}
