import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Pressable, StyleSheet, Animated, PanResponder, ScrollView, LayoutAnimation, Platform, UIManager, Linking } from 'react-native';
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

// Enable LayoutAnimation on Android (no-op on iOS where it's always on).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Lightweight progress bar isolated into its own subscriber so the 500ms
// position updates re-render ONLY the bar, not the whole widget (artwork,
// blur, queue). Big win on weak devices.
const ProgressBar = React.memo(function ProgressBar() {
  const theme = useTheme();
  const positionMs = useMusicStore((s) => s.positionMs);
  const durationMs = useMusicStore((s) => s.durationMs);
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 6 }}>
      <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)', overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: theme.colors.accent.primary, borderRadius: 2 }} />
      </View>
      <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 9 }}>{fmt(positionMs)}/{fmt(durationMs)}</Text>
    </View>
  );
});

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
  const scheduleCollapse = useCallback(() => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setExpanded(false);
    }, COLLAPSE_DELAY);
  }, []);
  useEffect(() => {
    if (expanded) scheduleCollapse();
    return () => { if (collapseTimer.current) clearTimeout(collapseTimer.current); };
  }, [expanded, scheduleCollapse]);

  // Toggle expand with a smooth, native layout transition instead of a hard cut.
  const toggleExpanded = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((e) => !e);
  }, []);

  if (!current) return null;

  const queue = recent.filter((t) => t.id !== current.id);
  // The close (x) button only makes sense when there's nothing else queued.
  // With other songs available, hide it so the user keeps the queue handy.
  const showClose = queue.length === 0;

  return (
    <Animated.View
      style={[styles.wrap, { top: insets.top + 6, transform: [{ translateY: Animated.add(slide, dragY) }] }]}
      pointerEvents={show ? 'box-none' : 'none'}
    >
      <View style={[styles.cardShadow]} {...panResponder.panHandlers}>
        <BlurView intensity={90} tint={theme.isDark ? 'dark' : 'light'} style={styles.blur}>
          {/* Main row — tap to expand/collapse */}
          <Pressable onPress={toggleExpanded} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <CachedImage uri={current.artwork} style={styles.art} resizeMode="cover" />
            <View style={{ flex: 1, marginLeft: 10, marginRight: 8 }}>
              <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 12 }}>{current.title}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ flexShrink: 1, fontSize: 11 }}>{current.artist}</Text>
                {/* Quiet "30 с" pill marks iTunes preview clips so the user knows playback is shortened. */}
                {current.isPreview ? (
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                    <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 9 }}>30 с</Text>
                  </View>
                ) : null}
              </View>
              <ProgressBar />
            </View>
            <Pressable onPress={() => { toggle(); scheduleCollapse(); }} hitSlop={8} style={[styles.btn, { backgroundColor: theme.colors.accent.primary }]}>
              <Feather name={isPlaying ? 'pause' : 'play'} size={16} color="#FFFFFF" style={isPlaying ? undefined : { marginLeft: 2 }} />
            </Pressable>
            {showClose && (
              <Pressable onPress={stop} hitSlop={8} style={{ paddingLeft: 8, paddingRight: 2 }}>
                <Feather name="x" size={16} color={theme.colors.text.tertiary} />
              </Pressable>
            )}
          </Pressable>

          {/* For iTunes 30 s previews show a one-tap shortcut to YouTube Music
              so the user can listen to the full track. Hidden for full-length
              Audius tracks (no need). */}
          {current.isPreview ? (
            <Pressable
              onPress={() => {
                const q = `${current.title} ${current.artist}`.trim();
                Linking.openURL(`https://music.youtube.com/search?q=${encodeURIComponent(q)}`).catch(() => {});
              }}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8, paddingVertical: 6, borderRadius: 10, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
            >
              <Feather name="external-link" size={11} color={theme.colors.text.secondary} />
              <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ fontSize: 10 }}>Слушать целиком в YouTube Music</Text>
            </Pressable>
          ) : null}

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
