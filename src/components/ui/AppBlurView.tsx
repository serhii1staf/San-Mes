import React, { memo } from 'react';
import { Platform, View, type ViewStyle, type StyleProp } from 'react-native';
import { BlurView as ExpoBlurView } from 'expo-blur';
import { useTheme } from '../../theme';
import { useSettingsStore } from '../../store/settingsStore';
import { SanGlassBox, useGlassSurfacesActive } from './SanGlassSurface';
import { androidSurfaceStyle, type AppSurfaceRole } from './androidSurface';

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
 * ── THE OPT-IN FLAG WAS WRONG, AND IT COST EXACTLY WHAT THIS NOTE PREDICTED ──
 *
 * This block used to read: real blur is reachable by turning on `liquidGlassEnabled`, because that
 * setting "currently does NOTHING on Android", so it is "a switch the user already has" — "no new
 * setting, no guesswork".
 *
 * Both halves were wrong. `liquidGlassEnabled` DEFAULTS TO TRUE, so this was not an opt-in at all: it
 * turned dimezis blur on for every Android install the moment this wrapper shipped. And it is not a
 * switch the user has, because the settings row for it is gated on `isNativeGlassCapable()`, which is
 * false off iOS — so on Android the row is hidden and the flag is unreachable. The effect could not be
 * judged on a real device and could not be turned back off.
 *
 * The note above says turning blur on for all Android by default "would trade a legibility bug for an
 * FPS bug, and 'no heavy blur that drops FPS' was a stated requirement." That is precisely what
 * happened, on the very next line, by choosing a default-true flag.
 *
 * Measured with `dumpsys gfxinfo`, eight identical swipes on `(tabs)/profile`, monitor off:
 *
 *     36.84% janky frames | 42 ms median | Slow UI thread 91/91 | Slow bitmap uploads 56
 *
 * The bitmap-upload counter is the signature: this app's earlier documented baseline recorded it as
 * ZERO. dimezis blur snapshots the view hierarchy beneath it and blurs it — UI-thread work that
 * produces a bitmap upload, per frame, behind chrome that sits over a scrolling list.
 *
 * So the opt-in is now `androidBlurEnabled`, its OWN field, default FALSE, with its own settings row
 * that is visible ON ANDROID. The lesson is not "pick a better default" — it is that a shared flag
 * silently growing a second platform's meaning is how this happened.
 */

// Kept importable from here for existing callers; the definition lives in ./androidSurface.
export { androidSurfaceStyle };
export type { AppSurfaceRole };

export interface AppBlurViewProps {
  /** 1-100, as in expo-blur. On Android it scales the tonal fill's opacity instead of a blur radius. */
  intensity?: number;
  tint?: 'light' | 'dark' | 'default' | string;
  /** See `AppSurfaceRole`. Android-only in effect; iOS always renders a real blur. */
  role?: AppSurfaceRole;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  [key: string]: any;
}

function AppBlurViewComponent({ intensity = 50, tint = 'default', role = 'chrome', style, children, ...rest }: AppBlurViewProps) {
  const theme = useTheme();
  // Android's own flag, default false. NOT `liquidGlassEnabled` — that one defaults to true and its
  // settings row is hidden off iOS, which is how every Android install ended up running dimezis blur
  // with no way to stop it. See the note above.
  const blurOptIn = useSettingsStore((s) => s.androidBlurEnabled);
  const glass = useGlassSurfacesActive();

  // ── OUR GLASS, WHEN IT IS ON ───────────────────────────────────────────────
  //
  // Asked for: our glass on every blur the app has, with the blur kept for when the glass is switched
  // off. So with the glass on (a binary whose glass can be a surface, the setting on, no Reduce
  // Transparency) this is our frosted glass on both platforms, and everything below is the fallback.
  // `intensity` thickens the tint the way a higher blur intensity reads as a heavier material; `tint`
  // and `role` pick the family exactly as they pick the fallback's.
  if (glass) {
    const dark = tint === 'dark' ? true : tint === 'light' ? false : theme.isDark;
    return (
      <SanGlassBox
        style={style}
        kind={role === 'scrim' ? 'scrim' : 'frosted'}
        dark={dark}
        strength={Math.max(0, Math.min(100, intensity)) / 100}
        {...rest}
      >
        {children}
      </SanGlassBox>
    );
  }

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
        androidSurfaceStyle(intensity, dark, role),
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
