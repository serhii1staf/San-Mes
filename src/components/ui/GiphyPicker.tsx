import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Pressable, Modal, TextInput, FlatList, Animated, StatusBar, Easing, Dimensions, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { getTrendingGifs, searchGifs, GiphyItem } from '../../services/giphy';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const NUM_COLS = 3;
const GRID_PAD = 12;
const CELL_GAP = 6;
const CELL_W = Math.floor((SCREEN_WIDTH - GRID_PAD * 2 - CELL_GAP * (NUM_COLS - 1)) / NUM_COLS);

interface GiphyPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
}

// GIF picker sheet — slides up from the bottom (matches the app's other sheets),
// shows trending GIFs + search, sends the chosen GIF URL. Lightweight: only small
// downsized renditions are loaded into the grid.
export function GiphyPicker({ visible, onClose, onSelect }: GiphyPickerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(40)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const dismissing = useRef(false);

  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GiphyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (visible) {
      dismissing.current = false;
      slide.setValue(40);
      fade.setValue(0);
      Animated.parallel([
        Animated.timing(slide, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
      // Load trending on open
      load('', 0);
    } else {
      setQuery('');
      setGifs([]);
    }
  }, [visible]);

  const load = useCallback(async (q: string, offset: number) => {
    const reqId = ++reqIdRef.current;
    if (offset === 0) setLoading(true); else setLoadingMore(true);
    const items = q.trim() ? await searchGifs(q, 24, offset) : await getTrendingGifs(24, offset);
    // Ignore stale responses (user typed again before this returned)
    if (reqId !== reqIdRef.current) return;
    offsetRef.current = offset + items.length;
    setGifs((prev) => (offset === 0 ? items : [...prev, ...items]));
    setLoading(false);
    setLoadingMore(false);
  }, []);

  // Debounced search as the user types
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => load(query, 0), 350);
    return () => clearTimeout(t);
  }, [query, visible, load]);

  const dismiss = useCallback(() => {
    if (dismissing.current) return;
    dismissing.current = true;
    Animated.parallel([
      Animated.timing(slide, { toValue: 40, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: 170, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(() => onClose());
  }, [onClose]);

  const handleEndReached = useCallback(() => {
    if (loading || loadingMore) return;
    load(query, offsetRef.current);
  }, [loading, loadingMore, query, load]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <StatusBar hidden />
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', opacity: fade }}>
        <Pressable style={{ flex: 1 }} onPress={dismiss} />
      </Animated.View>

      <Animated.View
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: '72%',
          backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          opacity: fade, transform: [{ translateY: slide }],
          overflow: 'hidden',
        }}
      >
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
            contentContainerStyle={{ paddingHorizontal: GRID_PAD, paddingBottom: insets.bottom + 16 }}
            columnWrapperStyle={{ gap: CELL_GAP, marginBottom: CELL_GAP }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            removeClippedSubviews
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            onEndReachedThreshold={0.6}
            onEndReached={handleEndReached}
            renderItem={({ item }) => (
              <Pressable onPress={() => { onSelect(item.sendUrl); dismiss(); }} style={{ width: CELL_W, height: CELL_W, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.colors.background.secondary }}>
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
      </Animated.View>
    </Modal>
  );
}
