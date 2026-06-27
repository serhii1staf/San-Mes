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
import { JAMENDO_CLIENT_ID } from '../config/music';

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

// Precomputed, query-derived inputs for `scoreTrackRelevance`. Building these
// (normalization + transliteration + per-word RegExp compilation) is identical
// for every track in a single search, so we do it ONCE per `searchTracks` call
// instead of O(tracks × words) times. Behaviour is unchanged: the same
// candidates, words, and regex patterns the per-call path would have built.
interface RelevanceQueryCandidate {
  q: string;
  // new RegExp(`\\b${escapeRegex(q)}`) — word-boundary prefix match on the candidate.
  prefixRegex: RegExp;
  // Query words (length >= 2, preserving order), each with its precompiled
  // whole-word RegExp (`\\b${escapeRegex(w)}\\b`). Words shorter than 2 chars
  // are excluded here because the scoring loop skips them.
  words: { w: string; boundary: RegExp }[];
}
export interface RelevancePrecomputed {
  candidates: RelevanceQueryCandidate[];
}

// Build the per-query scoring inputs once. Mirrors exactly what
// `scoreTrackRelevance` computes internally when no precomputed value is given.
export function precomputeRelevance(query: string): RelevancePrecomputed {
  const candStrings: string[] = [normalize(query)].filter(Boolean);
  if (hasCyrillic(query)) {
    const tl = normalize(transliterate(query));
    if (tl && !candStrings.includes(tl)) candStrings.push(tl);
  }
  const candidates: RelevanceQueryCandidate[] = candStrings.map((q) => {
    const words = q
      .split(' ')
      .filter(Boolean)
      .filter((w) => w.length >= 2)
      .map((w) => ({ w, boundary: new RegExp(`\\b${escapeRegex(w)}\\b`) }));
    return {
      q,
      prefixRegex: new RegExp(`\\b${escapeRegex(q)}`),
      words,
    };
  });
  return { candidates };
}

