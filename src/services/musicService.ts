// Music search + streaming via the Audius API.
//
// Why Audius: open, free, no API key, and — crucially — it serves FULL-LENGTH
// tracks (not 30s previews), legally (royalty-free / artist-uploaded catalogue).
// Streams are plain HTTPS URLs that expo-av plays directly, so it's fully
// OTA-compatible and puts zero load on our own server.
//
// Flow:
//   1. Resolve a healthy discovery node from https://api.audius.co (cached).
//   2. Search:   {host}/v1/tracks/search?query=...&app_name=San-Mes
//   3. Stream:   {host}/v1/tracks/{id}/stream?app_name=San-Mes  (302 → audio)

const APP_NAME = 'San-Mes';
const BOOTSTRAP = 'https://api.audius.co';
const FALLBACK_HOSTS = [
  'https://discoveryprovider.audius.co',
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

let cachedHost: string | null = null;
let hostPromise: Promise<string> | null = null;

async function resolveHost(): Promise<string> {
  if (cachedHost) return cachedHost;
  if (hostPromise) return hostPromise;
  hostPromise = (async () => {
    try {
      const res = await fetch(BOOTSTRAP);
      const json = await res.json();
      const hosts: string[] = Array.isArray(json?.data) ? json.data : [];
      if (hosts.length > 0) {
        cachedHost = hosts[Math.floor(Math.random() * Math.min(hosts.length, 5))];
        return cachedHost!;
      }
    } catch {}
    cachedHost = FALLBACK_HOSTS[0];
    return cachedHost!;
  })();
  return hostPromise;
}

function mapTrack(t: any, host: string): Track | null {
  if (!t?.id || !t?.title) return null;
  const art = t.artwork?.['480x480'] || t.artwork?.['150x150'] || t.artwork?.['1000x1000'] || '';
  return {
    id: String(t.id),
    title: t.title,
    artist: t.user?.name || t.user?.handle || '',
    artwork: art,
    streamUrl: `${host}/v1/tracks/${t.id}/stream?app_name=${APP_NAME}`,
    durationMs: (Number(t.duration) || 0) * 1000,
  };
}

export async function searchTracks(query: string, limit = 15): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];
  let host = await resolveHost();
  const attempt = async (h: string) => {
    const url = `${h}/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=${APP_NAME}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('bad status');
    const json = await res.json();
    const results: any[] = Array.isArray(json?.data) ? json.data : [];
    return results.map((t) => mapTrack(t, h)).filter((x): x is Track => !!x).slice(0, limit);
  };
  try {
    return await attempt(host);
  } catch {
    // Discovery node may be down — try fallbacks once.
    for (const h of FALLBACK_HOSTS) {
      try { cachedHost = h; return await attempt(h); } catch {}
    }
    return [];
  }
}
