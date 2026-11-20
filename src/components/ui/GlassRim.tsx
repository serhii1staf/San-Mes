/**
 * The light of a glass edge, for surfaces that cannot have Apple's liquid glass (iOS before 26, the
 * liquid-glass toggle off, Android).
 *
 * This is glisse's rim (https://glisse.kelvinzhang.ca, MIT), not an approximation of it: the images in
 * assets/glass/ are its `rimMap`, drawn by scripts/gen-glass-maps.mjs with its formulas and constants —
 * a band about 1.2 pt wide just inside the edge, lit where the edge faces the light's diagonal (full on
 * the straight sides and the top-left and bottom-right curves, fading out towards the other two). The
 * shine is 1, the setting of the clear `<Glass>` that was asked for (bend 1, dispersion 2, frost 0.5px,
 * rim 1), so it is the same white line on both themes.
 *
 * What glisse also does and this cannot: bend the content behind the glass. glisse needs a backdrop
 * filter, or a backdrop it repaints itself in WebGL, for that, and outside those it keeps exactly this,
 * the frost and the lit rim. On iOS 26 the native glass refracts.
 *
 * One image per shape, prerendered at @1x/@2x/@3x, so there is nothing to compute or rasterise at run
 * time: the GPU draws a texture.
 */
import React, { memo } from 'react';
import { Image, StyleSheet, type ImageSourcePropType } from 'react-native';

export type GlassRimShape = 'bar' | 'capsule' | 'dial';

const RIMS: Record<GlassRimShape, ImageSourcePropType> = {
  // The tab bar's main capsule, 171 x 60 inside its border.
  bar: require('../../../assets/glass/rim-bar.png'),
  // The detached profile capsule, 59 x 59 inside its border.
  capsule: require('../../../assets/glass/rim-capsule.png'),
  // The quick-dial buttons above the profile capsule, 49 x 49 inside their border.
  dial: require('../../../assets/glass/rim-dial.png'),
};

export const GlassRim = memo(function GlassRim({ shape }: { shape: GlassRimShape }) {
  return (
    <Image
      source={RIMS[shape]}
      style={StyleSheet.absoluteFill}
      resizeMode="stretch"
      // Android fades a newly loaded image in over 300 ms by default; a rim should simply be there.
      fadeDuration={0}
      accessible={false}
    />
  );
});
