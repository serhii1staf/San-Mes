import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, Dimensions, FlatList } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
  Easing,
} from 'react-native-reanimated';
import { CachedImage } from '../ui/CachedImage';
import { ModalStatusBar } from '../ui/ModalStatusBar';

/**
 * Full-screen photo viewer for the chat.
 *
 * ── WHY IT IS ITS OWN COMPONENT ───────────────────────────────────────────────
 * It used to be inline JSX inside the chat screen, which is what made dragging it
 * feel awful. The pager's `renderItem`, `keyExtractor` and `getItemLayout` were
 * inline arrows, so EVERY re-render of the chat screen handed the viewer's FlatList
 * fresh identities and re-rendered all three mounted full-screen images. The chat
 * screen re-renders often (keyboard frames, reveal state, store pushes), and while
 * the viewer was open those re-renders were landing mid-gesture — so a drag was
 * competing with three image re-renders per frame.
 *
 * Extracted and memoized on primitives, with all three callbacks stable, the viewer
 * is now completely insulated: nothing the chat screen does re-renders it.
 *
 * ── ANIMATION ─────────────────────────────────────────────────────────────────
 * The old version relied on `Modal animationType="fade"`, which pops. Open and close
 * are now a Reanimated scale + backdrop fade on the UI thread, and the modal itself
 * mounts with no animation so the two never fight. Close waits for the exit to
 * finish before unmounting, so the image never disappears before the backdrop.
 *
 * Dragging down dismisses, tracking the finger with the backdrop fading out as it
 * goes — the interaction people expect from a photo viewer. All of it runs in
 * worklets, so it cannot be slowed by whatever JS is busy.
 *
 * ── CACHE ─────────────────────────────────────────────────────────────────────
 * `proxyWidth` is passed in by the caller so the viewer requests the SAME derivative
 * the chat bubbles already decoded. Without it the viewer asked for a different size,
 * which is a different cache key and therefore a fresh download + decode on open.
 */

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/** Drag further than this (or flick faster) and the viewer dismisses. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;

export interface ImageViewerModalProps {
  /** Non-null opens the viewer. */
  payload: { images: string[]; index: number } | null;
  onClose: () => void;
  topInset: number;
  /**
   * Proxy width to request, matched to what the bubbles used so the images come
   * from the memory cache instead of being re-fetched at a new size.
   */
  proxyWidth: number;
}

