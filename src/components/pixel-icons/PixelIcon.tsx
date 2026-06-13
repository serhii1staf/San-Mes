/**
 * PixelIcon — thin wrapper around `expo-image` that resolves a
 * pixel-icon `id` from the bundled registry and renders the matching
 * 256x256 PNG at an arbitrary size.
 *
 * Why this lives in its own file:
 * - The registry (`registry.ts`) holds 70 `require()`s. Importing it
 *   from a feature surface drags every entry into that surface's
 *   chunk. Routing all consumers through this component lets the
 *   registry stay encapsulated behind a single id-keyed lookup.
 * - All consumers (home header, post-emoji pattern, chat-reply
 *   preview) share the same caching policy (`memory-disk`) and the
 *   same zero-transition fade — so when an icon is reused across
 *   surfaces it shows instantly the second time.
 *
 * The component bails out to `null` when the id is unknown — defensive
 * against stale persisted ids after a registry shuffle.
 */

import React, { memo } from 'react';
import type { ImageStyle, StyleProp } from 'react-native';
import { Image } from 'expo-image';
import { PIXEL_ICON_BY_ID } from './registry';

interface PixelIconProps {
  /** Stable registry id, e.g. `pack-1/01_ghost_king`. */
  id: string;
  /** Square edge length in px. The PNG is `contain`-fit inside. */
  size: number;
  /** Optional override (margin, opacity, etc.). Width/height set by
   *  this component take precedence — pass nothing layout-related. */
  style?: StyleProp<ImageStyle>;
}

function PixelIconBase({ id, size, style }: PixelIconProps) {
  const ic = PIXEL_ICON_BY_ID[id];
  if (!ic) return null;
  return (
    <Image
      source={ic.source}
      // `width` / `height` are the trump card for square sizing —
      // matches the pattern CachedImage uses elsewhere in the app.
      style={[{ width: size, height: size }, style]}
      contentFit="contain"
      // memory-disk lets the same icon flash instantly when it's
      // reused across the home header / a post pattern / a chat-reply
      // preview within the same session.
      cachePolicy="memory-disk"
      // No fade — the icons are tiny and a transition only ever made
      // them feel laggy on the picker grid.
      transition={0}
    />
  );
}

export const PixelIcon = memo(PixelIconBase);
