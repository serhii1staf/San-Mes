import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { MediaViewerModal, MediaViewerSource, InlineVideoPlayer } from './MediaViewerModal';
import { getLinkPreview, getCachedPreviewSync, LinkPreviewData } from '../../services/linkPreview';

// Rich link preview card (Discord / Telegram style).
//
// Video behaviour (like Discord):
//   - Tap the video thumbnail → an embedded player loads RIGHT IN THE CARD and
//     plays (YouTube via the official IFrame API for reliability — no error 153).
//   - Tap the maximize button → fullscreen player.
// Image link → fullscreen image viewer. Other links → in-app browser.
//
// `textColor` lets callers (e.g. own chat bubbles) force readable colors.
// Anti-flicker: in-memory cache is read synchronously, so loaded previews
// render instantly with no spinner and no re-fetch on scroll / navigation.

interface LinkPreviewProps {
  url: string;
  onError?: () => void;
  textColor?: string; // override title/description color (e.g. white in own bubbles)
}

const PREVIEW_HEIGHT = 190;
const FALLBACK_WIDTH = 280;

export function LinkPreview({ url, onError, textColor }: LinkPreviewProps) {
  const theme = useTheme();
  const cached = getCachedPreviewSync(url);
  const [data, setData] = useState<LinkPreviewData | null>(cached === undefined ? null : cached);
  const [resolved, setResolved] = useState<boolean>(cached !== undefined);
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState<MediaViewerSource | null>(null);
  const [cardWidth, setCardWidth] = useState(0);
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
  const titleColor = textColor || theme.colors.text.primary;
  const descColor = textColor || theme.colors.text.tertiary;

  const videoSource: MediaViewerSource | null = data?.provider === 'youtube' && data.videoId
    ? { kind: 'youtube', videoId: data.videoId }
    : data?.provider === 'vimeo' && data.videoId
    ? { kind: 'vimeo', videoId: data.videoId }
    : null;

  const handlePress = () => {
    if (videoSource) {
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
          <Feather name="link" size={14} color={descColor} />
          <Text variant="caption" color={descColor} numberOfLines={1} style={{ flex: 1 }}>
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

  const effectiveWidth = cardWidth > 0 ? cardWidth : FALLBACK_WIDTH;

  return (
    <>
      {fullscreenEl}
      <View
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w && Math.abs(w - cardWidth) > 1) setCardWidth(w);
        }}
        style={{
          width: '100%',
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
          <View style={{ position: 'relative' }}>
            <InlineVideoPlayer source={videoSource} width={effectiveWidth} />
            <Pressable
              onPress={() => setFullscreen(videoSource)}
              style={{ position: 'absolute', bottom: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}
              hitSlop={8}
            >
              <Feather name="maximize-2" size={14} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : data.image ? (
          <Pressable onPress={handlePress}>
            <CachedImage uri={data.image} style={{ width: '100%', aspectRatio: isVideo ? 16 / 9 : undefined, height: isVideo ? undefined : PREVIEW_HEIGHT }} resizeMode="cover" />
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
            <Feather name={isVideo ? 'play-circle' : 'link'} size={11} color={textColor || accent} />
            <Text variant="caption" weight="semibold" color={textColor || accent} numberOfLines={1} style={{ flex: 1, fontSize: 11, opacity: textColor ? 0.9 : 1 }}>
              {data.siteName || host}
            </Text>
          </View>
          {data.title ? (
            <Text variant="body" weight="semibold" color={titleColor} numberOfLines={2} style={{ fontSize: 14, lineHeight: 18, marginBottom: data.description ? 3 : 0 }}>
              {data.title}
            </Text>
          ) : null}
          {data.description ? (
            <Text variant="caption" color={descColor} numberOfLines={2} style={{ fontSize: 12, lineHeight: 16, opacity: textColor ? 0.85 : 1 }}>
              {data.description}
            </Text>
          ) : null}
        </Pressable>
      </View>
    </>
  );
}
