import React from 'react';
import { StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const TIMING_CONFIG = { duration: 300 };

interface ZoomableImageProps {
  uri: string;
  width: number;
  height: number;
  minScale?: number;
  maxScale?: number;
  onClose?: () => void;
}

export function ZoomableImage({
  uri,
  width,
  height,
  minScale = 1,
  maxScale = 3,
  onClose,
}: ZoomableImageProps) {
  // Shared values for zoom state
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  /**
   * Clamp translate values so image edges don't exceed viewport bounds.
   * When scale > 1, the image is larger than viewport; allow panning
   * up to the point where the image edge meets the viewport edge.
   */
  const clampTranslate = (
    translate: number,
    imageSize: number,
    viewportSize: number,
    currentScale: number,
  ): number => {
    'worklet';
    const scaledSize = imageSize * currentScale;
    if (scaledSize <= viewportSize) {
      return 0;
    }
    const maxTranslate = (scaledSize - viewportSize) / 2;
    return Math.min(Math.max(translate, -maxTranslate), maxTranslate);
  };

  // Pinch gesture: scale from minScale to maxScale with savedScale accumulation
  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = savedScale.value * event.scale;
    })
    .onEnd(() => {
      // Bounce-back if exceeds bounds
      if (scale.value > maxScale) {
        scale.value = withTiming(maxScale, TIMING_CONFIG);
      } else if (scale.value < minScale) {
        scale.value = withTiming(minScale, TIMING_CONFIG);
        translateX.value = withTiming(0, TIMING_CONFIG);
        translateY.value = withTiming(0, TIMING_CONFIG);
      }
      savedScale.value = scale.value;
    });

  // Pan gesture: move image when scale > 1, clamped to viewport bounds
  const panGesture = Gesture.Pan()
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      if (scale.value > minScale) {
        const newTranslateX = savedTranslateX.value + event.translationX;
        const newTranslateY = savedTranslateY.value + event.translationY;

        translateX.value = clampTranslate(newTranslateX, width, SCREEN_WIDTH, scale.value);
        translateY.value = clampTranslate(newTranslateY, height, SCREEN_HEIGHT, scale.value);
      }
    })
    .onEnd(() => {
      // If scale returned to 1, reset translate
      if (scale.value <= minScale) {
        translateX.value = withTiming(0, TIMING_CONFIG);
        translateY.value = withTiming(0, TIMING_CONFIG);
      }
    })
    .minPointers(1)
    .maxPointers(2);

  // Double tap: toggle between 1x and 2x, centering on tap point
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((event) => {
      if (scale.value > minScale) {
        // Zoom out to 1x
        scale.value = withTiming(minScale, TIMING_CONFIG);
        savedScale.value = minScale;
        translateX.value = withTiming(0, TIMING_CONFIG);
        translateY.value = withTiming(0, TIMING_CONFIG);
      } else {
        // Zoom in to 2x centered on tap point
        const targetScale = Math.min(2, maxScale);
        scale.value = withTiming(targetScale, TIMING_CONFIG);
        savedScale.value = targetScale;

        // Calculate offset to center on tap point
        const tapX = event.x - SCREEN_WIDTH / 2;
        const tapY = event.y - SCREEN_HEIGHT / 2;

        // Offset is negative because we move the image opposite to tap direction
        const targetX = clampTranslate(
          -tapX * (targetScale - 1),
          width,
          SCREEN_WIDTH,
          targetScale,
        );
        const targetY = clampTranslate(
          -tapY * (targetScale - 1),
          height,
          SCREEN_HEIGHT,
          targetScale,
        );

        translateX.value = withTiming(targetX, TIMING_CONFIG);
        translateY.value = withTiming(targetY, TIMING_CONFIG);
      }
    });

  // Compose gestures: pinch + pan are simultaneous, double tap is exclusive
  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);
  const finalGesture = Gesture.Exclusive(doubleTapGesture, composedGesture);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: scale.value },
      ],
    };
  });

  return (
    <GestureDetector gesture={finalGesture}>
      <Animated.Image
        source={{ uri }}
        style={[
          styles.image,
          { width, height },
          animatedStyle,
        ]}
        resizeMode="contain"
      />
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  image: {
    maxWidth: SCREEN_WIDTH,
    maxHeight: SCREEN_HEIGHT,
  },
});
