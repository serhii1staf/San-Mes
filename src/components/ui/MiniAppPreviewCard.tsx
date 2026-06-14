import React, { useEffect, useState } from 'react';
import { View, Pressable, Text as RNText, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { useMiniAppsStore, MiniApp } from '../../store/miniAppsStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getMiniAppPreviewSource } from '../mini-app-previews/registry';
import { supabase } from '../../lib/supabase';
import { useT } from '../../i18n/store';
import { kvGetJSONSync, kvSetJSON } from '../../services/kvStore';
import { miniAppPrefixRange } from '../../utils/miniAppShare';

// In-app rich preview for a mini-app share link.
//
// Replaces the generic LinkPreview unfurl whenever a chat message,
// comment, or post body contains a link of one of these shapes:
//   https://san-m-app.com/m/<8-char-prefix>     (new short URL)
//   https://san-m-app.com/mini/<full-uuid>      (legacy long URL)
//
// Layout: small emoji bubble + name (+ description if available) +
// primary "Открыть" button that pushes the in-app /mini-app screen.
// External browser opens (recipient without the app) keep using the
// existing Vercel SSR landing page — that path is untouched.
//
// Resolution strategy mirrors app/m/[short].tsx:
//   1. Look up in useMiniAppsStore so the card renders instantly when
//      the user already has the app cached.
//   2. Cache miss → kvStore for a 24h cached row from a previous fetch.
//   3. Still nothing → one-shot Supabase fetch by id (full uuid) or by
//      `id LIKE '<prefix>%'` (short).

interface CachedRow {
  t: number;
  d: Pick<MiniApp, 'id' | 'name' | 'emoji' | 'description' | 'url'> | null;
}
const CACHE_PREFIX = '@san:mini-preview:';
const TTL_MS = 24 * 60 * 60 * 1000;

function cacheGet(key: string): CachedRow | null {
  const entry = kvGetJSONSync<CachedRow | null>(CACHE_PREFIX + key, null);
  if (!entry) return null;
  if (Date.now() - entry.t > TTL_MS) return null;
  return entry;
}

function cachePut(key: string, value: CachedRow['d']): void {
  kvSetJSON(CACHE_PREFIX + key, { t: Date.now(), d: value });
}

interface MiniAppPreviewCardProps {
  shortOrFullId: string;
  onOpen?: () => void;
  textColor?: string; // pass a light color when rendered inside an own-bubble
}

export const MiniAppPreviewCard = React.memo(function MiniAppPreviewCard({
  shortOrFullId,
  onOpen,
  textColor,
}: MiniAppPreviewCardProps) {
  const theme = useTheme();
  const t = useT();

  // Pull the apps array reactively so when the user creates / loads new
  // apps elsewhere this card resolves without a remount.
  const apps = useMiniAppsStore((s) => s.apps);

  // Try to resolve from the store first. `startsWith` covers BOTH the
  // short prefix path and the full id path (an exact id is a trivial
  // prefix of itself).
  const fromStore = React.useMemo(
    () => apps.find((a) => a.id === shortOrFullId || a.id.startsWith(shortOrFullId)),
    [apps, shortOrFullId],
  );

  const fromCacheRef = React.useRef<CachedRow['d'] | null>(null);
  if (fromCacheRef.current === null && !fromStore) {
    fromCacheRef.current = cacheGet(shortOrFullId)?.d ?? null;
  }

  const [resolved, setResolved] = useState<CachedRow['d'] | null>(
    fromStore
      ? { id: fromStore.id, name: fromStore.name, emoji: fromStore.emoji, description: fromStore.description, url: fromStore.url }
      : fromCacheRef.current,
  );
  const [loading, setLoading] = useState<boolean>(!resolved);
  const [missing, setMissing] = useState<boolean>(false);

  // If the store changes after first mount and now has the app, pick it up.
  useEffect(() => {
    if (fromStore) {
      setResolved({
        id: fromStore.id,
        name: fromStore.name,
        emoji: fromStore.emoji,
        description: fromStore.description,
        url: fromStore.url,
      });
      setLoading(false);
      setMissing(false);
    }
  }, [fromStore]);

  // Cold path: nothing in store, nothing in cache → fetch once.
  useEffect(() => {
    if (resolved) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const isShort = shortOrFullId.length <= 12 && !shortOrFullId.includes('-');
        if (isShort) {
          // UUID column: LIKE doesn't work, use a btree range on the
          // indexed `id`. `limit(2)` so an ambiguous prefix matching 2+
          // rows is rejected rather than silently routed to the wrong app.
          const range = miniAppPrefixRange(shortOrFullId);
          if (!range) {
            setMissing(true);
            cachePut(shortOrFullId, null);
            return;
          }
          const { data } = await supabase
            .from('mini_apps')
            .select('id, name, emoji, description, url')
            .gte('id', range.lo)
            .lte('id', range.hi)
            .limit(2);
          if (cancelled) return;
          if (data && data.length === 1) {
            const row = data[0] as CachedRow['d'];
            setResolved(row);
            cachePut(shortOrFullId, row);
          } else {
            setMissing(true);
            cachePut(shortOrFullId, null);
          }
        } else {
          const { data } = await supabase
            .from('mini_apps')
            .select('id, name, emoji, description, url')
            .eq('id', shortOrFullId)
            .limit(1);
          if (cancelled) return;
          if (data && data.length === 1) {
            const row = data[0] as CachedRow['d'];
            setResolved(row);
            cachePut(shortOrFullId, row);
          } else {
            setMissing(true);
            cachePut(shortOrFullId, null);
          }
        }
      } catch {
        if (!cancelled) setMissing(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shortOrFullId, resolved]);

  const accent = theme.colors.accent.primary;
  const titleColor = textColor || theme.colors.text.primary;
  const subColor = textColor || theme.colors.text.tertiary;
  const bg = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.025)';

  // User-pickable WebP backdrop. `null` = current transparent look —
  // matches the historical visual exactly. Skeleton/missing states
  // intentionally skip the image so error chrome stays readable.
  const previewBgId = useSettingsStore((s) => s.miniAppPreviewBg);
  const previewBgSource = getMiniAppPreviewSource(previewBgId);
  // Soft tint above the image so text + button stay readable. Light
  // theme darkens the photo less than dark theme; values mirror the
  // overlay strength used elsewhere in the app for image-on-text.
  const previewOverlayColor = theme.isDark
    ? 'rgba(0,0,0,0.35)'
    : 'rgba(255,255,255,0.55)';

  // Skeleton — single thin row to match LinkPreview's loading state.
  if (loading && !resolved) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 10,
          paddingVertical: 10,
          borderRadius: 14,
          backgroundColor: bg,
        }}
      >
        <ActivityIndicator size="small" color={accent} />
        <Text variant="caption" color={subColor} numberOfLines={1} style={{ flex: 1, fontSize: 12 }}>
          {t('mini_app.preview.loading')}
        </Text>
      </View>
    );
  }

  if (missing || !resolved) {
    // Same visual weight as the legacy "no preview" fallback so the bubble
    // doesn't suddenly grow if the row was deleted by its author.
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderRadius: 14,
          backgroundColor: bg,
        }}
      >
        <Feather name="alert-circle" size={13} color={subColor} />
        <Text variant="caption" color={subColor} numberOfLines={1} style={{ flex: 1, fontSize: 12 }}>
          {t('mini_app.preview.unavailable')}
        </Text>
      </View>
    );
  }

  const handleOpen = () => {
    onOpen?.();
    router.push({
      pathname: '/mini-app',
      params: {
        url: encodeURIComponent(resolved.url || ''),
        name: resolved.name,
        emoji: resolved.emoji,
        id: resolved.id,
      },
    });
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 10,
        paddingVertical: 10,
        borderRadius: 16,
        borderLeftWidth: 2,
        borderLeftColor: textColor ? 'rgba(255,255,255,0.6)' : accent,
        backgroundColor: bg,
        // Clip the optional WebP backdrop to the rounded corner. Without
        // `overflow: hidden` the full-bleed image would leak past the
        // 16-px radius on iOS.
        overflow: 'hidden',
      }}
    >
      {/* User-pickable WebP backdrop. Sits absolutely behind every other
          child so it never affects the row's layout, then a soft tint
          on top keeps text + button readable. Skipped entirely when the
          user has not chosen one (`null` keeps the current visual). */}
      {previewBgSource ? (
        <>
          <Image
            source={previewBgSource}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={0}
            pointerEvents="none"
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: previewOverlayColor,
            }}
          />
        </>
      ) : null}
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'visible',
        }}
      >
        <RNText style={{ fontSize: 26 }} allowFontScaling={false}>
          {resolved.emoji || '🧩'}
        </RNText>
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="caption" weight="semibold" color={titleColor} numberOfLines={1} style={{ fontSize: 14 }}>
          {resolved.name}
        </Text>
        {resolved.description ? (
          <Text variant="caption" color={subColor} numberOfLines={2} style={{ fontSize: 11, lineHeight: 15, marginTop: 2, opacity: textColor ? 0.85 : 1 }}>
            {resolved.description}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={handleOpen}
        hitSlop={6}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 14,
          backgroundColor: textColor ? 'rgba(255,255,255,0.18)' : accent + '15',
        }}
      >
        <Text variant="caption" weight="semibold" color={textColor || accent} style={{ fontSize: 12 }}>
          {t('mini_app.preview.open')}
        </Text>
      </Pressable>
    </View>
  );
});
