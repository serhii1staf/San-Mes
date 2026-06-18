import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';

// ─── Screen-capture protection ───────────────────────────────────────────────
//
// Applies capture protection WHILE the screen is focused, gated by `enabled`
// (which the caller derives from the VIEWED account's `screenshots_disabled`
// flag — so it's per-account, fetched once with the profile, NOT polled).
//
// Platform reality:
//   • Android — `preventScreenCaptureAsync` sets FLAG_SECURE, which blocks BOTH
//     screenshots AND screen recording at the OS level (the captured frame is
//     black). Fully effective, including over any modal/menu on top.
//   • iOS — Apple does NOT allow apps to block a still screenshot. What we CAN
//     do: `preventScreenCaptureAsync` blanks the content during screen
//     RECORDING / mirroring, and `addScreenshotListener` DETECTS a screenshot
//     after the fact so we can flash a cover overlay. So on iOS recording is
//     blocked and a screenshot is detected (caller shows the 🙈 shield), but
//     the still image itself can't be prevented — an OS limitation.
//
// `key` ref-counts protection so several mounted guards don't fight each other:
// capture is re-allowed only once every active key has released.
export function useScreenCaptureGuard(enabled: boolean, key: string): { screenshotDetected: boolean } {
  const [screenshotDetected, setScreenshotDetected] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      let sub: { remove: () => void } | undefined;
      let active = true;

      ScreenCapture.preventScreenCaptureAsync(key).catch(() => {});
      if (Platform.OS === 'ios') {
        // iOS can't block the still screenshot — detect it and let the caller
        // throw up the cover shield (black + 🙈). Auto-clears so the shield
        // shows briefly then the screen returns to normal.
        try {
          sub = ScreenCapture.addScreenshotListener(() => {
            if (!active) return;
            setScreenshotDetected(true);
            setTimeout(() => { if (active) setScreenshotDetected(false); }, 2600);
          });
        } catch {}
      }

      return () => {
        active = false;
        ScreenCapture.allowScreenCaptureAsync(key).catch(() => {});
        try { sub?.remove(); } catch {}
        setScreenshotDetected(false);
      };
    }, [enabled, key]),
  );

  return { screenshotDetected };
}
