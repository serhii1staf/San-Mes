import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Linking, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { MediaViewerModal, MediaViewerSource, embedUrlFor } from './MediaViewerModal';
import { getLinkPreview, getCachedPreviewSync, LinkPreviewData } from '../../services/linkPreview';

// Rich link preview card (Discord / Telegram style).
//
// Video behaviour (like Discord):
//   - Tap the video thumbnail → an embedded player loads RIGHT IN THE CARD and
//     starts playing. Video streams from YouTube/Vimeo (zero load on our
//     server / database).
//   - Tap the expand button → fullscreen player.
// Image link → fullscreen image viewer. Other links → in-app browser.
//
// Anti-flicker: in-memory cache is read synchronously, so loaded previews
// render instantly with no spinner and no re-fetch on scroll / navigation.

interface LinkPreviewProps {
  url: string;
  onError?: () => void;
}

const PREVIEW_HEIGHT = 190;

export function LinkPreview({ url, onError }: LinkPreviewProps) {
  const theme = useTheme();
  const cached = getCachedPreviewSync(url);
  const [data, setData] = useState<LinkPreviewData | null>(cached === undefined ? null : cached);
  const [resolved, setResolved] = useState<boolean>(cached !== undefined);
  const [playing, setPlaying] = useState(false); // inline video playing in card
  const [fullscreen, setFullscreen] = useState<MediaViewerSource | null>(null);
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

  const border = theme.colors.border.light;
  const accent = theme.colors.accent.primary;
  const bg = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.025)';

  const videoSource: MediaViewerSource | null = data?.provider === 'youtube' && data.videoId
    ? { kind: 'youtube', videoId: data.videoId }
    : data?.provider === 'vimeo' && data.videoId
    ? { kind: 'vimeo', videoId: data.videoId }
    : null;

  const handlePress = () => {
    if (videoSource) {
      // Start inline playback right in the card.
      setPlaying(true);
      return;
    }
    if (data?.type === 'image' && data.image) {
      setFullscreen({ kind: 'image', uri: data.image });
      return;
    }
    try {
      router.push({ pathname: '/browser', params: { url } });
    } catch {
      Linking.openURL(url).catch(() => {});
    }
  };

  const fullscreenEl = (
    <MediaViewerModal visible={!!fullscreen} source={fullscreen} onClose={() => setFullscreen(null)} />
  );

  // Skeleton while first fetch is in flight (fixed height = no layout jump).
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

  const isVideo = !!videoSource || data.type === 'video';
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return data.siteName || '';
    }
  })();

  return (
    <>
      {fullscreenEl}
      <View
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
        {/* Media area */}
        {playing && videoSource ? (
          <View style={{ width: '100%', height: PREVIEW_HEIGHT, backgroundColor: '#000' }}>
            <WebView
              source={{ uri: embedUrlFor(videoSource) }}
              style={{ flex: 1, backgroundColor: '#000' }}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              domStorageEnabled
              allowsFullscreenVideo
              originWhitelist={['*']}
              startInLoadingState
              renderLoading={() => (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
                  <ActivityIndicator color="#FFFFFF" />
                </View>
              )}
            />
            {/* Expand to fullscreen */}
            <Pressable
              onPress={() => setFullscreen(videoSource)}
              style={{ position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}
              hitSlop={8}
            >
              <Feather name="maximize-2" size={15} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : data.image ? (
          <Pressable onPress={handlePress}>
            <CachedImage uri={data.image} style={{ width: '100%', height: PREVIEW_HEIGHT }} resizeMode="cover" />
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
          </Pressable>
        ) : null}

        {/* Text area (tap opens link / browser) */}
        <Pressable onPress={handlePress} style={{ padding: 12 }}>
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
        </Pressable>
      </View>
    </>
  );
}
