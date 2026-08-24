import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, FlatList, ActivityIndicator, Text as RNText, StyleSheet, Dimensions, InteractionManager } from 'react-native';
import { useLiquidGlassActive, GlassBg } from '../ui/LiquidGlass';
import { CachedImage } from '../ui/CachedImage';
import { getTrendingGifs, getCachedTrending, setCachedTrending, GiphyItem } from '../../services/giphy';
import { useT } from '../../i18n/store';

// ── Inline GIF panel ───────────────────────────────────────────────────────
//
// The GIF twin of `EmojiPanel`: a docked, scrollable grid that the chat screen
// drops into the space the keyboard vacates (same lift mechanism, same
// full-bleed top-rounded glass/flat surface). No floating modal, no keyboard
// fight — exactly like the emoji panel, just GIF thumbnails instead of emoji.
//
// Shows trending GIFs (cached for the session to save the Giphy beta key's
// 100-req/hour budget) and pages in more as the user scrolls. Tapping a cell
// fires `onSelect(sendUrl)`.

const SCREEN_WIDTH = Dimensions.get('window').width;
const NUM_COLS = 4;          // smaller cells than the old modal (3) — "поменьше"
const H_PAD = 8;
const CELL_GAP = 6;
const CELL_W = Math.floor((SCREEN_WIDTH - H_PAD * 2 - CELL_GAP * (NUM_COLS - 1)) / NUM_COLS);

export interface GifPanelProps {
  /** Panel height in px (≈ last real keyboard height) supplied by the parent. */
  height: number;
  /** Fired when a GIF cell is tapped — passes the full item so the caller can
   *  both send it (sendUrl) and record it in the recent list. */
  onSelect: (item: GiphyItem) => void;
  /** Fired when a GIF cell is LONG-pressed — opens the preview popup. */
  onLongPress?: (item: GiphyItem) => void;
  /** Active theme object (passed in to avoid an extra context read on mount). */
  theme: any;
  /** Bottom safe-area inset — added as list content padding. */
  bottomInset?: number;
  /** Embedded in the shared MediaPanel surface → no own bg/rounding. */
  bare?: boolean;
  /** Most-recently-used GIFs - prepended to the trending grid. */
  recentGifs?: GiphyItem[];
  /** Top content padding, so the overlaying recents strip does not cover the first row. */
  topInset?: number;
  /** Raw scroll notification. The parent latches it to hide/restore its chrome. */
  onScrollTick?: () => void;
  /** GIFs the user added by pasting a link. Shown first - they asked for them, so they lead. */
  customGifs?: GiphyItem[];
  /** Long-press a user-added GIF to drop it. Absent for Giphy items, which are not the user's. */
  onRemoveCustomGif?: (id: string) => void;
}

