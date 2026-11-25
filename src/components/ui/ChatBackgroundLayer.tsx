/**
 * ChatBackgroundLayer
 * -------------------
 * Renders the chat wallpaper for both the live chat screen and the
 * settings/chat-* preview modals. Accepts either:
 *
 *   - A regular image URI (file://, https://, content://, ph://) — rendered
 *     via expo-image (CachedImage) so we get caching + WebP optimisation.
 *
 *   - `preset:image:<id>`: one of the bundled wallpapers (BUNDLED_CHAT_BACKGROUNDS), the
 *     presets offered in Settings → Chat background.
 *
 *   - `preset:gradient:<from>:<to>` where <from> and <to> are 6-digit hex
 *     colours WITHOUT the leading `#` — so they don't collide with URL
 *     fragment parsing. Rendered as a LinearGradient. The previous presets;
 *     no longer offered, still rendered for chats that have one set.
 *
 * The chat screen previously read `backgroundImage` directly into an
 * <ImageBackground/>; centralising the lookup here means we only need to
 * teach ONE place about preset URIs, and both the preview and the real
 * chat render look identical.
 */

import React from 'react';
import { ViewStyle, StyleProp, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { CachedImage } from './CachedImage';

interface ChatBackgroundLayerProps {
  uri?: string;
  style?: StyleProp<ViewStyle>;
  /** Width hint passed to the image proxy for non-preset URIs. */
  proxyWidth?: number;
  /**
   * For a GIF wallpaper: whether it plays now. `false` holds it on the current frame. The chat
   * passes false while the list scrolls, while the keyboard moves, while another screen is on top,
   * and in Low Power Mode or with Reduce Motion. Ignored for still images.
   */
  animate?: boolean;
}

/** A GIF, by extension or by host. Same test as the chat's and the profile's. */
export function isAnimatedUri(u: string): boolean {
  return /\.gif(\?|$)/i.test(u) || /giphy\.com|tenor\.com/i.test(u);
}

/**
 * The proxy width for a GIF wallpaper, in points (the proxy doubles it for density): 720 px wide.
 *
 * A wallpaper decodes every frame at the size it was fetched, for as long as the chat is open.
 * Fetched at the 800 pt default it came back 1200 px wide, about 2.6 MB of pixels per frame on a
 * tall phone, decoded continuously behind the messages. At 720 px it is about a third of that,
 * and behind a column of bubbles the difference in sharpness does not show.
 */
const GIF_WALLPAPER_PROXY_W = 360;

/**
 * The bundled wallpapers offered in Settings → Chat background, in the order shown there. Each is
 * stored as `preset:image:<id>`, so the id must never change once shipped: it is what a chat's
 * saved setting points at. Files in assets/chat-backgrounds/ (the owner's own images, unchanged).
 */
export const BUNDLED_CHAT_BACKGROUNDS: readonly { id: string; source: number }[] = [
  { id: 'doodle-1', source: require('../../../assets/chat-backgrounds/doodle-1.webp') },
  { id: 'doodle-2', source: require('../../../assets/chat-backgrounds/doodle-2.webp') },
  { id: 'doodle-3', source: require('../../../assets/chat-backgrounds/doodle-3.webp') },
  { id: 'doodle-4', source: require('../../../assets/chat-backgrounds/doodle-4.webp') },
  { id: 'doodle-5', source: require('../../../assets/chat-backgrounds/doodle-5.webp') },
];

export function buildPresetImageUri(id: string): string {
  return `preset:image:${id}`;
}

/** The bundled image a `preset:image:<id>` URI points at, or null. */
export function parsePresetImageUri(uri: string): number | null {
  if (!uri.startsWith('preset:image:')) return null;
  const id = uri.slice('preset:image:'.length);
  return BUNDLED_CHAT_BACKGROUNDS.find((b) => b.id === id)?.source ?? null;
}

/** True iff the URI is one of the `preset:` pseudo-URIs (a gradient or a bundled image). */
export function isPresetUri(uri: string): boolean {
  return uri.startsWith('preset:');
}

/** Build a preset URI from two hex colour strings (with or without `#`). */
export function buildPresetGradientUri(from: string, to: string): string {
  const a = from.replace(/^#/, '').toUpperCase();
  const b = to.replace(/^#/, '').toUpperCase();
  return `preset:gradient:${a}:${b}`;
}

/** Parse a preset URI. Returns null if the URI is malformed or not a preset. */
export function parsePresetUri(uri: string): { from: string; to: string } | null {
  if (!isPresetUri(uri)) return null;
  const parts = uri.split(':');
  // ['preset', 'gradient', fromHex, toHex]
  if (parts.length !== 4 || parts[1] !== 'gradient') return null;
  const from = parts[2];
  const to = parts[3];
  if (!/^[0-9A-F]{6}$/i.test(from) || !/^[0-9A-F]{6}$/i.test(to)) return null;
  return { from: `#${from}`, to: `#${to}` };
}

export function ChatBackgroundLayer({ uri, style, proxyWidth, animate }: ChatBackgroundLayerProps) {
  if (!uri) return null;

  // A bundled wallpaper: read from the app itself, no network, no proxy.
  const bundled = parsePresetImageUri(uri);
  if (bundled != null) {
    return (
      <Image
        source={bundled}
        style={[StyleSheet.absoluteFill, style as any]}
        contentFit="cover"
        transition={0}
        pointerEvents="none"
        accessible={false}
      />
    );
  }
  // A wallpaper that is no longer offered (an id removed from the list): show none rather than
  // sending a `preset:` string to the image loader.
  if (uri.startsWith('preset:image:')) return null;

  // Gradients are no longer offered, but a chat that already has one keeps it.
  const preset = parsePresetUri(uri);
  if (preset) {
    return (
      <LinearGradient
        colors={[preset.from, preset.to]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, style]}
        pointerEvents="none"
      />
    );
  }

  const animated = isAnimatedUri(uri);
  return (
    <CachedImage
      uri={uri}
      style={[StyleSheet.absoluteFill, style as any]}
      resizeMode="cover"
      proxyWidth={proxyWidth ?? (animated ? GIF_WALLPAPER_PROXY_W : 800)}
      // Only a GIF gets the prop: `autoplay` makes CachedImage start and stop the animation, which
      // a still image has none of.
      autoplay={animated ? animate !== false : undefined}
    />
  );
}