// Score a track against the query. Higher is more relevant. Title matches weigh
// more than artist matches; exact > prefix > word-boundary > substring. The
// query is matched against BOTH the original text and (when it contained
// cyrillic) the transliteration, so an English track title matched via
// transliteration of a russian query still scores well.
//
// `precomputed` is an optional perf optimization: when a caller scores many
// tracks against one query it can build the query-derived inputs once via
// `precomputeRelevance` and pass them in. When omitted they're computed
// internally, so standalone callers behave exactly as before. The resulting
// score for a given (track, query) is identical either way.
export function scoreTrackRelevance(
  track: Track,
  query: string,
  precomputed?: RelevancePrecomputed,
): number {
  const pc = precomputed ?? precomputeRelevance(query);
  if (pc.candidates.length === 0) return 0;
  const title = normalize(track.title);
  const artist = normalize(track.artist);

  let best = 0;
  for (const cand of pc.candidates) {
    const q = cand.q;
    let score = 0;

    if (title === q) score += 1000;
    else if (title.startsWith(q)) score += 600;
    else if (cand.prefixRegex.test(title)) score += 400;
    else if (title.includes(q)) score += 250;

    if (artist === q) score += 300;
    else if (artist.startsWith(q)) score += 180;
    else if (artist.includes(q)) score += 90;

    for (const { w, boundary } of cand.words) {
      if (boundary.test(title)) score += 40;
      else if (title.includes(w)) score += 15;
      if (boundary.test(artist)) score += 20;
    }

    if (score > best) best = score;
  }
  return best;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchJson(url: string, timeoutMs = 6000, init?: RequestInit): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Many CDN endpoints (SoundCloud especially) reject requests without a UA, so
// every outbound music request gets a desktop UA. RN's bare fetch sends none.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

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

// ─── Jamendo ─────────────────────────────────────────────────────────────────
// Jamendo (https://www.jamendo.com) is a LEGAL, free developer API serving
// FULL-LENGTH Creative-Commons / artist-licensed tracks — same licensing
// posture as Audius, App-Store-safe under §3.3.4.A.i. The `audio` field on each
// track is a direct, full-length progressive MP3 that expo-av plays natively.
// Requires a free Client ID (src/config/music.ts); skipped entirely when unset.
function mapJamendoTrack(t: any): Track | null {
  if (!t?.id || !t?.name || !t?.audio) return null;
  const art: string = t.image || t.album_image || '';
  return {
    id: `jamendo-${t.id}`,
    title: t.name,
    artist: t.artist_name || '',
    artwork: art,
    streamUrl: t.audio, // full-length progressive MP3
    durationMs: (Number(t.duration) || 0) * 1000,
    sourceHost: 'api.jamendo.com',
    isPreview: false,
  };
}

async function jamendoSearch(query: string, limit: number): Promise<Track[]> {
  if (!JAMENDO_CLIENT_ID) return [];
  // `namesearch` matches track/artist names; `audioformat=mp32` gives a
  // higher-bitrate full stream. `imagesize` keeps artwork reasonable.
  const url =
    `https://api.jamendo.com/v3.0/tracks/?client_id=${JAMENDO_CLIENT_ID}` +
    `&format=json&limit=${limit}&audioformat=mp32&imagesize=300` +
    `&namesearch=${encodeURIComponent(query)}`;
  const json = await fetchJson(url, 6000);
  const results: any[] = Array.isArray(json?.results) ? json.results : [];
  const out: Track[] = [];
  for (const raw of results) {
    const mapped = mapJamendoTrack(raw);
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
// Last-resort fallback — SoundCloud rotates these every few months but at any
// given moment many work for weeks. If the homepage scrape fails we try this
// list before giving up. Add fresh ones as needed; the live extraction is
// always preferred.
const SC_FALLBACK_CLIENT_IDS = [
  'iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX',
  '2t9loNQH90kzJcsFCODdigxfp325aq4z',
  'eGWfNJiC0gLKyz3D1AmzREpaCJB1H0HK',
];
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
  // 3. Extract from soundcloud.com. Send a browser UA so the CDN actually
  //    serves the JS bundles (without UA it sometimes returns a stub).
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const homepage = await fetch('https://soundcloud.com/', {
      signal: ctrl.signal,
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' },
    });
    clearTimeout(t);
    if (homepage.ok) {
      const html = await homepage.text();
      const scriptUrls = Array.from(html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js/g)).map((m) => m[0]);
      if (scriptUrls.length > 0) {
        const bundles = await Promise.all(scriptUrls.slice(0, 6).map(async (u) => {
          try {
            const r = await fetch(u, { headers: { 'User-Agent': BROWSER_UA } });
            if (!r.ok) return null;
            const txt = await r.text();
            const m = txt.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{20,40})"/);
            return m ? m[1] : null;
          } catch { return null; }
        }));
        const id = bundles.find((x): x is string => !!x);
        if (id) {
          scClientCache = { id, ts: Date.now() };
          try { kvSetJSON(SC_CLIENT_KEY, scClientCache); } catch {}
          return id;
        }
      }
    }
  } catch {}
  // 4. Fallback list — try each until one works for a tiny test request.
  for (const candidate of SC_FALLBACK_CLIENT_IDS) {
    try {
      const test = await fetchJson(
        `https://api-v2.soundcloud.com/search/tracks?q=test&limit=1&client_id=${candidate}`,
        4000,
        { headers: { 'User-Agent': BROWSER_UA } },
      );
      if (test && Array.isArray(test.collection)) {
        scClientCache = { id: candidate, ts: Date.now() };
        try { kvSetJSON(SC_CLIENT_KEY, scClientCache); } catch {}
        return candidate;
      }
    } catch {}
  }
  return null;
}

