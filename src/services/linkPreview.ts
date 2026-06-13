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
import { kvGetStringRawSync, kvSetStringRaw, isMMKVAvailable } from './kvStore';
import { getWikiPreview, isWikiUrl } from './unfurl/wikipedia';

const UNFURL_ENDPOINT = 'https://san-m-app.com/api/unfurl';
const CACHE_PREFIX = '@san:lp:'; // link-preview cache (global, not per-account — previews are public)
// Hard expiry: after this we force a re-fetch even if we have stale data.
// 30 days is plenty — link OG metadata almost never changes within that window.
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Soft expiry: data older than this is still rendered instantly to avoid the
// skeleton flicker, but a silent background refresh is kicked off so the
// updated content lands by the next view. This is the standard
// stale-while-revalidate pattern.
const SWR_MS = 24 * 60 * 60 * 1000; // 1 day
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
  // Synchronous MMKV mirror for instant cold-start reads.
  if (isMMKVAvailable()) {
    try { kvSetStringRaw(keyFor(url), JSON.stringify(entry)); } catch {}
  }
  try {
    await AsyncStorage.setItem(keyFor(url), JSON.stringify(entry));
  } catch {
    // ignore storage failures — preview is non-critical
  }
}

function fresh(entry: CacheEntry | null | undefined): boolean {
  return !!entry && Date.now() - entry.t < TTL_MS;
}

// Soft-fresh — entry is still good for instant render but a background
// refresh should be kicked off the next time the URL is requested.
function softFresh(entry: CacheEntry | null | undefined): boolean {
  return !!entry && Date.now() - entry.t < SWR_MS;
}

/**
 * Synchronous read from caches. Returns:
 *   - the data (or null for "no preview") when ANY usable entry exists
 *     (within hard TTL — stale entries within the SWR window count too,
 *     and `getLinkPreview` is still expected to be called so a background
 *     refresh runs).
 *   - undefined when nothing is cached yet (caller should fetch).
 * Reads the in-memory cache first, then the synchronous MMKV mirror — so even on
 * a COLD start a previously-seen preview renders instantly with zero flicker.
 *
 * The previous implementation only returned data within `softFresh` — anything
 * older than 1 day forced a full skeleton + network fetch. That was the
 * dominant cause of "preview reloads every time" on devices where the user
 * doesn't visit the same link daily. Now the only path that returns
 * `undefined` is a true cache miss; stale-but-usable entries are returned
 * synchronously and refreshed in the background.
 */
export function getCachedPreviewSync(url: string): LinkPreviewData | null | undefined {
  if (!url) return null;
  const mem = memCache.get(url);
  if (fresh(mem)) return mem!.d;
  // MMKV mirror (sync) — promotes into memCache for next time.
  if (isMMKVAvailable()) {
    try {
      const raw = kvGetStringRawSync(keyFor(url));
      if (raw) {
        const entry = JSON.parse(raw) as CacheEntry;
        if (fresh(entry)) {
          memCache.set(url, entry);
          return entry.d;
        }
      }
    } catch {}
  }
  return undefined;
}

/**
 * Get a link preview for a URL. Returns cached data instantly when available,
 * otherwise fetches once (dedupes concurrent calls) and caches the result.
 * Returns null when there is no usable preview.
 *
 * Stale-while-revalidate: when a cached entry exists but is older than
 * `SWR_MS`, the cached value is returned immediately AND a background fetch
 * is fired so the next view shows fresh data. This keeps every visit
 * flicker-free even when the cache is several days old.
 */
export async function getLinkPreview(url: string): Promise<LinkPreviewData | null> {
  if (!url) return null;

  // 1. Memory cache.
  const mem = memCache.get(url);
  if (mem && fresh(mem)) {
    // Soft-stale → kick off a silent background refresh, but return the
    // cached value right now so the caller renders without a skeleton.
    if (!softFresh(mem)) {
      void revalidate(url);
    }
    return mem.d;
  }

  // 2. Dedupe concurrent requests for the same URL.
  const existing = inflight.get(url);
  if (existing) return existing;

  const task = (async () => {
    // 3. Persisted cache (MMKV first for sync devices, then AsyncStorage).
    let persisted: CacheEntry | null = null;
    if (isMMKVAvailable()) {
      try {
        const raw = kvGetStringRawSync(keyFor(url));
        if (raw) persisted = JSON.parse(raw) as CacheEntry;
      } catch {}
    }
    if (!persisted) {
      persisted = await readPersisted(url);
    }
    if (fresh(persisted)) {
      memCache.set(url, persisted!);
      // Same SWR check on the persisted path.
      if (!softFresh(persisted!)) {
        void revalidate(url);
      }
      return persisted!.d;
    }

    // 4. Network fetch via our unfurl endpoint.
    const data = await fetchFresh(url);
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

// Background refresh — fired as a side-effect of a cached read when the entry
// is past the SWR window. Never blocks the caller; failures are silently
// swallowed because the caller already has a usable cached value.
async function revalidate(url: string): Promise<void> {
  if (inflight.has(url)) return;
  const task = (async () => {
    const data = await fetchFresh(url);
    const entry: CacheEntry = { t: Date.now(), d: data };
    memCache.set(url, entry);
    void writePersisted(url, entry);
    return data;
  })();
  inflight.set(url, task);
  try {
    await task;
  } catch {
    // ignore
  } finally {
    inflight.delete(url);
  }
}

async function fetchFresh(url: string): Promise<LinkPreviewData | null> {
  // Wikipedia / Wikidata: try the REST APIs first — they're free, structured,
  // and return a richer preview (lead paragraph, hero thumbnail) than the
  // generic OG scraper. On failure / non-wiki URL the helper returns null
  // and we fall through to the existing pipeline below.
  if (isWikiUrl(url)) {
    try {
      const wiki = await getWikiPreview(url);
      if (wiki) return wiki;
    } catch {
      // ignore — fall through to OG scraper
    }
  }

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
  return data;
}
