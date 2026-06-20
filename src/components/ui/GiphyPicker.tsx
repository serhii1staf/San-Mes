import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Pressable, Modal, TextInput, FlatList, Animated, Dimensions, ActivityIndicator, Keyboard, Platform } from 'react-native';
import { ModalStatusBar } from './ModalStatusBar';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { getTrendingGifs, searchGifs, getCachedTrending, setCachedTrending, GiphyItem } from '../../services/giphy';
import { useT } from '../../i18n/store';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_MARGIN = 10;
const NUM_COLS = 3;
const GRID_PAD = 10;
const CELL_GAP = 6;
const SHEET_W = SCREEN_WIDTH - SHEET_MARGIN * 2;
const CELL_W = Math.floor((SHEET_W - GRID_PAD * 2 - CELL_GAP * (NUM_COLS - 1)) / NUM_COLS);
// Resting card height (keyboard down). A touch shorter than before and
// anchored to the bottom so the panel sits a bit LOWER on screen.
const RESTING_HEIGHT = Math.round(SCREEN_HEIGHT * 0.56);

interface GiphyPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
}

// GIF picker — floating bottom card with a spring slide-up, a 0.4 black
// backdrop, and a slide-down on close.
//
// Keyboard-aware: focusing the search field LIFTS the whole card so its bottom
// edge sits exactly on top of the keyboard (nothing is covered and the chat
// behind never shows through), and the search bar — which lives at the BOTTOM
// of the card — ends up as a clean input row directly above the keyboard. The
// GIF grid scrolls above it. The lift is a native-driver translateY combined
// with the open/close slide, and the card height shrinks to the space above
// the keyboard so it never overflows the top.
export function GiphyPicker({ visible, onClose, onSelect }: GiphyPickerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  // Native-driver keyboard lift (negative translateY). Combined with slideAnim.
  const kbTranslate = useRef(new Animated.Value(0)).current;
  const isClosing = useRef(false);
  const [mounted, setMounted] = useState(false);
  // Keyboard state drives the card height so the lifted card fits above the
  // keyboard without running off the top of the screen.
  const [kbOpen, setKbOpen] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);

  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GiphyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);
  const reqIdRef = useRef(0);

  const restingBottom = Math.max(insets.bottom, 8);

  const load = useCallback(async (q: string, offset: number) => {
    const reqId = ++reqIdRef.current;
    // Serve trending from the session cache instantly (saves API quota — the
    // beta key is limited to 100 req/hour).
    if (!q.trim() && offset === 0) {
      const cached = getCachedTrending();
      if (cached && cached.length > 0) {
        setGifs(cached);
        offsetRef.current = cached.length;
        setLoading(false);
        return;
      }
    }
    if (offset === 0) setLoading(true); else setLoadingMore(true);
    const items = q.trim() ? await searchGifs(q, 24, offset) : await getTrendingGifs(24, offset);
    if (reqId !== reqIdRef.current) return; // stale response
    if (!q.trim() && offset === 0) setCachedTrending(items);
    offsetRef.current = offset + items.length;
    setGifs((prev) => (offset === 0 ? items : [...prev, ...items]));
    setLoading(false);
    setLoadingMore(false);
  }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      isClosing.current = false;
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
      kbTranslate.setValue(0);
      setKbOpen(false);
      setKbHeight(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      // Initial load handled by the debounced query effect below (avoids a
      // duplicate request that would burn the rate limit twice as fast).
    }
  }, [visible]);

  // Keyboard lift. Works inside a RN Modal via the core Keyboard events
  // (react-native-keyboard-controller does not track keyboards hosted in a
  // separate Modal window, so we drive the animation ourselves). iOS gets the
  // `will*` events (fire before the keyboard finishes → animation matches the
  // keyboard exactly); Android only emits `did*`.
  useEffect(() => {
    if (!visible) return;
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: any) => {
      const h = e?.endCoordinates?.height ?? 0;
      if (h <= 0) return;
      setKbHeight(h);
      setKbOpen(true);
      // Lift so the card's resting bottom (restingBottom) ends up at the
      // keyboard's top edge (h).
      const lift = Math.max(0, h - restingBottom);
      Animated.timing(kbTranslate, {
        toValue: -lift,
        duration: e?.duration || 250,
        useNativeDriver: true,
      }).start();
    };
    const onHide = (e: any) => {
      setKbOpen(false);
      Animated.timing(kbTranslate, {
        toValue: 0,
        duration: e?.duration || 220,
        useNativeDriver: true,
      }).start();
    };
    const subShow = Keyboard.addListener(showEvt, onShow);
    const subHide = Keyboard.addListener(hideEvt, onHide);
    return () => { subShow.remove(); subHide.remove(); };
  }, [visible, restingBottom, kbTranslate]);

  // Debounced search; also performs the initial trending load on open.
  useEffect(() => {
    if (!visible) return;
    const tid = setTimeout(() => load(query, 0), query.trim() ? 350 : 0);
    return () => clearTimeout(tid);
  }, [query, visible, load]);

  const dismiss = useCallback(() => {
    if (isClosing.current) return;
    isClosing.current = true;
    // Dismiss the keyboard FIRST so the underlying input bar settles back down.
    Keyboard.dismiss();
    kbTranslate.setValue(0);
    setKbOpen(false);
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(() => {
        setMounted(false);
        setQuery('');
        setGifs([]);
        onClose();
      }, 30);
    });
  }, [onClose, kbTranslate]);

  const handleEndReached = useCallback(() => {
    if (loading || loadingMore) return;
    load(query, offsetRef.current);
  }, [loading, loadingMore, query, load]);

  const select = useCallback((url: string) => {
    Keyboard.dismiss();
    onSelect(url);
    dismiss();
  }, [onSelect, dismiss]);

  if (!visible && !mounted) return null;

  // Card height: when the keyboard is up, shrink to the gap between the
  // keyboard top and the safe-area top so the lifted card never runs off
  // screen; otherwise the resting height.
  const cardHeight = kbOpen
    ? Math.max(260, SCREEN_HEIGHT - kbHeight - insets.top - 16)
    : RESTING_HEIGHT;

  return (
    <Modal visible={visible || mounted} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <ModalStatusBar />
      {/* Backdrop — same 0.4 black dim as the feed menu */}
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdropAnim }}>
        <Pressable style={{ flex: 1 }} onPress={dismiss} />
      </Animated.View>

      {/* Floating card (does not touch edges). translateY combines the
          open/close slide with the keyboard lift. */}
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: SHEET_MARGIN,
          right: SHEET_MARGIN,
          bottom: restingBottom,
          height: cardHeight,
          opacity: backdropAnim,
          transform: [{ translateY: Animated.add(slideAnim, kbTranslate) }],
        }}
      >
        <View style={{ flex: 1, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 36, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 20, elevation: 12 }}>
          {/* Grabber */}
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
          </View>

          {/* GIF grid — fills the space above the bottom search row. */}
          {loading && gifs.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={theme.colors.accent.primary} />
            </View>
          ) : (
            <FlatList
              data={gifs}
              style={{ flex: 1 }}
              keyExtractor={(item) => item.id}
              numColumns={NUM_COLS}
              contentContainerStyle={{ paddingHorizontal: GRID_PAD, paddingTop: 4, paddingBottom: 12 }}
              columnWrapperStyle={{ gap: CELL_GAP, marginBottom: CELL_GAP }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              removeClippedSubviews
              // Tightened from 12/12/7. With numColumns=3 each "row" is 3
              // GIF cells, so initialNumToRender=9 = 3 fully-rendered rows
              // (≈ visible-window height); maxToRenderPerBatch=3 streams
              // one row per batch instead of 4 rows in one go.
              initialNumToRender={9}
              maxToRenderPerBatch={3}
              windowSize={5}
              onEndReachedThreshold={0.6}
              onEndReached={handleEndReached}
              renderItem={({ item }) => (
                <Pressable onPress={() => select(item.sendUrl)} style={{ width: CELL_W, height: CELL_W, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.colors.background.secondary }}>
                  {/* GIFs in a scrolling grid — `priority="low"` lets
                      expo-image's loader prioritize visible GIFs first
                      and queue the off-screen rows behind them, so a
                      fast scroll doesn't pile decode work on the JS
                      thread. */}
                  <CachedImage uri={item.previewUrl} style={{ width: '100%', height: '100%' }} resizeMode="cover" priority="low" />
                </Pressable>
              )}
              ListFooterComponent={loadingMore ? <View style={{ paddingVertical: 16 }}><ActivityIndicator color={theme.colors.accent.primary} /></View> : null}
              ListEmptyComponent={!loading ? (
                <View style={{ alignItems: 'center', paddingTop: 40 }}>
                  <Text variant="body" color={theme.colors.text.tertiary}>{t('giphy.empty')}</Text>
                </View>
              ) : null}
            />
          )}

          {/* Search row — pinned to the BOTTOM of the card. When the keyboard
              opens and the card lifts, this row sits as a clean input directly
              above the keyboard. The clear-x and a close-panel x live on the
              right. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: GRID_PAD, marginTop: 4, marginBottom: 10, backgroundColor: theme.colors.background.secondary, borderRadius: 20, paddingHorizontal: 14, height: 42 }}>
            <Feather name="search" size={16} color={theme.colors.text.tertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('giphy.search_placeholder')}
              placeholderTextColor={theme.colors.text.tertiary}
              style={{ flex: 1, marginLeft: 8, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular }}
              autoCorrect={false}
              returnKeyType="search"
            />
            <View style={{ marginLeft: 8 }}>
              <Text variant="caption" weight="bold" color={theme.colors.accent.primary} style={{ fontSize: 11 }}>GIPHY</Text>
            </View>
            {/* Clear the query (only when there's text). */}
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8} style={{ marginLeft: 10 }}>
                <Feather name="x" size={16} color={theme.colors.text.tertiary} />
              </Pressable>
            )}
            {/* Close the whole panel. */}
            <Pressable onPress={dismiss} hitSlop={8} style={{ marginLeft: 10, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
              <Feather name="x" size={15} color={theme.colors.text.secondary} />
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}
