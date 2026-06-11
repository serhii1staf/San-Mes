import React, { memo, useState, useEffect } from 'react';
import { ImageStyle, StyleProp, StyleSheet } from 'react-native';
import { Image } from 'expo-image';

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
  // Private / signed URLs — weserv can't fetch them, and the per-request
  // signature would defeat caching anyway.
  if (uri.indexOf('token=') !== -1 || uri.indexOf('Signature=') !== -1) return uri;

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
 */
export function prefetchImages(uris: (string | null | undefined)[]): void {
  const list = uris
    .filter((u): u is string => !!u && u.startsWith('http'))
    .slice(0, 30)
    .map((u) => proxiedImageUrl(u, 600));
  if (list.length === 0) return;
  try { Image.prefetch(list, { cachePolicy: 'memory-disk' }); } catch {}
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
  [key: string]: any;
}

export const CachedImage = memo(function CachedImage({
  uri,
  style,
  resizeMode = 'cover',
  proxyWidth,
  noProxy,
  ...props
}: CachedImageProps) {
  // Reset proxy-failure state when the source URL changes — otherwise a row
  // recycled in a list would keep falling back forever after a single bad URL.
  const [proxyFailed, setProxyFailed] = useState(false);
  useEffect(() => { setProxyFailed(false); }, [uri]);

  if (!uri) return null;

  let finalUri = uri;
  if (!noProxy && !proxyFailed) {
    const flat = StyleSheet.flatten(style) as ImageStyle | undefined;
    const styleW = typeof flat?.width === 'number' ? flat.width : undefined;
    finalUri = proxiedImageUrl(uri, proxyWidth ?? styleW);
  }

  return (
    <Image
      source={{ uri: finalUri }}
      style={style}
      contentFit={resizeMode === 'contain' ? 'contain' : resizeMode === 'fill' ? 'fill' : 'cover'}
      // Keep decoded images in memory AND on disk → re-entering a chat shows
      // them instantly with no black flash or re-download.
      cachePolicy="memory-disk"
      // Reuse the cached frame immediately; only fade the first time.
      transition={120}
      recyclingKey={finalUri}
      // If the proxy fails (e.g. weserv can't fetch a private/odd host), fall
      // back to the original URL so the image still loads. Without this any
      // URL the proxy can't see (private buckets, signed URLs, less-common
      // CDNs in unfurl thumbnails) silently shows nothing.
      onError={() => {
        if (!noProxy && !proxyFailed && finalUri !== uri) {
          setProxyFailed(true);
        }
      }}
      {...props}
    />
  );
});
