/**
 * The surface of a round button that floats over moving content: the photo viewer's controls and the
 * profile QR screen's buttons. Drawn behind the icon, filling a round, clipped container.
 *
 * ── WHY THESE ARE NOT OUR GLASS ON iOS (Nov 2026) ─────────────────────────────────────────────────
 *
 * Reported on iPhone: tapping a photo to hide its buttons, and tapping again to bring them back, is
 * "not smooth, laggy, as if it is redrawn a million times"; the QR screen's buttons lag as they slide
 * in. Both sets were our frosted glass (modules/san-glass). That glass rebuilds itself from what is
 * beneath it: on iOS every view runs its own display link, renders the layers under it on the main
 * thread and blurs them on the GPU, whenever its signature changes, and its own position is part of
 * the signature. So a glass button that slides re-captures on every frame of the slide. The viewer
 * has four of them, moving together for 240 ms, on the main thread that also runs the slide; the QR
 * screen has four over an emoji field that never stops moving, so they capture all the time. The
 * capture is also presented outside the Core Animation transaction that moves the button, so its
 * content trails the button by a frame: the "redrawn" look.
 *
 * Here, on iOS, the button is the system blur (UIVisualEffectView, composited by the system, smooth
 * under transforms and free while still) with glisse's lit rim on top (the prerendered image the tab
 * bar uses without native glass, `GlassRim`). That keeps the frost and the light of the edge, which is
 * what reads as glass at this size; what it gives up is the bend at the very edge. Never under an
 * animated opacity: the callers slide these on transforms only, which a blur view tolerates.
 *
 * Android keeps our glass, whose frosted control there is a flat body with the lit rim and records
 * nothing from beneath (SanGlassSurface.tsx), so it costs nothing when it moves. Apple's own glass on
 * an older iOS 26 binary is composited by the system and stays. With the glass switched off it is the
 * app's blur, as before.
 */
import React, { memo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView as ExpoBlurView } from 'expo-blur';
import { GlassBg, useLiquidGlassActive } from './LiquidGlass';
import { useGlassSurfacesActive } from './SanGlassSurface';
import { AppBlurView } from './AppBlurView';
import { GlassRim } from './GlassRim';

export const OverlayButtonSurface = memo(function OverlayButtonSurface({
  radius,
  tintColor,
  interactive = true,
}: {
  /** Half the button's size: the container is round and clips. */
  radius: number;
  /** Laid over the surface, e.g. a red wash on a destructive action. */
  tintColor?: string;
  /** Apple's glass reacts to touch where it is used (older iOS 26 binaries). */
  interactive?: boolean;
}) {
  const glassActive = useLiquidGlassActive();
  const ours = useGlassSurfacesActive();
  const tint = tintColor ? <View style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]} /> : null;

  if (ours && Platform.OS === 'ios') {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
        <ExpoBlurView intensity={42} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.darken]} />
        {tint}
        <GlassRim shape="dial" />
      </View>
    );
  }
  if (glassActive) {
    return (
      <GlassBg
        borderRadius={radius}
        glassStyle="regular"
        control
        interactive={interactive}
        colorScheme="dark"
        tintColor={tintColor}
      />
    );
  }
  return (
    <AppBlurView intensity={36} role="scrim" tint="dark" style={StyleSheet.absoluteFill}>
      {tint}
    </AppBlurView>
  );
});

const styles = StyleSheet.create({
  // The frosted glass's own dark tint (`glassLook('frosted', dark)`), lighter: the blur is already a
  // dark material.
  darken: { backgroundColor: 'rgba(20,20,26,0.18)' },
});
