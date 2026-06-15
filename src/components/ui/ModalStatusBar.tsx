import { Platform, StatusBar } from 'react-native';

/**
 * Hides the top system status bar (clock / battery / Wi-Fi) — but ONLY on iOS.
 *
 * Our full-screen modals (context menus, sheets, media/image viewers, the
 * music player) hide the status bar so they read as immersive overlays. On
 * iOS that looks clean and the bar restores smoothly on dismiss. On Android,
 * toggling the status bar per-modal causes a visible flicker / layout jump and
 * the user explicitly wants the clock + battery to stay put, so on Android we
 * render nothing and leave the status bar alone.
 *
 * Drop-in replacement for `<StatusBar hidden />` inside a Modal.
 */
export function ModalStatusBar() {
  if (Platform.OS !== 'ios') return null;
  return <StatusBar hidden />;
}
