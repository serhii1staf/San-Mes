// NASA Astronomy Picture of the Day client.
//
// Endpoint: https://api.nasa.gov/planetary/apod
// Auth: api_key query parameter. We pull the project's `EXPO_PUBLIC_NASA_KEY`
// (see services/env.ts). When absent we fall back to `DEMO_KEY`, which works
// but is rate-limited to ~30 requests / hour / IP — fine for one-off testing,
// not for production.
//
// Cache strategy: NASA picks a new image once per day, so we cache by the
// UTC date string (YYYYMMDD). The first fetch of the day hits the network;
// subsequent reads (from any user on this device) serve the cached blob
// for free. Cache lives in MMKV — survives app restart but auto-fades when
// the user logs out (cacheService namespacing handles that).

import { kvGetJSONSync, kvSetJSON } from '../kvStore';
import { getNasaKey } from '../env';

const FETCH_TIMEOUT_MS = 8000;
const CACHE_PREFIX = '@san:nasa:apod:';

export interface ApodEntry {
  /** YYYY-MM-DD as returned by the API. */
  date: string;
  /** Free-form title, often poetic ("A Whirlpool of Stars"). */
  title: string;
  /** Long-form explanation, multi-paragraph, English. */
  explanation: string;
  /** The image URL — always JPEG/PNG. */
  url: string;
  /** High-res HD URL when available. */
  hdurl?: string;
  /** "image" | "video" — videos use a YouTube-style embed URL we can't show inline. */
  mediaType: 'image' | 'video';
  /** Author / credit line. May be empty. */
  copyright?: string;
}

interface RawApodResponse {
  date?: string;
  title?: string;
  explanation?: string;
  url?: string;
  hdurl?: string;
  media_type?: string;
  copyright?: string;
}

function cacheKey(date: string): string {
  return `${CACHE_PREFIX}${date.replace(/-/g, '')}`;
}

function todayUtc(): string {
  // YYYY-MM-DD in UTC, matching what the NASA API returns.
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fetch APOD for the given date (or today if omitted). Returns a cached
 * value first when present, regardless of TTL — APOD is immutable once
 * published, so a cache hit is always safe to serve.
 *
 * Returns null on any failure (network, parse, video). The UI shows an
 * inline "couldn't load" state in that case.
 */
export async function fetchApod(date?: string): Promise<ApodEntry | null> {
  const target = date || todayUtc();
  // 1) Cache lookup — APOD is publication-stable, so any cached entry for
  //    this date is good forever.
  const cached = kvGetJSONSync<ApodEntry | null>(cacheKey(target), null);
  if (cached) return cached;

  // 2) Network fetch with timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(
      getNasaKey(),
    )}&date=${encodeURIComponent(target)}`;
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
    const json = (await resp.json()) as RawApodResponse;
    if (!json?.url || !json?.title) return null;
    const entry: ApodEntry = {
      date: json.date || target,
      title: json.title,
      explanation: json.explanation || '',
      url: json.url,
      hdurl: json.hdurl || undefined,
      mediaType: json.media_type === 'video' ? 'video' : 'image',
      copyright: json.copyright?.trim() || undefined,
    };
    // 3) Stash for future loads. Best-effort — failure here doesn't matter.
    try {
      kvSetJSON(cacheKey(target), entry);
    } catch {}
    return entry;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Drop the cached APOD entry for a date (or today). Used by the screen's
 * pull-to-refresh action so the user can force a re-fetch.
 */
export function clearApodCache(date?: string): void {
  const target = date || todayUtc();
  try {
    kvSetJSON(cacheKey(target), null);
  } catch {}
}
