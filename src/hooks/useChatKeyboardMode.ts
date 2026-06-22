import { useCallback } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

// ─── Chat keyboard input-mode override (root-cause fix for first-focus jump) ──
//
// THE PROBLEM (Android only):
// Our chat screens drive their OWN smooth content lift via
// `react-native-keyboard-controller` (KeyboardStickyView + a list translateY fed
// by `useReanimatedKeyboardAnimation`). But the Android window's default soft
// input mode is `adjustResize` (Expo default, + edge-to-edge). So on the FIRST
// focus the OS ALSO resizes the window — content moves twice (OS resize + our JS
// transform) = the abrupt jump / "focus goes to the wrong place". On the second
// tap the window is already resized, so it looks native. JS-only transform tweaks
// can't fix this because the fight is with the native window resize itself.
//
// THE FIX:
// While a chat screen with a custom JS-driven input bar is focused, switch the
// window to `SOFT_INPUT_ADJUST_NOTHING`. The OS then stops moving the window, so
// ONLY our smooth transform animates the content — no double-move, no first-focus
// jump. On blur/unmount we restore the app default (`setDefaultMode`) so every
// other screen keeps normal `adjustResize` behaviour.
//
// This is a RUNTIME native override exposed by the already-installed
// `react-native-keyboard-controller` (verified present in this version:
// `KeyboardController.setInputMode` / `.setDefaultMode`, enum
// `AndroidSoftInputModes.SOFT_INPUT_ADJUST_NOTHING = 48`). It ships via OTA — it
// is NOT an app.json `softwareKeyboardLayoutMode` change and needs no native
// rebuild. It is also fully compatible with the root `<KeyboardProvider>`:
// `setInputMode` is a per-window runtime override on top of the provider.
//
// iOS: no-op. The whole effect early-returns on iOS, and the native calls are
// `@platform android` no-ops anyway. Calls are wrapped in try/catch so an older
// binary that somehow lacks the method degrades silently instead of crashing.

// `react-native-keyboard-controller` is already a hard dependency of these chat
// screens (KeyboardStickyView etc.), so the native module is guaranteed present
// in any binary that renders them. We still load defensively to mirror the
// codebase's guarded-native-module convention.
let KeyboardController: typeof import('react-native-keyboard-controller').KeyboardController | null = null;
let AndroidSoftInputModes: typeof import('react-native-keyboard-controller').AndroidSoftInputModes | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const kc = require('react-native-keyboard-controller');
  KeyboardController = kc.KeyboardController ?? null;
  AndroidSoftInputModes = kc.AndroidSoftInputModes ?? null;
} catch {
  KeyboardController = null;
  AndroidSoftInputModes = null;
}

/**
 * Switches the Android window to `SOFT_INPUT_ADJUST_NOTHING` while the calling
 * chat screen is focused, and restores the app default on blur/unmount.
 *
 * Use this ONLY on screens that perform their own JS-driven input-bar lift
 * (KeyboardStickyView + list translateY). It is purely additive — it does not
 * touch any animation values, the input bar, or gesture logic.
 *
 * No-op on iOS.
 */
export function useChatKeyboardMode(): void {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const KC = KeyboardController;
      const modes = AndroidSoftInputModes;
      if (!KC || !modes) return;

      // Stop the OS from resizing/panning the window — let ONLY our JS transform move content.
      try {
        KC.setInputMode(modes.SOFT_INPUT_ADJUST_NOTHING);
      } catch {}

      // Always restore the manifest default so non-chat screens keep adjustResize.
      return () => {
        try {
          KC.setDefaultMode();
        } catch {}
      };
    }, []),
  );
}
