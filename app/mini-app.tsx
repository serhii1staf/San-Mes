import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMiniAppStore } from '../src/store/miniAppStore';

// Thin launcher route.
//
// The mini-app UI/WebView now lives in the persistent root host
// (src/components/ui/MiniAppHost.tsx) so it survives minimize without
// reloading. Every existing entry point still navigates to `/mini-app` with
// url/name/emoji[/id] params — this route just forwards them into the store
// and pops itself, so the host takes over as a full-screen overlay. Keeping
// the route means none of the call sites (settings list, search, messages
// row, deep links, share links) had to change.

export default function MiniAppLauncher() {
  const { url, name, emoji, id } = useLocalSearchParams<{ url: string; name: string; emoji: string; id?: string }>();
  // Guard so the open()+back() pair runs EXACTLY once per mount. React can
  // double-invoke effects (StrictMode / fast remount), and a duplicate fire
  // here would push open() twice and pop one screen too many — both read as a
  // flicker / "open-close-open-close" on screen.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    useMiniAppStore.getState().open({
      url: url || '',
      name: name || 'App',
      emoji: emoji || '📱',
      id: id || undefined,
    });
    // Pop this launcher so the persistent host overlay is what the user sees.
    // Use a microtask so the open() state commit lands before we navigate.
    const h = setTimeout(() => {
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)');
    }, 0);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Black placeholder for the single frame before we pop — matches the
  // mini-app's black background so there's no flash.
  return <View style={{ flex: 1, backgroundColor: '#000' }} />;
}
