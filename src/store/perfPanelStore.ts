/**
 * Tiny visibility store for the in-app performance-monitor panel.
 *
 * Why this exists separate from `PerfMonitorBubble`'s local state:
 *  - The Dynamic Island companion overlay's FPS tile wants to open the
 *    panel directly, but the bubble owns the Modal that hosts it. With
 *    only React-tree communication available, the only ways to reach the
 *    bubble's local state are (a) prop drilling from the app root, (b)
 *    React context, or (c) a tiny external store. (c) is the lightest
 *    touch — no provider, no re-renders for unrelated consumers, no
 *    refactor of the bubble's gesture surface.
 *
 *  - Future surfaces (a "Perf" entry in settings, a deep-linked URL, etc.)
 *    can also flip the same store, so the panel is reachable from anywhere.
 *
 * State machine: just `open: boolean`. The bubble component subscribes,
 * everything else writes.
 */

import { create } from 'zustand';

interface PerfPanelState {
  open: boolean;
  setOpen: (next: boolean) => void;
  show: () => void;
  hide: () => void;
}

export const usePerfPanelStore = create<PerfPanelState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
