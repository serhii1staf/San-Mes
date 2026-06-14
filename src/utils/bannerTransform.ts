/**
 * Banner transform encoding.
 *
 * Profile banners are stored in Supabase as a single `banner_url` string —
 * no schema for offset / scale exists. Rather than migrate the table, the
 * interactive banner editor encodes the position + zoom inside the URL's
 * hash fragment:
 *
 *   https://media.san-m-app.com/banner/abc.jpg#x=-40&y=20&s=1.4
 *
 * The fragment is invisible to HTTP servers (browsers strip `#...` before
 * sending), so the same URL still resolves to the same image on the wire.
 * The image proxy (`proxiedImageUrl` in CachedImage.tsx) does not see the
 * hash because callers strip it before requesting; display code reads
 * the parsed transform back via `parseBannerTransform()` and applies it
 * to the rendered `<CachedImage>` via React Native's `style.transform`.
 *
 * Backward compatibility: existing banners stored without a hash parse to
 * the identity transform `(0, 0, 1)` so they render exactly as before.
 *
 * Maintainers: do NOT strip the hash from `banner_url` before persisting,
 * and do NOT pass the URL with hash through the image proxy — always call
 * `stripBannerTransform()` first.
 */

export interface BannerTransform {
  /** Horizontal offset in points, applied AFTER cover-fit scaling. */
  translateX: number;
  /** Vertical offset in points, applied AFTER cover-fit scaling. */
  translateY: number;
  /** Multiplicative scale on top of cover-fit. Clamped 1.0–3.0. */
  scale: number;
}

export const IDENTITY_BANNER_TRANSFORM: BannerTransform = Object.freeze({
  translateX: 0,
  translateY: 0,
  scale: 1,
}) as BannerTransform;

const MIN_SCALE = 1;
const MAX_SCALE = 3;
// Translation is clamped at parse-time only as a sanity guard against
// corrupted hashes; the editor itself applies a more realistic limit
// based on the current zoom level.
const MAX_TRANSLATE = 1000;

function clampScale(s: number): number {
  if (!Number.isFinite(s)) return 1;
  if (s < MIN_SCALE) return MIN_SCALE;
  if (s > MAX_SCALE) return MAX_SCALE;
  return s;
}

function clampTranslate(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < -MAX_TRANSLATE) return -MAX_TRANSLATE;
  if (v > MAX_TRANSLATE) return MAX_TRANSLATE;
  return v;
}

/**
 * Strip the hash fragment from a banner URL. Returns the URL safe to
 * pass to image proxies / network fetches. Never strips query params.
 */
export function stripBannerTransform(url: string | null | undefined): string | null {
  if (!url) return null;
  const hashIndex = url.indexOf('#');
  return hashIndex === -1 ? url : url.slice(0, hashIndex);
}

/**
 * Read a banner transform out of a URL's hash. Missing hash, missing
 * keys, NaN values and out-of-range scales all collapse to safe
 * defaults — never throws, always returns a usable transform.
 */
export function parseBannerTransform(url: string | null | undefined): BannerTransform {
  if (!url) return { ...IDENTITY_BANNER_TRANSFORM };
  const hashIndex = url.indexOf('#');
  if (hashIndex === -1 || hashIndex === url.length - 1) {
    return { ...IDENTITY_BANNER_TRANSFORM };
  }
  const hash = url.slice(hashIndex + 1);
  const params: Record<string, string> = {};
  for (const part of hash.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    params[key] = val;
  }
  const x = parseFloat(params.x ?? '0');
  const y = parseFloat(params.y ?? '0');
  const s = parseFloat(params.s ?? '1');
  return {
    translateX: clampTranslate(x),
    translateY: clampTranslate(y),
    scale: clampScale(s),
  };
}

/**
 * Serialize a transform onto a base URL. The base may already carry a
 * hash — it gets replaced. Identity transforms produce a hash-free URL
 * so existing banners that were never re-positioned stay byte-identical
 * to what they were before this feature shipped.
 */
export function serializeBannerTransform(baseUrl: string, transform: BannerTransform): string {
  const clean = stripBannerTransform(baseUrl);
  if (!clean) return baseUrl;
  const x = Math.round((transform.translateX || 0) * 100) / 100;
  const y = Math.round((transform.translateY || 0) * 100) / 100;
  const s = Math.round(clampScale(transform.scale || 1) * 1000) / 1000;
  const isIdentity = x === 0 && y === 0 && Math.abs(s - 1) < 0.001;
  if (isIdentity) return clean;
  return `${clean}#x=${x}&y=${y}&s=${s}`;
}

/**
 * Convenience: produce a React Native `style.transform` array suitable
 * for spreading directly into `<Image style={{ transform: [...] }} />`.
 * Argument order is translate then scale so cover-fitted pixels move
 * first (in their original frame) and then magnify around the centre.
 */
export function bannerTransformToStyle(transform: BannerTransform): {
  transform: ({ translateX: number } | { translateY: number } | { scale: number })[];
} {
  return {
    transform: [
      { translateX: transform.translateX },
      { translateY: transform.translateY },
      { scale: transform.scale },
    ],
  };
}
