import React, { useCallback, useEffect, useRef } from 'react';
import { View, Modal, Pressable, FlatList, StyleSheet, Animated, Dimensions, PanResponder, Share } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { Track } from '../../services/musicService';
import { useMusicStore } from '../../store/musicStore';
import { triggerHaptic } from '../../utils/haptics';
import { useT, useI18nStore } from '../../i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface PlaylistSheetProps {
  visible: boolean;
  tracks: Track[]; // already deduped by caller
  onClose: () => void;
}

// Floating playlist sheet — same chrome as AuthorInfoModal (marginH 8, marginB
// 16, borderRadius 28, flex-end anchored, content-driven height capped via the
// inner ScrollView). Tap a row to play, swipe down or tap the backdrop to
// close, "Поделиться" exports the playlist as plain text via system Share.
export function PlaylistSheet({ visible, tracks, onClose }: PlaylistSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const locale = useI18nStore((s) => s.locale);
  const play = useMusicStore((s) => s.play);
  const current = useMusicStore((s) => s.current);
  const isPlaying = useMusicStore((s) => s.isPlaying);

  // Stable play handler so the memoized TrackRow's `onPlay` prop identity
  // doesn't change on every sheet re-render — keeps the row comparator from
  // tripping when only `current`/`isPlaying` ticked.
  const handlePlay = useCallback((item: Track) => { triggerHaptic('light'); play(item); }, [play]);

  // Off-screen offset is generous so the slide-out fully clears even on tall
  // phones; the value never drives layout, only translateY.
  const OFFSCREEN = SCREEN_HEIGHT;
  const translateY = useRef(new Animated.Value(OFFSCREEN)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    if (visible) {
      closing.current = false;
      translateY.setValue(OFFSCREEN);
      backdrop.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 60, friction: 11 }),
        Animated.timing(backdrop, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const animateClose = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(translateY, { toValue: OFFSCREEN, duration: 220, useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.4,
      onPanResponderMove: (_, g) => {
        if (closing.current) return;
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (closing.current) return;
        if (g.dy > 80 || g.vy > 0.5) animateClose();
        else Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 90, friction: 11 }).start();
      },
      onPanResponderTerminate: () => {
        if (!closing.current) Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 90, friction: 11 }).start();
      },
    }),
  ).current;

  const sharePlaylist = async () => {
    triggerHaptic('light');
    const lines = tracks.map((t, i) => `${i + 1}. ${t.title} — ${t.artist}`);
    const message = `${t('playlist.share_header')}\n\n${lines.join('\n')}`;
    try { await Share.share({ message }); } catch {}
  };

  const renderTrack = ({ item, index }: { item: Track; index: number }) => (
    <TrackRow
      item={item}
      index={index}
      active={current?.id === item.id}
      isPlaying={isPlaying}
      theme={theme}
      t={t}
      onPlay={handlePlay}
    />
  );

  const sheetBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={animateClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        {/* Backdrop */}
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdrop }}>
          <Pressable style={{ flex: 1 }} onPress={animateClose} />
        </Animated.View>

        {/* Sheet — anchored to bottom, height grows with content (ScrollView
            caps it at ~55% of screen). Same chrome (marginH 8, marginB 16,
            borderRadius 28) as the rest of the app's sheets. */}
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY }] }}>
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: sheetBg, borderRadius: 28, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10, overflow: 'hidden' }}>
              {/* Drag handle — claims pan gestures so list scrolling stays
                  free of accidental dismissals. */}
              <View {...panResponder.panHandlers} style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }} />
              </View>

              {/* Title row — also a drag area for extra forgiveness on swipe-to-dismiss. */}
              <View {...panResponder.panHandlers} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 10 }}>
                <View>
                  <Text variant="body" weight="bold" style={{ fontSize: 16 }}>{t('playlist.title')}</Text>
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11, marginTop: 1 }}>{tracks.length} {pluralize(tracks.length, locale, t)}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={sharePlaylist} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="share" size={15} color={theme.colors.text.primary} />
                  </Pressable>
                  <Pressable onPress={animateClose} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="x" size={14} color={theme.colors.text.primary} />
                  </Pressable>
                </View>
              </View>

              {tracks.length === 0 ? (
                <View style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 28 }}>
                  <Feather name="music" size={36} color={theme.colors.text.tertiary} />
                  <Text variant="body" weight="semibold" style={{ marginTop: 10 }}>{t('playlist.empty_title')}</Text>
                  <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginTop: 4, fontSize: 12 }}>
                    {t('playlist.empty_hint')}
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={tracks}
                  keyExtractor={(t) => t.id}
                  renderItem={renderTrack}
                  // Cap list height so the sheet never grows past ~55% of the
                  // screen — same rule AuthorInfoModal applies to its body.
                  style={{ maxHeight: SCREEN_HEIGHT * 0.55 }}
                  contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: Math.max(insets.bottom, 8) + 12 }}
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                  removeClippedSubviews
                  // Tightened from 10/8/7. Each row is a 40×40 thumbnail +
                  // text + a CachedImage decode; piling 10 of those onto the
                  // open-the-sheet frame produced a perceptible stutter on
                  // weak devices. 8/4/6 covers the visible area and streams
                  // the rest in one row at a time.
                  initialNumToRender={8}
                  maxToRenderPerBatch={4}
                  windowSize={6}
                />
              )}
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────
// Memoized at module scope so it has a stable component type across parent
// re-renders. When the music store ticks (track change / play-pause) the sheet
// re-renders, but the comparator below means only the rows whose `active` flag
// actually flipped (the newly-active row and the previously-active one) rebuild
// — every other visible row is skipped instead of having its JSX recreated.
interface TrackRowProps {
  item: Track;
  index: number;
  active: boolean;
  isPlaying: boolean;
  theme: ReturnType<typeof useTheme>;
  t: ReturnType<typeof useT>;
  onPlay: (item: Track) => void;
}

