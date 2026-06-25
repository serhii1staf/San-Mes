// HeaderSceneLayer
// ----------------
// Read-only renderer for a user's "build-your-own" header decorations. Lays
// each item out by NORMALIZED (0..1) position within the card box using
// percentage left/top, so it renders identically on any device width without
// needing onLayout. Used on both the owner's profile and other users' profiles
// (the scene travels with the profile row). Purely presentational + memoized;
// pointerEvents are off so it never blocks taps on the content beneath.
//
// Each glyph renders via <StickerGlyph/> at its real font size (crisp at any
// scale) and runs its optional looping animation on the native thread.

import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { HeaderScene, BASE_ITEM_SIZE } from '../../services/headerScene';
import { StickerGlyph } from './StickerGlyph';

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
              transform: [{ translateX: -size / 2 }, { translateY: -size / 2 }],
            }}
          >
            <StickerGlyph value={it.value} size={size} rotation={it.rotation} anim={it.anim} />
          </View>
        );
      })}
    </View>
  );
}

export const HeaderSceneLayer = memo(HeaderSceneLayerComponent);
