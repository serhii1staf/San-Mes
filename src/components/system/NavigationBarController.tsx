// Android system navigation bar theming.
//
// Problem: on Android the bottom system navigation bar (back / home /
// recents buttons) rendered as a solid WHITE strip in our app while it
// matched the OS theme in other apps. SDK 54 enforces edge-to-edge, so the
// bar is drawn by the system over our content; without telling Android what
// foreground (button) colour and background to use, it falls back to a light
// default that clashes with our (usually dark) theme and can make the
// buttons invisible.
//
// Fix: a tiny headless controller that mirrors the app theme onto the system
// nav bar whenever the theme flips (dark ⇄ light, accent change).
//
//  - `setButtonStyleAsync`  → light buttons on dark themes, dark buttons on
//    light themes, so the back/home/recents glyphs always have contrast.
//  - `setBackgroundColorAsync` → paint the bar with the current screen
//    background so it blends in. On Android 15+ (edge-to-edge transparency
//    enforced) this is a no-op the OS ignores; on the Android 10–14 range it
//    correctly tints the bar.
//
// `expo-navigation-bar` is a NATIVE module. During development the Metro
// bundle (JS) can get ahead of the installed dev-client binary — e.g. right
// after we add the dependency but before the user installs the rebuilt APK.
// In that window `requireNativeModule('ExpoNavigationBar')` throws
// "Cannot find native module" at import time and, because this file imported
// it at the top level, took the whole app down with a render error. The same
// can happen with an OTA update whose JS references a module the shipped
// binary lacks.
//
// To stay crash-proof we load the module through a guarded require: if the
// native side isn't present we simply no-op. Once the matching build is
// installed the require succeeds and theming kicks in. iOS has no equivalent
// surface, so this is Android-only.

import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useTheme } from '../../theme';

// Guarded load — never throws even when the native module is missing from the
// running binary (stale dev-client / OTA-ahead-of-binary). Resolved once at
// module eval; `null` means "feature unavailable, do nothing".
let NavigationBar: typeof import('expo-navigation-bar') | null = null;
if (Platform.OS === 'android') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    NavigationBar = require('expo-navigation-bar');
  } catch {
    NavigationBar = null;
  }
}

export function NavigationBarController() {
  const { isDark, colors } = useTheme();
  const bg = colors.background.primary;

  useEffect(() => {
    if (Platform.OS !== 'android' || !NavigationBar) return;
    // Button (glyph) contrast — the part that fixes "invisible / wrong-colour
    // buttons". Always supported, even under edge-to-edge.
    NavigationBar.setButtonStyleAsync(isDark ? 'light' : 'dark').catch(() => {});
    // Bar background tint — fixes the solid-white strip on Android < 15.
    // Silently ignored where the OS enforces a transparent bar.
    NavigationBar.setBackgroundColorAsync(bg).catch(() => {});
  }, [isDark, bg]);

  return null;
}
