import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Pressable, Modal, TextInput, FlatList, Animated, StatusBar, Dimensions, ActivityIndicator, Keyboard } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { getTrendingGifs, searchGifs, getCachedTrending, setCachedTrending, GiphyItem } from '../../services/giphy';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_MARGIN = 10;
const NUM_COLS = 3;
const GRID_PAD = 10;
const CELL_GAP = 6;
const SHEET_W = SCREEN_WIDTH - SHEET_MARGIN * 2;
const CELL_W = Math.floor((SHEET_W - GRID_PAD * 2 - CELL_GAP * (NUM_COLS - 1)) / NUM_COLS);

interface GiphyPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
}

// GIF picker — uses the EXACT same open/close/dim animation as the main feed's
// three-dots menu (PostMenuModal): spring slide-up from the bottom, a 0.4 black
// backdrop that fades in over 200ms, and a 250ms slide-down + fade-out on close.
// It also always dismisses the keyboard on close so the underlying chat / comment
// input bar (KeyboardStickyView) can't get stuck mid-screen.
export function GiphyPicker({ visible, onClose, onSelect }: GiphyPickerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const isClosing = useRef(false);
  const [mounted, setMounted] = useState(false);

  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GiphyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);
  const reqIdRef = useRef(0);

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
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      // Initial load handled by the debounced query effect below (avoids a
      // duplicate request that would burn the rate limit twice as fast).
    }
  }, [visible]);

  // Debounced search; also performs the initial trending load on open.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => load(query, 0), query.trim() ? 350 : 0);
    return () => clearTimeout(t);
  }, [query, visible, load]);

  const dismiss = useCallback(() => {
    if (isClosing.current) return;
    isClosing.current = true;
    // Dismiss the keyboard FIRST so the underlying input bar settles back down.
    Keyboard.dismiss();
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
  }, [onClose]);

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

  return (
    <Modal visible={visible || mounted} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <StatusBar hidden />
      {/* Backdrop — same 0.4 black dim as the feed menu */}
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdropAnim }}>
        <Pressable style={{ flex: 1 }} onPress={dismiss} />
      </Animated.View>

      {/* Floating card (does not touch edges) */}
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: SHEET_MARGIN,
          right: SHEET_MARGIN,
          bottom: Math.max(insets.bottom, 8),
          height: '60%',
          opacity: backdropAnim,
          transform: [{ translateY: slideAnim }],
        }}
      >
        <View style={{ flex: 1, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 36, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 20, elevation: 12 }}>
          {/* Grabber */}
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
          </View>

          {/* Search */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: GRID_PAD, marginVertical: 8, backgroundColor: theme.colors.background.secondary, borderRadius: 20, paddingHorizontal: 14, height: 40 }}>
            <Feather name="search" size={16} color={theme.colors.text.tertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Поиск GIF..."
              placeholderTextColor={theme.colors.text.tertiary}
              style={{ flex: 1, marginLeft: 8, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular }}
              autoCorrect={false}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Feather name="x" size={16} color={theme.colors.text.tertiary} />
              </Pressable>
            )}
            <View style={{ marginLeft: 8 }}>
              <Text variant="caption" weight="bold" color={theme.colors.accent.primary} style={{ fontSize: 11 }}>GIPHY</Text>
            </View>
          </View>

          {loading && gifs.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={theme.colors.accent.primary} />
            </View>
          ) : (
            <FlatList
              data={gifs}
              keyExtractor={(item) => item.id}
              numColumns={NUM_COLS}
              contentContainerStyle={{ paddingHorizontal: GRID_PAD, paddingBottom: 16 }}
              columnWrapperStyle={{ gap: CELL_GAP, marginBottom: CELL_GAP }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              removeClippedSubviews
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={7}
              onEndReachedThreshold={0.6}
              onEndReached={handleEndReached}
              renderItem={({ item }) => (
                <Pressable onPress={() => select(item.sendUrl)} style={{ width: CELL_W, height: CELL_W, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.colors.background.secondary }}>
                  <CachedImage uri={item.previewUrl} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                </Pressable>
              )}
              ListFooterComponent={loadingMore ? <View style={{ paddingVertical: 16 }}><ActivityIndicator color={theme.colors.accent.primary} /></View> : null}
              ListEmptyComponent={!loading ? (
                <View style={{ alignItems: 'center', paddingTop: 40 }}>
                  <Text variant="body" color={theme.colors.text.tertiary}>Ничего не найдено</Text>
                </View>
              ) : null}
            />
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}
