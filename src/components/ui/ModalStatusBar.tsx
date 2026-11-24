import { useEffect } from 'react';
import { Platform, StatusBar } from 'react-native';

/**
 * Hides the top system status bar (clock / battery / Wi-Fi) — but ONLY on iOS.
 *
 * Our full-screen modals (context menus, sheets, media/image viewers, the
 * music player) hide the status bar so they read as immersive overlays. On
 * Android, toggling the status bar per-modal causes a visible flicker / layout
 * jump and the user explicitly wants the clock + battery to stay put, so on
 * Android this does nothing and leaves the status bar alone.
 *
 * ── IT FADES NOW, BOTH WAYS (Nov 2026) ─────────────────────────────────────────
 *
 * Asked, about the hold menu: the status bar ("там где время, зарядка") should go and come back
 * smoothly. It was `<StatusBar hidden />`, which hides it with no animation, and on unmount React
 * Native's StatusBar falls back to its defaults, which also have no animation: the clock and the
 * battery vanished in one frame when a menu opened and popped back in one frame after it had closed
 * smoothly.
 *
 * Now `StatusBar.setHidden(…, 'fade')` both ways. It also updates React Native's default props, so any
 * declarative `<StatusBar>` elsewhere stays consistent with it. Counted, because these nest (a menu
 * inside a Modal that hides it too, the post menu's two cards in one Modal): the bar comes back only
 * when the last one lets go.
 *
 * `hidden={false}` lets go early, so a surface can bring the bar back as its close animation starts
 * rather than after it.
 */
let holders = 0;

export function ModalStatusBar({ hidden = true }: { hidden?: boolean } = {}) {
  useEffect(() => {
    if (Platform.OS !== 'ios' || !hidden) return;
    holders += 1;
    if (holders === 1) StatusBar.setHidden(true, 'fade');
    return () => {
      holders = Math.max(0, holders - 1);
      if (holders === 0) StatusBar.setHidden(false, 'fade');
    };
  }, [hidden]);
  return null;
}
