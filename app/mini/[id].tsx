import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { apiGet } from '../../src/services/apiClient';
import { useMiniAppsStore } from '../../src/store/miniAppsStore';
import { useTheme } from '../../src/theme';

// Deep-link entry for share URLs.
//   Universal link: https://san-m-app.com/mini/<id>  (declared in
//     api/.well-known/apple-app-site-association)
//   Custom scheme:  san-mes://mini/<id>              (used by the SSR
//     "Открыть в San" button on api/mini/[id].ts)
//
// Both shapes resolve to this route. We look the mini-app up in the local
// store first; if it isn't there yet (first launch via deep link, before
// the user opened settings) we fetch it from Supabase one-shot, then
// `router.replace` into the existing WebView screen so the back-stack
// stays clean. If the row no longer exists we drop the user on the home
// tab — there's nothing useful we can show.
export default function MiniDeepLinkScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const targetId = String(id || '').trim();
      if (!targetId) {
        router.replace('/(tabs)');
        return;
      }

      // Cache lookup first — no network hop on the common case where the
      // user already has the app in their local mini-apps cache.
      const cached = useMiniAppsStore.getState().apps.find((a) => a.id === targetId);
      if (cached) {
        if (cancelled) return;
        router.replace({
          pathname: '/mini-app',
          params: { url: encodeURIComponent(cached.url), name: cached.name, emoji: cached.emoji },
        });
        return;
      }

      // Cold path: the user opened a share link for an app they've never
      // seen. Pull the row directly from the Worker so we can hand the
      // URL to the WebView screen.
      try {
        const { data } = await apiGet<{ id: string; name: string; emoji: string; url: string }>(
          `/v1/mini-apps/${encodeURIComponent(targetId)}`,
        );
        if (cancelled) return;
        if (data?.url) {
          router.replace({
            pathname: '/mini-app',
            params: { url: encodeURIComponent(data.url), name: data.name, emoji: data.emoji },
          });
        } else {
          router.replace('/(tabs)');
        }
      } catch {
        if (!cancelled) router.replace('/(tabs)');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.background.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ActivityIndicator size="large" color={theme.colors.accent.primary} />
    </View>
  );
}
