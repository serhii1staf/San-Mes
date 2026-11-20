/**
 * The light of a glass edge, for surfaces that cannot have Apple's liquid glass (iOS before 26, the
 * liquid-glass toggle off, Android). It sits on top of the surface's blur.
 *
 * This is glisse's rim (https://glisse.kelvinzhang.ca, MIT), not an approximation of it: the images in
 * assets/glass/ are its `rimMap`, drawn by scripts/gen-glass-maps.mjs with its formulas and constants —
 * a band about 1.2 pt wide just inside the edge, lit where the edge faces the light's diagonal (full on
 * the straight sides and the top-left and bottom-right curves, fading out towards the other two), at
 * shine 0.13 on a dark page and 0.3 on a light one. The previous rim here was an SVG of three
 * gradients made to look like that; it was asked to be replaced with the real thing.
 *
 * What glisse also does and this cannot: bend the content behind the glass. glisse needs a backdrop
 * filter or a backdrop it repaints itself in WebGL for that, and outside those it keeps exactly this,
 * "the frost and the lit rim". On iOS 26 the native glass refracts.
 *
 * One image per shape, prerendered at @1x/@2x/@3x, so there is nothing to compute or rasterise at run
 * time: the GPU draws a texture.
 */
import React, { memo } from 'react';
import { Image, StyleSheet, type ImageSourcePropType } from 'react-native';

const RIMS: Record<GlassRimShape, { dark: ImageSourcePropType; light: ImageSourcePropType }> = {
  // The tab bar's main capsule, 171 x 60 inside its border.
  bar: {
    dark: require('../../../assets/glass/rim-bar-dark.png'),
    light: require('../../../assets/glass/rim-bar-light.png'),
  },
  // The detached profile capsule, 59 x 59 inside its border.
  capsule: {
    dark: require('../../../assets/glass/rim-capsule-dark.png'),
    light: require('../../../assets/glass/rim-capsule-light.png'),
  },
  // The quick-dial buttons above the profile capsule, 49 x 49 inside their border.
  dial: {
    dark: require('../../../assets/glass/rim-dial-dark.png'),
    light: require('../../../assets/glass/rim-dial-light.png'),
  },
};

export type GlassRimShape = 'bar' | 'capsule' | 'dial';

export const GlassRim = memo(function GlassRim({ shape, isDark }: { shape: GlassRimShape; isDark: boolean }) {
  return (
    <Image
      source={RIMS[shape][isDark ? 'dark' : 'light']}
      style={StyleSheet.absoluteFill}
      resizeMode="stretch"
      // Android fades a newly loaded image in over 300 ms by default; a rim should simply be there.
      fadeDuration={0}
      accessible={false}
    />
  );
});
