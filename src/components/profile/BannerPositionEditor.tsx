/**
 * Banner position editor: drag and pinch the picked image to frame it, then save.
 *
 * ── THE NEW LAYOUT ───────────────────────────────────────────────────────────
 *
 * Asked for: "более стильно, как-то по центру". The old one was a full-width strip pinned under a
 * row of three buttons at the top of a near-black screen. Now:
 *
 *   • the backdrop is the same image, blurred and dimmed, so the editor is tinted by what is being
 *     edited instead of being a black void;
 *   • the frame is centred on screen, inset from the edges with rounded corners, the title and hint
 *     above it;
 *   • when zoomed in, the part of the image that falls OUTSIDE the frame stays faintly visible around
 *     it, so it is obvious what is being cut off and which way there is room to drag;
 *   • the actions sit at the bottom where the thumb is: Отмена, Сбросить, Готово.
 *
 * ── SAME COORDINATES AS BEFORE ───────────────────────────────────────────────
 *
 * A saved transform must keep meaning what it meant: the profile applies it to a cover-fitted image
 * in a full-width banner (see `ProfileHeaderCard`). So the image is still laid out at the REAL banner
 * size (screen width × BANNER_EDIT_HEIGHT) and the whole real-size box is scaled down by `k` to fit
 * the inset frame. Translations are stored in real-banner points, so a finger movement of `d` screen
 * points moves the image by `d / k`.
 *
 * ── THE FRAME STAYS COVERED ──────────────────────────────────────────────────
 *
 * The image is cover-fitted to the banner, so at 1× there is nothing beyond the frame to reveal, and
 * dragging used to just pull an empty band of background into the banner, which is how it then showed
 * on the profile. Now a drag past the edge meets resistance and springs back on release, and zooming
 * out pulls the image back so it still covers the frame.
 *
 * Gestures drive Reanimated shared values on the UI thread, so the drag stays smooth while the editor
 * screen underneath is busy. The `GestureHandlerRootView` inside the Modal is mandatory: RN portals a
 * Modal's contents outside the app's gesture root.
 */
import React, { useEffect, useMemo } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { CachedImage } from '../ui/CachedImage';
import { NativeGlassView, useLiquidGlassActive } from '../ui/LiquidGlass';
import { useT } from '../../i18n/store';
import { triggerHaptic } from '../../utils/haptics';
import type { BannerTransform } from '../../utils/bannerTransform';

/** The real banner's height: the frame the saved transform is expressed in. */
export const BANNER_EDIT_HEIGHT = 300;
const MIN_SCALE = 1;
const MAX_SCALE = 3;
const FRAME_SIDE_INSET = 16;
const FRAME_RADIUS = 20;
/** One decode for all three layers of the same image. */
const IMAGE_PROXY_WIDTH = 800;
/** Fraction of an overshoot past the edge that still follows the finger. */
const RUBBER = 0.35;
/** How visible the part of the image outside the frame is, at most. */
const GHOST_OPACITY = 0.3;
const SETTLE = { damping: 24, stiffness: 240, mass: 0.8 };

/** How far the image may move from centre along one axis at scale `s` and still cover the frame. */
function maxOffset(size: number, s: number): number {
  'worklet';
  return Math.max(0, (size * s - size) / 2);
}

function clampOffset(v: number, size: number, s: number): number {
  'worklet';
  const m = maxOffset(size, s);
  return Math.min(m, Math.max(-m, v));
}

/** Follows the finger inside the limit, with resistance past it. */
function rubberBand(v: number, size: number, s: number): number {
  'worklet';
  const m = maxOffset(size, s);
  if (v > m) return m + (v - m) * RUBBER;
  if (v < -m) return -m + (v + m) * RUBBER;
  return v;
}

/**
 * The image at real-banner size, scaled into the frame. Rendered twice: faint outside, clipped inside.
 * `still`: a GIF holds its first frame (the faint copy), so only the framed one animates.
 */
