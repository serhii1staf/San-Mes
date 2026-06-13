/**
 * Tiny visibility store for the Dynamic Island companion overlay.
 *
 * Mirrors the iOS Dynamic Island UX without touching ActivityKit (which we
 * can't use from Expo OTA): a floating Liquid-Glass pill that wraps the
 * notch area, expandable to a half-screen card with a 4-tile dashboard.
 *
 * Why a separate Zustand store rather than React state inside the host:
 *  - The trigger gesture region lives at the app root (above every screen)
 *    and must flip visibility from outside the host's tree.
 *  - The host fully unmounts when `visible === false` so we pay zero idle
 *    cost — keeping state in a tiny external store survives that unmount.
 *  - Multiple screens may want to dismiss the overlay (back-button, route
 *    change, etc.) and need a stable global handle.
 *
 * State machine:
 *  - `visible` toggles whether the host is mounted at all.
 *  - `expanded` only matters when `visible === true`. Toggling it animates
 *    the pill into/out of the half-screen card on the UI thread.
 */

import { create } from 'zustand';

interface DynamicOverlayState {
  visible: boolean;
  expanded: boolean;
  /** Mount the overlay in collapsed state. Idempotent. */
  show: () => void;
  /** Unmount the overlay completely. Resets `expanded` so the next
   *  `show()` always starts as a pill. */
  hide: () => void;
  /** Flip between collapsed pill and expanded card. No-op when hidden. */
  toggleExpand: () => void;
  /** Force back to the collapsed pill state (used by interaction handlers
   *  that want to keep the overlay open but cancel the expanded view). */
  collapse: () => void;
}

export const useDynamicOverlayStore = create<DynamicOverlayState>((set, get) => ({
  visible: false,
  expanded: false,
  show: () => {
    if (get().visible) return;
    set({ visible: true, expanded: false });
  },
  hide: () => set({ visible: false, expanded: false }),
  toggleExpand: () => {
    if (!get().visible) return;
    set((s) => ({ expanded: !s.expanded }));
  },
  collapse: () => {
    if (!get().visible) return;
    set({ expanded: false });
  },
}));
