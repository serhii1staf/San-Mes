import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { getLinkPreview, getCachedPreviewSync, LinkPreviewData } from '../../services/linkPreview';

// Rich link preview card (Telegram / Discord style).
//
// Anti-flicker: on mount we synchronously read the in-memory cache, so a
// preview that was already loaded shows INSTANTLY with no spinner and no
// re-fetch when scrolling or switching screens. Only genuinely-new links do a
// (cached, CDN-backed) network fetch. Nothing touches the database.

interface LinkPreviewProps {
  url: string;
  onError?: () => void;
}

// Open known video providers inside the app's in-app browser for playback;
// everything else opens in the system browser.
function openLink(url: string, data: LinkPreviewData | null) {
  try {
    if (data?.provider === 'youtube' && data.videoId) {
      // Prefer the native YouTube app / system handling for real playback.
      Linking.openURL(`https://www.youtube.com/watch?v=${data.videoId}`).catch(() => {
        Linking.openURL(url).catch(() => {});
      });
      return;
    }
    // In-app browser for a smooth experience without leaving the app.
    router.push({ pathname: '/browser', params: { url } });
  } catch {
    Linking.openURL(url).catch(() => {});
  }
}

export function LinkPreview({ url, onError }: LinkPreviewProps) {
  const theme = useTheme();
  // Seed from the synchronous memory cache to avoid any loading flicker.
  const cached = getCachedPreviewSync(url);
  const [data, setData] = useState<LinkPreviewData | null>(cached === undefined ? null : cached);
  const [resolved, setResolved] = useState<boolean>(cached !== undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // If we already have a synchronous cache hit, do nothing (no re-fetch).
    if (cached !== undefined) {
      if (!cached) onError?.();
      return () => {
        mounted.current = false;
      };
    }
    getLinkPreview(url)
      .then((d) => {
        if (!mounted.current) return;
        setData(d);
        setResolved(true);
        if (!d) onError?.();
      })
      .catch(() => {
        if (!mounted.current) return;
        setResolved(true);
        onError?.();
      });
    return () => {
      mounted.current = false;
    };
  }, [url]);

  const border = theme.colors.border.light;
  const accent = theme.colors.accent.primary;
  const bg = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.025)';

  // Skeleton placeholder (fixed height) while the FIRST fetch is in flight.
  // Fixed size means the layout never jumps when the data arrives.
  if (!resolved && !data) {
    return (
      <View style={{ borderRadius: 16, overflow: 'hidden', backgroundColor: bg, borderWidth: 1, borderColor: border }}>
        <View style={{ height: 4, backgroundColor: accent, opacity: 0.5 }} />
        <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="link" size={14} color={theme.colors.text.tertiary} />
          <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ flex: 1 }}>
            {url.replace(/^https?:\/\/(www\.)?/, '')}
          </Text>
        </View>
      </View>
    );
  }

  if (!data) return null;

  const isVideo = data.type === 'video' || !!data.provider;
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return data.siteName || '';
    }
  })();

  return (
    <Pressable
      onPress={() => openLink(url, data)}
      style={{
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: bg,
        borderLeftWidth: 3,
        borderLeftColor: accent,
        borderTopWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderTopColor: border,
        borderRightColor: border,
        borderBottomColor: border,
      }}
    >
      {data.image ? (
        <View>
          <CachedImage uri={data.image} style={{ width: '100%', height: 180 }} resizeMode="cover" />
          {isVideo && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: 'rgba(0,0,0,0.6)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: 'rgba(255,255,255,0.85)',
                }}
              >
                <Feather name="play" size={24} color="#FFFFFF" style={{ marginLeft: 3 }} />
              </View>
            </View>
          )}
        </View>
      ) : null}

      <View style={{ padding: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 }}>
          <Feather name={isVideo ? 'play-circle' : 'link'} size={11} color={accent} />
          <Text variant="caption" weight="semibold" color={accent} numberOfLines={1} style={{ flex: 1, fontSize: 11 }}>
            {data.siteName || host}
          </Text>
        </View>
        {data.title ? (
          <Text variant="body" weight="semibold" numberOfLines={2} style={{ fontSize: 14, lineHeight: 18, marginBottom: data.description ? 3 : 0 }}>
            {data.title}
          </Text>
        ) : null}
        {data.description ? (
          <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={2} style={{ fontSize: 12, lineHeight: 16 }}>
            {data.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
