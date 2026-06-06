import React, { memo } from 'react';
import { ImageStyle, StyleProp } from 'react-native';
import { Image } from 'expo-image';

/**
 * CachedImage — uses expo-image for native disk caching (like Telegram).
 * Features:
 * - memory + disk cache so images stay instant when re-entering a screen
 *   (no black flash / reload on navigation back and forth)
 * - short fade only on the very first load
 * - minimal re-renders (memo)
 */
interface CachedImageProps {
  uri: string | undefined | null;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'fill' | 'center';
  [key: string]: any;
}

export const CachedImage = memo(function CachedImage({ uri, style, resizeMode = 'cover', ...props }: CachedImageProps) {
  if (!uri) return null;

  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit={resizeMode === 'contain' ? 'contain' : resizeMode === 'fill' ? 'fill' : 'cover'}
      // Keep decoded images in memory AND on disk → re-entering a chat shows
      // them instantly with no black flash or re-download.
      cachePolicy="memory-disk"
      // Reuse the cached frame immediately; only fade the first time.
      transition={120}
      recyclingKey={uri}
      {...props}
    />
  );
});
