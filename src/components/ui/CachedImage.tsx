import React, { memo, useState, useEffect, useRef } from 'react';
import { ImageStyle, StyleProp, StyleSheet } from 'react-native';
import { Image, ImageLoadEventData, ImageErrorEventData } from 'expo-image';
import { perfMonitor } from '../../services/perfMonitor';
import { useSettingsStore } from '../../store/settingsStore';

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
const DPR = 2; // device-pixel-ratio compensation so retina screens stay sharp

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
  [key: string]: any;
}

export const CachedImage = memo(function CachedImage({
  uri,
  style,
  resizeMode = 'cover',
  proxyWidth,
  noProxy,
  autoplay,
  ...props
}: CachedImageProps) {
  // Reset proxy-failure state when the source URL changes — otherwise a row
  // recycled in a list would keep falling back forever after a single bad URL.
  const [proxyFailed, setProxyFailed] = useState(false);
  useEffect(() => { setProxyFailed(false); }, [uri]);

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
      if (autoplay) ref.startAnimating?.();
      else ref.stopAnimating?.();
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
      onLoad={(e) => {
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
        externalOnLoad?.(e);
      }}
      // If the proxy fails (e.g. weserv can't fetch a private/odd host), fall
      // back to the original URL so the image still loads. Without this any
      // URL the proxy can't see (private buckets, signed URLs, less-common
      // CDNs in unfurl thumbnails) silently shows nothing.
      onError={(e) => {
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
      }}
      {...restProps}
    />
  );
});
