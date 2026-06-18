import React from 'react';
import { Platform, View, StyleSheet, type ViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSettingsStore } from '../../store/settingsStore';

// ── Native liquid glass (iOS 26+) — single integration point ───────────────
//
// `expo-glass-effect` renders Apple's real UIVisualEffectView liquid glass on
// iOS 26+. On every other platform/OS version its components fall back to a
// plain View, so the package is safe to import everywhere — but we still gate
// ALL usage behind a runtime capability check so we never mount a degenerate
// glass view where the effect can't actually render.
//
// IMPORTANT (the "fully disappears when off" guarantee): every consumer renders
// the native GlassView ONLY when `useLiquidGlassActive()` is true. When the
// user flips the settings toggle off, that hook returns false, the GlassView
// unmounts entirely, and the provided `fallback` renders instead. Nothing from
// expo-glass-effect remains in the tree — no residual layer, no GPU cost.

// Guarded require: if the native module isn't in the current binary (e.g. an
// older build made before we added the dependency), this degrades gracefully
// instead of crashing — every capability check below resolves to false.
let GlassViewComp: any = null;
let GlassContainerComp: any = null;
let _isLiquidGlassAvailable: (() => boolean) | null = null;
let _isGlassEffectAPIAvailable: (() => boolean) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('expo-glass-effect');
  GlassViewComp = mod.GlassView ?? null;
  GlassContainerComp = mod.GlassContainer ?? null;
  _isLiquidGlassAvailable = mod.isLiquidGlassAvailable ?? null;
  _isGlassEffectAPIAvailable = mod.isGlassEffectAPIAvailable ?? null;
} catch {
  // Module absent — stays in fallback mode forever this session.
}

// Real liquid glass requires: iOS, the JS component present, the Liquid Glass
// design compiled into the app (`isLiquidGlassAvailable`), AND the runtime API
// actually present on this OS build (`isGlassEffectAPIAvailable` guards against
// iOS 26 betas that ship without the API and would otherwise crash). Computed
// once at module load — these values are stable for an app session.
const NATIVE_GLASS_CAPABLE: boolean = (() => {
  if (Platform.OS !== 'ios' || !GlassViewComp) return false;
  try {
    return !!_isLiquidGlassAvailable?.() && !!_isGlassEffectAPIAvailable?.();
  } catch {
    return false;
  }
})();

/**
 * Whether this device CAN render native liquid glass at all (iOS 26+ with the
 * API compiled in). Use to decide whether to even SHOW the settings toggle —
 * there's no point offering it on Android / older iOS where it's a no-op.
 */
export function isNativeGlassCapable(): boolean {
  return NATIVE_GLASS_CAPABLE;
}

/**
 * True when the device can render native glass AND the user has it enabled in
 * settings. Subscribes to the toggle so consumers re-render (mount/unmount the
 * GlassView) the instant the user flips it.
 */
export function useLiquidGlassActive(): boolean {
  const enabled = useSettingsStore((s) => s.liquidGlassEnabled);
  return NATIVE_GLASS_CAPABLE && enabled;
}

export type GlassStyle = 'clear' | 'regular' | 'none';

interface NativeGlassViewProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
  glassStyle?: GlassStyle;
  tintColor?: string;
  isInteractive?: boolean;
  /** Override the system appearance to match the app's own theme toggle. */
  colorScheme?: 'auto' | 'light' | 'dark';
  children?: React.ReactNode;
}

/**
 * Thin typed wrapper over expo-glass-effect's `GlassView`. Render this ONLY
 * after checking `useLiquidGlassActive()` — it assumes the native effect is
 * available. Renders a plain View if (somehow) the module is missing, so it
 * can never crash. `children` render inside the glass surface.
 */
export function NativeGlassView({
  glassStyle = 'regular',
  tintColor,
  isInteractive,
  colorScheme,
  style,
  children,
  ...rest
}: NativeGlassViewProps) {
  if (!GlassViewComp) {
    return <View style={style} {...rest}>{children}</View>;
  }
  return (
    <GlassViewComp
      style={style}
      glassEffectStyle={glassStyle}
      tintColor={tintColor}
      isInteractive={isInteractive}
      colorScheme={colorScheme}
      {...rest}
    >
      {children}
    </GlassViewComp>
  );
}

