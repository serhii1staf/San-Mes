import { useEffect, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import { kvGetJSONSync, kvSetJSON } from '../services/kvStore';
import { stripBannerTransform } from '../utils/bannerTransform';

// Adaptive-text-colour data hook for the profile banner.
//
// Returns the average luminance of the banner image as a number in
// 0.0 (dark) .. 1.0 (light), plus a derived `isLight` boolean using a
// 0.5 cutoff. Display code uses this to pick dark text on light banners
// and light text on dark banners so the name + @username always read
// against the surface they sit on.
//
// Why server-side luminance (not on-device):
//   React Native core ships no canvas API and no pixel-buffer access.
//   Computing brightness in JS would require bundling a PNG / JPEG
//   decoder (hundreds of KB) and burning CPU on every banner load.
//   The result is a single float per URL, so we fetch it from
//   /api/banner-brightness, which downsamples server-side and caches
//   the response at the CDN edge for a week. Repeat profile views pay
//   zero cost after the first hit anywhere on the network.
//
// Why brightness can be `null`:
//   For brand-new banners the server hasn't been hit yet, and for
//   "legacy" banners (network failure, bot blocking the host, anything
//   that returns 0) the hook short-circuits to `null`. The display
//   code treats that as "unknown" and renders the today-default
//   white-text-on-dark behaviour — graceful fallback, no flicker.
//
// Cache-key contract:
//   The MMKV key suffix is the URL with its `#x=&y=&s=` transform hash
//   stripped (via stripBannerTransform). Keying on the stripped URL
//   means a user re-positioning their banner doesn't invalidate the
//   brightness — repositioning never changes the pixels, only how they
//   render. Never include the hash in the cache key.

const API_ENDPOINT = 'https://san-m-app.com/api/banner-brightness';
const CACHE_KEY_PREFIX = '@san:banner_brightness:';

interface CacheEntry {
  brightness: number;
  fetchedAt: number;
}

interface UseBannerBrightnessResult {
  /** Average luminance 0..1, or null if not yet known. */
  brightness: number | null;
  /** True when the banner is light enough that dark text reads better. */
  isLight: boolean;
}

export function useBannerBrightness(
  bannerUrl: string | null | undefined
): UseBannerBrightnessResult {
  const stripped = stripBannerTransform(bannerUrl) || null;

  // Synchronous MMKV read on first render — instant first paint when
  // we've seen this banner before. No flash from white-text default
  // back to dark-text on a light banner.
  const [brightness, setBrightness] = useState<number | null>(() => {
    if (!stripped) return null;
    const cached = kvGetJSONSync<CacheEntry | null>(
      CACHE_KEY_PREFIX + stripped,
      null
    );
    if (cached && typeof cached.brightness === 'number') {
      return cached.brightness;
    }
    return null;
  });

  // Dedupe in-flight fetches per URL within a single mount. Without
  // this, a parent re-render that swaps `bannerUrl` to the same value
  // (referentially different but identical string) would fire a second
  // network request while the first was still in flight.
  const inFlightUrl = useRef<string | null>(null);
  // Guard against unmount race conditions before setState.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!stripped) {
      setBrightness(null);
      return;
    }
    // Already cached → setState above already covers it. Avoid
    // re-fetching: this is a content-addressed value that doesn't
    // change for a given URL.
    const cached = kvGetJSONSync<CacheEntry | null>(
      CACHE_KEY_PREFIX + stripped,
      null
    );
    if (cached && typeof cached.brightness === 'number') {
      if (mountedRef.current) setBrightness(cached.brightness);
      return;
    }
    if (inFlightUrl.current === stripped) return;
    inFlightUrl.current = stripped;

    // Defer the fetch until after the navigation transition into the
    // profile screen has settled — banner brightness is a polish
    // detail, not blocking anything, and it shouldn't compete with
    // the initial render for network or JS-thread time.
    const handle = InteractionManager.runAfterInteractions(async () => {
      try {
        const resp = await fetch(
          `${API_ENDPOINT}?url=${encodeURIComponent(stripped)}`
        );
        if (!resp.ok) {
          inFlightUrl.current = null;
          return;
        }
        const json: any = await resp.json();
        const value =
          typeof json?.brightness === 'number' ? json.brightness : null;
        if (value == null) {
          inFlightUrl.current = null;
          return;
        }
        // Persist before setState so a remount during the same session
        // hits the synchronous cache path.
        kvSetJSON(CACHE_KEY_PREFIX + stripped, {
          brightness: value,
          fetchedAt: Date.now(),
        } as CacheEntry);
        if (mountedRef.current) setBrightness(value);
      } catch {
        // swallow — `null` brightness produces the safe legacy default
      } finally {
        inFlightUrl.current = null;
      }
    });

    return () => {
      try {
        handle.cancel();
      } catch {}
    };
  }, [stripped]);

  const isLight = brightness != null && brightness >= 0.5;
  return { brightness, isLight };
}
