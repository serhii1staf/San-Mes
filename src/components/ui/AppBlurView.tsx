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

/**
 * What this surface is FOR, which decides how opaque the Android fallback may be.
 *
 * ── WHY ONE ALPHA CURVE FOR FIFTY SURFACES WAS WRONG ────────────────────────
 *
 * Reported, after the blur default was turned off: the bottom navigation reads as "practically
 * transparent" and the profile's QR / settings buttons are "just black".
 *
 * Both are accurate, and they are the SAME bug seen from two directions — `surfaceAlpha` has a 0.72
 * floor and every call site got it regardless of what the surface was doing:
 *
 *   The 34x34 buttons ask for `intensity={80} tint="dark"`, so they paint `rgba(28,28,32,0.896)`.
 *   They sit on top of the user's banner PHOTO, where the blur used to let the photo through. A
 *   90%-opaque near-black disc is, correctly described, a black circle.
 *
 *   The tab bar asks for 80 in light theme, so it paints `rgba(255,255,255,0.896)` — which is
 *   nearly the same colour as the light background behind it. The alpha is high; the CONTRAST is
 *   almost nil, and a hairline at `rgba(0,0,0,0.07)` is not enough edge to say "this is a bar".
 *   High opacity and low visibility at the same time.
 *
 * The floor was written to fix illegible chrome, and for a panel with text on it that is right. It is
 * wrong for a small control whose whole job is to float over an image. So the role is now explicit
 * instead of inferred from an intensity number that means different things at different call sites.
 */
export type AppSurfaceRole =
  /**
   * Default. A panel, bar, header or sheet — something with content ON it that has to stay readable
   * over anything. Keeps the near-opaque tonal fill, and gains a stronger edge so it still reads as a
   * container when its fill matches the background.
   */
  | 'chrome'
  /**
   * A small control floating over imagery: the profile's QR and settings buttons, the back/menu
   * buttons on someone else's profile. Deliberately translucent — it is a scrim, so the picture
   * behind stays visible, which is what made these read as glass rather than as painted discs.
   * Contrast for the icon on top comes from the darkening, not from hiding the image.
   */
  | 'scrim';

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

/**
 * Map an expo-blur `intensity` to a surface alpha.
 *
 * Not linear. iOS blur hides what is beneath it by DISPLACING detail, so a low intensity still obscures
 * content; a flat fill only hides it by covering it, so the same number has to buy more opacity to be
 * equally legible. The floor is what fixes the reported bug: nothing in the app's chrome is ever allowed
 * to be near-transparent again, however low an intensity a call site asks for.
 */
function surfaceAlpha(intensity: number, role: AppSurfaceRole = 'chrome'): number {
  const t = Math.max(0, Math.min(100, intensity)) / 100;
  // A scrim is allowed to be see-through, because that is the entire point of it. 0.34 rising to 0.52:
  // enough darkening for a white icon to hold contrast over a bright photo, little enough that the
  // photo is still visibly there. `intensity={80}` therefore lands at ~0.48 rather than 0.896.
  if (role === 'scrim') return 0.34 + t * 0.18;
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
export function androidSurfaceStyle(
  intensity: number,
  isDark: boolean,
  role: AppSurfaceRole = 'chrome',
): ViewStyle {
  const base = isDark ? '28,28,32' : '255,255,255';
  // A scrim always darkens, whichever way the theme goes. Pinning it to black rather than following
  // `isDark` is deliberate: these controls sit on a user-supplied photo, not on the app background, so
  // a white scrim in light theme would wash out a bright banner and leave a white icon on white.
  const fill = role === 'scrim' ? '0,0,0' : base;
  return {
    backgroundColor: `rgba(${fill},${surfaceAlpha(intensity, role)})`,
    borderWidth: StyleSheet.hairlineWidth,
    // An edge. On iOS the blur's own contrast against its surroundings defines the container's shape; a
    // flat fill has no such edge, and without one a light surface on a light background loses its
    // boundary entirely — which is exactly what happened to the tab bar in light theme.
    //
    // `chrome` in light theme gets a MARKEDLY stronger line than the old 0.07, because that surface's
    // fill is near-white by design and the border is the only thing left doing the work. A scrim keeps a
    // faint bright rim, which is what reads as a glass lip over a photo.
    borderColor:
      role === 'scrim'
        ? 'rgba(255,255,255,0.22)'
        : isDark
          ? 'rgba(255,255,255,0.12)'
          : 'rgba(0,0,0,0.16)',
  };
}

function AppBlurViewComponent({ intensity = 50, tint = 'default', role = 'chrome', style, children, ...rest }: AppBlurViewProps) {
  const theme = useTheme();
  // Android's own flag, default false. NOT `liquidGlassEnabled` — that one defaults to true and its
  // settings row is hidden off iOS, which is how every Android install ended up running dimezis blur
  // with no way to stop it. See the note above.
  const blurOptIn = useSettingsStore((s) => s.androidBlurEnabled);

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
