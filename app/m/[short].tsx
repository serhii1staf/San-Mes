import React, { useEffect } from 'react';
import { View, ActivityIndicator, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useMiniAppsStore } from '../../src/store/miniAppsStore';
import { useTheme } from '../../src/theme';
import { useT } from '../../src/i18n/store';
import { miniAppPrefixRange } from '../../src/utils/miniAppShare';

// Deep-link entry for the new short share URLs.
//   Universal link: https://san-m-app.com/m/<8-char-prefix>
//   Custom scheme:  san-mes://m/<8-char-prefix>
//
// Resolves the prefix to a full mini-app id by:
//   1. Searching the local store first (instant for apps the user already has).
//   2. Falling back to a one-shot Supabase fetch by `id LIKE '<prefix>%'`
//      with a hard `limit(2)` so an ambiguous prefix is rejected rather than
//      silently routed to the wrong app.
//
// The legacy long-uuid route stays at app/mini/[id].tsx — see vercel.json.
export default function MiniShortDeepLinkScreen() {
  const theme = useTheme();
  const t = useT();
  const { short } = useLocalSearchParams<{ short: string }>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const prefix = String(short || '').trim();
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

      // 2. Cold path: never seen this app, fall back to a network lookup.
      //    UUID column → use a binary range over the indexed `id` rather
      //    than LIKE (Postgres rejects LIKE on UUID without a cast).
      //    `limit(2)` is intentional — if the prefix matches more than one
      //    row we MUST refuse to route, since picking arbitrarily could
      //    open the wrong app.
      const range = miniAppPrefixRange(prefix);
      if (!range) {
        Alert.alert(t('mini_app.preview.not_found_title'), t('mini_app.preview.not_found_msg'));
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)');
        return;
      }
      try {
        const { data } = await supabase
          .from('mini_apps')
          .select('id, name, emoji, url')
          .gte('id', range.lo)
          .lte('id', range.hi)
          .limit(2);
        if (cancelled) return;
        if (data && data.length === 1 && data[0]?.url) {
          const row = data[0];
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
