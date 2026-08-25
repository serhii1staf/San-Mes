import React, { memo } from 'react';
import { Platform, View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { BlurView as ExpoBlurView } from 'expo-blur';
import { useTheme } from '../../theme';
import { useSettingsStore } from '../../store/settingsStore';

/**
 * The app's blur surface. Import this instead of `expo-blur`'s `BlurView`.
 *
 * ── THE BUG: ANDROID HAD NO BLUR AND NO SURFACE EITHER ──────────────────────
 *
 * Reported: on Android the navigation, the buttons, the headers and every glass container are simply
 * transparent — on every Android device.
 *
 * That is documented behaviour, not a mystery. From the Expo SDK 54 BlurView reference, on the
 * `experimentalBlurMethod` prop:
 *
 *     Default: 'none'
 *     'none' - Falls back to a semi-transparent view instead of rendering a blur effect.
 *
 * The prop was set nowhere in this codebase, so all fifty-nine `BlurView`s on Android were rendering a
 * semi-transparent tint and no blur. And several of them ask for `intensity={28}`, which maps to a very
 * low alpha — so the "fallback" was faint enough to read as fully transparent. Hence illegible chrome.
 *
 * ── WHY THIS IS A WRAPPER AND NOT FIFTY-NINE EDITS ──────────────────────────
 *
 * Because the same lesson has now been learned twice in this codebase the expensive way: the scrims
 * drifted apart while every screen inlined its own gradient stops, and the sticker grid re-introduced a
 * decode storm because pacing lived at the call site. Cross-platform surface behaviour is exactly the
 * kind of decision that must have one home, or the twenty-fifth `BlurView` someone adds will be
 * transparent on Android again and nobody will notice for weeks.
 *
 * Call sites keep their existing props — `intensity`, `tint`, `style`, children — and change one import.
 *
 * ── WHAT ANDROID GETS, AND WHY NOT REAL BLUR BY DEFAULT ─────────────────────
 *
 * A solid tonal surface, by default. The same docs are explicit about the alternative:
 *
 *     Currently, BlurView support is experimental on Android and may cause performance and
 *     graphical issues.
 *     'dimezisBlurView' - ... This method may lead to decreased performance.
 *
 * That library works by snapshotting the view hierarchy underneath and blurring it, per frame. Behind
 * app chrome that sits over a scrolling list — which is where nearly every one of these is — that is a
 * recurring cost on exactly the thread we have spent this whole effort clearing. Turning it on for all
 * Android devices by default would trade a legibility bug for an FPS bug, and "no heavy blur that drops
 * FPS" was a stated requirement.
 *
 * A tonal fill is also not a compromise on Android's own terms: Material specifies elevated surfaces as
 * tonal colour, not as blur. So this reads as deliberate rather than as a missing effect.
 *
 * Real blur is still reachable. The `liquidGlassEnabled` setting currently does NOTHING on Android
 * (`NATIVE_GLASS_CAPABLE` is iOS-only by construction), so it is a switch the user already has and which
 * is currently inert on their platform. Turning it on now opts Android into `dimezisBlurView`, so the
 * effect can be judged on a real device and turned back off without a rebuild — no new setting, no
 * guesswork on my part about whether a given phone can afford it.
 */

export interface AppBlurViewProps {
  /** 1-100, as in expo-blur. On Android it scales the tonal fill's opacity instead of a blur radius. */
  intensity?: number;
  tint?: 'light' | 'dark' | 'default' | string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  [key: string]: any;
}

/**
 * Map an expo-blur `intensity` to a surface alpha.
 *
 * Not linear. iOS blur hides what is beneath it by DISPLACING detail, so a low intensity still obscures
 * content; a flat fill only hides it by covering it, so the same number has to buy more opacity to be
 * equally legible. The floor is what fixes the reported bug: nothing in the app's chrome is ever allowed
 * to be near-transparent again, however low an intensity a call site asks for.
 */
function surfaceAlpha(intensity: number): number {
  const t = Math.max(0, Math.min(100, intensity)) / 100;
  // 0.72 at intensity 0 rising to 0.94 at 100. Even the app's lightest request (28) lands at ~0.78,
  // which is opaque enough for text and icons on top to be readable over any content.
  return 0.72 + t * 0.22;
}

/**
 * The Android surface fill, as a plain style object.
 *
 * Exported so the LIQUID-GLASS family can use the identical treatment. There are two separate families
 * of surface in this app — `BlurView` call sites and the `GlassBg` / `NativeGlassView` components — and
 * fixing only the first is what left the bottom navigation transparent after the previous round. One
 * definition of "what a surface looks like on Android" is the only way both stay in step.
 *
 * `isDark` is passed in rather than read from the theme here, because the glass components are sometimes
 * pinned to a fixed scheme (`colorScheme="dark"` over a photo, for instance) independently of the app's
 * theme, and the surface has to follow the same choice.
 */
export function androidSurfaceStyle(intensity: number, isDark: boolean): ViewStyle {
  const base = isDark ? '28,28,32' : '255,255,255';
  return {
    backgroundColor: `rgba(${base},${surfaceAlpha(intensity)})`,
    borderWidth: StyleSheet.hairlineWidth,
    // A hairline edge. On iOS the blur's own contrast against its surroundings defines the container's
    // shape; a flat fill has no such edge, and without one a light surface on a light background loses
    // its boundary entirely.
    borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)',
  };
}

function AppBlurViewComponent({ intensity = 50, tint = 'default', style, children, ...rest }: AppBlurViewProps) {
  const theme = useTheme();
  // Read the same flag the iOS glass path uses. On Android it has never had an effect, so opting real
  // blur behind it gives an existing, already-discoverable switch a meaning here rather than inventing a
  // second one.
  const blurOptIn = useSettingsStore((s) => s.liquidGlassEnabled);

  if (Platform.OS !== 'android') {
    return (
      <ExpoBlurView intensity={intensity} tint={tint as any} style={style} {...rest}>
        {children}
      </ExpoBlurView>
    );
  }

  if (blurOptIn) {
    return (
      <ExpoBlurView
        intensity={intensity}
        tint={tint as any}
        // The one place in the app that names this. See the note above for why it is not the default.
        experimentalBlurMethod="dimezisBlurView"
        // Android's perceived blur at a given intensity is stronger than iOS's; the docs provide this
        // knob specifically to bring the two closer. 4 is the documented default, kept explicit so it
        // is visible that it was considered.
        blurReductionFactor={4}
        style={style}
        {...rest}
      >
        {children}
      </ExpoBlurView>
    );
  }

  // ── Default Android path: a real surface ───────────────────────────────────
  //
  // `tint` decides which way the fill goes, falling back to the theme when a call site passes
  // `'default'` — which most do, because on iOS `default` means "system material" and adapts on its own.
  const dark = tint === 'dark' ? true : tint === 'light' ? false : theme.isDark;
  return (
    <View
      style={[
        style,
        // AFTER `style`, so the surface cannot be cancelled by a caller that sets its own transparent
        // background — which is how several of these are written, on the assumption that the blur
        // provides the fill.
        androidSurfaceStyle(intensity, dark),
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

/**
 * Memoised: these sit in list headers, tab bars and per-row chrome, and their props are almost always
 * constant. Without it every parent commit re-renders the surface for nothing.
 */
export const AppBlurView = memo(AppBlurViewComponent);

/** Drop-in alias so a call site's JSX does not have to change, only its import. */
export const BlurView = AppBlurView;
