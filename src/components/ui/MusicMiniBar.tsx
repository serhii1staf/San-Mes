import React, { useEffect, useRef } from 'react';
import { View, Pressable, StyleSheet, Animated, PanResponder } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { useMusicStore } from '../../store/musicStore';

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// App-wide floating music widget (Spotify/Telegram-style). Slides down from the
// top when a track is playing AND the user is NOT on the music chat screen
// itself (in the chat the inline cards control playback). Swipe up to dismiss.
export function MusicMiniBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const current = useMusicStore((s) => s.current);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const positionMs = useMusicStore((s) => s.positionMs);
  const durationMs = useMusicStore((s) => s.durationMs);
  const toggle = useMusicStore((s) => s.toggle);
  const stop = useMusicStore((s) => s.stop);

  // Hide on the music chat screen (cards control playback there).
  const onMusicScreen = pathname === '/chat/music';
  const show = !!current && !onMusicScreen;

  const slide = useRef(new Animated.Value(-120)).current;
  const dragY = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy < -6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => { if (g.dy < 0) dragY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy < -40 || g.vy < -0.4) {
          Animated.timing(dragY, { toValue: -160, duration: 160, useNativeDriver: true }).start(() => {
            dragY.setValue(0);
            useMusicStore.getState().stop();
          });
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 120, friction: 10 }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    Animated.spring(slide, { toValue: show ? 0 : -120, useNativeDriver: true, tension: 70, friction: 12 }).start();
  }, [show]);

  if (!current) return null;

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  return (
    <Animated.View
      style={[styles.wrap, { top: insets.top + 6, transform: [{ translateY: Animated.add(slide, dragY) }] }]}
      pointerEvents={show ? 'box-none' : 'none'}
    >
      <View
        style={[styles.card, { backgroundColor: theme.isDark ? '#1C1C1E' : '#FFFFFF', borderColor: theme.colors.border.light }]}
        {...panResponder.panHandlers}
      >
        <CachedImage uri={current.artwork} style={styles.art} resizeMode="cover" />
        <View style={{ flex: 1, marginLeft: 10, marginRight: 8 }}>
          <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 12 }}>{current.title}</Text>
          <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{current.artist}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 6 }}>
            <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: theme.colors.border.light, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: theme.colors.accent.primary, borderRadius: 2 }} />
            </View>
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 9 }}>{fmt(positionMs)}/{fmt(durationMs)}</Text>
          </View>
        </View>
        <Pressable onPress={toggle} hitSlop={8} style={[styles.btn, { backgroundColor: theme.colors.accent.primary }]}>
          <Feather name={isPlaying ? 'pause' : 'play'} size={16} color="#FFFFFF" style={isPlaying ? undefined : { marginLeft: 2 }} />
        </Pressable>
        <Pressable onPress={stop} hitSlop={8} style={{ paddingLeft: 8, paddingRight: 2 }}>
          <Feather name="x" size={16} color={theme.colors.text.tertiary} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 300 },
  card: {
    flexDirection: 'row', alignItems: 'center', width: '92%',
    borderRadius: 16, paddingHorizontal: 8, paddingVertical: 8, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 8,
  },
  art: { width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.1)' },
  btn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
