import React, { memo, useState, useEffect, useRef } from 'react';
import { ImageStyle, StyleProp, StyleSheet, View } from 'react-native';
import { Image, ImageLoadEventData, ImageErrorEventData } from 'expo-image';
import { perfMonitor } from '../../services/perfMonitor';
import { useSettingsStore } from '../../store/settingsStore';
import Skeleton from './Skeleton';

// ─────────────────────────────────────────────────────────────────────────────
// Image proxy via images.weserv.nl
//
// Why: we sit on Supabase Free, which caps cached egress at 5 GB/month. Since
// only a handful of unique images exist in Storage but they are downloaded
// many times by every client, almost the entire egress bill is "the same
// 60 MB of images served thousands of times". By prepending a free public
// proxy that lives behind Cloudflare's CDN we move that fan-out off Supabase
// entirely: weserv fetches each image from Supabase ONCE, then serves
// every subsequent request from Cloudflare's edge, optimized to the size
// the device actually displays and re-encoded as WebP.
//
// This is a non-destructive change — the original URLs in the database are
// untouched. If anything ever goes wrong with weserv we just stop wrapping.
// ─────────────────────────────────────────────────────────────────────────────

const PROXY_HOST = 'https://images.weserv.nl';
const MAX_PROXY_WIDTH = 1200; // hard cap so giant fullscreen viewers don't pull megabytes
const DEFAULT_PROXY_WIDTH = 800;
// Retina-sharp display. (An earlier 1.4 experiment to cut decode cost made
// photos look noticeably soft — and it did NOT fix the chat lag, which comes
// from heavy bubble MOUNTS, not image decode. So quality is restored to 2×.)
const DPR = 2;

/**
 * Wrap a remote image URL in the public images.weserv.nl proxy so that:
 *   - the file is downloaded from origin (Supabase Storage) at most once;
 *   - subsequent requests hit Cloudflare's CDN edge, not Supabase;
 *   - the response is resized to the device's actual display size;
 *   - the response is re-encoded as WebP at quality 70 (typically 30–60% smaller).
 *
 * Falls through to the original URL when:
 *   - the URI is local (file://, asset://, data:, etc.);
 *   - the URI is already wrapped in the proxy;
 *   - the URI is a signed/private URL (weserv can't see it).
 */
