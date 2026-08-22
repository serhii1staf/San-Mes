import { useSyncExternalStore } from 'react';
import { getPowerMode, subscribePowerMode, type PowerMode } from '../services/powerMode';

/**
 * Subscribe to Low Power Mode.
 *
 * `useSyncExternalStore` rather than state + effect so a mode change mid-session
 * re-renders consumers without the screen having to remount — the user toggles
 * Low Power Mode from Control Centre while the app is open, and the app must adapt
 * on the spot.
 *
 * Mirrors the pattern already used for reduce-transparency in `LiquidGlass.tsx`;
 * no new convention introduced.
 */
export function usePowerMode(): PowerMode {
  return useSyncExternalStore(subscribePowerMode, getPowerMode, () => 'unknown' as PowerMode);
}
