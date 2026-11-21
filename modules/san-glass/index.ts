/**
 * San's own liquid glass, not the system's.
 *
 * A native view that shows what is BEHIND it, bent at the rim the way glisse bends it
 * (https://glisse.kelvinzhang.ca, MIT): within a band about 0.3 of its shorter side wide (at most 36 pt)
 * every point shows the content from further in, by the slope of glisse's bezel profile (Snell's law
 * through a curved rim, index 1.5), with red, green and blue pulled by different amounts (dispersion),
 * a light frost and glisse's saturation. The middle is left alone, so the live content shows through
 * exactly; only the rim band is drawn.
 *
 *   - Android 13+ (API 33): the content beneath is recorded into a RenderNode from the views' own display
 *     lists every frame and bent by an AGSL RuntimeShader on the GPU. Nothing is rasterised on the CPU.
 *   - iOS: the content beneath is rendered into a small IOSurface-backed buffer (only the area under the
 *     view, at 2x at most, skipped while it is unchanged) and bent by a Metal fragment shader. Public API
 *     only (Metal, CoreVideo, Core Animation): no private backdrop layer.
 *
 * Absent (old binaries running a newer JS bundle over the air, Android below 13, web, jest) the
 * component renders nothing and `isSanGlassAvailable` is false, so callers keep their fallback.
 */
import * as React from 'react';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { ViewProps } from 'react-native';

export interface SanGlassViewProps extends ViewProps {
  /** Corner radius of the glass, in pt. Must match the view's own rounding. */
  cornerRadius: number;
  /** glisse `--lg-glass-bend`: how far the rim pulls the content in, as a multiple of the band width. */
  bend?: number;
  /** glisse `--lg-glass-dispersion`: red is pulled 1 + 0.2x as far, green 1 + 0.1x, blue 1x. */
  dispersion?: number;
  /** glisse `--lg-blur` (frost), in pt. */
  frost?: number;
  /** glisse's `saturate(1.5)` on what the glass bends. */
  saturation?: number;
  /** Width of the bending band as a fraction of the shorter side (glisse 0.3). */
  depth?: number;
  /** Upper bound of the band, in pt (glisse 36). */
  maxDepth?: number;
}

interface SanGlassNativeModule {
  isSupported(): boolean;
  lastError(): string | null;
}

const nativeModule = requireOptionalNativeModule<SanGlassNativeModule>('SanGlass');

/** Whether this binary has the native glass and the device can run it. */
export const isSanGlassAvailable: boolean = (() => {
  try {
    return !!nativeModule && nativeModule.isSupported() === true;
  } catch {
    return false;
  }
})();

/** The last native failure (a shader that did not compile, for instance), for diagnostics. */
export function sanGlassLastError(): string | null {
  try {
    return nativeModule?.lastError() ?? null;
  } catch {
    return null;
  }
}

const NativeSanGlassView: React.ComponentType<SanGlassViewProps> | null = (() => {
  if (!isSanGlassAvailable) return null;
  try {
    return requireNativeViewManager<SanGlassViewProps>('SanGlass');
  } catch {
    return null;
  }
})();

export function SanGlassView(props: SanGlassViewProps): React.ReactElement | null {
  if (!NativeSanGlassView) return null;
  return React.createElement(NativeSanGlassView, {
    pointerEvents: 'none',
    accessible: false,
    ...props,
  });
}
