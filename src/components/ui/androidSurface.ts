import { StyleSheet, type ViewStyle } from 'react-native';

/**
 * The Android surface: what a blur or frosted-glass surface looks like on Android as a flat fill.
 *
 * Moved out of AppBlurView.tsx so the glass layer (SanGlassSurface.tsx) can use the same definition
 * without an import cycle: AppBlurView and LiquidGlass both import SanGlassSurface. One definition is
 * the point, see the note on `androidSurfaceStyle`.
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
