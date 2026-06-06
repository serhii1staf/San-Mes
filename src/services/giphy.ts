// GIPHY integration via the REST API (no native SDK).
//
// Why REST and not the GIPHY SDK: the SDK is a native module that needs an EAS
// rebuild + config plugin and doesn't ship over OTA. The REST API is plain HTTP
// + we render the returned GIF URLs as images (expo-image animates GIFs), so it
// works identically on iOS / Android / Web and ships via OTA.
//
// Payloads are kept tiny: we request the "fixed_width" downsized renditions
// (~100-200px wide, tens of KB) for the grid, and keep the original URL only for
// sending. Nothing touches our own server/storage — GIF URLs are sent as-is.

const GIPHY_API_KEY = 'caEHH1NMR0T7xkQ00fWHryFVH49kLG1C';
const BASE = 'https://api.giphy.com/v1/gifs';

export interface GiphyItem {
  id: string;
  // Small preview rendition for the picker grid (light, fast).
  previewUrl: string;
  previewWidth: number;
  previewHeight: number;
  // Rendition we actually send / display in the message (still downsized to keep KB low).
  sendUrl: string;
  width: number;
  height: number;
}

function mapItem(g: any): GiphyItem | null {
  try {
    const images = g.images || {};
    const preview = images.fixed_width_small || images.fixed_width || images.downsized;
    const send = images.fixed_width || images.downsized_medium || images.downsized || preview;
    if (!preview?.url || !send?.url) return null;
    return {
      id: g.id,
      previewUrl: preview.url,
      previewWidth: Number(preview.width) || 100,
      previewHeight: Number(preview.height) || 100,
      sendUrl: send.url,
      width: Number(send.width) || 200,
      height: Number(send.height) || 200,
    };
  } catch {
    return null;
  }
}

async function fetchGifs(url: string): Promise<GiphyItem[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    return data.map(mapItem).filter((x): x is GiphyItem => !!x);
  } catch {
    return [];
  }
}

export async function getTrendingGifs(limit = 24, offset = 0): Promise<GiphyItem[]> {
  const url = `${BASE}/trending?api_key=${GIPHY_API_KEY}&limit=${limit}&offset=${offset}&rating=pg-13&bundle=fixed_width_small`;
  return fetchGifs(url);
}

export async function searchGifs(query: string, limit = 24, offset = 0): Promise<GiphyItem[]> {
  const q = query.trim();
  if (!q) return getTrendingGifs(limit, offset);
  const url = `${BASE}/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}&rating=pg-13&lang=ru&bundle=fixed_width_small`;
  return fetchGifs(url);
}

// A GIF message is stored/sent with this marker so it round-trips through the
// existing text-based message/comment storage without any schema change.
export const GIF_PREFIX = '::gif::';
export function encodeGif(url: string): string {
  return `${GIF_PREFIX}${url}`;
}
export function parseGif(text: string | undefined | null): string | null {
  if (!text || !text.startsWith(GIF_PREFIX)) return null;
  const url = text.slice(GIF_PREFIX.length).trim();
  return url || null;
}
