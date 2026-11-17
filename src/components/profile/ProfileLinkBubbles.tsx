/**
 * Profile links as floating liquid bubbles, in the space beside the avatar (the idea of Telegram's
 * profile gifts, drawn as soap-bubble glass instead of gift art).
 *
 * Each bubble holds the link's brand icon, drifts slowly on its own rhythm, carries an iridescent
 * sheen that keeps turning, can be dragged in any direction and springs back with a little wobble
 * when let go. A tap opens the link.
 *
 * Cost, since the profile is where lag was reported:
 *   - everything moves on the UI thread (Reanimated); nothing re-renders React while it animates;
 *   - the loops start only after the open transition and stop while the screen is not focused
 *     (the own-profile tab stays mounted behind the other tabs) or when Reduce Motion is on;
 *   - no blur views. On iOS 26 with liquid glass on, the base is the native glass material;
 *     everywhere else it is a translucent fill, a gradient sheen, a highlight and a rim.
 */
import React, { memo, useCallback, useEffect, useMemo } from 'react';
import { InteractionManager, StyleSheet, View, useWindowDimensions } from 'react-native';
import { FontAwesome5, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { NativeGlassView } from '../ui/LiquidGlass';
import { triggerHaptic } from '../../utils/haptics';
import { openUrl } from '../../utils/openUrl';
import { useT } from '../../i18n/store';

export type LinkKind =
  | 'github' | 'twitter' | 'instagram' | 'youtube' | 'telegram' | 'tiktok'
  | 'linkedin' | 'discord' | 'twitch' | 'spotify' | 'website';

export function detectLinkKind(url: string): LinkKind {
  const l = url.toLowerCase();
  if (l.includes('github.com')) return 'github';
  if (l.includes('twitter.com') || l.includes('x.com')) return 'twitter';
  if (l.includes('instagram.com')) return 'instagram';
  if (l.includes('youtube.com') || l.includes('youtu.be')) return 'youtube';
  if (l.includes('t.me') || l.includes('telegram.me')) return 'telegram';
  if (l.includes('tiktok.com')) return 'tiktok';
  if (l.includes('linkedin.com')) return 'linkedin';
  if (l.includes('discord.gg') || l.includes('discord.com')) return 'discord';
  if (l.includes('twitch.tv')) return 'twitch';
  if (l.includes('spotify.com')) return 'spotify';
  return 'website';
}

const BRAND: Record<LinkKind, { icon: string; color: string; label: string; brand: boolean }> = {
  github: { icon: 'github', color: '#FFFFFF', label: 'GitHub', brand: true },
  twitter: { icon: 'twitter', color: '#1DA1F2', label: 'Twitter', brand: true },
  instagram: { icon: 'instagram', color: '#F56A8C', label: 'Instagram', brand: true },
  youtube: { icon: 'youtube', color: '#FF3B3B', label: 'YouTube', brand: true },
  telegram: { icon: 'telegram-plane', color: '#2AABEE', label: 'Telegram', brand: true },
  tiktok: { icon: 'tiktok', color: '#FFFFFF', label: 'TikTok', brand: true },
  linkedin: { icon: 'linkedin-in', color: '#3D8BFF', label: 'LinkedIn', brand: true },
  discord: { icon: 'discord', color: '#8C97FF', label: 'Discord', brand: true },
  twitch: { icon: 'twitch', color: '#A970FF', label: 'Twitch', brand: true },
  spotify: { icon: 'spotify', color: '#1ED760', label: 'Spotify', brand: true },
  website: { icon: 'globe', color: '#6FA8FF', label: '', brand: false },
};

/** Bubble diameters, by index. Different sizes read as a cluster rather than a row of buttons. */
const SIZES = [58, 50, 54, 46, 52];

/** Bubble centres as fractions of the area, for 1..5 links. Staggered so neighbours never touch. */
const LAYOUTS: [number, number][][] = [
  [[0.5, 0.5]],
  [[0.3, 0.42], [0.72, 0.6]],
  [[0.18, 0.56], [0.52, 0.32], [0.84, 0.6]],
  [[0.12, 0.38], [0.4, 0.68], [0.66, 0.3], [0.9, 0.64]],
  [[0.1, 0.62], [0.32, 0.28], [0.54, 0.7], [0.75, 0.3], [0.94, 0.66]],
];

// Soap-film colours. Low alpha: the sheen tints the bubble, it does not paint it.
const SHEEN = ['#FF7AD966', '#7AE7FF66', '#FFF07A55', '#A88BFF66', '#FF7AD966'] as const;

interface BubbleProps {
  url: string;
  size: number;
  left: number;
  top: number;
  index: number;
  running: boolean;
  glassActive: boolean;
  isDark: boolean;
  websiteLabel: string;
}

const Bubble = memo(function Bubble({ url, size, left, top, index, running, glassActive, isDark, websiteLabel }: BubbleProps) {
  const kind = detectLinkKind(url);
  const brand = BRAND[kind];
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const scale = useSharedValue(1);
  const driftX = useSharedValue(0);
  const driftY = useSharedValue(0);
  const spin = useSharedValue(index * 0.21);

  // Each bubble gets its own periods so the cluster never moves in step.
  const periodY = 2600 + index * 430;
  const periodX = 3400 + index * 370;
  const periodSpin = 7000 + index * 900;

  useEffect(() => {
    if (!running) {
      cancelAnimation(driftX);
      cancelAnimation(driftY);
      cancelAnimation(spin);
      return;
    }
    const sine = Easing.inOut(Easing.sin);
    driftY.value = withRepeat(withTiming(1, { duration: periodY, easing: sine }), -1, true);
    driftX.value = withRepeat(withTiming(1, { duration: periodX, easing: sine }), -1, true);
    spin.value = withRepeat(withTiming(spin.value + 1, { duration: periodSpin, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(driftX);
      cancelAnimation(driftY);
      cancelAnimation(spin);
    };
  }, [running, driftX, driftY, spin, periodX, periodY, periodSpin]);

  const open = useCallback(() => {
    triggerHaptic('light');
    openUrl(url);
  }, [url]);
  const grabbed = useCallback(() => triggerHaptic('selection'), []);

  const gesture = useMemo(() => {
    // Both gestures BEGIN on touch-down; the pan only STARTS once the finger has moved. So the
    // press-in lives on the tap's begin, the grab on the pan's start, and the one reset that always
    // runs is the pan's finalize (it fires for every touch that began, tap or drag).
    // The bubbles sit inside the profile's ScrollView. A quick swipe that starts on a bubble must
    // still scroll the page, so the drag only engages after a short hold ("grab the bubble"). A
    // hold released without moving is still a tap.
    const pan = Gesture.Pan()
      .activateAfterLongPress(140)
      .onStart(() => {
        scale.value = withSpring(1.14, { damping: 12, stiffness: 260 });
        runOnJS(grabbed)();
      })
      .onChange((e) => {
        dx.value += e.changeX;
        dy.value += e.changeY;
      })
      .onEnd((e) => {
        if (Math.abs(e.translationX) < 6 && Math.abs(e.translationY) < 6) runOnJS(open)();
      })
      .onFinalize((e) => {
        // Low damping is the "liquid" part: it overshoots home and settles with a wobble.
        dx.value = withSpring(0, { velocity: e.velocityX, damping: 7, stiffness: 120, mass: 0.9 });
        dy.value = withSpring(0, { velocity: e.velocityY, damping: 7, stiffness: 120, mass: 0.9 });
        scale.value = withSpring(1, { damping: 6, stiffness: 180 });
      });
    const tap = Gesture.Tap()
      .maxDuration(400)
      .onBegin(() => {
        scale.value = withSpring(0.92, { damping: 14, stiffness: 320 });
      })
      .onEnd((_e, success) => {
        if (success) runOnJS(open)();
      });
    return Gesture.Race(pan, tap);
  }, [dx, dy, scale, open, grabbed]);

  const bodyStyle = useAnimatedStyle(() => {
    const fx = (driftX.value - 0.5) * 6;
    const fy = (driftY.value - 0.5) * 9;
    // Squash a little along the drag direction while it is pulled away from home.
    const pull = Math.min(1, Math.sqrt(dx.value * dx.value + dy.value * dy.value) / 160);
    return {
      transform: [
        { translateX: dx.value + fx },
        { translateY: dy.value + fy },
        { scaleX: scale.value * (1 + pull * 0.06) },
        { scaleY: scale.value * (1 - pull * 0.06) },
      ],
    };
  });
  const sheenStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));

  const r = size / 2;
  // ── NO CLIPPING, ON PURPOSE ────────────────────────────────────────────────
  // The first version rotated an oversized gradient inside an `overflow: hidden` circle. On
  // Android a rounded clip with changing content is redrawn through an offscreen layer every frame,
  // and the emulator measured it: idle with three bubbles, 74 frames in 5 s, p50 150 ms. Every layer
  // is now a circle of its own (expo-linear-gradient draws inside its border radius natively), so
  // the sheen's rotation, the drift and the drag are pure transforms on already-recorded views.
  const circle = { position: 'absolute' as const, left: 0, top: 0, width: size, height: size, borderRadius: r };
  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.View
        accessible
        accessibilityRole="link"
        accessibilityLabel={brand.label || websiteLabel}
        style={[{ position: 'absolute', left, top, width: size, height: size }, bodyStyle]}
      >
        {glassActive ? (
          <NativeGlassView glassStyle="clear" colorScheme={isDark ? 'dark' : 'light'} style={circle} />
        ) : (
          <View style={[circle, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.5)' }]} />
        )}
        {/* Soap-film sheen: a diagonal gradient circle, turned slowly. The circle is symmetric, so
            rotating it only swirls the colours. */}
        <Reanimated.View pointerEvents="none" style={[circle, sheenStyle]}>
          <LinearGradient colors={SHEEN} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={circle} />
        </Reanimated.View>
        {/* Depth: light from above, a touch of shade underneath. */}
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.22)']}
          locations={[0, 0.5, 1]}
          style={circle}
        />
        {/* Specular highlight. */}
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(255,255,255,0.9)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={{ position: 'absolute', left: size * 0.17, top: size * 0.1, width: size * 0.42, height: size * 0.26, borderRadius: size * 0.13, transform: [{ rotate: '-22deg' }] }}
        />
        <View pointerEvents="none" style={[circle, styles.rim]} />
        <View pointerEvents="none" style={[circle, styles.center]}>
          {brand.brand ? (
            <FontAwesome5 name={brand.icon} size={Math.round(size * 0.38)} color={brand.color} brand style={styles.iconShadow} />
          ) : (
            <Feather name={brand.icon as any} size={Math.round(size * 0.38)} color={brand.color} style={styles.iconShadow} />
          )}
        </View>
      </Reanimated.View>
    </GestureDetector>
  );
});

