// HeaderSceneLayer
// ----------------
// Read-only renderer for a user's "build-your-own" header decorations. Lays
// each item out by NORMALIZED (0..1) position within the card box using
// percentage left/top, so it renders identically on any device width without
// needing onLayout. Used on both the owner's profile and other users' profiles
// (the scene travels with the profile row). Purely presentational + memoized;
// pointerEvents are off so it never blocks taps on the content beneath.

import React, { memo } from 'react';
import { View, Text as RNText, StyleSheet } from 'react-native';
import { HeaderScene, BASE_ITEM_SIZE } from '../../services/headerScene';

interface Props {
  scene: HeaderScene | null | undefined;
  /** Render above (true) or below the frosted overlay. Default above. */
  style?: any;
}

function HeaderSceneLayerComponent({ scene, style }: Props) {
  if (!scene || scene.items.length === 0) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {scene.items.map((it) => {
        // Render the glyph at its REAL final size (fontSize), NOT via a
        // transform scale of a base-size glyph — scaling a rasterized emoji is
        // what made enlarged stickers look blurry/low-quality. Sizing the Text
        // itself rasterizes the glyph crisply at any size.
        const size = BASE_ITEM_SIZE * it.scale;
        return (
          <View
            key={it.id}
            style={{
              position: 'absolute',
              left: `${it.x * 100}%`,
              top: `${it.y * 100}%`,
              width: size,
              height: size,
              alignItems: 'center',
              justifyContent: 'center',
              transform: [
                { translateX: -size / 2 },
                { translateY: -size / 2 },
                { rotate: `${it.rotation}deg` },
              ],
            }}
          >
            <RNText allowFontScaling={false} style={{ fontSize: size * 0.82 }}>
              {it.value}
            </RNText>
          </View>
        );
      })}
    </View>
  );
}

export const HeaderSceneLayer = memo(HeaderSceneLayerComponent);
