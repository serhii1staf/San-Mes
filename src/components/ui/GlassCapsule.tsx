/**
 * GlassCapsule — shared Liquid-Glass material capsule.
 *
 * Reusable shell for chat surfaces that need the same Liquid-Glass look
 * the Dynamic Island companion overlay (`DynamicOverlayHost`) uses. One
 * BlurView per surface on iOS, flat translucent fill on Android. Stack
 * order top-to-bottom inside the wrapper:
 *
 *   1. Material backdrop  (iOS BlurView / Android translucent fill)
 *   2. Optional accent tint  (e.g. send button when ready)
 *   3. Top reflection LinearGradient (white-fade)
 *   4. Bottom dim LinearGradient (faint dark fade)
 *   5. Hairline border drawn last so it sits above the glass layers
 *   6. Children — interactive content sits above all glass layers
 *
 * Performance:
 *   - iOS uses `systemThinMaterial*` (lighter than the overlay's
 *     `systemChromeMaterial*`) because chat surfaces are dense, near
 *     the keyboard, and stack with the message list. Lighter material
 *     composites cheaper.
 *   - Intensity capped at 60 to limit per-frame blur cost — the chat
 *     input bar sits just above the keyboard and the keyboard
 *     animation re-rasterizes any BlurView above it.
 *   - Android NEVER renders a BlurView (too expensive on a
 *     keyboard-coupled view); it falls back to a flat rgba fill
 *     consistent with `DynamicOverlayHost`'s own Android branch.
 *   - Memoized so capsule shell is free of typing churn when the host
 *     re-renders on text input.
 *
 * Apple compliance:
 *   - No new permissions, no new native modules, OTA-safe.
 */

import React, { memo } from 'react';
import { Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

export interface GlassCapsuleProps {
  children?: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Outer corner radius. Drives the BlurView, reflection and border radii. */
  borderRadius: number;
  isDark: boolean;
  /** Optional accent overlay (e.g. for the active send button). */
  tinted?: { color: string };
  /**
   * Pointer events forwarded to the wrapper. Use 'box-none' when this
   * capsule wraps interactive children that should still be tappable.
   */
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
}

function GlassCapsuleInner({
  children,
  style,
  borderRadius,
  isDark,
  tinted,
  pointerEvents,
}: GlassCapsuleProps) {
  return (
    <View
      style={[styles.wrap, { borderRadius }, style as ViewStyle]}
      pointerEvents={pointerEvents}
    >
      {/* 1. Material backdrop — iOS BlurView / Android translucent fill. */}
      {Platform.OS === 'ios' ? (
        <BlurView
          intensity={isDark ? 50 : 60}
          tint={isDark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
          style={[StyleSheet.absoluteFill, { borderRadius }]}
          pointerEvents="none"
        />
      ) : (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius,
              backgroundColor: isDark
                ? 'rgba(40,40,45,0.65)'
                : 'rgba(255,255,255,0.78)',
            },
          ]}
        />
      )}

      {/* 2. Optional accent tint (e.g. send button when canSend === true). */}
      {tinted ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius, backgroundColor: tinted.color },
          ]}
        />
      ) : null}

      {/* 3. Top reflection — same gradient stops as DynamicOverlayHost. */}
      <LinearGradient
        colors={
          isDark
            ? ['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']
            : ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']
        }
        style={[
          styles.reflection,
          { borderTopLeftRadius: borderRadius, borderTopRightRadius: borderRadius },
        ]}
        pointerEvents="none"
      />

      {/* 4. Bottom dim — faint dark fade on the lower half so the capsule
          feels grounded against the chat background. */}
      <LinearGradient
        colors={
          isDark
            ? ['rgba(0,0,0,0)', 'rgba(0,0,0,0.18)']
            : ['rgba(0,0,0,0)', 'rgba(0,0,0,0.06)']
        }
        style={[
          styles.dim,
          { borderBottomLeftRadius: borderRadius, borderBottomRightRadius: borderRadius },
        ]}
        pointerEvents="none"
      />

      {/* 5. Hairline border drawn last so it sits above blur + reflection. */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            borderRadius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isDark
              ? 'rgba(255,255,255,0.18)'
              : 'rgba(255,255,255,0.65)',
          },
        ]}
      />

      {/* 6. Children rendered last so they sit above all glass layers. */}
      {children}
    </View>
  );
}

export const GlassCapsule = memo(GlassCapsuleInner);

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    position: 'relative',
  },
  reflection: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '46%',
  },
  dim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '40%',
  },
});

export default GlassCapsule;
