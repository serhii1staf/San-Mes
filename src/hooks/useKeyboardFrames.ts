import { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useKeyboardHandler } from 'react-native-keyboard-controller';
import { browserBandHeightSV } from '../lib/browserBandShared';

/**
 * The keyboard's height on the UI thread, updated on every frame of its movement (0 when closed).
 *
 * Use this, not `useReanimatedKeyboardAnimation` or `KeyboardStickyView`, for anything that has to
 * move WITH the keyboard. On iOS their value is written once, at keyboardWillShow, straight to the
 * end height (react-native-keyboard-controller lib/module/animated.js). That only looks animated
 * when Reanimated mounts the update inside UIKit's keyboard animation; a React commit in flight at
 * that moment makes it land late, and the view jumps to its end position before the keyboard moves.
 * keyboard-controller documents this for KeyboardStickyView. This value follows the per-frame
 * events instead: onMove while the keyboard animates, onInteractive while a finger drags it, onEnd
 * for the exact end value. The chat, comments and search screens use the same three events.
 */
export function useKeyboardFrames(): SharedValue<number> {
  const height = useSharedValue(0);
  useKeyboardHandler(
    {
      onMove: (e) => {
        'worklet';
        height.value = e.height;
      },
      onInteractive: (e) => {
        'worklet';
        height.value = e.height;
      },
      onEnd: (e) => {
        'worklet';
        height.value = e.height;
      },
    },
    [],
  );
  return height;
}

/**
 * A transform that lifts a bottom-docked view above the keyboard, frame by frame.
 *
 * The view keeps `restPadding` (usually the safe area) as its bottom padding at all times and rises
 * by whatever the keyboard covers beyond `restPadding - gap`, so its content ends `gap` above the
 * keyboard. Animating the padding instead would be a layout change on every keyboard move.
 *
 * `underBand`: the screen sits above the minimized-session bar when it shows (every pushed screen
 * and tab), so the keyboard, measured from the bottom of the window, covers the bar before the
 * screen. False for a screen presented over the whole window (an iOS native modal).
 */
export function useKeyboardRiseStyle(restPadding: number, gap = 8, underBand = true) {
  const keyboard = useKeyboardFrames();
  const covered = restPadding - gap;
  return useAnimatedStyle(() => {
    const band = underBand ? browserBandHeightSV.value : 0;
    return { transform: [{ translateY: -Math.max(0, keyboard.value - band - covered) }] };
  });
}
