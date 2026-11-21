/**
 * San's own glass as a SURFACE: every glass and blur surface in the app, on binaries whose native glass
 * can be one (modules/san-glass feature level 2: tint, frosted body, rim light, a radius per corner).
 *
 * Asked for: our glass, slightly darkened, on by default, the system's liquid glass no longer used, the
 * blur kept as what is shown when the glass is switched off, and our glass on every blur the app has.
 * So `LiquidGlass.tsx` (the system-glass family: `NativeGlassView`, `GlassBg`, ...) and `AppBlurView`
 * (the blur family) both render from here while `useGlassSurfacesActive()` is true, and keep their
 * previous behaviour when it is false: the setting off, Reduce Transparency on, Android before 13, or an
 * older binary running this bundle over the air (feature level 1 only had the tab bar's rim lens, so
 * those binaries keep exactly the look they shipped with).
 *
 * Three looks:
 *   - `clear`: the tab bar's glass (glisse's clear `<Glass>`: bend 1, dispersion 2, frost 0.5 px,
 *     rim 1), darkened a little. The middle is the live content. Buttons, pills, chips, avatar tiles.
 *   - `frosted`: what is behind, blurred, under a tint. Panels with text on them: headers, sheets,
 *     menus, the composer, toasts. Also what every blur surface becomes.
 *   - `scrim`: a lighter frost for small controls floating over a photo (the blur's `scrim` role).
 *
 * Kept free of `LiquidGlass.tsx` and `AppBlurView.tsx` imports: both import this.
 */
import React from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useSettingsStore } from '../../store/settingsStore';
import { SanGlassView, isSanGlassAvailable, sanGlassFeatureLevel } from '../../../modules/san-glass/index';

// ── Reduce Transparency (accessibility) ────────────────────────────────────
//
// Expo's own docs are explicit about this: `isLiquidGlassAvailable()` only tells you the components are
// compiled in, and "may also be true if the user has enabled accessibility settings that limit the
// Liquid Glass effect. To check if the user has disabled the Liquid Glass effect via accessibility
// settings, use AccessibilityInfo.isReduceTransparencyEnabled()." The same request applies to our own
// glass: a user who asked the system for less transparency gets the plain surfaces. Tracked in a
// module-level store so every consumer shares one value and non-React callers can read it.
let reduceTransparency = false;
const reduceTransparencyListeners = new Set<() => void>();

function setReduceTransparency(next: boolean): void {
  if (next === reduceTransparency) return;
  reduceTransparency = next;
  reduceTransparencyListeners.forEach((fn) => {
    try { fn(); } catch { /* a torn-down subscriber must not break the others */ }
  });
}

if (Platform.OS === 'ios') {
  AccessibilityInfo.isReduceTransparencyEnabled()
    .then(setReduceTransparency)
    .catch(() => { /* keep the default (glass allowed) */ });
  // Respect a mid-session toggle — the user can flip this in Settings while the app is backgrounded.
  AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);
}

/** Whether the OS "Reduce Transparency" accessibility setting is currently on. */
export function isReduceTransparencyEnabled(): boolean {
  return reduceTransparency;
}

export function subscribeReduceTransparency(onStoreChange: () => void): () => void {
  reduceTransparencyListeners.add(onStoreChange);
  return () => {
    reduceTransparencyListeners.delete(onStoreChange);
  };
}

export function useReduceTransparency(): boolean {
  return React.useSyncExternalStore(subscribeReduceTransparency, isReduceTransparencyEnabled, isReduceTransparencyEnabled);
}

/** This binary's glass can be a surface (feature level 2). Static for the session. */
export const GLASS_SURFACES_CAPABLE: boolean = isSanGlassAvailable && sanGlassFeatureLevel >= 2;

/** Every glass and blur surface renders our glass: capable binary, the setting on, no Reduce Transparency. */
export function useGlassSurfacesActive(): boolean {
  const enabled = useSettingsStore((s) => s.liquidGlassEnabled);
  const reduced = useReduceTransparency();
  return GLASS_SURFACES_CAPABLE && enabled && !reduced;
}

// ── The looks ───────────────────────────────────────────────────────────────

export type GlassLookKind = 'clear' | 'frosted' | 'scrim';

export interface GlassLook {
  blur: number;
  tintColor: string;
  shine: number;
  bend: number;
  dispersion: number;
  frost: number;
  saturation: number;
}

