import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { MediaViewerModal, MediaViewerSource, InlineVideoPlayer } from './MediaViewerModal';
import { getLinkPreview, getCachedPreviewSync, LinkPreviewData } from '../../services/linkPreview';

// Rich link preview.
//
// Two layouts:
//   - VIDEO (YouTube/Vimeo): a BIG thumbnail (16:9). Tap → plays inline right
//     in the card (no fullscreen jump). Thin rounded container.
//   - LINK (our profile/post/media, other sites): a THIN row — small left
//     thumbnail + site + title + description.
//
// Stability:
//   - In a list the card shows only a cached image (no WebView) until the user
//     taps play, so scrolling / re-entering never reloads or jumps.
//   - Metadata is read synchronously from cache → instant, no flicker.
//   - Nothing hits our server / database (CDN-cached unfurl + on-device cache).
//
// `textColor` overrides text colors (e.g. white in own chat bubbles).

interface LinkPreviewProps {
  url: string;
  onError?: () => void;
  textColor?: string;
}

const THUMB_RADIUS = 14;

export function LinkPreview({ url, onError, textColor }: LinkPreviewProps) {
  const theme = useTheme();
  const cached = getCachedPreviewSync(url);
  const [data, setData] = useState<LinkPreviewData | null>(cached === undefined ? null : cached);
  const [resolved, setResolved] = useState<boolean>(cached !== undefined);
  const [playing, setPlaying] = useState(false);
  const [cardWidth, setCardWidth] = useState(0);
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

  const accent = theme.colors.accent.primary;
  const subColor = textColor ? textColor : theme.colors.text.tertiary;
  const titleColor = textColor || theme.colors.text.primary;
  const bg = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.025)';
  const border = theme.colors.border.light;

  const videoSource: MediaViewerSource | null =
    data?.provider === 'youtube' && data.videoId
      ? { kind: 'youtube', videoId: data.videoId }
      : data?.provider === 'vimeo' && data.videoId
      ? { kind: 'vimeo', videoId: data.videoId }
      : null;

  const isVideo = !!videoSource || data?.type === 'video';

  const openLink = () => {
    try {
      router.push({ pathname: '/browser', params: { url } });
    } catch {
      Linking.openURL(url).catch(() => {});
    }
  };

  const handlePress = () => {
    if (data?.type === 'image' && data.image) {
      setFullscreen({ kind: 'image', uri: data.image });
      return;
    }
    openLink();
  };

  const fullscreenEl = <MediaViewerModal visible={!!fullscreen} source={fullscreen} onClose={() => setFullscreen(null)} />;

  // Skeleton (thin) during the first fetch.
  if (!resolved && !data) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
        <Feather name="link" size={13} color={subColor} />
        <Text variant="caption" color={subColor} numberOfLines={1} style={{ flex: 1, fontSize: 12 }}>
          {url.replace(/^https?:\/\/(www\.)?/, '')}
        </Text>
      </View>
    );
  }

  if (!data) return null;

  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return data.siteName || '';
    }
  })();

  // ─── VIDEO layout: big 16:9 thumbnail, inline play, thin rounded container ──
  if (isVideo) {
    return (
      <>
        {fullscreenEl}
        <View
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w && Math.abs(w - cardWidth) > 1) setCardWidth(w);
          }}
          style={{ width: '100%', borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' }}
        >
          {playing && videoSource && cardWidth > 0 ? (
            <InlineVideoPlayer source={videoSource} width={cardWidth} />
          ) : (
            <Pressable onPress={() => (videoSource ? setPlaying(true) : openLink())}>
              {data.image ? (
                <CachedImage uri={data.image} style={{ width: '100%', aspectRatio: 16 / 9 }} resizeMode="cover" />
              ) : (
                <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#111' }} />
              )}
              {/* Play button */}
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' }}>
                  <Feather name="play" size={24} color="#FFFFFF" style={{ marginLeft: 3 }} />
                </View>
              </View>
              {/* Site label */}
              <View style={{ position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, maxWidth: '90%' }}>
                <Feather name="play-circle" size={10} color="#FFFFFF" />
                <Text variant="caption" color="#FFFFFF" numberOfLines={1} style={{ fontSize: 10 }}>
                  {data.title || data.siteName || host}
                </Text>
              </View>
            </Pressable>
          )}
        </View>
      </>
    );
  }

  // ─── LINK layout: thin row (small thumbnail + text) ─────────────────────────
  return (
    <>
      {fullscreenEl}
      <Pressable
        onPress={handlePress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingLeft: 10,
          borderLeftWidth: 2,
          borderLeftColor: textColor ? 'rgba(255,255,255,0.6)' : accent,
        }}
      >
        {data.image ? (
          <View style={{ width: 60, height: 60, borderRadius: THUMB_RADIUS, overflow: 'hidden', backgroundColor: bg }}>
            <CachedImage uri={data.image} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          </View>
        ) : null}

        <View style={{ flex: 1, paddingVertical: 2 }}>
          <Text variant="caption" weight="semibold" color={textColor || accent} numberOfLines={1} style={{ fontSize: 11, opacity: textColor ? 0.9 : 1 }}>
            {data.siteName || host}
          </Text>
          {data.title ? (
            <Text variant="caption" weight="semibold" color={titleColor} numberOfLines={2} style={{ fontSize: 13, lineHeight: 17, marginTop: 1 }}>
              {data.title}
            </Text>
          ) : null}
          {data.description ? (
            <Text variant="caption" color={subColor} numberOfLines={2} style={{ fontSize: 11, lineHeight: 15, marginTop: 1, opacity: textColor ? 0.8 : 1 }}>
              {data.description}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </>
  );
}
