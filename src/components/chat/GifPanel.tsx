import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, FlatList, ActivityIndicator, Text as RNText, StyleSheet, Dimensions } from 'react-native';
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
  /** Most-recently-used GIFs — prepended to the trending grid. */
  recentGifs?: GiphyItem[];
}

function GifPanelComponent({ height, onSelect, onLongPress, theme, bottomInset = 0, bare = false, recentGifs }: GifPanelProps) {
  const t = useT();
  const glassActive = useLiquidGlassActive();
  const [gifs, setGifs] = useState<GiphyItem[]>(() => getCachedTrending() || []);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(gifs.length);
  const reqIdRef = useRef(0);

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
    () => [styles.listContent, { paddingBottom: 12 + bottomInset }],
    [bottomInset],
  );

  const renderItem = useCallback(
    ({ item }: { item: GiphyItem }) => (
      <Pressable
        onPress={() => onSelect(item)}
        onLongPress={onLongPress ? () => onLongPress(item) : undefined}
        delayLongPress={280}
        style={{ width: CELL_W, height: CELL_W, borderRadius: 10, overflow: 'hidden', marginBottom: CELL_GAP, backgroundColor: theme.colors.background.secondary }}
      >
        {/* STATIC frame in the dense grid — `autoplay={false}` + the still
            rendition means each cell costs ONE decode instead of animating
            every frame (a 16-cell grid of animated GIFs was saturating the UI
            thread on weak devices). Motion is shown on long-press + in the
            sent message. `(item as any).stillUrl` falls back to previewUrl for
            GIFs persisted in `recent_gif` before stillUrl existed. */}
        <CachedImage
          uri={(item as any).stillUrl || item.previewUrl}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          priority="low"
          autoplay={false}
        />
      </Pressable>
    ),
    [onSelect, onLongPress, theme],
  );

  // Recently-used GIFs first, then trending (deduped by id).
  const data = useMemo(() => {
    if (!recentGifs || recentGifs.length === 0) return gifs;
    const seen = new Set(recentGifs.map((g) => g.id));
    return [...recentGifs, ...gifs.filter((g) => !seen.has(g.id))];
  }, [recentGifs, gifs]);

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

      {loading && data.length === 0 ? (
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
          keyboardShouldPersistTaps="always"
          removeClippedSubviews
          initialNumToRender={9}
          maxToRenderPerBatch={6}
          windowSize={5}
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
