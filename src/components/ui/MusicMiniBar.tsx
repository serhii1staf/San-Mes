import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, Animated, PanResponder, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
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

const COLLAPSE_DELAY = 4000;

// App-wide floating music widget (Spotify/Telegram-style), with a frosted blur
// background (same BlurView as the profile buttons). Slides down from the top
// while a track plays and the user is NOT on the music chat screen. Tap to expand
// (rubber-band) into a queue of recently played tracks; it auto-collapses after a
// few idle seconds. Swipe up to dismiss (stops playback).
export function MusicMiniBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const current = useMusicStore((s) => s.current);
  const recent = useMusicStore((s) => s.recent);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const positionMs = useMusicStore((s) => s.positionMs);
  const durationMs = useMusicStore((s) => s.durationMs);
  const toggle = useMusicStore((s) => s.toggle);
  const play = useMusicStore((s) => s.play);
  const stop = useMusicStore((s) => s.stop);

  const onMusicScreen = pathname === '/chat/music';
  const show = !!current && !onMusicScreen;

  const slide = useRef(new Animated.Value(-260)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const [expanded, setExpanded] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy < -6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => { if (g.dy < 0) dragY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy < -40 || g.vy < -0.4) {
          Animated.timing(dragY, { toValue: -260, duration: 160, useNativeDriver: true }).start(() => {
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
    Animated.spring(slide, { toValue: show ? 0 : -260, useNativeDriver: true, tension: 70, friction: 12 }).start();
    if (!show) setExpanded(false);
  }, [show]);

  // Auto-collapse after idle.
  const scheduleCollapse = () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setExpanded(false), COLLAPSE_DELAY);
  };
  useEffect(() => {
    if (expanded) scheduleCollapse();
    return () => { if (collapseTimer.current) clearTimeout(collapseTimer.current); };
  }, [expanded]);

  if (!current) return null;

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const queue = recent.filter((t) => t.id !== current.id);

  return (
    <Animated.View
      style={[styles.wrap, { top: insets.top + 6, transform: [{ translateY: Animated.add(slide, dragY) }] }]}
      pointerEvents={show ? 'box-none' : 'none'}
    >
      <View style={[styles.cardShadow]} {...panResponder.panHandlers}>
        <BlurView intensity={90} tint={theme.isDark ? 'dark' : 'light'} style={styles.blur}>
          {/* Main row — tap to expand/collapse */}
          <Pressable onPress={() => { setExpanded((e) => !e); }} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <CachedImage uri={current.artwork} style={styles.art} resizeMode="cover" />
            <View style={{ flex: 1, marginLeft: 10, marginRight: 8 }}>
              <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 12 }}>{current.title}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{current.artist}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 6 }}>
                <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)', overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: theme.colors.accent.primary, borderRadius: 2 }} />
                </View>
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 9 }}>{fmt(positionMs)}/{fmt(durationMs)}</Text>
              </View>
            </View>
            <Pressable onPress={() => { toggle(); scheduleCollapse(); }} hitSlop={8} style={[styles.btn, { backgroundColor: theme.colors.accent.primary }]}>
              <Feather name={isPlaying ? 'pause' : 'play'} size={16} color="#FFFFFF" style={isPlaying ? undefined : { marginLeft: 2 }} />
            </Pressable>
            <Pressable onPress={stop} hitSlop={8} style={{ paddingLeft: 8, paddingRight: 2 }}>
              <Feather name="x" size={16} color={theme.colors.text.tertiary} />
            </Pressable>
          </Pressable>

          {/* Expanded queue of recent tracks */}
          {expanded && queue.length > 0 && (
            <View style={{ marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)', paddingTop: 8 }}>
              <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {queue.map((t) => (
                  <Pressable key={t.id} onPress={() => { play(t); scheduleCollapse(); }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                    <CachedImage uri={t.artwork} style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.1)' }} resizeMode="cover" />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text variant="caption" weight="medium" numberOfLines={1} style={{ fontSize: 12 }}>{t.title}</Text>
                      <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 10 }}>{t.artist}</Text>
                    </View>
                    <Feather name="play" size={14} color={theme.colors.text.tertiary} />
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </BlurView>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 300 },
  cardShadow: {
    width: '92%', borderRadius: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 14, elevation: 9,
  },
  blur: { borderRadius: 18, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 8 },
  art: { width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.1)' },
  btn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