export function proxiedImageUrl(uri: string, displayWidth?: number): string {
  if (!uri || typeof uri !== 'string') return uri;
  if (!uri.startsWith('http')) return uri;
  if (uri.indexOf('images.weserv.nl') !== -1) return uri;
  // Private / signed URLs — weserv usually can't fetch them, and the per-request
  // signature defeats caching. EXCEPTION: legacy Amazon S3 photos
  // (*.amazonaws.com) are proxied ANYWAY. Reopened photo chats surface these as
  // full-resolution decodes (~300 ms UI-thread stalls — the "БАМ, freeze" in
  // photo-heavy chats) precisely because the signature made them skip the
  // downscaling proxy. weserv fetches the signed URL as-is (valid until expiry)
  // and returns a display-sized WebP, so the on-device decode drops to a few ms.
  // If weserv can't fetch it, CachedImage's onError handler falls back to the
  // ORIGINAL signed URL — so this can only ever be faster, never break loading.
  const isS3 = uri.indexOf('.amazonaws.com') !== -1;
  if (!isS3 && (uri.indexOf('token=') !== -1 || uri.indexOf('Signature=') !== -1)) return uri;
  // GIFs must not be proxied: weserv re-encodes to WebP by default and
  // animations get flattened to the first frame. Sending output=gif keeps
  // them animated but breaks decoding on some devices, so we just skip the
  // proxy entirely and serve the original URL — the upstream is fast enough
  // for the small number of GIFs in chat.
  const lower = uri.toLowerCase();
  const qIdx = lower.indexOf('?');
  const path = qIdx >= 0 ? lower.slice(0, qIdx) : lower;
  if (path.endsWith('.gif')) return uri;

  const stripped = uri.replace(/^https?:\/\//, '');
  const w = displayWidth && displayWidth > 0
    ? Math.min(MAX_PROXY_WIDTH, Math.round(displayWidth * DPR))
    : DEFAULT_PROXY_WIDTH;
  return `${PROXY_HOST}/?url=${encodeURIComponent(stripped)}&w=${w}&output=webp&q=70`;
}

/**
 * Prefetch a batch of remote images into expo-image's disk+memory cache so they
 * appear instantly when the user scrolls to them (Telegram-style). Cheap, fire-
 * and-forget, deduped by expo-image internally.
 *
 * Routed through the proxy at a feed-card-friendly width so we warm the *small*
 * versions, not the originals — keeps the egress saving consistent with the
 * actual displayed size.
 *
 * `displayWidth` lets a caller warm the EXACT width its target screen will
 * request, so the warmed bytes share an expo-image cache key with the real
 * mount (a warm at 600 that gets displayed at 270 produces a different proxy
 * URL and therefore a guaranteed cache MISS — wasted egress + a cold fetch on
 * open). Defaults to the feed-card width (600) so existing callers (feed
 * heroes, profile banner, link-preview thumbs) are byte-for-byte unchanged.
 *
 * `cachePolicy` controls HOW much work the warm does:
 *   - `'memory-disk'` (default) — download AND DECODE into the in-memory
 *     bitmap cache. Instant on render, but the decode is expensive (esp. for
 *     animated GIFs) and front-loads CPU/memory the moment we warm. Kept as
 *     the default so every existing caller behaves byte-for-byte as before.
 *   - `'disk'` — download to disk ONLY, no decode. Saves just the network
 *     round-trip; the (cheap-once-cached) decode then happens lazily when a
 *     VISIBLE image actually mounts. This is what the chat-open and
 *     messages-tab warm paths use so warming never triggers a decode storm
 *     off-screen. `'disk'` is a supported `Image.prefetch` cache policy in
 *     expo-image SDK 54 (see `ImagePrefetchOptions.cachePolicy`).
 */
export function prefetchImages(
  uris: (string | null | undefined)[],
  displayWidth: number = 600,
  cachePolicy: 'disk' | 'memory-disk' | 'memory' = 'memory-disk',
): void {
  const list = uris
    .filter((u): u is string => !!u && u.startsWith('http'))
    .slice(0, 30)
    .map((u) => proxiedImageUrl(u, displayWidth));
  if (list.length === 0) return;
  try { Image.prefetch(list, { cachePolicy }); } catch {}
}

/**
 * CachedImage — uses expo-image for native disk caching (like Telegram), and
 * automatically routes remote URLs through the weserv image proxy so every
 * client request after the first hits Cloudflare's CDN instead of Supabase.
 *
 * Features:
 * - memory + disk cache so images stay instant when re-entering a screen
 * - automatic resize to the actual display size (huge egress saving)
 * - short fade only on the very first load
 * - minimal re-renders (memo)
 *
 * Optional `proxyWidth` lets a caller force a specific proxy width when the
 * `style.width` is non-numeric (e.g. '100%') — useful for full-bleed cards.
 * Pass `noProxy` to opt out (e.g. for fullscreen zoomable viewers that want
 * the highest resolution available).
 */
interface CachedImageProps {
  uri: string | undefined | null;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'fill' | 'center';
  proxyWidth?: number;
  noProxy?: boolean;
  /**
   * Animation control for animated images (GIF/WebP). When the caller passes
   * `false` we both set expo-image's `autoplay={false}` AND imperatively call
   * `stopAnimating()` — toggling the prop alone does not reliably halt an
   * already-running animation. Used by the chat list to pause GIFs that
   * scroll off-screen so the UI thread isn't decoding frames the user can't
   * see. Leave undefined everywhere else (zero added cost — no ref/effect).
   */
  autoplay?: boolean;
  /**
   * Fired once when the underlying expo-image finishes loading, carrying the
   * decoded source dimensions in `event.source.{width,height}`. Forwarded
   * through after our perf-monitor instrumentation runs (see the wrapper in
   * `onLoad` below). Callers use this to size a card to the image's natural
   * aspect ratio. Typed explicitly so consumers get the dimension payload.
   */
  onLoad?: (event: ImageLoadEventData) => void;
  /** Forwarded after our proxy-fallback + gauge-release runs. */
  onError?: (event: ImageErrorEventData) => void;
  /**
   * OPT-IN shimmer placeholder. When omitted/falsy (the default for every
   * existing caller) the rendered output is byte-for-byte unchanged — the
   * `<Image>` is the single returned node with identical props, no wrapper.
   *
   * When `true`, the image is wrapped in a container that flattens the
   * caller's `style` (width/height/aspectRatio/margin/position/borderRadius
   * all apply to the container exactly as they did to the image) and the
   * image fades in over a `<Skeleton>` shimmer that is removed once the image
   * has loaded. All existing Image props/behaviour are preserved on the inner
   * image.
   */
  skeleton?: boolean;
  [key: string]: any;
}

export const CachedImage = memo(function CachedImage({
  uri,
  style,
  resizeMode = 'cover',
  proxyWidth,
  noProxy,
  autoplay,
  skeleton,
  ...props
}: CachedImageProps) {
  // Reset proxy-failure state when the source URL changes — otherwise a row
  // recycled in a list would keep falling back forever after a single bad URL.
  const [proxyFailed, setProxyFailed] = useState(false);
  useEffect(() => { setProxyFailed(false); }, [uri]);

  // OPT-IN skeleton reveal: track whether the image has loaded so the shimmer
  // overlay can be removed once it has. Reset to false whenever the source URL
  // changes — mirrors the `proxyFailed` reset so a recycled row re-shows its
  // shimmer for the new image. These hooks run unconditionally (and before the
  // `if (!uri) return null` early return) so hook order/count stays identical
  // for skeleton and non-skeleton callers alike.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(false); }, [uri]);

  // Imperative handle to the underlying expo-image, used only when the caller
  // opts into animation control via the `autoplay` prop. expo-image exposes
  // start/stopAnimating() on the component ref.
  const imageRef = useRef<{ startAnimating?: () => Promise<void>; stopAnimating?: () => Promise<void> } | null>(null);
  useEffect(() => {
    // No-op for the overwhelming majority of callers that never pass
    // `autoplay` — keeps the cost at a single undefined check.
    if (autoplay === undefined) return;
    const ref = imageRef.current;
    if (!ref) return;
    try {
      // expo-image's start/stopAnimating() are ASYNC (return a Promise). When
      // the underlying native ImageView has already been torn down — e.g. the
      // row unmounted during fast navigation (messages ↔ chat) — the native
      // call rejects with "Unable to find the 'ImageView' view with tag …".
      // A synchronous try/catch can't catch that async rejection, so we MUST
      // attach a .catch() or it surfaces as an unhandled promise rejection
      // (the Sentry `startAnimating`/`stopAnimating` errors).
      const p = autoplay ? ref.startAnimating?.() : ref.stopAnimating?.();
      if (p && typeof (p as any).catch === 'function') (p as any).catch(() => {});
    } catch {
      // Static images have no animation to control; ignore.
    }
  }, [autoplay]);

  // Perf-monitor instrumentation. Counts in-flight decodes via the
  // pendingDecodes gauge and records the URI→onLoad latency per host so the
  // panel can surface "8 image bitmaps decoded while you scrolled the
  // profile". `decodeStart` is the timestamp at which the URI prop changed;
  // `pendingHere` tracks whether THIS instance currently owns a pending
  // increment so we don't double-decrement on uri churn or unmount races.
  //
  // The hot path here (URI change, onLoad, onError) is gated on the
  // monitor-enabled flag at the call site so the disabled case skips the
  // method-call and increment entirely. ~50 image loads/sec during a fast
  // scroll need to add 0 ms when the monitor is off, which this gate
  // guarantees.
  const decodeStart = useRef(0);
  const pendingHere = useRef(false);
  useEffect(() => {
    if (!uri) return;
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    decodeStart.current = Date.now();
    perfMonitor.incrementPendingDecodes();
    pendingHere.current = true;
    return () => {
      // The URI changed (or this CachedImage is unmounting) before onLoad/
      // onError fired. Release the gauge so the count doesn't drift.
      if (pendingHere.current) {
        perfMonitor.decrementPendingDecodes();
        pendingHere.current = false;
      }
    };
  }, [uri]);

  if (!uri) return null;

  let finalUri = uri;
  if (!noProxy && !proxyFailed) {
    const flat = StyleSheet.flatten(style) as ImageStyle | undefined;
    const styleW = typeof flat?.width === 'number' ? flat.width : undefined;
    finalUri = proxiedImageUrl(uri, proxyWidth ?? styleW);
  }

  // Honour any external onLoad while still firing our instrumentation hook.
  // Pulling it out of `props` keeps the spread below from clobbering the
  // wrapper we install.
  const externalOnLoad = (props as any).onLoad as
    | ((event: any) => void)
    | undefined;
  const externalOnError = (props as any).onError as
    | ((event: any) => void)
    | undefined;
  const restProps: any = { ...props };
  delete restProps.onLoad;
  delete restProps.onError;

  // Factored handlers so BOTH the default and skeleton paths share the exact
  // same perf-monitor instrumentation + proxy-fallback behaviour. In the
  // skeleton path `handleLoad` additionally flips `loaded` to reveal the image
  // and tear down the shimmer overlay.
  const handleLoad = (e: ImageLoadEventData) => {
    // Perf-monitor: per-host load latency + release the gauge. Gated
    // here at the call site so the disabled case skips the function
    // call entirely.
    if (
      pendingHere.current &&
      useSettingsStore.getState().perfMonitorEnabled
    ) {
      perfMonitor.markImageDecode(uri, Date.now() - decodeStart.current);
      perfMonitor.decrementPendingDecodes();
      pendingHere.current = false;
    }
    if (skeleton) setLoaded(true);
    externalOnLoad?.(e);
  };

  const handleError = (e: ImageErrorEventData) => {
    if (!noProxy && !proxyFailed && finalUri !== uri) {
      setProxyFailed(true);
    }
    // Release the in-flight decode counter on error too — otherwise a
    // single broken URL would pin the gauge at +1 forever.
    if (pendingHere.current) {
      perfMonitor.decrementPendingDecodes();
      pendingHere.current = false;
    }
    externalOnError?.(e);
  };

  // ── OPT-IN skeleton path ──────────────────────────────────────────────────
  // Wrap the SAME image in a container that takes the caller's flattened style
  // (so width/height/aspectRatio/margin/position/borderRadius land on the
  // container exactly as they did on the image) and reveal it over a shimmer.
  // The inner Image keeps every prop it has in the default path — the
  // container does not swallow any of them. `imageRef` still points at the
  // inner Image so the autoplay effect keeps working.
  if (skeleton) {
    const flattenedStyle = StyleSheet.flatten(style);
    return (
      <View style={[flattenedStyle, { overflow: 'hidden' }]}>
        <Image
          ref={imageRef as any}
          source={{ uri: finalUri }}
          style={StyleSheet.absoluteFill}
          autoplay={autoplay}
          contentFit={resizeMode === 'contain' ? 'contain' : resizeMode === 'fill' ? 'fill' : 'cover'}
          cachePolicy="memory-disk"
          transition={0}
          recyclingKey={uri}
          onLoad={handleLoad}
          onError={handleError}
          {...restProps}
        />
        {!loaded && (
          <Skeleton
            width={'100%'}
            height={'100%'}
            radius={0}
            style={StyleSheet.absoluteFill}
          />
        )}
      </View>
    );
  }

  // ── Default path ────────────────────────────────────────────────────────
  // Byte-for-byte identical to the original: the <Image> is the single
  // returned node, with the same props in the same order. No wrapper.
  return (
    <Image
      ref={imageRef as any}
      source={{ uri: finalUri }}
      style={style}
      // Pass through animation control when the caller opts in; undefined
      // leaves expo-image at its default (autoplay on).
      autoplay={autoplay}
      contentFit={resizeMode === 'contain' ? 'contain' : resizeMode === 'fill' ? 'fill' : 'cover'}
      // Keep decoded images in memory AND on disk → re-entering a chat shows
      // them instantly with no black flash or re-download.
      cachePolicy="memory-disk"
      // No fade transition: the fade ran on every component mount, so when
      // a screen unmounts and remounts (tab switching, list virtualisation
      // recycling) the user perceived it as the image "re-loading" — even
      // though the bytes were served from cache. Showing the cached frame
      // instantly removes that flicker entirely.
      transition={0}
      // Recycling key is tied to the ORIGINAL URI, never the proxied form.
      // Otherwise a proxy fallback (proxy → original) would re-key the
      // image and force expo-image to drop its cached bitmap, manifesting
      // as a brief reload when switching tabs / scrolling lists.
      recyclingKey={uri}
      onLoad={handleLoad}
      onError={handleError}
      {...restProps}
    />
  );
});