function ImageViewerModalComponent({ payload, onClose, topInset, proxyWidth }: ImageViewerModalProps) {
  // Kept mounted for the length of the exit animation so the content does not blink
  // out before the backdrop has faded.
  const [mounted, setMounted] = useState(!!payload);
  // Frozen copy of the payload, so a parent clearing it mid-exit cannot empty the
  // pager while it is still on screen.
  const [shown, setShown] = useState(payload);

  const enter = useSharedValue(0);
  const dragY = useSharedValue(0);

  useEffect(() => {
    if (payload) {
      setShown(payload);
      setMounted(true);
      dragY.value = 0;
      enter.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      enter.value = withTiming(0, { duration: 170, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
    // `mounted` is read, not depended on: adding it would re-run the exit on the
    // state change the exit itself causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, enter, dragY]);

  const requestClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Backdrop opacity folds in the drag so pulling the photo down reveals the chat
  // behind it, rather than dimming at full strength until the very last frame.
  const backdropStyle = useAnimatedStyle(() => {
    const dragFade = interpolate(Math.abs(dragY.value), [0, SCREEN_H * 0.5], [1, 0], Extrapolation.CLAMP);
    return { opacity: enter.value * dragFade };
  });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: dragY.value },
      // A small scale-in on open, and a slight shrink while dragging away, which is
      // what makes the dismiss read as "throwing it back into the chat".
      {
        scale:
          interpolate(enter.value, [0, 1], [0.92, 1], Extrapolation.CLAMP) *
          interpolate(Math.abs(dragY.value), [0, SCREEN_H * 0.6], [1, 0.85], Extrapolation.CLAMP),
      },
    ],
  }));

  const dismissGesture = useMemo(
    () =>
      Gesture.Pan()
        // Vertical only, so the horizontal pager keeps its own gesture.
        .activeOffsetY([-14, 14])
        .failOffsetX([-20, 20])
        .onUpdate((e) => {
          dragY.value = e.translationY;
        })
        .onEnd((e) => {
          const far = Math.abs(e.translationY) > DISMISS_DISTANCE;
          const fast = Math.abs(e.velocityY) > DISMISS_VELOCITY;
          if (far || fast) {
            // Continue in the direction of travel, then hand back to the parent.
            const target = e.translationY >= 0 ? SCREEN_H : -SCREEN_H;
            dragY.value = withTiming(target, { duration: 180, easing: Easing.out(Easing.cubic) });
            enter.value = withTiming(0, { duration: 180 }, (finished) => {
              if (finished) {
                runOnJS(setMounted)(false);
                runOnJS(requestClose)();
              }
            });
          } else {
            dragY.value = withSpring(0, { damping: 20, stiffness: 260, mass: 0.7 });
          }
        }),
    [dragY, enter, requestClose],
  );

  // ── Stable pager callbacks ────────────────────────────────────────────────
  const images = shown?.images ?? [];

  const keyExtractor = useCallback((uri: string, i: number) => uri + i, []);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({ length: SCREEN_W, offset: SCREEN_W * index, index }),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: string }) => <ViewerPage uri={item} proxyWidth={proxyWidth} />,
    [proxyWidth],
  );

  if (!mounted || !shown) return null;

  // NOTE: not a native `Modal`. A Modal here would put the viewer in a separate
  // native window, where the Reanimated drag and the chat screen's gesture handler
  // root do not share a coordinate space — and it would re-introduce the platform
  // present/dismiss animation we are replacing. An in-tree absolute overlay with a
  // high zIndex gives the same visual result and keeps one gesture root.
  return (
    <View style={styles.host} pointerEvents="auto">
      <ModalStatusBar />
      <Reanimated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />

      <GestureDetector gesture={dismissGesture}>
        <Reanimated.View style={[StyleSheet.absoluteFill, contentStyle]}>
          <FlatList
            data={images}
            horizontal
            pagingEnabled
            initialScrollIndex={Math.min(shown.index, Math.max(0, images.length - 1))}
            getItemLayout={getItemLayout}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            showsHorizontalScrollIndicator={false}
            style={styles.pager}
            // Three mounted pages at most: the one on screen and one either side.
            initialNumToRender={1}
            maxToRenderPerBatch={1}
            windowSize={3}
            removeClippedSubviews
          />
        </Reanimated.View>
      </GestureDetector>

      <Pressable
        onPress={requestClose}
        hitSlop={10}
        accessibilityRole="button"
        style={[styles.closeBtn, { top: topInset + 12 }]}
      >
        <Feather name="x" size={20} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

/**
 * One page. Memoized on its own props so paging never re-renders its neighbours,
 * and `contain` inside a full-screen box so tall and wide photos both fit without
 * the caller having to know the aspect ratio.
 */
const ViewerPage = memo(function ViewerPage({ uri, proxyWidth }: { uri: string; proxyWidth: number }) {
  return (
    <View style={styles.page}>
      <CachedImage uri={uri} style={styles.image} resizeMode="contain" proxyWidth={proxyWidth} />
    </View>
  );
});

const styles = StyleSheet.create({
  host: { ...StyleSheet.absoluteFillObject, zIndex: 3000 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.95)' },
  pager: { flex: 1 },
  page: { width: SCREEN_W, height: '100%', justifyContent: 'center', alignItems: 'center' },
  image: { width: SCREEN_W, height: '100%' },
  closeBtn: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * Memoized on the payload reference plus primitives. The chat screen re-renders
 * frequently; without this the viewer's pager was being handed new props (and thus
 * re-rendering every mounted image) on each of those renders, which is what made
 * dragging it stutter.
 */
export const ImageViewerModal = memo(
  ImageViewerModalComponent,
  (prev, next) =>
    prev.payload === next.payload &&
    prev.onClose === next.onClose &&
    prev.topInset === next.topInset &&
    prev.proxyWidth === next.proxyWidth,
);
