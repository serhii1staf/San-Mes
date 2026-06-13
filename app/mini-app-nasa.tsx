import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, RefreshControl, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme';
import { Text } from '../src/components/ui';
import { CachedImage } from '../src/components/ui/CachedImage';
import { fetchApod, clearApodCache, ApodEntry } from '../src/services/nasa/apod';
import { useT } from '../src/i18n/store';
import { triggerHaptic } from '../src/utils/haptics';

// Astronomy Picture of the Day. Lightweight read-only screen — fetches once
// on mount, MMKV-cached by date so re-opening on the same day is instant.
//
// Video days: NASA occasionally publishes a video instead of an image. We
// detect `mediaType === 'video'` and offer a "Open in browser" button rather
// than try to embed the unknown video host (would need a WebView and add
// complexity for a once-a-month edge case).

export default function NasaApodScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [entry, setEntry] = useState<ApodEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading((wasLoading) => (entry ? wasLoading : true));
    const data = await fetchApod();
    setEntry(data);
    setLoading(false);
    setRefreshing(false);
  }, [entry]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = useCallback(() => {
    triggerHaptic('selection');
    setRefreshing(true);
    clearApodCache();
    void load();
  }, [load]);

  const cardBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: insets.top + 8,
          paddingBottom: 12,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="body" weight="bold" style={{ flex: 1, textAlign: 'center', marginRight: 32 }}>
          {t('nasa_apod.title')}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.text.tertiary}
          />
        }
      >
        {loading && !entry ? (
          <View style={{ paddingVertical: 60, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={theme.colors.text.tertiary} />
          </View>
        ) : !entry ? (
          <View style={{ paddingVertical: 60, alignItems: 'center', paddingHorizontal: 24 }}>
            <Feather name="cloud-off" size={32} color={theme.colors.text.tertiary} />
            <Text variant="body" color={theme.colors.text.tertiary} style={{ marginTop: 12, textAlign: 'center' }}>
              {t('nasa_apod.error')}
            </Text>
            <Pressable
              onPress={onRefresh}
              style={{
                marginTop: 16,
                paddingHorizontal: 18,
                paddingVertical: 10,
                borderRadius: 12,
                backgroundColor: theme.colors.accent.primary + '20',
              }}
            >
              <Text variant="caption" weight="semibold" color={theme.colors.accent.primary}>
                {t('common.retry')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Media — image inline, video gets an "Open" CTA */}
            {entry.mediaType === 'image' ? (
              <CachedImage
                uri={entry.hdurl || entry.url}
                style={{
                  width: '100%',
                  aspectRatio: 1,
                  borderRadius: 18,
                  backgroundColor: theme.colors.background.tertiary,
                }}
                resizeMode="cover"
              />
            ) : (
              <Pressable
                onPress={() => Linking.openURL(entry.url).catch(() => {})}
                style={{
                  width: '100%',
                  aspectRatio: 16 / 9,
                  borderRadius: 18,
                  backgroundColor: theme.colors.background.tertiary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Feather name="play-circle" size={48} color={theme.colors.accent.primary} />
                <Text variant="caption" color={theme.colors.text.secondary} style={{ marginTop: 8 }}>
                  {t('nasa_apod.video_open')}
                </Text>
              </Pressable>
            )}

            <View style={{ marginTop: 16, padding: 16, borderRadius: 16, backgroundColor: cardBg }}>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>
                {entry.date}
              </Text>
              <Text variant="body" weight="bold" style={{ marginTop: 4, fontSize: 18 }}>
                {entry.title}
              </Text>
              {entry.copyright ? (
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 4 }}>
                  © {entry.copyright}
                </Text>
              ) : null}
              <Text
                variant="body"
                color={theme.colors.text.secondary}
                style={{ marginTop: 12, lineHeight: 22 }}
              >
                {entry.explanation}
              </Text>
            </View>

            <Text
              variant="caption"
              color={theme.colors.text.tertiary}
              style={{ marginTop: 12, textAlign: 'center', fontSize: 11 }}
            >
              {t('nasa_apod.source')}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}
