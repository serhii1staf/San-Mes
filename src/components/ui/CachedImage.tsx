import React, { memo } from 'react';
import { ImageStyle, StyleProp } from 'react-native';
import { Image } from 'expo-image';

/**
 * CachedImage — uses expo-image for native disk caching (like Telegram).
 * Features:
 * - Automatic disk + memory cache
 * - Blurhash placeholders
 * - Progressive loading
 * - Minimal re-renders (memo)
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
      transition={200}
      recyclingKey={uri}
      {...props}
    />
  );
});
