import React, { memo, useState, useRef } from 'react';
import { Image, ImageProps, ImageStyle, StyleProp, View, Animated } from 'react-native';

/**
 * CachedImage — wraps React Native Image with:
 * 1. Aggressive iOS disk caching (cache: 'force-cache')
 * 2. Blur placeholder that fades out when image loads
 * 3. Smooth fade-in animation on load
 */
interface CachedImageProps extends Omit<ImageProps, 'source'> {
  uri: string | undefined | null;
  style?: StyleProp<ImageStyle>;
}

export const CachedImage = memo(function CachedImage({ uri, style, ...props }: CachedImageProps) {
  if (!uri) return null;

  const [loaded, setLoaded] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const handleLoad = () => {
    setLoaded(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={[style as any, { overflow: 'hidden' }]}>
      {/* Blur placeholder — shown until image loads */}
      {!loaded && (
        <View
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(200, 180, 160, 0.15)',
            borderRadius: 12,
          }}
        />
      )}
      {/* Actual image with fade-in */}
      <Animated.Image
        source={{ uri, cache: 'force-cache' }}
        style={[
          { width: '100%', height: '100%' },
          { opacity: fadeAnim },
        ]}
        onLoad={handleLoad}
        {...props}
      />
    </View>
  );
});