function ScaledImage({
  uri,
  realW,
  frameW,
  frameH,
  k,
  imageStyle,
  wrapStyle,
  still,
}: {
  uri: string;
  realW: number;
  frameW: number;
  frameH: number;
  k: number;
  imageStyle: React.ComponentProps<typeof Animated.View>['style'];
  wrapStyle?: React.ComponentProps<typeof Animated.View>['style'];
  still?: boolean;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: realW,
          height: BANNER_EDIT_HEIGHT,
          left: (frameW - realW) / 2,
          top: (frameH - BANNER_EDIT_HEIGHT) / 2,
          transform: [{ scale: k }],
        },
        wrapStyle,
      ]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, imageStyle]}>
        <CachedImage uri={uri} style={StyleSheet.absoluteFillObject} resizeMode="cover" proxyWidth={IMAGE_PROXY_WIDTH} autoplay={still ? false : undefined} />
      </Animated.View>
    </Animated.View>
  );
}

function GlassPill({ glass, onPress, children, label }: { glass: boolean; onPress: () => void; children: React.ReactNode; label: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={glass ? styles.pillHostGlass : styles.pillHost}>
      {glass ? (
        <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={styles.pill}>
          {children}
        </NativeGlassView>
      ) : (
        <View style={[styles.pill, styles.pillFlat]}>{children}</View>
      )}
    </Pressable>
  );
}

