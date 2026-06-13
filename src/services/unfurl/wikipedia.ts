// Wikipedia / Wikidata REST enrichment for the unfurl pipeline.
//
// When the user pastes a *.wikipedia.org or *.wikidata.org link, the regular
// `/api/unfurl` Open-Graph scraper produces a passable card — but the Wikimedia
// REST APIs ship clean structured data (lead paragraph, hero thumbnail,
// short description, label) that's higher-quality and free of API key
// requirements. We try the structured fetch first; if it fails we fall back
// to the existing scraper unchanged.
//
// Privacy: HTTPS-only endpoints, no API keys, no per-device auth, no headers
// that fingerprint the user. Wikimedia logs the request like any anonymous
// web fetch — same as the in-app browser would.

import { kvGetStringRawSync, kvSetStringRaw, isMMKVAvailable } from '../kvStore';
import type { LinkPreviewData } from '../linkPreview';

// 24h cache, mirroring the rest of the unfurl pipeline. Wiki content is more
// volatile than YouTube oembed but a day is the typical Wikimedia Foundation
// "varnish" cache TTL — we don't need to be more aggressive.
const WIKI_CACHE_PREFIX = '@san:wiki:'; // global, not per-account — wikipedia data is public
const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;

interface CacheEntry {
  t: number;
  d: LinkPreviewData | null;
}

interface WikiSummary {
  type?: string;
  title?: string;
  displaytitle?: string;
  description?: string;
  extract?: string;
  thumbnail?: { source?: string; width?: number; height?: number };
  originalimage?: { source?: string };
  content_urls?: { desktop?: { page?: string }; mobile?: { page?: string } };
}

interface WikidataEntity {
  labels?: Record<string, { value?: string }>;
  descriptions?: Record<string, { value?: string }>;
  claims?: Record<string, any>;
}

/**
 * Returns true when the URL points at a Wikipedia or Wikidata page we can
 * enrich. Used by linkPreview as a cheap pre-check before doing any work.
 */
export function isWikiUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (/(^|\.)wikipedia\.org$/.test(host)) return true;
    if (host === 'wikidata.org' || host === 'www.wikidata.org') return true;
    return false;
  } catch {
    return false;
  }
}

/** Extract the wiki title (URL-decoded) from a Wikipedia URL. */
function parseWikipediaTarget(url: string): { lang: string; title: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const m = host.match(/^([a-z\-]+)\.wikipedia\.org$/);
    if (!m) return null;
    const lang = m[1];
    // Path looks like /wiki/Some_Title or /wiki/Some_Title#section
    const pm = u.pathname.match(/^\/wiki\/([^#?]+)/);
    if (!pm) return null;
    let title = decodeURIComponent(pm[1]);
    // The REST summary API expects underscores rather than spaces, but it
    // also handles spaces — pass the title as-is from the URL (which is
    // already underscore-joined for spaces).
    title = title.trim();
    if (!title) return null;
    return { lang, title };
  } catch {
    return null;
  }
}

/** Extract the entity ID (Q123 / P456) from a wikidata.org URL. */
function parseWikidataTarget(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/wikidata\.org$/i.test(u.hostname)) return null;
    // /wiki/Q42 or /wiki/Property:P31
    const pm = u.pathname.match(/^\/wiki\/(?:Property:)?([QP]\d+)/i);
    if (pm) return pm[1].toUpperCase();
    // Special:EntityData/Q42
    const ed = u.pathname.match(/Special:EntityData\/([QP]\d+)/i);
    if (ed) return ed[1].toUpperCase();
    return null;
  } catch {
    return null;
  }
}

function readCache(url: string): CacheEntry | null {
  if (!isMMKVAvailable()) return null;
  try {
    const raw = kvGetStringRawSync(WIKI_CACHE_PREFIX + url);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

function writeCache(url: string, entry: CacheEntry): void {
  if (!isMMKVAvailable()) return;
  try {
    kvSetStringRaw(WIKI_CACHE_PREFIX + url, JSON.stringify(entry));
  } catch {
    // ignore — cache is best-effort
  }
}

function fresh(entry: CacheEntry | null): boolean {
  return !!entry && Date.now() - entry.t < TTL_MS;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        // No User-Agent header is set on RN's `fetch` — that's fine, the
        // Wikimedia REST endpoints accept anonymous requests. Adding a
        // bespoke UA would risk being treated as a bot for our IP range.
        Accept: 'application/json',
      },
    });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWikipedia(url: string): Promise<LinkPreviewData | null> {
  const target = parseWikipediaTarget(url);
  if (!target) return null;
  const apiUrl = `https://${target.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(target.title)}`;
  const json = await fetchJson<WikiSummary>(apiUrl);
  if (!json) return null;
  // The REST API returns a "disambiguation" or "no-extract" type for
  // ambiguous pages — render those too, but with the description as the
  // primary line since `extract` will be empty.
  const title = json.displaytitle || json.title;
  const description = json.extract || json.description;
  const image = json.originalimage?.source || json.thumbnail?.source;
  if (!title && !description && !image) return null;
  return {
    url,
    siteName: 'Wikipedia',
    title: title || undefined,
    description: description || undefined,
    image: image || undefined,
    favicon: 'https://en.wikipedia.org/static/favicon/wikipedia.ico',
    type: 'article',
    provider: null,
    videoId: null,
  };
}

async function fetchWikidata(url: string): Promise<LinkPreviewData | null> {
  const id = parseWikidataTarget(url);
  if (!id) return null;
  const apiUrl = `https://www.wikidata.org/wiki/Special:EntityData/${id}.json`;
  const json = await fetchJson<{ entities?: Record<string, WikidataEntity> }>(apiUrl);
  if (!json?.entities?.[id]) return null;
  const entity = json.entities[id];
  // Pick the locale the user likely wants. Try Russian and English first,
  // fall back to whatever label/description the entity has.
  const pickLocalized = (bag: Record<string, { value?: string }> | undefined) => {
    if (!bag) return undefined;
    return bag.ru?.value || bag.en?.value || Object.values(bag)[0]?.value;
  };
  const label = pickLocalized(entity.labels);
  const description = pickLocalized(entity.descriptions);
  if (!label && !description) return null;
  return {
    url,
    siteName: 'Wikidata',
    title: label || id,
    description: description || undefined,
    favicon: 'https://www.wikidata.org/static/favicon/wikidata.ico',
    type: 'article',
    provider: null,
    videoId: null,
  };
}

/**
 * Public entry — call from the unfurl pipeline before falling back to the
 * generic OG scraper. Returns a fully-populated preview when the URL points
 * at Wikipedia / Wikidata AND the REST fetch succeeds; null otherwise (the
 * caller is expected to fall through to the existing scraper).
 *
 * Caches both successes and explicit nulls for 24h to avoid hammering the
 * Wikimedia endpoints when the same link is rendered repeatedly across the
 * feed / chat list.
 */
export async function getWikiPreview(url: string): Promise<LinkPreviewData | null> {
  if (!isWikiUrl(url)) return null;

  const cached = readCache(url);
  if (fresh(cached)) return cached!.d;

  let data: LinkPreviewData | null = null;
  if (parseWikipediaTarget(url)) {
    data = await fetchWikipedia(url);
  } else if (parseWikidataTarget(url)) {
    data = await fetchWikidata(url);
  }

  // Cache the result either way — null is a valid "this URL has no enriched
  // data" signal, and we want to remember it so we don't refetch on every
  // render. The pipeline still falls through to the generic scraper above.
  writeCache(url, { t: Date.now(), d: data });
  return data;
}