function GifPanelComponent({ height, onSelect, onLongPress, theme, bottomInset = 0, bare = false, recentGifs, topInset = 0, onScrollTick, customGifs, onRemoveCustomGif }: GifPanelProps) {
  const t = useT();
  const glassActive = useLiquidGlassActive();
  const [gifs, setGifs] = useState<GiphyItem[]>(() => getCachedTrending() || []);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(gifs.length);
  const reqIdRef = useRef(0);

  // ── Decode gate ──────────────────────────────────────────────────────────
  // The panel mounts the moment the user taps GIF, on the SAME JS pass that
  // also kicks off the bar/panel rise animation. Decoding ~9 thumbnail bitmaps
  // on that synchronous mount frame was the dominant cost behind the
  // "провисание" (freeze-then-jerk) on weak Android. We keep the cells as cheap
  // placeholder Views ONLY for the mount commit, then flip the images in one
  // tick later — off the heavy mount frame, but effectively immediate to the
  // eye (no perceptible blank). Earlier this was a fixed 320 ms timeout, which
  // made the thumbnails visibly pop in late; runAfterInteractions + a single
  // RAF protects the same hot frame without the noticeable delay.
  const [decodeReady, setDecodeReady] = useState(false);
  useEffect(() => {
    let raf = 0;
    const handle = InteractionManager.runAfterInteractions(() => {
      raf = requestAnimationFrame(() => setDecodeReady(true));
    });
    return () => { handle.cancel(); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const load = useCallback(async (offset: number) => {
    const reqId = ++reqIdRef.current;
    if (offset === 0) {
      const cached = getCachedTrending();
      if (cached && cached.length > 0) {
        setGifs(cached);
        offsetRef.current = cached.length;
        return;
      }
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    const items = await getTrendingGifs(24, offset);
    if (reqId !== reqIdRef.current) return;
    if (offset === 0) setCachedTrending(items);
    offsetRef.current = offset + items.length;
    setGifs((prev) => (offset === 0 ? items : [...prev, ...items]));
    setLoading(false);
    setLoadingMore(false);
  }, []);

  useEffect(() => {
    if (gifs.length === 0) load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEndReached = useCallback(() => {
    if (loading || loadingMore) return;
    load(offsetRef.current);
  }, [loading, loadingMore, load]);

  const contentStyle = useMemo(
    () => [styles.listContent, { paddingTop: 10 + topInset, paddingBottom: 12 + bottomInset }],
    [bottomInset, topInset],
  );

  const renderItem = useCallback(
    ({ item }: { item: GiphyItem }) => (
      <Pressable
        onPress={() => onSelect(item)}
        // A GIF the user added is the only one they can delete, so long-press means two different things
        // depending on the cell — remove for their own, preview for Giphy's. Keyed off the `custom:` id
        // prefix the store mints, which is the only marker that survives being persisted and reloaded.
        //
        // Without this there is no way to undo an add: the picker would accumulate every mistyped link
        // for ever, which is the failure mode of every "add your own" feature that ships without a remove.
        onLongPress={
          onRemoveCustomGif && item.id.startsWith('custom:')
            ? () => onRemoveCustomGif(item.id)
            : onLongPress
              ? () => onLongPress(item)
              : undefined
        }
        delayLongPress={280}
        style={{ width: CELL_W, height: CELL_W, borderRadius: 10, overflow: 'hidden', marginBottom: CELL_GAP, backgroundColor: theme.colors.background.secondary }}
      >
        {/* STATIC frame in the dense grid — `autoplay={false}` + the still
            rendition means each cell costs ONE decode instead of animating
            every frame (a 16-cell grid of animated GIFs was saturating the UI
            thread on weak devices). Motion is shown on long-press + in the
            sent message. `(item as any).stillUrl` falls back to previewUrl for
            GIFs persisted in `recent_gif` before stillUrl existed.

            Until `decodeReady` the cell stays a bare tinted View (the
            `backgroundColor` on the Pressable already provides it) so the
            open animation never competes with bitmap decode — see the decode
            gate above. */}
        {decodeReady ? (
          <CachedImage
            uri={(item as any).stillUrl || item.previewUrl}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
            priority="low"
            autoplay={false}
            // ── noProxy: THE FIX FOR THE THUMBNAIL STORM ──────────────────────────────
            //
            // A perf snapshot of opening this panel showed ~26 image loads starting together
            // and completing at 117, 355, 503, 650, 737, 894, 971, 1070, 1183, 1351, 1419,
            // 1634, 1677 ms — a monotonic climb, which is the signature of a QUEUE, not of
            // slow images.
            //
            // The queue was one host. `style.width` here is `'100%'`, which is not numeric,
            // and no `proxyWidth` was passed, so `CachedImage` fell through to
            // `DEFAULT_PROXY_WIDTH` and routed every cell to images.weserv.nl as
            // `?w=800&output=gif&n=-1`. So all 26 requests went to a single shared free proxy,
            // each asking it to cold-fetch from Giphy and RE-ENCODE a GIF at 800 px wide —
            // for a cell that is 88 px on screen.
            //
            // Giphy is already a CDN and `stillUrl` is already the right size: the mapping in
            // giphy.ts prefers `fixed_width_small_still`, a single frame around 100 px. There
            // is nothing for the proxy to save here, and three things for it to cost — a
            // bigger payload, an extra network hop, and the loss of Giphy's own sharding
            // across media0-4.giphy.com, which is exactly the parallelism the climb was
            // missing.
            //
            // Passing a numeric `proxyWidth={CELL_W}` would fix the 800 px part but keep the
            // single-host funnel. Bypassing the proxy fixes both.
            noProxy
          />
        ) : null}
      </Pressable>
    ),
    [onSelect, onLongPress, onRemoveCustomGif, theme, decodeReady],
  );

  // Recently-used GIFs first, then trending (deduped by id).
  // Order: the user's own GIFs, then what they used recently, then trending. Their own come first
  // because they were added deliberately - a sticker you saved and cannot find is the same as not
  // having saved it. Deduped by id across all three so a GIF cannot occupy two cells.
  const data = useMemo(() => {
    const own = customGifs && customGifs.length > 0 ? customGifs : [];
    const recent = recentGifs && recentGifs.length > 0 ? recentGifs : [];
    if (own.length === 0 && recent.length === 0) return gifs;
    const seen = new Set<string>();
    const out: GiphyItem[] = [];
    for (const g of [...own, ...recent, ...gifs]) {
      if (!g?.id || seen.has(g.id)) continue;
      seen.add(g.id);
      out.push(g);
    }
    return out;
  }, [customGifs, recentGifs, gifs]);

  return (
    <View
      style={
        bare
          ? styles.bareContainer
          : [
              styles.container,
              {
                height,
                backgroundColor: glassActive ? 'transparent' : theme.colors.background.elevated,
              },
            ]
      }
    >
      {!bare && glassActive ? (
        <GlassBg
          borderRadius={28}
          glassStyle="regular"
          interactive={false}
          colorScheme={theme.isDark ? 'dark' : 'light'}
          tintColor={theme.isDark ? 'rgba(26,26,31,0.55)' : 'rgba(255,255,255,0.55)'}
        />
      ) : null}

      {/* `!decodeReady` is NO LONGER part of this condition.
   
          It used to be, which meant the panel showed a full-height spinner for the first tick
          and then swapped it for the grid — a second full relayout landing in the middle of the
          300 ms rise, on top of the image mounts. The user sees that as the panel stuttering as
          it opens.
   
          The grid can render from the very first frame at no cost, because `decodeReady` already
          gates the IMAGES inside each cell: until it flips, every cell is just the Pressable's
          tinted background. So the layout is committed once, in its final shape, and the
          thumbnails fade into cells that are already in place.
   
          The spinner now means only what it says — a network fetch with nothing cached yet. */}
      {(loading && data.length === 0) ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        </View>
      ) : (
        <FlatList
          data={data}
          style={styles.list}
          keyExtractor={(item) => item.id}
          numColumns={NUM_COLS}
          renderItem={renderItem}
          columnWrapperStyle={{ gap: CELL_GAP }}
          contentContainerStyle={contentStyle}
          showsVerticalScrollIndicator={false}
          onScroll={onScrollTick}
          // 64 ms, not 16. This only has to tell the parent that a scroll IS happening; the parent
          // latches the first tick and restores on an idle timer, so a higher rate would buy nothing
          // and cost a bridge callback per frame during exactly the gesture we are protecting.
          scrollEventThrottle={64}
          keyboardShouldPersistTaps="always"
          removeClippedSubviews
          // ── THESE NUMBERS ARE ROWS, NOT CELLS ──────────────────────────────────
          // With `numColumns={4}` FlatList groups items into rows before handing them to
          // VirtualizedList, so every count here is multiplied by 4. `initialNumToRender={9}`
          // therefore meant 36 CELLS committed at once — and since the data on open is
          // recents + 24 trending, that was usually the ENTIRE dataset mounting in one
          // commit. 36 simultaneous image mounts is where the request storm came from.
          //
          // 3 rows = 12 cells covers the panel's visible area with a little headroom; 2 rows
          // per batch = 8 cells refills fast enough for a flick without ever committing a
          // large group; windowSize 3 retains roughly a panel and a half, plenty for a grid
          // this dense.
          initialNumToRender={3}
          maxToRenderPerBatch={2}
          windowSize={3}
          onEndReachedThreshold={0.6}
          onEndReached={handleEndReached}
          ListFooterComponent={loadingMore ? <View style={{ paddingVertical: 16 }}><ActivityIndicator color={theme.colors.accent.primary} /></View> : null}
          ListEmptyComponent={!loading ? (
            <View style={styles.center}>
              <RNText style={{ color: theme.colors.text.tertiary }}>{t('giphy.empty')}</RNText>
            </View>
          ) : null}
        />
      )}

      {/* Small GIPHY attribution (Giphy API ToS) — bottom-right, unobtrusive. */}
      <View style={styles.attribution} pointerEvents="none">
        <RNText style={{ fontSize: 9, fontWeight: '800', letterSpacing: 0.5, color: theme.colors.text.tertiary }}>GIPHY</RNText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  bareContainer: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingTop: 10, paddingHorizontal: H_PAD },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  attribution: { position: 'absolute', right: 12, bottom: 6 },
});

export const GifPanel = memo(GifPanelComponent);
