/**
 * San's own liquid glass, not the system's.
 *
 * A native view that shows what is BEHIND it, bent at the rim the way glisse bends it
 * (https://glisse.kelvinzhang.ca, MIT): within a band about 0.3 of its shorter side wide (at most 36 pt)
 * every point shows the content from further in, by the slope of glisse's bezel profile (Snell's law
 * through a curved rim, index 1.5), with red, green and blue pulled by different amounts (dispersion),
 * a light frost and glisse's saturation.
 *
 * From feature level 2 it is also a surface: a tint laid over it (the darkened glass), a frosted body
 * (what is behind, blurred: for panels with text on them), glisse's lit rim drawn by the shader for any
 * size and shape, and a radius per corner. Without those it draws exactly what level 1 drew: the bent
 * rim band only, the middle left to the live content.
 *
 *   - Android 13+ (API 33): the content beneath is recorded into a RenderNode from the views' own display
 *     lists every frame, blurred on the GPU when frosted, and bent by an AGSL RuntimeShader. Nothing is
 *     rasterised on the CPU.
 *   - iOS: the content beneath is rendered into a small IOSurface-backed buffer (only the area under the
 *     view, visiting only the layers that reach it; skipped while it is unchanged), blurred with Metal
 *     Performance Shaders when frosted, and bent by a Metal fragment shader. Public API only (Metal,
 *     CoreVideo, Core Animation): no private backdrop layer.
 *
 * Absent (old binaries running a newer JS bundle over the air, Android below 13, web, jest) the
 * component renders nothing and `isSanGlassAvailable` is false, so callers keep their fallback.
 */
import * as React from 'react';
import { processColor, type ColorValue, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

export interface SanGlassViewProps extends ViewProps {
  /** Corner radius of the glass, in pt. Must match the view's own rounding. */
  cornerRadius?: number;
  /** One radius per corner (top-left, top-right, bottom-right, bottom-left), pt. Level 2. */
  cornerRadii?: [number, number, number, number];
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
  /** Laid over the whole glass. Level 2. */
  tintColor?: ColorValue;
  /** glisse's rim light, 0 (none) to 1 (the clear glass's). Level 2. */
  shine?: number;
  /** Frosted body: blur of what is behind (a Gaussian sigma), pt. 0 = clear. Level 2. */
  blur?: number;
}

interface SanGlassNativeModule {
  isSupported(): boolean;
  lastError(): string | null;
  featureLevel?: () => number;
  stats?: () => SanGlassStats;
  resetStats?: () => void;
}

/** What the glass costs, summed over every instance since the last reset. */
export interface SanGlassStats {
  seconds: number;
  instances: number;
  capturesPerSecond: number;
  captureMsAverage: number;
  captureMsMax: number;
  /** Main-thread (iOS) or UI-thread (Android) time spent capturing, ms per second. */
  captureMsPerSecond: number;
  ticksPerSecond?: number;
  drawsPerSecond?: number;
  layersVisitedPerCapture?: number;
  layersRenderedPerCapture?: number;
  subtreesRenderedWholePerCapture?: number;
  /** Android: ancestor levels re-recorded per capture (the rest are reused). */
  levelsRecordedPerCapture?: number;
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

/**
 * 0 without the glass, 1 for the first binary (the tab bar's rim lens only), 2 from the binary that
 * added tint, frost, the rim light, per-corner radii and stats.
 */
export const sanGlassFeatureLevel: number = (() => {
  if (!isSanGlassAvailable) return 0;
  try {
    return typeof nativeModule?.featureLevel === 'function' ? nativeModule.featureLevel() : 1;
  } catch {
    return 1;
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

/** The glass's cost counters, or null where the binary has no stats (level 1, or no glass). */
export function sanGlassStats(): SanGlassStats | null {
  try {
    return typeof nativeModule?.stats === 'function' ? nativeModule.stats() : null;
  } catch {
    return null;
  }
}

export function resetSanGlassStats(): void {
  try {
    nativeModule?.resetStats?.();
  } catch {
    // Diagnostics must never cost the app.
  }
}

const NativeSanGlassView: React.ComponentType<Record<string, unknown>> | null = (() => {
  if (!isSanGlassAvailable) return null;
  try {
    return requireNativeViewManager<Record<string, unknown>>('SanGlass');
  } catch {
    return null;
  }
})();

export function SanGlassView({ tintColor, ...props }: SanGlassViewProps): React.ReactElement | null {
  if (!NativeSanGlassView) return null;
  return React.createElement(NativeSanGlassView, {
    pointerEvents: 'none',
    accessible: false,
    ...props,
    // A number on both platforms, as expo-image sends its tint.
    ...(tintColor != null ? { tintColor: processColor(tintColor) } : null),
  });
}
