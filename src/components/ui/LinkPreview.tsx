import React, { useEffect, useState } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
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
import { PostPreviewCard } from './PostPreviewCard';
import { ProfilePreviewCard } from './ProfilePreviewCard';
import { getLinkPreview, getCachedPreviewSync, LinkPreviewData } from '../../services/linkPreview';
import { extractMiniAppShareId } from '../../utils/miniAppShare';
import { extractPostShareId, extractProfileShareId } from '../../utils/appLinks';
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
  /**
   * Whether this preview may hit the NETWORK yet. Defaults to true, so every existing call site
   * behaves exactly as before.
   *
   * ── WHY ─────────────────────────────────────────────────────────────────────
   *
   * The unfurl fetch fires on mount. In a chat that is not the same thing as "on screen":
   * FlashList mounts rows within `drawDistance` (250 pt) of the viewport, so scrolling through a
   * conversation with several links mounts several previews the user cannot see, and each one
   * fires its own request.
   *
   * The perf log shows what that costs. In one chat session: `linkPreview fetch play.google.com`
   * 335 ms, `accounts.google.com` 257 ms and 313 ms, `san-m-app.com` 799 ms — followed by long
   * tasks of 356 ms and 175 ms. The fetches themselves are network, but their resolution is not:
   * each one lands a JSON parse, a state update, a re-render of the card and an MMKV write on the
   * JS thread, and four of those can complete inside the same few frames
   * (`MAX_CONCURRENT_FETCHES` is 4).
   *
   * Gating on visibility does not make previews appear later for the user — a preview they can
   * see is by definition visible, so it fetches immediately. It removes the work for rows that
   * were mounted speculatively and may never be looked at.
   *
   * CACHED previews are deliberately NOT gated: `getCachedPreviewSync` is a synchronous map/MMKV
   * read with no network and no async resolution, so an already-known preview still paints on the
   * first frame whether visible or not. Only the cache-MISS path waits.
   */
  active?: boolean;
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
  // ── OUR OWN LINKS NEVER GET THE GENERIC OG TREATMENT ────────────────────────
  //
  // Everything below is a link to content that lives INSIDE this app, and unfurling it would show the
  // reader a scraped copy of our own marketing page for something they can open natively one tap away —
  // and worse, tapping that card pushed `/browser`, a WebView. So each shape dispatches to a card that
  // renders the real entity and navigates in-app.
  //
  // Order matters only in that the shapes are mutually exclusive; each regex is anchored to a distinct
  // path segment (`/m|mini/`, `/post/`, `/profile/`, `/u/`).
  //
  // Dispatching to SIBLING components rather than branching inside `LinkPreviewInner` keeps that
  // component's hook order intact no matter which shape arrives — it has ten hooks including three
  // `useRecyclingState`, and a conditional return placed above them inside it would be a hooks-order
  // violation the moment a recycled cell changed shape.
  const miniAppShareId = extractMiniAppShareId(props.url);
  if (miniAppShareId) {
    return <MiniAppPreviewCard shortOrFullId={miniAppShareId} textColor={props.textColor} />;
  }
  const postShareId = extractPostShareId(props.url);
  if (postShareId) {
    return <PostPreviewCard postId={postShareId} textColor={props.textColor} static={props.static} />;
  }
  const profileShareId = extractProfileShareId(props.url);
  if (profileShareId) {
    return <ProfilePreviewCard profileId={profileShareId} textColor={props.textColor} static={props.static} />;
  }
  return <LinkPreviewInner {...props} />;
});

const LinkPreviewInner = React.memo(function LinkPreviewInner({ url, onError, textColor, emoji, static: isStatic, onLongPress, delayLongPress, active }: LinkPreviewProps) {
  const theme = useTheme();
  const cached = getCachedPreviewSync(url);
  // ── THESE THREE MUST RESET WHEN `url` CHANGES, NOT JUST ON MOUNT ───────────
  //
  // They were plain `useState`, so their initialisers ran once per mount and never again. Under
  // FlatList that was sufficient, because a row leaving the window UNMOUNTED and a row coming back
  // mounted fresh. Under FlashList the cell is RECYCLED: the same component instance is handed a new
  // `url`, and `useState` keeps the old value. The effect below does re-fetch (its deps include
  // `url`), but a fetch resolves a tick later at best, so in between the recycled cell renders the
  // PREVIOUS post's title, description and thumbnail. On a fast scroll that is visible.
  //
  // `useRecyclingState` is FlashList v2's answer to exactly this: same contract as `useState`, plus
  // it re-runs the initialiser when the dependency array changes — during render, so there is no
  // extra commit. It degrades to plain `useState` semantics outside a FlashList (its internal
  // `recyclerViewContext` access is optional-chained), so the many non-list callers of this
  // component are unaffected apart from correctly dropping stale data if their `url` prop changes.
  //
  // `cardWidth` is deliberately NOT in this group: it is re-measured by `onLayout` on the next frame
  // and a stale width is a size, not another post's content. `imageReady` likewise — it is a
  // one-RAF paint gate where a leaked `true` is the desirable outcome.
  const [data, setData] = useRecyclingState<LinkPreviewData | null>(cached === undefined ? null : cached, [url]);
  const [resolved, setResolved] = useRecyclingState<boolean>(cached !== undefined, [url]);
  const [playing, setPlaying] = useRecyclingState(false, [url]);
  const [cardWidth, setCardWidth] = useState(0);
  const [fullscreen, setFullscreen] = useState<MediaViewerSource | null>(null);

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
    // ── PER-RUN CANCELLATION, NOT A SHARED `mounted` REF ────────────────────
    //
    // This used a component-level `mounted` ref set to `true` here and `false` in the cleanup. That
    // guards against writing state after UNMOUNT, which is the only thing that could happen while
    // this component lived in a FlatList row. In a recycled FlashList cell the component is not
    // unmounted — `url` changes and this effect simply re-runs — and the ref cannot distinguish the
    // two cases: cleanup sets it to `false`, the next run immediately sets it back to `true`, so a
    // still-in-flight fetch for the PREVIOUS url passes the guard and calls `setData` with the
    // previous post's metadata. The recycling reset added above would then be silently undone.
    //
    // A flag captured per effect run cannot be revived by a later run, so a superseded fetch is
    // permanently inert whether the cause was an unmount, a url change or an `active` flip.
    let cancelled = false;
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
        cancelled = true;
      };
    }
    // Nothing cached AND this row is not on screen yet → do not spend a request on it. The effect
    // re-runs when `active` flips true (it is in the dep array), so the fetch starts the moment the
    // row actually becomes visible. See the note on the `active` prop for the measurements.
    if (active === false) {
      return () => {
        cancelled = true;
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
        if (cancelled) return;
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
        if (cancelled) return;
        recordFetch();
        setResolved(true);
        onError?.();
      });
    return () => {
      cancelled = true;
    };
    // `active` belongs here: a row that mounts off-screen skips the fetch above, and this effect
    // re-running when it scrolls into view is what starts it. Without the dependency the preview
    // would stay empty for the rest of that row's mounted life.
  }, [url, active]);

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