export function BannerPositionEditor({
  visible,
  uri,
  initial,
  onCancel,
  onSave,
}: {
  visible: boolean;
  uri: string | null;
  initial: BannerTransform;
  onCancel: () => void;
  onSave: (transform: BannerTransform) => void;
}) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const glass = useLiquidGlassActive();

  const { realW, frameW, frameH, k } = useMemo(() => {
    const w = Dimensions.get('window').width;
    const fw = w - FRAME_SIDE_INSET * 2;
    const scale = fw / w;
    return { realW: w, frameW: fw, frameH: Math.round(BANNER_EDIT_HEIGHT * scale), k: scale };
  }, []);

  const translateX = useSharedValue(initial.translateX);
  const translateY = useSharedValue(initial.translateY);
  const scale = useSharedValue(initial.scale);
  // Values at the start of each gesture, so successive drags and pinches add up.
  const startX = useSharedValue(initial.translateX);
  const startY = useSharedValue(initial.translateY);
  const startScale = useSharedValue(initial.scale);

  // Re-seed whenever the editor opens, possibly against a different `initial` (a Cancel must not leave
  // the previous in-editor state behind for the next open). Clamped, because a transform saved by the
  // old editor may leave part of the frame uncovered.
  useEffect(() => {
    if (!visible) return;
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, initial.scale || 1));
    const x = clampOffset(initial.translateX || 0, realW, s);
    const y = clampOffset(initial.translateY || 0, BANNER_EDIT_HEIGHT, s);
    scale.value = s;
    translateX.value = x;
    translateY.value = y;
    startScale.value = s;
    startX.value = x;
    startY.value = y;
  }, [visible, initial.translateX, initial.translateY, initial.scale, realW, scale, translateX, translateY, startScale, startX, startY]);

  const gesture = useMemo(() => {
    const settle = (x: SharedValue<number>, y: SharedValue<number>, s: number) => {
      'worklet';
      x.value = withSpring(clampOffset(x.value, realW, s), SETTLE);
      y.value = withSpring(clampOffset(y.value, BANNER_EDIT_HEIGHT, s), SETTLE);
    };
    const pan = Gesture.Pan()
      .averageTouches(true)
      .onStart(() => {
        startX.value = translateX.value;
        startY.value = translateY.value;
      })
      .onUpdate((e) => {
        // Screen points to real-banner points.
        translateX.value = rubberBand(startX.value + e.translationX / k, realW, scale.value);
        translateY.value = rubberBand(startY.value + e.translationY / k, BANNER_EDIT_HEIGHT, scale.value);
      })
      .onEnd(() => {
        settle(translateX, translateY, scale.value);
      });
    const pinch = Gesture.Pinch()
      .onStart(() => {
        startScale.value = scale.value;
      })
      .onUpdate((e) => {
        scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale.value * e.scale));
      })
      .onEnd(() => {
        settle(translateX, translateY, scale.value);
      });
    return Gesture.Simultaneous(pan, pinch);
  }, [k, realW, scale, startScale, startX, startY, translateX, translateY]);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));
  // The faint copy around the frame only has something to show once the image is zoomed or pulled
  // off centre; at rest it would only peek out at the frame's rounded corners.
  const ghostStyle = useAnimatedStyle(() => {
    const zoomed = (scale.value - 1) / 0.12;
    const moved = Math.max(Math.abs(translateX.value), Math.abs(translateY.value)) / 16;
    return { opacity: GHOST_OPACITY * Math.min(1, Math.max(0, zoomed, moved)) };
  });

  const reset = () => {
    triggerHaptic('light');
    translateX.value = withSpring(0, SETTLE);
    translateY.value = withSpring(0, SETTLE);
    scale.value = withSpring(1, SETTLE);
  };

  const save = () => {
    triggerHaptic('light');
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value));
    onSave({
      translateX: clampOffset(translateX.value, realW, s),
      translateY: clampOffset(translateY.value, BANNER_EDIT_HEIGHT, s),
      scale: s,
    });
  };

  if (!uri) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        {/* The image itself, blurred, as the backdrop. Same proxy width as the frame, so it is the same
            download; the blur is a single static pass, not a live blur view. A GIF holds its first
            frame here: animated, every frame of a full-screen layer was decoded (and on Android not
            blurred) behind the editor, the heaviest of the layers that froze a quick drag. */}
        <CachedImage uri={uri} style={StyleSheet.absoluteFillObject} resizeMode="cover" proxyWidth={IMAGE_PROXY_WIDTH} blurRadius={40} autoplay={false} />
        <View style={[StyleSheet.absoluteFill, styles.dim]} />

        {/* The whole screen is the drag surface, not only the frame: a small frame is a small target. */}
        <GestureDetector gesture={gesture}>
          <View style={[styles.stage, { paddingTop: insets.top + 12 }]}>
            <RNText style={styles.title} allowFontScaling={false} numberOfLines={1}>
              {t('edit_profile.banner.editor_title')}
            </RNText>
            <RNText style={styles.hint} allowFontScaling={false} numberOfLines={1}>
              {t('edit_profile.banner.editor_hint')}
            </RNText>
            <View style={{ width: frameW, height: frameH, marginTop: 22 }}>
              <ScaledImage uri={uri} realW={realW} frameW={frameW} frameH={frameH} k={k} imageStyle={imageStyle} wrapStyle={ghostStyle} still />
              <View style={[StyleSheet.absoluteFill, styles.frameClip]}>
                <ScaledImage uri={uri} realW={realW} frameW={frameW} frameH={frameH} k={k} imageStyle={imageStyle} />
              </View>
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.frameRing]} />
            </View>
          </View>
        </GestureDetector>

        <View style={[styles.bar, { paddingBottom: insets.bottom + 18 }]}>
          <GlassPill glass={glass} onPress={onCancel} label={t('edit_profile.banner.cancel')}>
            <RNText style={styles.pillText} allowFontScaling={false}>
              {t('edit_profile.banner.cancel')}
            </RNText>
          </GlassPill>
          <GlassPill glass={glass} onPress={reset} label={t('edit_profile.banner.reset')}>
            <Feather name="rotate-ccw" size={15} color="#FFFFFF" />
            <RNText style={styles.pillText} allowFontScaling={false}>
              {t('edit_profile.banner.reset')}
            </RNText>
          </GlassPill>
          <Pressable onPress={save} hitSlop={8} accessibilityRole="button" style={({ pressed }) => [styles.done, pressed ? { opacity: 0.85 } : null]}>
            <RNText style={styles.doneText} allowFontScaling={false}>
              {t('common.done')}
            </RNText>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  dim: { backgroundColor: 'rgba(0,0,0,0.5)' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', textAlign: 'center', paddingHorizontal: 24 },
  hint: { color: 'rgba(255,255,255,0.62)', fontSize: 13, fontWeight: '500', marginTop: 4, textAlign: 'center', paddingHorizontal: 24 },
  frameClip: { borderRadius: FRAME_RADIUS, overflow: 'hidden' },
  frameRing: {
    borderRadius: FRAME_RADIUS,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  pillHost: { borderRadius: 22, overflow: 'hidden' },
  pillHostGlass: { borderRadius: 22, overflow: 'visible' },
  pill: {
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  pillFlat: { backgroundColor: 'rgba(255,255,255,0.16)' },
  pillText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  done: {
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  doneText: { color: '#000000', fontSize: 15, fontWeight: '700' },
});