/**
 * The parameters of a look. `dark` picks the tint family; `strength` (0..1, from a blur's `intensity`)
 * thickens a frosted tint, the way a higher blur intensity reads as a heavier material.
 */
export function glassLook(kind: GlassLookKind, dark: boolean, strength = 0.6): GlassLook {
  const s = Math.max(0, Math.min(1, strength));
  if (kind === 'clear') {
    // "Slightly darkened": a thin black over the live content, lighter in the light theme so the glass
    // does not turn grey there.
    return { blur: 0, tintColor: dark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.06)', shine: 1, bend: 1, dispersion: 2, frost: 0.5, saturation: 1.5 };
  }
  if (kind === 'scrim') {
    // Over a photo: always darkening (a white scrim would wash a bright banner out), see-through.
    return { blur: 6, tintColor: `rgba(0,0,0,${(0.26 + 0.14 * s).toFixed(3)})`, shine: 0.8, bend: 1, dispersion: 1.5, frost: 0.5, saturation: 1.6 };
  }
  return {
    blur: 10,
    tintColor: dark
      ? `rgba(20,20,26,${(0.42 + 0.22 * s).toFixed(3)})`
      : `rgba(250,250,252,${(0.5 + 0.22 * s).toFixed(3)})`,
    shine: 0.45,
    bend: 1,
    dispersion: 1,
    frost: 0.5,
    saturation: 1.8,
  };
}

/** A caller's own tint (an accent pill, say) replaces the look's, keeping the glass otherwise. */
function withTint(look: GlassLook, tintColor?: string): GlassLook {
  return tintColor ? { ...look, tintColor } : look;
}

// ── Corners ─────────────────────────────────────────────────────────────────

export interface GlassCorners {
  cornerRadius?: number;
  cornerRadii?: [number, number, number, number];
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The glass's corners from a container's style, so it rounds itself exactly as its container does. */
export function cornersFromStyle(style: StyleProp<ViewStyle>, fallback?: number): GlassCorners {
  const s = (StyleSheet.flatten(style) || {}) as ViewStyle;
  const base = num(s.borderRadius) ?? fallback ?? 0;
  const tl = num(s.borderTopLeftRadius) ?? num(s.borderTopStartRadius) ?? base;
  const tr = num(s.borderTopRightRadius) ?? num(s.borderTopEndRadius) ?? base;
  const br = num(s.borderBottomRightRadius) ?? num(s.borderBottomEndRadius) ?? base;
  const bl = num(s.borderBottomLeftRadius) ?? num(s.borderBottomStartRadius) ?? base;
  if (tl === tr && tr === br && br === bl) return { cornerRadius: tl };
  return { cornerRadii: [tl, tr, br, bl] };
}

// ── Components ──────────────────────────────────────────────────────────────

export interface SanGlassLayerProps extends GlassCorners {
  kind: GlassLookKind;
  dark: boolean;
  strength?: number;
  tintColor?: string;
}

/** The glass alone, filling its parent. Draws its own rounding; nothing inside it. */
export const SanGlassLayer = React.memo(function SanGlassLayer({ kind, dark, strength, tintColor, cornerRadius, cornerRadii }: SanGlassLayerProps) {
  const look = withTint(glassLook(kind, dark, strength), tintColor);
  return (
    <SanGlassView
      style={StyleSheet.absoluteFill}
      cornerRadius={cornerRadii ? undefined : cornerRadius ?? 0}
      cornerRadii={cornerRadii}
      bend={look.bend}
      dispersion={look.dispersion}
      frost={look.frost}
      saturation={look.saturation}
      tintColor={look.tintColor}
      shine={look.shine}
      blur={look.blur}
    />
  );
});

export interface SanGlassBoxProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
  kind: GlassLookKind;
  dark: boolean;
  strength?: number;
  tintColor?: string;
  children?: React.ReactNode;
}

/**
 * A container with the glass as its first child and `children` on top, laid out by `style` exactly as
 * the surface it replaces was. The glass is a sibling of the content, never its parent, so nothing on
 * the surface is bent or blurred, and it takes its corners from `style`.
 */
export function SanGlassBox({ style, kind, dark, strength, tintColor, children, ...rest }: SanGlassBoxProps) {
  const corners = cornersFromStyle(style);
  return (
    <View style={style} {...rest}>
      <SanGlassLayer kind={kind} dark={dark} strength={strength} tintColor={tintColor} {...corners} />
      {children}
    </View>
  );
}
