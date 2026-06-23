import { useEffect, useState } from 'react';
import { isLoaded as isFontLoaded } from 'expo-font';

import type { FontLoadState } from '../theme/profileThemeEffective';
import type { ThemeFont } from '../theme/profileThemes';

/**
 * Seasonal Profile Themes — Theme_Font load-state hook (task 6.3).
 *
 * Reports the runtime {@link FontLoadState} of a theme's own {@link ThemeFont}
 * so themed-text components can fall back to the app default font on error or
 * after a 5-second timeout while still applying the theme palette (Req 4.8,
 * 4.9, 5.4). The state is consumed by `effectiveFont(theme, state)`.
 *
 * Behaviour:
 * - No theme font, or a theme font with no bundled `asset` (the PLACEHOLDER
 *   phase, where fonts are not yet sourced/licensed) → `'absent'`, so callers
 *   render the app default font.
 * - A theme font whose family is already loaded by `expo-font` → `'loaded'`.
 * - Otherwise `'loading'` until the font finishes loading, flipping to
 *   `'loaded'`; if it has not loaded within 5 seconds it flips to `'error'`
 *   (Req 5.4) — the same app-default fallback path used by `effectiveFont`.
 */
const FONT_LOAD_TIMEOUT_MS = 5000;
const FONT_POLL_INTERVAL_MS = 200;

export function useThemeFontState(font: ThemeFont | null | undefined): FontLoadState {
  const family = font?.family ?? null;
  // A bundled asset is required to load a custom font. Until one is sourced
  // (PLACEHOLDER phase) the font can never load, so it is treated as absent.
  const hasAsset = font?.asset != null;

  const computeInitial = (): FontLoadState => {
    if (!family || !hasAsset) return 'absent';
    return isFontLoaded(family) ? 'loaded' : 'loading';
  };

  const [state, setState] = useState<FontLoadState>(computeInitial);

  useEffect(() => {
    if (!family || !hasAsset) {
      setState('absent');
      return;
    }
    if (isFontLoaded(family)) {
      setState('loaded');
      return;
    }

    setState('loading');
    let cancelled = false;

    const poll = setInterval(() => {
      if (cancelled) return;
      if (isFontLoaded(family)) {
        clearInterval(poll);
        clearTimeout(timeout);
        setState('loaded');
      }
    }, FONT_POLL_INTERVAL_MS);

    const timeout = setTimeout(() => {
      if (cancelled) return;
      clearInterval(poll);
      // Final check: load may have completed between the last poll and the
      // timeout firing.
      setState(isFontLoaded(family) ? 'loaded' : 'error');
    }, FONT_LOAD_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearTimeout(timeout);
    };
  }, [family, hasAsset]);

  return state;
}

export default useThemeFontState;