// Resolve a SoundCloud track's playable HTTPS stream URL (progressive MP3 if
// available — falls back to HLS, which expo-av can also play on iOS+Android).
async function resolveSoundCloudStream(rawTrack: any, clientId: string): Promise<string | null> {
  try {
    const transcodings: any[] = rawTrack?.media?.transcodings || [];
    if (!transcodings.length) return null;
    const progressive = transcodings.find((t) => t?.format?.protocol === 'progressive');
    const chosen = progressive || transcodings[0];
    const transcodingUrl = chosen?.url;
    if (!transcodingUrl) return null;
    const sep = transcodingUrl.includes('?') ? '&' : '?';
    const json = await fetchJson(
      `${transcodingUrl}${sep}client_id=${clientId}`,
      5000,
      { headers: { 'User-Agent': BROWSER_UA } },
    );
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
  const json = await fetchJson(url, 5000, { headers: { 'User-Agent': BROWSER_UA } });
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
 * Search across Audius + Jamendo + SoundCloud (full-length) + iTunes (30s).
 *
 * - Cache hit (≤1h old): return immediately, zero network.
 * - Otherwise: query all Audius hosts + Jamendo + SoundCloud in parallel
 *   (+ transliterated variant if cyrillic), then iTunes only if the pool is
 *   still thin. Merge, dedupe by id and by (title, artist), rank by relevance,
 *   prefer full-length on ties.
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

  // Jamendo (legal full-length CC catalogue) in parallel too — only fires when
  // a client id is configured, otherwise resolves to [] instantly.
  const jamendoJobs: Promise<Track[]>[] = queries.map((v) => jamendoSearch(v, Math.min(limit, 15)));

  const [audiusResults, scResults, jamendoResults] = await Promise.all([
    Promise.all(audiusJobs),
    Promise.all(scJobs),
    Promise.all(jamendoJobs),
  ]);
  for (const list of audiusResults) {
    for (const t of list) if (!byId.has(t.id)) byId.set(t.id, t);
    if (byId.size >= POOL_TARGET) break;
  }
  for (const list of scResults) {
    for (const t of list) if (!byId.has(t.id)) byId.set(t.id, t);
  }
  for (const list of jamendoResults) {
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

  // Precompute the query-derived scoring inputs ONCE for this search. Both the
  // dedupe pass and the ranking pass below score many tracks against the same
  // `q`, so building the normalized candidates + per-word regexes a single time
  // avoids recompiling them per (track × word).
  const relevancePc = precomputeRelevance(q);

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
    const sExisting = scoreTrackRelevance(existing, q, relevancePc);
    const sNew = scoreTrackRelevance(t, q, relevancePc);
    if (sNew > sExisting) {
      dedupedByTitleArtist.set(key, t);
    } else if (sNew === sExisting && existing.isPreview && !t.isPreview) {
      dedupedByTitleArtist.set(key, t);
    }
  }

  // Rank by relevance score, then prefer full-length over preview on ties.
  // Track scoring is derived from BOTH the original query and (when cyrillic)
  // its transliteration, so an English-titled song matched via "Линда" → "Linda"
  // still scores well.
  //
  // Relevance filter: when there's at least one well-matching track in the
  // pool, drop everything with score 0 — those are SoundCloud/iTunes search
  // results that came back for unrelated reasons (their search is loose). If
  // EVERY result scores 0 we keep them all so the user still sees something.
  const scored = Array.from(dedupedByTitleArtist.values())
    .map((t) => ({ t, score: scoreTrackRelevance(t, q, relevancePc) }));
  const hasMatch = scored.some((x) => x.score > 0);
  const filtered = hasMatch ? scored.filter((x) => x.score > 0) : scored;
  const ranked = filtered
    .sort((a, b) => (b.score - a.score) || (Number(a.t.isPreview) - Number(b.t.isPreview)))
    .map((x) => x.t);

  const top = ranked.slice(0, limit);
  writeCache(q, top);
  return top;
}


// ── Direct-URL support ──────────────────────────────────────────────────────
// When the user types a URL into the music chat we try to treat it as a
// track instead of a search query. ONE case is supported safely: direct
// audio file URLs — anything ending in a recognised audio extension (.mp3,
// .m4a, .ogg, .wav, .flac, .aac, .opus). expo-av plays these natively. The
// user supplies the link, so the licensing responsibility sits with them,
// and the audio bytes never pass through our servers (Apple §3.3.4.A.i
// compliance).
//
// What we deliberately DON'T do: video-platform stream extraction (YouTube,
// TikTok, Instagram, Discord/Telegram media). Those require server-side
// extraction tooling (yt-dlp et al.) that violates the platforms' TOS and
// would put us at risk under §3.3.4.A.i ("must be wholly-owned or licensed").
// Such URLs simply fall through to the normal text search — which returns
// no results, so the user sees the standard "Не найдено" bubble. No special
// alert, no friction.

const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.ogg', '.wav', '.flac', '.aac', '.opus', '.weba'];

export type UrlIntent =
  | { kind: 'audio'; track: Track }
  | { kind: 'unsupported' };

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function prettyFromUrl(u: URL): { title: string; artist: string } {
  // Extract the file basename (last path segment, no extension, %20→space).
  const segments = u.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || u.hostname;
  const decoded = decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, '');
  // "Artist - Title" is a common file-naming convention; split if present.
  const dash = decoded.indexOf(' - ');
  if (dash > 0) {
    return {
      artist: decoded.slice(0, dash).trim(),
      title: decoded.slice(dash + 3).trim(),
    };
  }
  return { title: decoded || u.hostname, artist: u.hostname };
}

/**
 * Inspect a user-typed string and return what we should do with it.
 *   - `audio` → play as a track immediately.
 *   - `unsupported` → fall through to normal text search (which returns
 *     nothing for unplayable URLs; the user sees the standard empty state).
 */
export function classifyMusicInput(input: string): UrlIntent {
  const s = input.trim();
  if (!looksLikeUrl(s)) return { kind: 'unsupported' };

  let url: URL;
  try { url = new URL(s); } catch { return { kind: 'unsupported' }; }

  const path = url.pathname.toLowerCase();
  const hasAudioExt = AUDIO_EXTENSIONS.some((ext) => path.endsWith(ext));
  if (hasAudioExt) {
    const { title, artist } = prettyFromUrl(url);
    const track: Track = {
      id: `direct:${s}`,
      title,
      artist,
      artwork: '',
      streamUrl: s,
      durationMs: 0, // unknown until expo-av loads it; UI handles 0 fine
      sourceHost: url.hostname,
      isPreview: false,
    };
    return { kind: 'audio', track };
  }

  return { kind: 'unsupported' };
}
