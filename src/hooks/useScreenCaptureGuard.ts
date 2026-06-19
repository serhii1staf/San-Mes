import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

// ─── Screen-capture protection ───────────────────────────────────────────────
//
// Applies capture protection WHILE the screen is focused, gated by `enabled`
// (which the caller derives from the VIEWED account's `screenshots_disabled`
// flag — so it's per-account, fetched once with the profile, NOT polled).
//
// ⚠️ CRITICAL — guarded native-module load:
// `expo-screen-capture` calls `requireNativeModule('ExpoScreenCapture')` at the
// TOP LEVEL of its module. A static `import … from 'expo-screen-capture'` therefore
// THROWS at import-evaluation time on any binary that doesn't bundle the native
// module (every production/dev build made BEFORE the module was added, including
// anything running our OTA channel until the next native release). That throw
// can't be caught by wrapping the call sites — it happens while the module graph
// is loading, so it crashed the whole screen ("Cannot find native module
// 'ExpoScreenCapture'"). We therefore `require()` it inside try/catch ONCE and
// degrade to a no-op when it's absent. Do NOT convert this back to a static import.
let ScreenCapture: typeof import('expo-screen-capture') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ScreenCapture = require('expo-screen-capture');
} catch {
  ScreenCapture = null;
}

// Platform reality (only relevant when the native module IS present):
//   • Android — `preventScreenCaptureAsync` sets FLAG_SECURE, which blocks BOTH
//     screenshots AND screen recording at the OS level (the captured frame is
//     black). Fully effective, including over any modal/menu on top.
//   • iOS — Apple does NOT allow apps to block a still screenshot. We blank the
//     content during screen RECORDING / mirroring, and DETECT a screenshot after
//     the fact via `addScreenshotListener` so the caller can flash a cover.
//
// `key` ref-counts protection so several mounted guards don't fight each other.
export function useScreenCaptureGuard(enabled: boolean, key: string): { screenshotDetected: boolean } {
  const [screenshotDetected, setScreenshotDetected] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // No-op when disabled OR when the native module isn't in this binary.
      if (!enabled || !ScreenCapture) return;
      const SC = ScreenCapture;
      let sub: { remove: () => void } | undefined;
      let active = true;

      try { SC.preventScreenCaptureAsync(key).catch(() => {}); } catch {}
      if (Platform.OS === 'ios') {
        // iOS can't block the still screenshot — detect it and let the caller
        // throw up the cover shield (black + 🙈). Auto-clears so the shield
        // shows briefly then the screen returns to normal.
        try {
          sub = SC.addScreenshotListener(() => {
            if (!active) return;
            setScreenshotDetected(true);
            setTimeout(() => { if (active) setScreenshotDetected(false); }, 2600);
          });
        } catch {}
      }

      return () => {
        active = false;
        try { SC.allowScreenCaptureAsync(key).catch(() => {}); } catch {}
        try { sub?.remove(); } catch {}
        setScreenshotDetected(false);
      };
    }, [enabled, key]),
  );

  return { screenshotDetected };
}
