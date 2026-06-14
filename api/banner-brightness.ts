import type { IncomingMessage, ServerResponse } from 'http';
import sharp from 'sharp';

// Banner brightness service: given ?url=, fetch the image server-side,
// crop the bottom region (where the profile name + @username actually
// sit), downsample to a single average pixel, and return its sRGB-correct
// relative luminance (0.0 dark → 1.0 light) so the client can pick adaptive
// text colour for the banner overlay text.
//
// Why bottom-region only:
//   The display name + @username are positioned with marginTop: -140 over
//   a 300pt-tall banner — they overlap roughly the bottom 40% of the image.
//   Sampling the FULL banner blends the unrelated top half (which can be
//   bright sky, dark texture, etc.) into the average, so the picked colour
//   often disagreed with what the user actually saw under the text. Cropping
//   to the bottom 40% before averaging gives us the colour the eye reads in
//   that area, matching the user expectation that "any banner colour works
//   smoothly".
//
// Why server-side:
//   - React Native core has no canvas / pixel-buffer access. Doing this on
//     the device would require shipping a JS PNG/JPEG decoder bundle
//     (hundreds of KB) and burning CPU on every banner load.
//   - The result is a single number per URL — trivially cacheable at the
//     Vercel CDN edge. Repeat opens of the same profile pay zero cost
//     after the first hit anywhere on the network.
//
// Why sRGB-correct relative luminance instead of Rec.601 luma:
//   Rec.601 is a perceptual approximation that doesn't account for sRGB
//   gamma. WCAG-style relative luminance applies the linear-RGB transfer
//   function before mixing the channels, which gives a much smoother and
//   more accurate "is this surface light or dark" signal across the full
//   colour wheel. The earlier 0.5 cutoff on Rec.601 luma flipped between
//   light/dark text awkwardly on saturated backgrounds; relative luminance
//   plus a 0.55 cutoff (favouring white text on borderline banners — the
//   dark gradient backdrop reads better with white than the light-banner
//   surface reads with dark text on borderline cases) lands cleanly.
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

interface SuccessPayload {
  brightness: number;
  dominantColor: { r: number; g: number; b: number };
}

function sendSuccess(res: ServerResponse, payload: SuccessPayload) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  // 7 days fresh, then SWR for 1 day. Brightness of a given image URL
  // is immutable — content-addressed by the upload pipeline — so the
  // long s-maxage is safe.
  res.setHeader(
    'Cache-Control',
    'public, s-maxage=604800, stale-while-revalidate=86400'
  );
  res.end(JSON.stringify(payload));
}

function sendFallback(res: ServerResponse) {
  // Dark default — the client treats brightness=0 as "use white text".
  sendSuccess(res, { brightness: 0, dominantColor: { r: 0, g: 0, b: 0 } });
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

// sRGB → linear RGB. WCAG 2.x relative-luminance transfer function.
function srgbToLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
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
    if (!target) return sendFallback(res);

    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return sendFallback(res);
    }
    if (parsed.protocol !== 'https:') return sendFallback(res);
    if (!isAllowedHost(parsed.hostname)) return sendFallback(res);

    const buf = await fetchImageBuffer(target);
    if (!buf) return sendFallback(res);

    // Crop to the BOTTOM 40% of the banner before averaging — that's the
    // region the display-name + @username actually sit on. Strip alpha so
    // transparent PNGs don't bleed luminance toward black via
    // pre-multiplication. `raw()` returns the bytes directly so we don't
    // pay an encode round-trip.
    const meta = await sharp(buf).metadata();
    const w = Math.max(1, meta.width || 1);
    const h = Math.max(1, meta.height || 1);
    const cropTop = Math.floor(h * 0.6);
    const cropHeight = Math.max(1, h - cropTop);

    const pixel = await sharp(buf)
      .removeAlpha()
      .extract({ left: 0, top: cropTop, width: w, height: cropHeight })
      .resize(1, 1, { fit: 'cover' })
      .raw()
      .toBuffer();

    if (pixel.length < 3) return sendFallback(res);

    const r = pixel[0];
    const g = pixel[1];
    const b = pixel[2];

    // sRGB-correct relative luminance, normalised 0..1.
    const luminance =
      0.2126 * srgbToLinear(r) +
      0.7152 * srgbToLinear(g) +
      0.0722 * srgbToLinear(b);
    const clamped = Math.max(0, Math.min(1, luminance));

    return sendSuccess(res, {
      brightness: clamped,
      dominantColor: { r, g, b },
    });
  } catch {
    return sendFallback(res);
  }
}
