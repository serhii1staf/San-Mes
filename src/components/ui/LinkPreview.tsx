import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage, prefetchImages } from './CachedImage';
import Skeleton from './Skeleton';
import { EmojiPattern } from './EmojiPattern';
import { MediaViewerModal, MediaViewerSource, InlineVideoPlayer } from './MediaViewerModal';
import { MiniAppPreviewCard } from './MiniAppPreviewCard';
import { getLinkPreview, getCachedPreviewSync, LinkPreviewData } from '../../services/linkPreview';
import { extractMiniAppShareId } from '../../utils/miniAppShare';
import { perfMonitor } from '../../services/perfMonitor';
import { useSettingsStore } from '../../store/settingsStore';

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
  emoji?: string; // decorative emoji pattern behind the link row (Telegram-style)
  static?: boolean; // when true, never mount a WebView/player (used inside context menus)
  // Forwarded long-press from the parent message bubble. RN does not bubble
  // long-press through a child touch responder, so when this preview is rendered
  // inside a chat/comment bubble whose parent wants to open a context menu on
  // long-press, the parent must pass its handler in here so the inner Pressable
  // (link row / video thumbnail) wires it up too. Otherwise the inner Pressable
  // would swallow the gesture and the bubble's onLongPress would never fire.
  onLongPress?: () => void;
  delayLongPress?: number;
}

const THUMB_RADIUS = 14;

// Rewrite YouTube `hqdefault.jpg` (480×360) to `mqdefault.jpg` (320×180)
// even when the cached metadata still holds the old URL. Same byte/decode
// saving as the server-side switch in `api/unfurl.ts` — half the bytes,
// ~⅓ the decode time on weak devices — but applied transparently to all
// pre-existing cache entries on the user's device, so OTA delivery
// benefits immediately instead of waiting for the SWR refresh. Also
// applied to image-prefetch URLs so we don't warm the old large variant
// only to display the smaller one.
function ytThumb(uri: string | undefined | null): string | undefined {
  if (!uri) return undefined;
  if (uri.indexOf('i.ytimg.com/vi/') === -1) return uri;
  if (uri.indexOf('/hqdefault.') === -1) return uri;
  return uri.replace('/hqdefault.', '/mqdefault.');
}

export const LinkPreview = React.memo(function LinkPreview(props: LinkPreviewProps) {
  // Mini-app share links (new short `/m/<8>` and legacy `/mini/<uuid>`)
  // get a custom in-app card instead of the generic OG unfurl. We dispatch
  // to a sibling component so the rest of LinkPreviewInner keeps its hook
  // order intact regardless of whether the URL is a mini-app share.
  const miniAppShareId = extractMiniAppShareId(props.url);
  if (miniAppShareId) {
    return <MiniAppPreviewCard shortOrFullId={miniAppShareId} textColor={props.textColor} />;
  }
  return <LinkPreviewInner {...props} />;
});

