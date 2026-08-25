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
}

function GifPanelComponent({ height, onSelect, onLongPress, theme, bottomInset = 0, bare = false, recentGifs, topInset = 0, onScrollTick, customGifs }: GifPanelProps) {
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
      <GifCell
        item={item}
        decodeReady={decodeReady}
        cellBg={theme.colors.background.secondary}
        onSelect={onSelect}
        onLongPress={onLongPress}
      />
    ),
    [onSelect, onLongPress, theme.colors.background.secondary, decodeReady],
  );

  // Recently-used GIFs first, then trending (deduped by id).
  // Order: the user's own GIFs, then what they used recently, then trending. Their own come first
  // because they were added deliberately - a sticker you saved and cannot find is the same as not
  // having saved it. Deduped by id across all three so a GIF cannot occupy two cells.
  const data = useMemo(() => {
    const own = customGifs && customGifs.length > 0 ? customGifs : [];
    const recent = recentGifs && recentGifs.length > 0 ? recentGifs : [];
    if (own.length === 0 && recent.length === 0) return gifs;
    // ── A DELETED IMPORT MUST NOT SURVIVE IN RECENTS ─────────────────────────
    //
    // `customGifsStore` owns whether an imported sticker still exists. Recents is a usage log, and it
    // stores whole `GiphyItem`s — so a sticker the user has sent has an identical twin in here, and
    // deleting it from the store alone left that twin in the very next segment of this list. The cell
    // moved down instead of going away, which is exactly what was reported.
    //
    // `removeRecentGif` purges the persisted copy at delete time; this is the guarantee that does not
    // depend on it. It re-derives membership on every render, so it also heals lists that were already
    // written before the purge existed, and it holds no matter which screen performed the delete —
    // both the chat and the comments screen keep their own React copy of recents, and neither is
    // notified by the other.
    //
    // Only `custom:` ids are checked against the store. A Giphy or Tenor GIF in recents was never
    // owned by the store, so testing it there would wipe the entire recents list.
    const ownIds = new Set(own.map((g) => g.id));
    const seen = new Set<string>();
    const out: GiphyItem[] = [];
    for (const g of [...own, ...recent, ...gifs]) {
      if (!g?.id || seen.has(g.id)) continue;
      if (g.id.startsWith('custom:') && !ownIds.has(g.id)) continue;
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
  // Hoisted out of the cell: these were inline object literals, so a scrolling grid minted two
  // fresh objects per cell per render. Only the background tint varies (it is themed), and that
  // is passed in as a primitive and composed as a second style entry.
  cell: { width: CELL_W, height: CELL_W, borderRadius: 10, overflow: 'hidden', marginBottom: CELL_GAP },
  cellImg: { width: '100%', height: '100%' },
  list: { flex: 1 },
  listContent: { paddingTop: 10, paddingHorizontal: H_PAD },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  attribution: { position: 'absolute', right: 12, bottom: 6 },
});

export const GifPanel = memo(GifPanelComponent);

/**
 * One cell of the GIF grid.
 *
 * ── WHY THIS IS A COMPONENT AND NOT JSX INSIDE `renderItem` ─────────────────
 *
 * Because it needs a hook. A device snapshot of opening this panel is unambiguous about what was
 * wrong — twenty-six image loads starting inside ~155 ms, `pendingDecodes` peaking at 24, and
 * durations climbing 447 → 456 → 600 → 693 → 698 → 700 → 702 → 704 → 707 → 709 → 715 ms.
 *
 * A monotonic climb across concurrent requests is the signature of a QUEUE, not of slow images: every
 * cell started at once and they finished in the order the device got round to them, so the last one
 * waited for all the others. The panel opens on the same gesture the user described as laggy.
 *
 * `noProxy` (see below) already fixed the *other* half of this — the single-host funnel through weserv.
 * What it could not fix is that all twenty-six decode STARTS still happen together, because each cell
 * begins loading the moment it mounts and FlatList mounts a batch per period.
 *
 * The chat bubbles solved exactly this with `useStaggeredReveal`, a shared frame-paced queue that
 * grants one decode per frame. This grid never got it: `decodeReady` is a single global latch, so it
 * gates the whole grid against the OPEN ANIMATION and does nothing to space the cells against each
 * other. Joining the shared queue bounds concurrency to ~1-2 decodes regardless of how many cells the
 * list mounts, and because the queue is app-wide the panel also cannot storm against a chat that is
 * still revealing its own images behind it.
 *
 * The photo pump is used rather than the GIF pump on purpose: these are STILL frames
 * (`autoplay={false}`), so they cost one cheap decode each, and the GIF pump's 90 ms spacing would
 * turn a screenful into a two-second cascade for no benefit.
 *
 * `memo` because a grid cell must not re-render when a sibling reveals. The comparator is shallow and
 * every prop is either a primitive or a stable callback, which is why `cellBg` is passed instead of the
 * whole `theme` object.
 */
const GifCell = memo(function GifCell({
  item,
  decodeReady,
  cellBg,
  onSelect,
  onLongPress,
}: {
  item: GiphyItem;
  decodeReady: boolean;
  cellBg: string;
  onSelect: (item: GiphyItem) => void;
  onLongPress?: (item: GiphyItem) => void;
}) {
  // The queue membership that used to live here has moved INTO `CachedImage` as its `paced` prop, so
  // there is one mechanism instead of two. This component stays because the memoised Pressable is still
  // worth having, but it no longer owns a hook of its own — which is what made pacing unreachable from a
  // plain `renderItem` and is why the stickers grid shipped without it. See the note on `paced`.
  return (
    <Pressable
      onPress={() => onSelect(item)}
      // ONE meaning for long-press: open the menu.
      //
      // This used to branch — a long-press DELETED your own sticker outright and opened a preview for
      // everything else. Two problems with that. Deleting on a long press with no confirmation is a
      // destructive action on the same gesture that elsewhere means "look at this", so it fires by
      // accident; and it meant your own stickers had no preview at all, which is the one place a
      // just-imported sticker most wants inspecting.
      //
      // Delete now lives in the menu (see MediaPanel's long-press card), alongside Send and View pack,
      // where it is a deliberate second tap and where the menu can tell whose sticker it is.
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      delayLongPress={280}
      style={[styles.cell, { backgroundColor: cellBg }]}
    >
      {/* STATIC frame in the dense grid — `autoplay={false}` + the still rendition means each cell
          costs ONE decode instead of animating every frame (a 16-cell grid of animated GIFs was
          saturating the UI thread on weak devices). Motion is shown on long-press and in the sent
          message. `stillUrl` falls back to `previewUrl` for GIFs persisted before `stillUrl` existed.

          Two gates, and they do different jobs: `decodeReady` holds the whole grid back until the open
          animation has finished, `revealed` then spaces the cells against one another. Until both pass
          the cell is just the Pressable's tinted background, so the layout is committed once in its
          final shape and thumbnails fade into cells that are already in place. */}
      {decodeReady ? (
        <CachedImage
          uri={(item as any).stillUrl || item.previewUrl}
          style={styles.cellImg}
          resizeMode="cover"
          priority="low"
          autoplay={false}
          // Frame-paced decode. `decodeReady` above holds the whole grid back until the open animation
          // has finished; this spaces the cells against one another so twenty-six of them cannot start
          // together. Two gates, two different jobs.
          paced
          // ── noProxy: THE OTHER HALF OF THE THUMBNAIL STORM ────────────────────────
          //
          // `style.width` here is `'100%'`, which is not numeric, and no `proxyWidth` was
          // passed — so `CachedImage` fell through to `DEFAULT_PROXY_WIDTH` and routed every
          // cell to images.weserv.nl as `?w=800&output=gif&n=-1`. Every request went to a
          // single shared free proxy, each asking it to cold-fetch from Giphy and RE-ENCODE a
          // GIF at 800 px wide, for a cell that is 88 px on screen.
          //
          // Giphy is already a CDN and `stillUrl` is already the right size (the mapping in
          // giphy.ts prefers `fixed_width_small_still`, one frame around 100 px). There is
          // nothing for the proxy to save here and three things for it to cost: a bigger
          // payload, an extra hop, and the loss of Giphy's own sharding across
          // media0-4.giphy.com — which is exactly the parallelism the climb was missing.
          //
          // A numeric `proxyWidth={CELL_W}` would fix the 800 px part and keep the single-host
          // funnel. Bypassing the proxy fixes both.
          noProxy
        />
      ) : null}
    </Pressable>
  );
});