/**
 * The bubble field. Lays itself out in the header to the right of the avatar; `active` should be
 * the screen's focus state so the loops stop when the profile is not on screen.
 */
export const ProfileLinkBubbles = memo(function ProfileLinkBubbles({
  links,
  top,
  left,
  height,
  active,
  glassActive,
}: {
  links: { url: string }[];
  top: number;
  left: number;
  height: number;
  active: boolean;
  glassActive: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [settled, setSettled] = React.useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setSettled(true));
    return () => handle.cancel();
  }, []);

  const list = links.slice(0, 5);
  const areaW = Math.max(0, width - left - 12);
  const layout = LAYOUTS[list.length - 1];
  if (!layout || areaW < 80) return null;
  const running = active && settled && !reduceMotion;

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top, left, width: areaW, height }}>
      {list.map((l, i) => {
        const size = SIZES[i];
        const [fx, fy] = layout[i];
        const cx = Math.min(areaW - size / 2, Math.max(size / 2, fx * areaW));
        const cy = Math.min(height - size / 2, Math.max(size / 2, fy * height));
        return (
          <Bubble
            key={`${l.url}-${i}`}
            url={l.url}
            size={size}
            left={cx - size / 2}
            top={cy - size / 2}
            index={i}
            running={running}
            glassActive={glassActive}
            isDark={theme.isDark}
            websiteLabel={t('edit_profile.link_website')}
          />
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  rim: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.38)' },
  center: { alignItems: 'center', justifyContent: 'center' },
  iconShadow: { textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
