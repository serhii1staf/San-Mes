// Music search + streaming via the Audius API.
//
// Why Audius: open, free, no API key, and serves FULL-LENGTH tracks (not 30s
// previews), legally. Streams are plain HTTPS URLs that expo-av plays directly,
// so it's fully OTA-compatible with zero load on our own server.
//
// We hit a list of known-good discovery hosts in order (api.audius.co serves the
// public API too), trying the next one on any failure or empty result.

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
  };
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

export async function searchTracks(query: string, limit = 20): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];
  for (const host of HOSTS) {
    const url = `${host}/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=${APP_NAME}`;
    const json = await fetchJson(url);
    const results: any[] = Array.isArray(json?.data) ? json.data : [];
    if (results.length > 0) {
      const mapped = results.map((t) => mapTrack(t, host)).filter((x): x is Track => !!x);
      if (mapped.length > 0) return mapped.slice(0, limit);
    }
  }
  return [];
}
