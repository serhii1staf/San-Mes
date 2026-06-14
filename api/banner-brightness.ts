import type { IncomingMessage, ServerResponse } from 'http';
import sharp from 'sharp';

// Banner brightness service: given ?url=, fetch the image server-side,
// downsample it to a single average pixel via sharp's resize(1, 1) and
// return its perceptual luminance (0.0 dark → 1.0 light) so the client
// can pick adaptive text colour for the display name + @username on the
// profile banner.
//
// Why server-side:
//   - React Native core has no canvas / pixel-buffer access. Doing this
//     on-device would require a JS PNG/JPEG decoder bundle that adds
//     hundreds of KB to the app and burns CPU on every banner load.
//   - The result is a single number per URL — trivially cacheable at
//     the Vercel CDN edge. Repeat opens of the same profile pay zero
//     cost after the first hit anywhere on the network.
//
// Security:
//   - URL must be HTTPS.
//   - Host must be on the allowlist (our R2 bucket or Supabase storage)
//     so we never proxy arbitrary user-supplied URLs (SSRF guard).
//   - 5-second fetch timeout, 5 MB max response size.
//   - On any failure path return { brightness: 0 } — that's the dark
//     default which the client interprets as "use white text", matching
//     the legacy behaviour for banners that pre-date this endpoint.

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_HOST_SUFFIXES = ['media.san-m-app.com', '.supabase.co'];

function send(res: ServerResponse, status: number, brightness: number) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  // 7 days fresh, then SWR for 1 day. Brightness of a given image URL
  // is immutable — content-addressed by the upload pipeline — so the
  // long s-maxage is safe.
  res.setHeader(
    'Cache-Control',
    'public, s-maxage=604800, stale-while-revalidate=86400'
  );
  res.end(JSON.stringify({ brightness }));
}

function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  for (const suffix of ALLOWED_HOST_SUFFIXES) {
    if (suffix.startsWith('.')) {
      if (h.endsWith(suffix) || h === suffix.slice(1)) return true;
    } else if (h === suffix) {
      return true;
    }
  }
  return false;
}

async function fetchImageBuffer(target: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(target, { signal: controller.signal });
    if (!resp.ok || !resp.body) return null;
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BYTES) {
        try { await reader.cancel(); } catch {}
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.end();
    return;
  }

  try {
    const reqUrl = new URL(req.url || '', `http://${req.headers.host}`);
    const target = reqUrl.searchParams.get('url');
    if (!target) return send(res, 200, 0);

    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return send(res, 200, 0);
    }
    if (parsed.protocol !== 'https:') return send(res, 200, 0);
    if (!isAllowedHost(parsed.hostname)) return send(res, 200, 0);

    const buf = await fetchImageBuffer(target);
    if (!buf) return send(res, 200, 0);

    // Resize to a single pixel — sharp's averaging gives the mean RGB of
    // the entire image. Strip alpha so transparent PNGs don't bleed the
    // luminance toward black via pre-multiplication. `raw()` returns the
    // bytes directly so we don't pay an encode round-trip.
    const pixel = await sharp(buf)
      .removeAlpha()
      .resize(1, 1, { fit: 'cover' })
      .raw()
      .toBuffer();

    if (pixel.length < 3) return send(res, 200, 0);

    const r = pixel[0];
    const g = pixel[1];
    const b = pixel[2];
    // Rec. 601 luma — same coefficients the macOS / iOS UI uses for
    // perceptual brightness decisions. Normalised to 0.0–1.0.
    const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const clamped = Math.max(0, Math.min(1, brightness));
    return send(res, 200, clamped);
  } catch {
    return send(res, 200, 0);
  }
}