interface GlassContainerViewProps {
  /**
   * Distance (in points) within which nested `GlassView`s merge/stretch toward
   * each other — the "liquid" coalescing effect. Forwarded straight to
   * expo-glass-effect's `GlassContainer`.
   */
  spacing?: number;
  style?: StyleProp<ViewStyle>;
  /** The non-glass UI rendered when liquid glass is OFF or unavailable. */
  fallback?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Gated wrapper over expo-glass-effect's `GlassContainer`. When liquid glass is
 * active it renders a real `GlassContainer`, which makes any nested
 * `NativeGlassView`s that come within `spacing` points merge and stretch toward
 * one another (Apple's "liquid" coalescing). When inactive it renders the
 * supplied `fallback`, or a plain `View` carrying the same `style` so layout is
 * preserved. Nothing from expo-glass-effect is mounted in the fallback path.
 */
export function GlassContainerView({ spacing, style, fallback, children }: GlassContainerViewProps) {
  const active = useLiquidGlassActive();
  if (active && GlassContainerComp) {
    return (
      <GlassContainerComp spacing={spacing} style={style}>
        {children}
      </GlassContainerComp>
    );
  }
  if (fallback !== undefined) return <>{fallback}</>;
  return <View style={style}>{children}</View>;
}

interface GlassSurfaceProps extends NativeGlassViewProps {
  /**
   * The non-glass UI rendered when liquid glass is OFF or unavailable. Pass
   * your existing BlurView / gradient / plain View here. Used for surfaces
   * that have NO inner children (e.g. a full-bleed backdrop). For surfaces
   * with children inside the glass (buttons), check `useLiquidGlassActive()`
   * inline instead.
   */
  fallback: React.ReactNode;
}

/**
 * No-children surface: renders a native `GlassView` when liquid glass is
 * active, otherwise the supplied `fallback`. When inactive, NOTHING from
 * expo-glass-effect is mounted — the effect fully disappears.
 */
export function GlassSurface({ fallback, ...glassProps }: GlassSurfaceProps) {
  const active = useLiquidGlassActive();
  if (active) return <NativeGlassView {...glassProps} />;
  return <>{fallback}</>;
}

interface GlassBgProps {
  borderRadius?: number;
  glassStyle?: GlassStyle;
  colorScheme?: 'auto' | 'light' | 'dark';
  /**
   * Whether the glass reacts to touch (Apple's liquid "stretch"/morph). Safe
   * to enable here because GlassBg is a BACKGROUND layer — the real content is
   * a sibling rendered ON TOP, so the interactive lensing animates the glass
   * surface without ever warping the icons/text (which was the bug when
   * content lived INSIDE an interactive GlassView). Default on for the liquid
   * feel; pass false for purely static surfaces.
   */
  interactive?: boolean;
  /** Optional tint to lift a too-dark glass surface. */
  tintColor?: string;
}

/**
 * Absolute-fill liquid-glass BACKGROUND layer — the correct way to glass a
 * button / pill / field.
 *
 * Usage: render `<GlassBg .../>` as the FIRST child of a SHAPED,
 * overflow-hidden container (Pressable/View) that already defines size /
 * padding / borderRadius, and put the real content (icons, text, TextInput)
 * as SIBLINGS AFTER it. The content then lays out normally and sits ON TOP of
 * the glass.
 *
 * Why not put content inside a GlassView? Two reasons learned the hard way:
 *   1. Content placed inside a GlassView gets visually lensed/warped by the
 *      glass (especially with `isInteractive`) — an icon appears to "stretch
 *      inside" the button.
 *   2. An absolute-fill GlassView holding the content collapses the parent's
 *      intrinsic size (a name pill shrank to a bare circle because the text
 *      lived inside the absolutely-positioned glass and no longer drove the
 *      pill's width).
 *
 * Returns null when glass is off, so the container simply falls back to its
 * own backgroundColor/border.
 */
export function GlassBg({ borderRadius, glassStyle = 'clear', colorScheme, interactive = true, tintColor }: GlassBgProps) {
  const active = useLiquidGlassActive();
  if (!active) return null;
  return (
    <NativeGlassView
      pointerEvents="none"
      glassStyle={glassStyle}
      colorScheme={colorScheme}
      isInteractive={interactive}
      tintColor={tintColor}
      style={[StyleSheet.absoluteFill, borderRadius != null ? { borderRadius } : null]}
    />
  );
}
