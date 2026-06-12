/**
 * ChatBackgroundLayer
 * -------------------
 * Renders the chat wallpaper for both the live chat screen and the
 * settings/chat-* preview modals. Accepts either:
 *
 *   - A regular image URI (file://, https://, content://, ph://) — rendered
 *     via expo-image (CachedImage) so we get caching + WebP optimisation.
 *
 *   - A "preset" pseudo-URI of the form `preset:gradient:<from>:<to>` where
 *     <from> and <to> are 6-digit hex colours WITHOUT the leading `#` — so
 *     they don't collide with URL fragment parsing. Rendered as a
 *     LinearGradient. This lets us ship "bundled patterns" without bundling
 *     image assets.
 *
 * The chat screen previously read `backgroundImage` directly into an
 * <ImageBackground/>; centralising the lookup here means we only need to
 * teach ONE place about preset URIs, and both the preview and the real
 * chat render look identical.
 */

import React from 'react';
import { ViewStyle, StyleProp, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CachedImage } from './CachedImage';

interface ChatBackgroundLayerProps {
  uri?: string;
  style?: StyleProp<ViewStyle>;
  /** Width hint passed to the image proxy for non-preset URIs. */
  proxyWidth?: number;
}

/** True iff the URI follows the `preset:gradient:<from>:<to>` shape. */
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

export function ChatBackgroundLayer({ uri, style, proxyWidth }: ChatBackgroundLayerProps) {
  if (!uri) return null;

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

  return (
    <CachedImage
      uri={uri}
      style={[StyleSheet.absoluteFill, style as any]}
      resizeMode="cover"
      proxyWidth={proxyWidth ?? 800}
    />
  );
}
