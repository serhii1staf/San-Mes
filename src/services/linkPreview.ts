// Link preview (unfurl) service for the app.
//
// Fetches Open Graph metadata for a URL from our own /api/unfurl endpoint and
// caches the (tiny) JSON result so previews appear instantly and never re-hit
// the network for the same link. Two cache layers:
//   1. In-memory Map (instant within a session).
//   2. AsyncStorage (persists across launches), namespaced + TTL'd.
//
// The actual page scraping happens server-side on Vercel's edge (cached on the
// CDN), so the app stays light and the database is never involved.

import AsyncStorage from '@react-native-async-storage/async-storage';

const UNFURL_ENDPOINT = 'https://san-m-app.com/api/unfurl';
const CACHE_PREFIX = '@san:lp:'; // link-preview cache (global, not per-account — previews are public)
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FETCH_TIMEOUT_MS = 6000;

export interface LinkPreviewData {
  url: string;
  siteName?: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  type?: string;
  provider?: 'youtube' | 'vimeo' | null;
  videoId?: string | null;
}

interface CacheEntry {
  t: number; // timestamp
  d: LinkPreviewData | null; // null = known "no preview"
}

const memCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<LinkPreviewData | null>>();

/** Extract the first http(s) URL from a string of text, if any. */
export function extractFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s<>"')]+/i);
  return m ? m[0] : null;
}

function keyFor(url: string): string {
  return CACHE_PREFIX + url;
}

async function readPersisted(url: string): Promise<CacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(url));
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

async function writePersisted(url: string, entry: CacheEntry): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(url), JSON.stringify(entry));
  } catch {
    // ignore storage failures — preview is non-critical
  }
}

function fresh(entry: CacheEntry | null | undefined): boolean {
  return !!entry && Date.now() - entry.t < TTL_MS;
}

/**
 * Synchronous read from the in-memory cache only. Returns:
 *   - the data (or null for "no preview") when a fresh entry exists,
 *   - undefined when nothing is cached yet (caller should fetch).
 * Lets components render cached previews instantly with no loading flicker.
 */
export function getCachedPreviewSync(url: string): LinkPreviewData | null | undefined {
  if (!url) return null;
  const mem = memCache.get(url);
  if (fresh(mem)) return mem!.d;
  return undefined;
}

/**
 * Get a link preview for a URL. Returns cached data instantly when available,
 * otherwise fetches once (dedupes concurrent calls) and caches the result.
 * Returns null when there is no usable preview.
 */
export async function getLinkPreview(url: string): Promise<LinkPreviewData | null> {
  if (!url) return null;

  // 1. Memory cache.
  const mem = memCache.get(url);
  if (fresh(mem)) return mem!.d;

  // 2. Dedupe concurrent requests for the same URL.
  const existing = inflight.get(url);
  if (existing) return existing;

  const task = (async () => {
    // 3. Persisted cache.
    const persisted = await readPersisted(url);
    if (fresh(persisted)) {
      memCache.set(url, persisted!);
      return persisted!.d;
    }

    // 4. Network fetch via our unfurl endpoint.
    let data: LinkPreviewData | null = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const resp = await fetch(`${UNFURL_ENDPOINT}?url=${encodeURIComponent(url)}`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (resp.ok) {
        const json = (await resp.json()) as LinkPreviewData;
        // Only treat as a usable preview if it has at least a title or image.
        if (json && (json.title || json.image || json.description)) {
          data = json;
        }
      }
    } catch {
      data = null;
    }

    const entry: CacheEntry = { t: Date.now(), d: data };
    memCache.set(url, entry);
    void writePersisted(url, entry);
    return data;
  })();

  inflight.set(url, task);
  try {
    return await task;
  } finally {
    inflight.delete(url);
  }
}
