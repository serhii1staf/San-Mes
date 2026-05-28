import React, { memo } from 'react';
import { Image, ImageProps, ImageStyle, StyleProp } from 'react-native';

/**
 * CachedImage — wraps React Native Image with aggressive caching.
 * On iOS, uses 'force-cache' to serve from disk cache when offline.
 * Falls back gracefully if image can't be loaded.
 */
interface CachedImageProps extends Omit<ImageProps, 'source'> {
  uri: string | undefined | null;
  style?: StyleProp<ImageStyle>;
}

export const CachedImage = memo(function CachedImage({ uri, style, ...props }: CachedImageProps) {
  if (!uri) return null;

  return (
    <Image
      source={{
        uri,
        cache: 'force-cache', // iOS: use disk cache even when offline
      }}
      style={style}
      {...props}
    />
  );
});
