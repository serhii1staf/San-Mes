// Music search + streaming via Audius + SoundCloud + iTunes Search.
//
// Strategy: prefer FULL-LENGTH sources (Audius, SoundCloud) over 30-second
// previews (iTunes). When all three are available for the same song the
// dedup picks the full-length copy.
//
//   - Audius: open, no API key, full-length but limited catalogue (mostly
//     indie/electronic).
//   - SoundCloud: very broad catalogue (artists upload there), full-length
//     streams. Uses a public-page-extracted client_id (auto-refreshed once a
//     day; persisted via MMKV) — this is the same approach every web
//     sound-extractor uses, no auth required.
//   - iTunes Search: 30-second `previewUrl`. Last-resort fallback for
//     mainstream songs missing from the open catalogues. Tagged
//     `isPreview: true` so the UI can show a "30 с" pill.
//
// Recall:
//   - Audius queried in parallel across discovery hosts.
//   - Cyrillic queries also retried as Latin transliteration ("Линда" → "Linda")
//     so an English-only catalogue still hits.
//   - iTunes only fires if pool < target (saves bandwidth).
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

// ─── SoundCloud ──────────────────────────────────────────────────────────────
// SoundCloud doesn't expose an OAuth-free official API any more, but every
// soundcloud.com page bootstraps a public Web client_id in one of the JS
// bundles it loads. Extracting it from the homepage gives us a working
// `client_id` for the public api-v2 endpoints (search + streams). We cache it
// in MMKV for 24h and re-extract on failure. This is the same technique used
// by every reputable browser-side music extractor and stays inside the public
// surface area of soundcloud.com.

const SC_CLIENT_KEY = 'soundcloud_client_id';
const SC_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
let scClientCache: { id: string; ts: number } | null = null;

async function getSoundCloudClientId(): Promise<string | null> {
  // 1. Fast path: in-memory.
  if (scClientCache && Date.now() - scClientCache.ts < SC_CLIENT_TTL_MS) {
    return scClientCache.id;
  }
  // 2. MMKV.
  try {
    const persisted = kvGetJSONSync<{ id: string; ts: number } | null>(SC_CLIENT_KEY, null);
    if (persisted && Date.now() - persisted.ts < SC_CLIENT_TTL_MS) {
      scClientCache = persisted;
      return persisted.id;
    }
  } catch {}
  // 3. Extract from soundcloud.com. The homepage references several JS
  //    bundles; one of them defines `client_id:"..."`. We fetch them in
  //    parallel and return the first match.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const homepage = await fetch('https://soundcloud.com/', { signal: ctrl.signal });
    clearTimeout(t);
    if (!homepage.ok) return null;
    const html = await homepage.text();
    // Find every <script src="https://a-v2.sndcdn.com/assets/X.js"> URL.
    const scriptUrls = Array.from(html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js/g)).map((m) => m[0]);
    if (scriptUrls.length === 0) return null;
    // Try the bundles in parallel; resolve with the first one that yields an id.
    const bundles = await Promise.all(scriptUrls.slice(0, 6).map(async (u) => {
      try {
        const r = await fetch(u);
        if (!r.ok) return null;
        const txt = await r.text();
        const m = txt.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{20,40})"/);
        return m ? m[1] : null;
      } catch { return null; }
    }));
    const id = bundles.find((x): x is string => !!x);
    if (!id) return null;
    scClientCache = { id, ts: Date.now() };
    try { kvSetJSON(SC_CLIENT_KEY, scClientCache); } catch {}
    return id;
  } catch {
    return null;
  }
}

// Resolve a SoundCloud track's playable HTTPS stream URL (progressive MP3 if
// available — falls back to HLS, which expo-av can also play on iOS+Android).
async function resolveSoundCloudStream(rawTrack: any, clientId: string): Promise<string | null> {
  try {
    const transcodings: any[] = rawTrack?.media?.transcodings || [];
    if (!transcodings.length) return null;
    // Prefer progressive MP3; HLS works too but is more expensive on weak devices.
    const progressive = transcodings.find((t) => t?.format?.protocol === 'progressive');
    const chosen = progressive || transcodings[0];
    const transcodingUrl = chosen?.url;
    if (!transcodingUrl) return null;
    const sep = transcodingUrl.includes('?') ? '&' : '?';
    const json = await fetchJson(`${transcodingUrl}${sep}client_id=${clientId}`, 5000);
    return json?.url || null;
  } catch {
    return null;
  }
}

function mapSoundCloudTrack(t: any, streamUrl: string): Track | null {
  if (!t?.id || !t?.title || !streamUrl) return null;
  const artwork = (t.artwork_url || t.user?.avatar_url || '').replace('-large.', '-t500x500.');
  return {
    id: `sc-${t.id}`,
    title: t.title,
    artist: t.user?.username || t.publisher_metadata?.artist || '',
    artwork,
    streamUrl,
    durationMs: Number(t.duration) || 0,
    sourceHost: 'soundcloud.com',
    isPreview: false, // SoundCloud streams are full-length.
  };
}

async function soundcloudSearch(query: string, limit: number): Promise<Track[]> {
  const clientId = await getSoundCloudClientId();
  if (!clientId) return [];
  const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&limit=${limit}&client_id=${clientId}`;
  const json = await fetchJson(url, 5000);
  const collection: any[] = Array.isArray(json?.collection) ? json.collection : [];
  if (!collection.length) return [];
  // Resolve stream urls in parallel — SoundCloud requires a separate call per
  // track to get the actual playable URL.
  const resolved = await Promise.all(collection.slice(0, limit).map(async (t) => {
    const streamUrl = await resolveSoundCloudStream(t, clientId);
    return streamUrl ? mapSoundCloudTrack(t, streamUrl) : null;
  }));
  return resolved.filter((x): x is Track => !!x);
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

  // SoundCloud also runs in parallel (one request per query variant), so it
  // doesn't add latency on top of Audius.
  const scJobs: Promise<Track[]>[] = queries.map((v) => soundcloudSearch(v, Math.min(limit, 10)));

  const [audiusResults, scResults] = await Promise.all([
    Promise.all(audiusJobs),
    Promise.all(scJobs),
  ]);
  for (const list of audiusResults) {
    for (const t of list) if (!byId.has(t.id)) byId.set(t.id, t);
    if (byId.size >= POOL_TARGET) break;
  }
  for (const list of scResults) {
    for (const t of list) if (!byId.has(t.id)) byId.set(t.id, t);
  }

  // iTunes fallback for popular releases the open catalogues don't have. Skip
  // entirely if we already have enough full-length results.
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
