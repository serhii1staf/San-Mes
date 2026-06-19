import React from 'react';
import { StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

// ── Native fading blur strip ───────────────────────────────────────────────
//
// A REAL frosted-glass blur (UIVisualEffectView via expo-blur) that softly
// fades to nothing toward one edge — so content scrolling under a header/footer
// is genuinely blurred at the bar and dissolves smoothly into the clear feed,
// with no hard blur seam. The fade is done with `@react-native-masked-view`:
// the BlurView is masked by a vertical gradient (opaque → transparent), so the
// blur's own alpha ramps off. That's something a plain LinearGradient tint
// can't do (it only darkens; it doesn't blur the pixels behind it).
//
// ⚠️ Guarded native-module load: `@react-native-masked-view/masked-view` is a
// native module. A static import throws on any binary that doesn't bundle it
// (every build made before we added the dep, including whatever is running our
// OTA channel until the next native release). We therefore require() it inside
// try/catch and render NOTHING when it's absent — callers keep their existing
// gradient as the always-present base layer, so this is purely additive and
// can never crash an older build. Do NOT convert to a static import.
let MaskedView: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@react-native-masked-view/masked-view');
  MaskedView = mod?.default ?? mod ?? null;
} catch {
  MaskedView = null;
}

/** True when the native masked-view module is present in this binary. */
export function isFadingBlurAvailable(): boolean {
  return !!MaskedView;
}

interface FadingBlurHeaderProps {
  isDark: boolean;
  /** 'down' = opaque at top, fades out at bottom (page header).
   *  'up'   = opaque at bottom, fades out at top (bottom bar / footer). */
  direction?: 'down' | 'up';
  /** Where the blur is fully faded out (0..1 of the strip height). */
  fadeStart?: number;
  intensity?: number;
  /** Explicit strip height. When omitted the blur fills its parent. Use a
   *  short height so the blur hugs the title row and doesn't bleed down into
   *  the feed — also cheaper (less area to recomposite). */
  height?: number;
}

/**
 * Absolute-fill (or fixed-height) frosted blur with a soft alpha fade. Render
 * as a sibling layer inside an already-positioned header/footer container,
 * ABOVE any base gradient and BELOW the bar's text/icons.
 *
 * iOS ONLY: the blur is a native UIVisualEffectView (GPU-composited, cheap even
 * while content scrolls under it). On Android we deliberately render NOTHING and
 * let the caller's plain gradient carry the look — a continuously-resampling
 * blur there (Dimezis) is too expensive on weak devices, which is exactly what
 * we must avoid. Also returns null when the native masked-view module is absent
 * (older binaries), so it can never crash.
 */
export function FadingBlurHeader({ isDark, direction = 'down', fadeStart = 0.55, intensity, height }: FadingBlurHeaderProps) {
  if (!MaskedView || Platform.OS !== 'ios') return null;

  // Opaque (black) keeps the blur; transparent removes it. `down` keeps the top
  // and fades the bottom; `up` is the mirror for a footer.
  const maskColors =
    direction === 'down'
      ? (['#000', '#000', 'transparent'] as const)
      : (['transparent', '#000', '#000'] as const);
  const maskLocations =
    direction === 'down'
      ? ([0, fadeStart, 1] as const)
      : ([0, 1 - fadeStart, 1] as const);

  const containerStyle = height != null
    ? { position: 'absolute' as const, top: 0, left: 0, right: 0, height }
    : StyleSheet.absoluteFill;

  return (
    <MaskedView
      style={containerStyle}
      pointerEvents="none"
      maskElement={
        <LinearGradient
          colors={maskColors as unknown as string[]}
          locations={maskLocations as unknown as number[]}
          style={StyleSheet.absoluteFill}
        />
      }
    >
      <BlurView
        intensity={intensity ?? (isDark ? 55 : 70)}
        tint={isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        style={StyleSheet.absoluteFill}
      />
    </MaskedView>
  );
}
