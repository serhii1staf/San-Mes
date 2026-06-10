import React, { useEffect, useRef, useMemo } from 'react';
import { View, Modal, Pressable, FlatList, StyleSheet, Animated, Dimensions, PanResponder, Share } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { Track } from '../../services/musicService';
import { useMusicStore } from '../../store/musicStore';
import { triggerHaptic } from '../../utils/haptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = Math.min(620, SCREEN_HEIGHT * 0.7);
const DISMISS_THRESHOLD = SHEET_HEIGHT * 0.25;

interface PlaylistSheetProps {
  visible: boolean;
  tracks: Track[]; // already deduped by caller
  onClose: () => void;
}

// Floating playlist sheet — same chrome as AuthorInfoModal so the music chat
// has a consistent visual language. Tap a row to play, swipe down or tap the
// backdrop to close, "Поделиться" exports the playlist as plain text via the
// system share sheet.
export function PlaylistSheet({ visible, tracks, onClose }: PlaylistSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const play = useMusicStore((s) => s.play);
  const current = useMusicStore((s) => s.current);
  const isPlaying = useMusicStore((s) => s.isPlaying);

  const translateY = useRef(new Animated.Value(SHEET_HEIGHT + 60)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    if (visible) {
      closing.current = false;
      translateY.setValue(SHEET_HEIGHT + 60);
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
      Animated.timing(translateY, { toValue: SHEET_HEIGHT + 60, duration: 220, useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_, g) => {
        if (closing.current) return;
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (closing.current) return;
        if (g.dy > DISMISS_THRESHOLD || g.vy > 0.6) animateClose();
        else Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 90, friction: 11 }).start();
      },
      onPanResponderTerminate: () => {
        if (!closing.current) Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 90, friction: 11 }).start();
      },
    }),
  ).current;

  const sheetBottomMargin = Math.max(insets.bottom, 12) + 8;

  const sharePlaylist = async () => {
    triggerHaptic('light');
    const lines = tracks.map((t, i) => `${i + 1}. ${t.title} — ${t.artist}`);
    const message = `🎵 Плейлист\n\n${lines.join('\n')}`;
    try { await Share.share({ message }); } catch {}
  };

  const renderTrack = ({ item, index }: { item: Track; index: number }) => {
    const active = current?.id === item.id;
    return (
      <Pressable
        onPress={() => { triggerHaptic('light'); play(item); }}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, borderRadius: 12, backgroundColor: active ? theme.colors.accent.primary + '15' : 'transparent' }}
      >
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ width: 22, textAlign: 'center', fontSize: 11 }}>{index + 1}</Text>
        <CachedImage uri={item.artwork} style={{ width: 40, height: 40, borderRadius: 8, marginLeft: 6, backgroundColor: 'rgba(0,0,0,0.1)' }} resizeMode="cover" />
        <View style={{ flex: 1, marginLeft: 10, marginRight: 6 }}>
          <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 13 }}>{item.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ flexShrink: 1, fontSize: 11 }}>{item.artist}</Text>
            {item.isPreview ? (
              <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 8 }}>30 с</Text>
              </View>
            ) : null}
          </View>
        </View>
        <Feather name={active && isPlaying ? 'volume-2' : 'play'} size={14} color={active ? theme.colors.accent.primary : theme.colors.text.tertiary} />
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={animateClose} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdrop }]}>
          <Pressable style={{ flex: 1 }} onPress={animateClose} />
        </Animated.View>

        <Animated.View
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: sheetBottomMargin,
            height: SHEET_HEIGHT,
            backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF',
            borderRadius: 24,
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.22,
            shadowRadius: 24,
            elevation: 14,
            transform: [{ translateY }],
          }}
        >
          <View {...panResponder.panHandlers} style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 10 }}>
            <View>
              <Text variant="body" weight="bold" style={{ fontSize: 16 }}>Плейлист</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11, marginTop: 1 }}>{tracks.length} {pluralize(tracks.length)}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={sharePlaylist} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="share" size={15} color={theme.colors.text.primary} />
              </Pressable>
              <Pressable onPress={animateClose} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="x" size={16} color={theme.colors.text.primary} />
              </Pressable>
            </View>
          </View>

          {tracks.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
              <Feather name="music" size={36} color={theme.colors.text.tertiary} />
              <Text variant="body" weight="semibold" style={{ marginTop: 10 }}>Плейлист пуст</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginTop: 4, fontSize: 12 }}>
                Найдите хотя бы один трек — он попадёт в плейлист автоматически
              </Text>
            </View>
          ) : (
            <FlatList
              data={tracks}
              keyExtractor={(t) => t.id}
              renderItem={renderTrack}
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
              showsVerticalScrollIndicator={false}
              bounces={false}
              removeClippedSubviews
              initialNumToRender={10}
              maxToRenderPerBatch={8}
              windowSize={7}
            />
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function pluralize(n: number): string {
  // Russian plural for "трек"
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'трек';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'трека';
  return 'треков';
}
