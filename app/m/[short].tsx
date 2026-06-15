import React, { useEffect } from 'react';
import { View, ActivityIndicator, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { apiGet } from '../../src/services/apiClient';
import { useMiniAppsStore } from '../../src/store/miniAppsStore';
import { useTheme } from '../../src/theme';
import { useT } from '../../src/i18n/store';

// Deep-link entry for the new short share URLs.
//   Universal link: https://san-m-app.com/m/<8-char-prefix>
//   Custom scheme:  san-mes://m/<8-char-prefix>
//
// Resolves the prefix to a full mini-app id by:
//   1. Searching the local store first (instant for apps the user already has).
//   2. If the cache misses, fetching the full mini-apps list via the
//      Worker and finding the row whose id starts with the prefix. We
//      use the list endpoint instead of a dedicated prefix-lookup
//      because mini-app counts stay small (dozens, not thousands) on
//      the timescale this app cares about. If the count grows we'll
//      add a `GET /v1/mini-apps/by-prefix/:p` endpoint.
//
// The legacy long-uuid route stays at app/mini/[id].tsx — see vercel.json.
export default function MiniShortDeepLinkScreen() {
  const theme = useTheme();
  const t = useT();
  const { short } = useLocalSearchParams<{ short: string }>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const prefix = String(short || '').trim().toLowerCase();
      if (!prefix) {
        router.replace('/(tabs)');
        return;
      }

      // 1. Local cache lookup — startsWith covers the common path where the
      //    user already has the app in their per-account mini-apps list.
      const cached = useMiniAppsStore.getState().apps.find((a) => a.id.startsWith(prefix));
      if (cached) {
        if (cancelled) return;
        router.replace({
          pathname: '/mini-app',
          params: {
            url: encodeURIComponent(cached.url),
            name: cached.name,
            emoji: cached.emoji,
            id: cached.id,
          },
        });
        return;
      }

      // 2. Cold path — fetch the full list and pick the unique prefix
      //    match. If 0 or 2+ rows match the prefix we refuse to route.
      try {
        const { data } = await apiGet<{ id: string; name: string; emoji: string; url: string }[]>(
          '/v1/mini-apps?limit=100',
        );
        if (cancelled) return;
        const matches = (data || []).filter((a) => a.id.toLowerCase().startsWith(prefix));
        if (matches.length === 1) {
          const row = matches[0];
          router.replace({
            pathname: '/mini-app',
            params: {
              url: encodeURIComponent(row.url),
              name: row.name,
              emoji: row.emoji,
              id: row.id,
            },
          });
          return;
        }
        // 0 or 2+ matches — show a generic "not found" alert and bail.
        Alert.alert(t('mini_app.preview.not_found_title'), t('mini_app.preview.not_found_msg'));
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)');
      } catch {
        if (cancelled) return;
        Alert.alert(t('mini_app.preview.not_found_title'), t('mini_app.preview.not_found_msg'));
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [short]);

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
