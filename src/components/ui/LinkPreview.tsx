import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Linking, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { getLinkPreview, LinkPreviewData } from '../../services/linkPreview';

// Rich link preview card (Telegram / Discord style). Given a URL it fetches
// cached Open Graph metadata and renders a compact card with image, title,
// description and site name. Tapping opens the link (or the video).
//
// Lightweight: metadata is cached (memory + disk + CDN), the image is loaded
// lazily via CachedImage, and nothing touches the database.

interface LinkPreviewProps {
  url: string;
  onError?: () => void; // called when there is no usable preview
}

export function LinkPreview({ url, onError }: LinkPreviewProps) {
  const theme = useTheme();
  const [data, setData] = useState<LinkPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    getLinkPreview(url)
      .then((d) => {
        if (!mounted.current) return;
        setData(d);
        setLoading(false);
        if (!d) onError?.();
      })
      .catch(() => {
        if (!mounted.current) return;
        setLoading(false);
        onError?.();
      });
    return () => {
      mounted.current = false;
    };
  }, [url]);

  const open = () => {
    Linking.openURL(url).catch(() => {});
  };

  if (loading) {
    return (
      <View
        style={{
          borderRadius: 16,
          padding: 14,
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <ActivityIndicator size="small" color={theme.colors.text.tertiary} />
        <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ flex: 1 }}>
          {url.replace(/^https?:\/\/(www\.)?/, '')}
        </Text>
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
      onPress={open}
      style={{
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
        borderWidth: 1,
        borderColor: theme.colors.border.light,
      }}
    >
      {data.image ? (
        <View>
          <CachedImage uri={data.image} style={{ width: '100%', height: 170 }} resizeMode="cover" />
          {isVideo && (
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 27,
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Feather name="play" size={24} color="#FFFFFF" />
              </View>
            </View>
          )}
        </View>
      ) : null}

      <View style={{ padding: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Feather name={isVideo ? 'video' : 'link'} size={11} color={theme.colors.accent.primary} />
          <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} numberOfLines={1} style={{ flex: 1, fontSize: 11 }}>
            {data.siteName || host}
          </Text>
        </View>
        {data.title ? (
          <Text variant="body" weight="semibold" numberOfLines={2} style={{ fontSize: 14, marginBottom: data.description ? 4 : 0 }}>
            {data.title}
          </Text>
        ) : null}
        {data.description ? (
          <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={2} style={{ fontSize: 12 }}>
            {data.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
