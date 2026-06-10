// Music search + streaming via the Audius API + iTunes Search.
//
// Strategy: Audius is the FIRST source because it serves FULL-LENGTH tracks
// (legally, no API key, free). But its catalog is mostly indie/electronic, so
// it misses mainstream releases. iTunes Search fills that gap with 30-second
// previews so popular songs (Harry Styles, Linda, etc.) are findable. Previews
// are tagged with `isPreview: true` so the UI can show a "30 с" badge and the
// ranker can prefer full-length when both exist for the same (title, artist).
//
// Recall:
//   - Audius is queried in parallel across discovery hosts (faster than serial
//     and tolerates slow nodes).
//   - Cyrillic queries are also transliterated to Latin and re-queried so a
//     search like "Линда" still finds "Linda".
//   - iTunes is hit ONLY if Audius returned too few hits — saves bandwidth.
//
// Caching: identical queries within 1 hour are served from a per-query MMKV
// cache so re-typing a song name doesn't re-hit the network.

import { kvGetJSONSync, kvSetJSON } from './kvStore';

const APP_NAME = 'San-Mes';

const HOSTS = [
  'https://api.audius.co',
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co',
  'https://audius-discovery-1.cultur3stake.com',
  'https://blockdaemon-audius-discovery-1.bdnodes.net',
];

const SEARCH_CACHE_PREFIX = 'music_search:';
const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface Track {
  id: string;
  title: string;
  artist: string;
  artwork: string;
  streamUrl: string;
  durationMs: number;
  sourceHost: string;
  // True for iTunes 30-second previews; false for Audius full-length.
  isPreview: boolean;
}

function mapTrack(t: any, host: string): Track | null {
  if (!t?.id || !t?.title) return null;
  const aw = t.artwork || {};
  const art = aw['480x480'] || aw['150x150'] || aw['1000x1000'] || '';
  return {
    id: String(t.id),
    title: t.title,
    artist: t.user?.name || t.user?.handle || '',
    artwork: art,
    streamUrl: `${host}/v1/tracks/${t.id}/stream?app_name=${APP_NAME}`,
    durationMs: (Number(t.duration) || 0) * 1000,
    sourceHost: host,
    isPreview: false,
  };
}

function mapItunesTrack(t: any): Track | null {
  if (!t?.trackId || !t?.previewUrl || !t?.trackName) return null;
  const art: string = (t.artworkUrl100 || t.artworkUrl60 || '').replace(/100x100bb\.jpg$/, '600x600bb.jpg');
  let previewHost = 'itunes.apple.com';
  try { previewHost = new URL(t.previewUrl).hostname; } catch {}
  return {
    id: `itunes-${t.trackId}`,
    title: t.trackName,
    artist: t.artistName || '',
    artwork: art,
    streamUrl: t.previewUrl,
    durationMs: Number(t.trackTimeMillis) || 30000,
    sourceHost: previewHost,
    isPreview: true,
  };
}

// Normalize for relevance comparison: lowercase, strip diacritics & punctuation,
// collapse whitespace.
function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cyrillic → Latin transliteration. Audius/iTunes catalogs are mostly Latin, so
// a search like "Линда" or "Валера" needs to also be tried as "Linda" / "Valera"
// to actually hit. Covers Russian + common Ukrainian letters.
const CYRILLIC_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
  з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
  я: 'ya', і: 'i', ї: 'yi', є: 'ie', ґ: 'g',
};
function transliterate(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) out += CYRILLIC_MAP[ch] ?? ch;
  return out;
}
function hasCyrillic(s: string): boolean {
  return /[а-яёіїєґ]/i.test(s);
}

