// Music search via the iTunes Search API.
//
// Why iTunes Search: free, no API key, legal, returns a 30-second preview URL
// (previewUrl) plus artwork/title/artist. We play the preview with expo-av.
// This avoids the copyright/store-removal risk of scraping full tracks from
// YouTube/streaming services. Payloads are tiny JSON; nothing hits our server.

const ENDPOINT = 'https://itunes.apple.com/search';

export interface Track {
  id: string;
  title: string;
  artist: string;
  artwork: string;       // album art URL (we upscale to 200px)
  previewUrl: string;    // 30s m4a preview, streamed by expo-av
  durationMs: number;
}

function mapTrack(r: any): Track | null {
  if (!r?.previewUrl || !r?.trackName) return null;
  const art: string = (r.artworkUrl100 || r.artworkUrl60 || '').replace('100x100', '200x200');
  return {
    id: String(r.trackId ?? r.collectionId ?? r.previewUrl),
    title: r.trackName,
    artist: r.artistName || '',
    artwork: art,
    previewUrl: r.previewUrl,
    durationMs: Number(r.trackTimeMillis) || 30000,
  };
}

export async function searchTracks(query: string, limit = 15): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const url = `${ENDPOINT}?term=${encodeURIComponent(q)}&media=music&entity=song&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const results: any[] = Array.isArray(json?.results) ? json.results : [];
    return results.map(mapTrack).filter((t): t is Track => !!t);
  } catch {
    return [];
  }
}
