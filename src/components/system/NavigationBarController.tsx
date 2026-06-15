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
//    correctly tints the bar. Wrapped so the unsupported path never throws.
//
// iOS has no equivalent surface, so this component renders nothing and does
// nothing off-Android.

import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';

import { useTheme } from '../../theme';

export function NavigationBarController() {
  const { isDark, colors } = useTheme();
  const bg = colors.background.primary;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    // Button (glyph) contrast — the part that fixes "invisible / wrong-colour
    // buttons". Always supported, even under edge-to-edge.
    NavigationBar.setButtonStyleAsync(isDark ? 'light' : 'dark').catch(() => {});
    // Bar background tint — fixes the solid-white strip on Android < 15.
    // Silently ignored where the OS enforces a transparent bar.
    NavigationBar.setBackgroundColorAsync(bg).catch(() => {});
  }, [isDark, bg]);

  return null;
}
