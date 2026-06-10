// Music search + streaming via the Audius API.
//
// Why Audius: open, free, no API key, and serves FULL-LENGTH tracks (not 30s
// previews), legally. Streams are plain HTTPS URLs that expo-av plays directly,
// so it's fully OTA-compatible with zero load on our own server.
//
// We hit a list of known-good discovery hosts in order (api.audius.co serves the
// public API too). Results from the first responsive hosts are merged and
// deduplicated so search recall is high, then ranked by relevance to the query.

const APP_NAME = 'San-Mes';

const HOSTS = [
  'https://api.audius.co',
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co',
  'https://audius-discovery-1.cultur3stake.com',
  'https://blockdaemon-audius-discovery-1.bdnodes.net',
];

export interface Track {
  id: string;
  title: string;
  artist: string;
  artwork: string;
  streamUrl: string;   // full-length stream (expo-av plays it)
  durationMs: number;
  sourceHost: string;  // discovery host the track came from — streamUrl is derived from it
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
    // streamUrl is ALWAYS derived from the same host the track metadata came
    // from, so the invariant `streamUrl host === sourceHost` always holds.
    streamUrl: `${host}/v1/tracks/${t.id}/stream?app_name=${APP_NAME}`,
    durationMs: (Number(t.duration) || 0) * 1000,
    sourceHost: host,
  };
}

// Normalize for relevance comparison: lowercase, strip diacritics & punctuation,
// collapse whitespace. Keeps matching robust across "Imagine" vs "imagine!".
function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Score a track against the query. Higher is more relevant. Title matches weigh
// more than artist matches; exact > prefix > word-boundary > substring.
export function scoreTrackRelevance(track: Track, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const title = normalize(track.title);
  const artist = normalize(track.artist);
  const qWords = q.split(' ').filter(Boolean);

  let score = 0;

  // Title relevance (primary signal).
  if (title === q) score += 1000;
  else if (title.startsWith(q)) score += 600;
  else if (new RegExp(`\\b${escapeRegex(q)}`).test(title)) score += 400;
  else if (title.includes(q)) score += 250;

  // Artist relevance (secondary signal).
  if (artist === q) score += 300;
  else if (artist.startsWith(q)) score += 180;
  else if (artist.includes(q)) score += 90;

  // Per-word coverage so multi-word queries rank partial matches sensibly.
  for (const w of qWords) {
    if (w.length < 2) continue;
    if (new RegExp(`\\b${escapeRegex(w)}\\b`).test(title)) score += 40;
    else if (title.includes(w)) score += 15;
    if (new RegExp(`\\b${escapeRegex(w)}\\b`).test(artist)) score += 20;
  }

  return score;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchJson(url: string, timeoutMs = 7000): Promise<any | null> {
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

/**
 * Search for tracks across Audius discovery hosts.
 *
 * Recall: queries hosts in order and MERGES results (deduplicated by track id)
 * until we have a healthy candidate pool, instead of stopping at the first
 * non-empty host. This finds far more matches for arbitrary queries.
 *
 * Relevance: the merged pool is ranked by `scoreTrackRelevance` so the result
 * the user actually searched for surfaces first.
 *
 * Resilience: every host failure/timeout is swallowed; an offline device simply
 * yields `[]` without throwing.
 */
export async function searchTracks(query: string, limit = 20): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];

  const byId = new Map<string, Track>();
  // Pool size target — enough to rank well without over-fetching on weak devices.
  const POOL_TARGET = Math.max(limit * 2, 30);

  for (const host of HOSTS) {
    const url = `${host}/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=${APP_NAME}`;
    const json = await fetchJson(url);
    const results: any[] = Array.isArray(json?.data) ? json.data : [];
    for (const raw of results) {
      const mapped = mapTrack(raw, host);
      if (mapped && !byId.has(mapped.id)) byId.set(mapped.id, mapped);
    }
    // Stop early once we have a strong enough candidate pool from healthy hosts.
    if (byId.size >= POOL_TARGET) break;
  }

  if (byId.size === 0) return [];

  const ranked = Array.from(byId.values())
    .map((t) => ({ t, score: scoreTrackRelevance(t, q) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t);

  return ranked.slice(0, limit);
}
