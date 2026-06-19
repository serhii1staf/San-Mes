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
  return !!MaskedView && Platform.OS === 'ios';
}

interface FadingBlurHeaderProps {
  isDark: boolean;
  /** 'down' = opaque at top, fades out at bottom (page header).
   *  'up'   = opaque at bottom, fades out at top (bottom bar / footer). */
  direction?: 'down' | 'up';
  /** Where the blur is fully faded out (0..1 of the strip height). */
  fadeStart?: number;
  intensity?: number;
}

/**
 * Absolute-fill frosted blur with a soft alpha fade. Render as a sibling layer
 * inside an already-sized, absolutely-positioned header/footer container, ABOVE
 * any base gradient and BELOW the bar's text/icons. Returns null (renders
 * nothing) when the native masked-view module isn't in the build — the caller's
 * gradient then carries the look on its own.
 */
export function FadingBlurHeader({ isDark, direction = 'down', fadeStart = 0.55, intensity }: FadingBlurHeaderProps) {
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

  return (
    <MaskedView
      style={StyleSheet.absoluteFill}
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
        intensity={intensity ?? (isDark ? 60 : 75)}
        tint={isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        style={StyleSheet.absoluteFill}
      />
    </MaskedView>
  );
}