const TrackRow = React.memo(
  function TrackRow({ item, index, active, isPlaying, theme, t, onPlay }: TrackRowProps) {
    return (
      <Pressable
        onPress={() => onPlay(item)}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, borderRadius: 12, backgroundColor: active ? theme.colors.accent.primary + '15' : 'transparent' }}
      >
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ width: 22, textAlign: 'center', fontSize: 11 }}>{index + 1}</Text>
        {/* Tracks beyond the first ~6 are off-screen on initial paint —
            `priority="low"` keeps their decodes behind anything visible
            (e.g. the player's own artwork, header icons) so opening the
            sheet stays smooth on populated playlists. The `skeleton` prop
            shimmers each rounded 40×40 box until its artwork loads, then
            reveals it smoothly instead of popping in. */}
        <CachedImage uri={item.artwork} style={{ width: 40, height: 40, borderRadius: 8, marginLeft: 6, backgroundColor: 'rgba(0,0,0,0.1)' }} resizeMode="cover" priority={index < 3 ? 'normal' : 'low'} skeleton />
        <View style={{ flex: 1, marginLeft: 10, marginRight: 6 }}>
          <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 13 }}>{item.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ flexShrink: 1, fontSize: 11 }}>{item.artist}</Text>
            {item.isPreview ? (
              <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 8 }}>{t('music_player.preview_seconds')}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <Feather name={active && isPlaying ? 'volume-2' : 'play'} size={14} color={active ? theme.colors.accent.primary : theme.colors.text.tertiary} />
      </Pressable>
    );
  },
  (prev, next) =>
    prev.item.id === next.item.id &&
    prev.active === next.active &&
    prev.isPlaying === next.isPlaying &&
    prev.index === next.index &&
    prev.theme === next.theme &&
    prev.onPlay === next.onPlay,
);

function pluralize(n: number, locale: 'ru' | 'en', t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string): string {
  if (locale === 'en') return n === 1 ? t('playlist.tracks_one') : t('playlist.tracks_many');
  // Russian plural for "трек"
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return t('playlist.tracks_one');
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return t('playlist.tracks_few');
  return t('playlist.tracks_many');
}
