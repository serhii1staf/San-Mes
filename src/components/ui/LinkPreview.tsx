import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { MediaViewerModal, MediaViewerSource } from './MediaViewerModal';
import { getLinkPreview, getCachedPreviewSync, LinkPreviewData } from '../../services/linkPreview';

// Lightweight rich link preview (Discord / Telegram style).
//
// IMPORTANT design choices for performance & stability inside long lists:
//   - The card NEVER mounts a WebView while in a list. It only renders a cached
//     thumbnail image (CachedImage). This means scrolling back to an old
//     preview does NOT reload anything and costs almost nothing.
//   - Tapping a video opens the FULLSCREEN player modal (not inline), which
//     avoids layout changes that would otherwise make the chat list jump.
//   - Metadata is read synchronously from cache → instant, no flicker, no
//     re-fetch on re-entering a screen. Nothing hits our server / database.
//
// `textColor` overrides text colors (e.g. white inside own chat bubbles).
// `compact` renders an ultra-thin row (used for our own profile/post links).

interface LinkPreviewProps {
  url: string;
  onError?: () => void;
  textColor?: string;
  compact?: boolean;
}

const THUMB_RADIUS = 14;

export function LinkPreview({ url, onError, textColor, compact }: LinkPreviewProps) {
  const theme = useTheme();
  const cached = getCachedPreviewSync(url);
  const [data, setData] = useState<LinkPreviewData | null>(cached === undefined ? null : cached);
  const [resolved, setResolved] = useState<boolean>(cached !== undefined);
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

  const videoSource: MediaViewerSource | null =
    data?.provider === 'youtube' && data.videoId
      ? { kind: 'youtube', videoId: data.videoId }
      : data?.provider === 'vimeo' && data.videoId
      ? { kind: 'vimeo', videoId: data.videoId }
      : null;

  const handlePress = () => {
    if (videoSource) {
      setFullscreen(videoSource); // open fullscreen player
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

  const fullscreenEl = <MediaViewerModal visible={!!fullscreen} source={fullscreen} onClose={() => setFullscreen(null)} />;

  // Skeleton (thin, fixed height = no layout jump) during the first fetch.
  if (!resolved && !data) {
    return (
      <Pressable onPress={handlePress} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
        <Feather name="link" size={13} color={subColor} />
        <Text variant="caption" color={subColor} numberOfLines={1} style={{ flex: 1, fontSize: 12 }}>
          {url.replace(/^https?:\/\/(www\.)?/, '')}
        </Text>
      </Pressable>
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

  // Compact / thin layout: a slim row with a small left thumbnail and text.
  // Used everywhere (chat, comments) — no heavy container, expands full width.
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
        {/* Left thumbnail (no webview — just a cached image) */}
        {data.image ? (
          <View style={{ width: 64, height: 64, borderRadius: THUMB_RADIUS, overflow: 'hidden', backgroundColor: '#000' }}>
            <CachedImage uri={data.image} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            {isVideo && (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)' }}>
                  <Feather name="play" size={12} color="#FFFFFF" style={{ marginLeft: 2 }} />
                </View>
              </View>
            )}
          </View>
        ) : null}

        {/* Text */}
        <View style={{ flex: 1, paddingVertical: 2 }}>
          <Text variant="caption" weight="semibold" color={textColor || accent} numberOfLines={1} style={{ fontSize: 11, opacity: textColor ? 0.9 : 1 }}>
            {data.siteName || host}
          </Text>
          {data.title ? (
            <Text variant="caption" weight="semibold" color={titleColor} numberOfLines={2} style={{ fontSize: 13, lineHeight: 17, marginTop: 1 }}>
              {data.title}
            </Text>
          ) : null}
          {!compact && data.description ? (
            <Text variant="caption" color={subColor} numberOfLines={2} style={{ fontSize: 11, lineHeight: 15, marginTop: 1, opacity: textColor ? 0.8 : 1 }}>
              {data.description}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </>
  );
}