const LinkPreviewInner = React.memo(function LinkPreviewInner({ url, onError, textColor, emoji, static: isStatic, onLongPress, delayLongPress }: LinkPreviewProps) {
  const theme = useTheme();
  const cached = getCachedPreviewSync(url);
  const [data, setData] = useState<LinkPreviewData | null>(cached === undefined ? null : cached);
  const [resolved, setResolved] = useState<boolean>(cached !== undefined);
  const [playing, setPlaying] = useState(false);
  const [cardWidth, setCardWidth] = useState(0);
  const [fullscreen, setFullscreen] = useState<MediaViewerSource | null>(null);
  const mounted = useRef(true);

  // Defer the actual <CachedImage /> mount by one RAF after this preview
  // first commits. The thumbnail decode (especially i.ytimg.com hqdefault
  // → mqdefault) was landing on the same frame as the parent screen's
  // navigation transition + list mount — perf monitor surfaced this as
  // `IMG i.ytimg.com 121 ms` right after `MOUNT comments/[id]`. We still
  // call `prefetchImages` synchronously below so the network fetch + disk
  // warm-up race ahead of the actual element mount; one RAF later the
  // CachedImage commits and expo-image dedupes against the in-flight
  // prefetch (`cachePolicy="memory-disk"`), so the visible paint is
  // virtually unchanged but the decode no longer competes with the
  // navigation frame.
  const [imageReady, setImageReady] = useState(false);
  useEffect(() => {
    const handle = requestAnimationFrame(() => setImageReady(true));
    return () => cancelAnimationFrame(handle);
  }, []);

  useEffect(() => {
    mounted.current = true;
    // Warm the image cache for the preview thumbnail as soon as metadata is
    // available, regardless of whether it came from cache or a fresh fetch.
    // Without this, scrolling past + back to a preview would re-decode the
    // thumbnail from disk every time, which the user perceived as
    // "preview reloads every time" — even though the metadata never re-fetched.
    if (cached?.image) {
      const u = ytThumb(cached.image);
      if (u) prefetchImages([u]);
    }
    if (cached !== undefined) {
      if (!cached) onError?.();
      return () => {
        mounted.current = false;
      };
    }
    // Time the very first network resolve for this URL so the perf monitor
    // can attribute SLOW UI frames to slow unfurl backends. Cheap (one host
    // parse + one Date.now diff) and entirely skipped when the bubble is off.
    const fetchStart = Date.now();
    const recordFetch = () => {
      if (!useSettingsStore.getState().perfMonitorEnabled) return;
      let host = '';
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
      perfMonitor.mark('linkPreview fetch ' + host, Date.now() - fetchStart);
    };
    getLinkPreview(url)
      .then((d) => {
        if (!mounted.current) return;
        recordFetch();
        setData(d);
        setResolved(true);
        // Prefetch the image immediately on resolve too — covers the
        // first-ever-view path where `cached` was undefined above.
        if (d?.image) {
          const u = ytThumb(d.image);
          if (u) prefetchImages([u]);
        }
        if (!d) onError?.();
      })
      .catch(() => {
        if (!mounted.current) return;
        recordFetch();
        setResolved(true);
        onError?.();
      });
    return () => {
      mounted.current = false;
    };
  }, [url]);

  // Rewrite YouTube `hqdefault.jpg` (480×360) to `mqdefault.jpg` (320×180)
  // even when the cached metadata still holds the old URL. Same byte/decode
  // saving as the server-side switch in `api/unfurl.ts` — half the bytes,
  // ~⅓ the decode time on weak devices — but applied transparently to all
  // pre-existing cache entries on the user's device, so OTA delivery
  // benefits immediately instead of waiting for the SWR refresh.
  const ytThumb = (uri: string | undefined): string | undefined => {
    if (!uri) return uri;
    if (uri.indexOf('i.ytimg.com/vi/') === -1) return uri;
    if (uri.indexOf('/hqdefault.') === -1) return uri;
    return uri.replace('/hqdefault.', '/mqdefault.');
  };

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

  const fullscreenEl = isStatic ? null : <MediaViewerModal visible={!!fullscreen} source={fullscreen} onClose={() => setFullscreen(null)} />;

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
          {playing && videoSource && cardWidth > 0 && !isStatic ? (
            <InlineVideoPlayer source={videoSource} width={cardWidth} />
          ) : (
            <Pressable
              onPress={() => { if (isStatic) return; videoSource ? setPlaying(true) : openLink(); }}
              onLongPress={onLongPress}
              delayLongPress={delayLongPress}
            >
              {data.image && imageReady ? (
                <CachedImage
                  uri={ytThumb(data.image) as string}
                  style={{ width: '100%', aspectRatio: 16 / 9 }}
                  resizeMode="cover"
                  proxyWidth={200}
                  // YouTube preview thumbnails are decorative chrome — they
                  // sit inside an inline card and the user's eye is on the
                  // primary chat content. Mark `priority="low"` so they
                  // don't compete with the message-bubble images that
                  // mount on the same RAF as the chat opens. expo-image
                  // routes high/normal-priority decodes ahead of low ones.
                  priority="low"
                  // Skip the cross-fade so a recycled card doesn't flash
                  // on re-mount when the FlatList recycles its row. Same
                  // rationale as `transition={0}` inside CachedImage.
                  transition={0}
                />
              ) : (
                // Shimmer skeleton until the post-RAF mount swap. The 16:9
                // box keeps layout stable so the play button doesn't shift
                // when CachedImage finally commits — the Skeleton fills it.
                <View style={{ width: '100%', aspectRatio: 16 / 9 }}>
                  <Skeleton width={'100%'} height={'100%' as any} radius={0} />
                </View>
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
        onLongPress={onLongPress}
        delayLongPress={delayLongPress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingLeft: 10,
          paddingRight: emoji ? 8 : 0,
          paddingVertical: emoji ? 6 : 0,
          borderLeftWidth: 2,
          borderLeftColor: textColor ? 'rgba(255,255,255,0.6)' : accent,
          borderRadius: emoji ? 12 : 0,
          overflow: 'hidden',
        }}
      >
        {/* Decorative emoji pattern behind the row (faint, non-interactive) */}
        {emoji ? <EmojiPattern emoji={emoji} opacity={textColor ? 0.18 : 0.12} seed={url} /> : null}

        {data.image && imageReady ? (
          <View style={{ width: 60, height: 60, borderRadius: THUMB_RADIUS, overflow: 'hidden', backgroundColor: bg }}>
            <CachedImage uri={ytThumb(data.image) as string} style={{ width: '100%', height: '100%' }} resizeMode="cover" proxyWidth={60} priority="low" />
          </View>
        ) : data.image ? (
          // Shimmer skeleton reserves the layout slot until the next-RAF
          // swap. Same rationale as the video layout above — the network
          // + decode races on a frame after the parent screen's mount.
          <Skeleton width={60} height={60} radius={THUMB_RADIUS} />
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
});