// Score a track against the query. Higher is more relevant. Title matches weigh
// more than artist matches; exact > prefix > word-boundary > substring. The
// query is matched against BOTH the original text and (when it contained
// cyrillic) the transliteration, so an English track title matched via
// transliteration of a russian query still scores well.
export function scoreTrackRelevance(track: Track, query: string): number {
  const candidates: string[] = [normalize(query)].filter(Boolean);
  if (hasCyrillic(query)) {
    const tl = normalize(transliterate(query));
    if (tl && !candidates.includes(tl)) candidates.push(tl);
  }
  if (candidates.length === 0) return 0;
  const title = normalize(track.title);
  const artist = normalize(track.artist);

  let best = 0;
  for (const q of candidates) {
    const qWords = q.split(' ').filter(Boolean);
    let score = 0;

    if (title === q) score += 1000;
    else if (title.startsWith(q)) score += 600;
    else if (new RegExp(`\\b${escapeRegex(q)}`).test(title)) score += 400;
    else if (title.includes(q)) score += 250;

    if (artist === q) score += 300;
    else if (artist.startsWith(q)) score += 180;
    else if (artist.includes(q)) score += 90;

    for (const w of qWords) {
      if (w.length < 2) continue;
      if (new RegExp(`\\b${escapeRegex(w)}\\b`).test(title)) score += 40;
      else if (title.includes(w)) score += 15;
      if (new RegExp(`\\b${escapeRegex(w)}\\b`).test(artist)) score += 20;
    }

    if (score > best) best = score;
  }
  return best;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchJson(url: string, timeoutMs = 6000): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Query a single Audius host (one search call). Returns mapped tracks or [].
async function audiusSearch(host: string, query: string): Promise<Track[]> {
  const url = `${host}/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=${APP_NAME}`;
  const json = await fetchJson(url);
  const results: any[] = Array.isArray(json?.data) ? json.data : [];
  const out: Track[] = [];
  for (const raw of results) {
    const mapped = mapTrack(raw, host);
    if (mapped) out.push(mapped);
  }
  return out;
}

async function itunesSearch(query: string, limit: number): Promise<Track[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=${limit}`;
  const json = await fetchJson(url, 5000);
  const results: any[] = Array.isArray(json?.results) ? json.results : [];
  const out: Track[] = [];
  for (const raw of results) {
    const mapped = mapItunesTrack(raw);
    if (mapped) out.push(mapped);
  }
  return out;
}

interface CachedSearch { ts: number; tracks: Track[]; }

function readCache(query: string): Track[] | null {
  try {
    const key = SEARCH_CACHE_PREFIX + normalize(query);
    const hit = kvGetJSONSync<CachedSearch | null>(key, null);
    if (!hit) return null;
    if (Date.now() - hit.ts > SEARCH_CACHE_TTL_MS) return null;
    if (!Array.isArray(hit.tracks) || hit.tracks.length === 0) return null;
    return hit.tracks;
  } catch {
    return null;
  }
}

function writeCache(query: string, tracks: Track[]): void {
  if (!tracks.length) return;
  try {
    const key = SEARCH_CACHE_PREFIX + normalize(query);
    kvSetJSON(key, { ts: Date.now(), tracks });
  } catch {}
}

/**
 * Search across Audius (full-length) + iTunes (30s previews).
 *
 * - Cache hit (≤1h old): return immediately, zero network.
 * - Otherwise: query all Audius hosts in parallel + transliterated variant
 *   if cyrillic + iTunes if pool still thin. Merge, dedupe by id and by
 *   (title, artist), rank by relevance, prefer full-length on ties.
 *
 * Offline / failing hosts simply return []; the function never throws.
 */
export async function searchTracks(query: string, limit = 20): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];

  const cached = readCache(q);
  if (cached) return cached.slice(0, limit);

  const queries: string[] = [q];
  if (hasCyrillic(q)) {
    const tl = transliterate(q).trim();
    if (tl && tl !== q) queries.push(tl);
  }

  const byId = new Map<string, Track>();
  const POOL_TARGET = Math.max(limit * 2, 30);

  // Parallel fan-out across all Audius hosts × all query variants. First
  // batch of responsive hosts wins; slow ones don't block the result.
  const audiusJobs: Promise<Track[]>[] = [];
  for (const variant of queries) {
    for (const host of HOSTS) audiusJobs.push(audiusSearch(host, variant));
  }
  const audiusResults = await Promise.all(audiusJobs);
  for (const list of audiusResults) {
    for (const t of list) if (!byId.has(t.id)) byId.set(t.id, t);
    if (byId.size >= POOL_TARGET) break;
  }

  // iTunes fallback for popular releases Audius doesn't have. Query both the
  // original and the transliterated variant in parallel.
  if (byId.size < limit) {
    const itunesJobs = queries.map((v) => itunesSearch(v, limit));
    const itunesResults = await Promise.all(itunesJobs);
    for (const list of itunesResults) {
      for (const t of list) if (!byId.has(t.id)) byId.set(t.id, t);
    }
  }

  if (byId.size === 0) return [];

  // Dedupe by (normalized title, normalized artist). Same song can come back
  // as both an Audius full-length and an iTunes preview — keep the higher
  // scoring one; on a tie prefer the full-length (isPreview: false).
  const dedupedByTitleArtist = new Map<string, Track>();
  for (const t of byId.values()) {
    const key = `${normalize(t.title)}|||${normalize(t.artist)}`;
    const existing = dedupedByTitleArtist.get(key);
    if (!existing) {
      dedupedByTitleArtist.set(key, t);
      continue;
    }
    const sExisting = scoreTrackRelevance(existing, q);
    const sNew = scoreTrackRelevance(t, q);
    if (sNew > sExisting) {
      dedupedByTitleArtist.set(key, t);
    } else if (sNew === sExisting && existing.isPreview && !t.isPreview) {
      dedupedByTitleArtist.set(key, t);
    }
  }

  // Rank. Primary: relevance score desc. Secondary: full-length before preview
  // (Number(false) - Number(true) = -1, so isPreview=false sorts earlier).
  const ranked = Array.from(dedupedByTitleArtist.values())
    .map((t) => ({ t, score: scoreTrackRelevance(t, q) }))
    .sort((a, b) => (b.score - a.score) || (Number(a.t.isPreview) - Number(b.t.isPreview)))
    .map((x) => x.t);

  const top = ranked.slice(0, limit);
  writeCache(q, top);
  return top;
}
