import React from 'react';
import { View, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Avatar } from './index';
import { useTheme } from '../../theme';

interface LiquidGlassAvatarRingProps {
  emoji: string;
  /** Total outer footprint in points. Default 80. */
  size?: number;
  /** Avatar emoji size token. Default 'lg'. */
  avatarSize?: 'sm' | 'md' | 'lg' | 'xl';
}

/**
 * A "liquid glass" frame around the emoji avatar.
 *
 * Approximates iOS Liquid Glass without using `expo-blur` BlurView (we
 * already have 3 BlurView surfaces on the profile screen and any more
 * costs frame budget on weaker devices). The illusion is built from:
 *
 *   1. Outer drop shadow ........... floating-glass feel
 *   2. Diagonal gradient rim ....... light refraction at the edge
 *   3. Inner glass surface ......... slight tint + thin inner border
 *   4. Top crescent highlight ...... specular reflection from a virtual
 *                                    light source above the dome
 *
 * The component is purely visual — wrap it with a Pressable in the
 * caller if you need tap behaviour.
 */
export function LiquidGlassAvatarRing({
  emoji,
  size = 80,
  avatarSize = 'lg',
}: LiquidGlassAvatarRingProps) {
  const theme = useTheme();
  const isDark = theme.isDark;
  const ringThickness = 6;
  const innerSize = size - ringThickness * 2;

  return (
    <View
      style={[
        { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
        Platform.select({
          ios: {
            shadowColor: '#000',
            shadowOpacity: isDark ? 0.45 : 0.22,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
          },
          android: { elevation: 4 },
          default: {},
        }),
      ]}
    >
      {/* Outer rim — diagonal gradient suggests a light source from the
          top-left catching the curved glass edge, then the bottom-right
          edge picks up a softer specular bounce. The dark mid-stop is
          where the curvature would naturally render shaded glass. */}
      <LinearGradient
        colors={
          isDark
            ? [
                'rgba(255,255,255,0.65)',
                'rgba(255,255,255,0.18)',
                'rgba(0,0,0,0.22)',
                'rgba(255,255,255,0.45)',
              ]
            : [
                'rgba(255,255,255,0.95)',
                'rgba(255,255,255,0.55)',
                'rgba(0,0,0,0.08)',
                'rgba(255,255,255,0.75)',
              ]
        }
        locations={[0, 0.45, 0.7, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Inner glass surface — a slightly tinted disc that holds the
            emoji. The thin inner border gives the dome a physical edge
            so the gradient rim doesn't bleed into the emoji. */}
        <View
          style={{
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isDark
              ? 'rgba(20,20,20,0.6)'
              : 'rgba(255,255,255,0.6)',
            borderWidth: 0.5,
            borderColor: isDark
              ? 'rgba(255,255,255,0.18)'
              : 'rgba(0,0,0,0.06)',
          }}
        >
          <Avatar emoji={emoji} size={avatarSize} />
        </View>
      </LinearGradient>

      {/* Top crescent specular highlight — a soft, slightly tilted
          ellipse that sells the "wet glass" reflection. Sits above
          the rim gradient so it reads as light hitting the dome's
          apex. pointerEvents="none" so it doesn't swallow the parent
          Pressable's taps. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 4,
          left: size * 0.18,
          width: size * 0.64,
          height: 12,
          borderRadius: 12,
          backgroundColor: 'rgba(255,255,255,0.5)',
          opacity: isDark ? 0.55 : 0.78,
          transform: [{ scaleX: 1.05 }],
        }}
      />
    </View>
  );
}
