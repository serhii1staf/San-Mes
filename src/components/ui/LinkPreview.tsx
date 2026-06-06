import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { MediaViewerModal, MediaViewerSource } from './MediaViewerModal';
import { getLinkPreview, getCachedPreviewSync, LinkPreviewData } from '../../services/linkPreview';

// Rich link preview card (Telegram / Discord style).
//
// Behaviour on tap:
//   - YouTube / Vimeo video → plays INLINE inside the app (embedded player,
//     streamed from the provider — zero load on our server / database).
//   - Direct image link → opens a full-screen in-app image viewer.
//   - Anything else → opens the in-app browser.
//
// Anti-flicker: the in-memory cache is read synchronously on mount, so an
// already-loaded preview renders instantly with no spinner and no re-fetch
// when scrolling or switching screens.

interface LinkPreviewProps {
  url: string;
  onError?: () => void;
}

export function LinkPreview({ url, onError }: LinkPreviewProps) {
  const theme = useTheme();
  const cached = getCachedPreviewSync(url);
  const [data, setData] = useState<LinkPreviewData | null>(cached === undefined ? null : cached);
  const [resolved, setResolved] = useState<boolean>(cached !== undefined);
  const [viewer, setViewer] = useState<MediaViewerSource | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
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

  const handlePress = () => {
    // Video → inline player.
    if (data?.provider === 'youtube' && data.videoId) {
      setViewer({ kind: 'youtube', videoId: data.videoId });
      return;
    }
    if (data?.provider === 'vimeo' && data.videoId) {
      setViewer({ kind: 'vimeo', videoId: data.videoId });
      return;
    }
    // Direct image → in-app image viewer.
    if (data?.type === 'image' && data.image) {
      setViewer({ kind: 'image', uri: data.image });
      return;
    }
    // Everything else → in-app browser (fallback to system browser).
    try {
      router.push({ pathname: '/browser', params: { url } });
    } catch {
      Linking.openURL(url).catch(() => {});
    }
  };

  const border = theme.colors.border.light;
  const accent = theme.colors.accent.primary;
  const bg = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.025)';

  const viewerEl = (
    <MediaViewerModal visible={!!viewer} source={viewer} onClose={() => setViewer(null)} />
  );

  // Skeleton placeholder (fixed height) while the FIRST fetch is in flight.
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
    <>
      {viewerEl}
      <Pressable
        onPress={handlePress}
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
    </>
  );
}
