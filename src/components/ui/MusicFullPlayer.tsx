import React, { useRef, useCallback } from 'react';
import { View, Modal, Pressable, StyleSheet, Animated, PanResponder, ScrollView, StatusBar, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { useMusicStore } from '../../store/musicStore';
import { Track } from '../../services/musicService';
import { triggerHaptic } from '../../utils/haptics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Full-screen player. Slides up from where the bottom indicator was, occupying
// roughly half the screen and growing into a comfortable sheet. "Свернуть" (or
// drag-down) closes it back to the bottom indicator without stopping playback.
//
// Why a custom Modal sheet instead of a screen route:
//   - we need it on top of every tab/screen (route would lose chat state),
//   - we want it to feel like a transient panel — the music stays "in the
//     background" of the app, not a destination,
//   - Modal animationType="none" + our own Animated translateY = full control
//     over physics, no native pageSheet artefacts.
//
// Performance for weak devices:
//   - All transforms are useNativeDriver: true.
//   - Progress slider uses ONLY the Animated.Value during scrubbing; only the
//     drop-release commit calls into the audio store.
//   - Track-row list is a plain map (recents are capped at 12) — no FlatList
//     overhead is needed at this size.

const PLAYER_TOP = 60; // sheet starts this far below the top edge

export function MusicFullPlayer() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const playerOpen = useMusicStore((s) => s.playerOpen);
  const closePlayer = useMusicStore((s) => s.closePlayer);
  const current = useMusicStore((s) => s.current);
  const recent = useMusicStore((s) => s.recent);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const positionMs = useMusicStore((s) => s.positionMs);
  const durationMs = useMusicStore((s) => s.durationMs);
  const toggle = useMusicStore((s) => s.toggle);
  const seek = useMusicStore((s) => s.seek);
  const play = useMusicStore((s) => s.play);

  // Slide animation. translateY=0 → fully open. translateY=SCREEN_HEIGHT → off-screen.
  const slide = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  React.useEffect(() => {
    if (playerOpen) {
      closing.current = false;
      slide.setValue(SCREEN_HEIGHT);
      dragY.setValue(0);
      Animated.spring(slide, { toValue: 0, useNativeDriver: true, tension: 65, friction: 12 }).start();
    }
  }, [playerOpen]);

  const animateClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(slide, { toValue: SCREEN_HEIGHT, duration: 240, useNativeDriver: true }).start(() => {
      closePlayer();
    });
  }, [closePlayer, slide]);

  // Drag-down on the handle area dismisses the player.
  const sheetPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_, g) => {
        if (closing.current) return;
        if (g.dy > 0) dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (closing.current) return;
        if (g.dy > 100 || g.vy > 0.6) {
          // Continue the swipe out using whatever momentum the user gave it.
          Animated.timing(dragY, { toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: true }).start(() => {
            dragY.setValue(0);
            closePlayer();
          });
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 90, friction: 11 }).start();
        }
      },
    }),
  ).current;

  // ── Progress slider ────────────────────────────────────────────────────────
  // We render the slider thumb at a position derived from EITHER the live
  // playback position OR a "scrubbing" offset while the user drags the thumb.
  // That way scrubbing is buttery (no audio call per move) and only the
  // release commits a single seek().
  const sliderWidth = SCREEN_WIDTH - 48; // 24px h-padding inside sheet
  const [scrubbingMs, setScrubbingMs] = React.useState<number | null>(null);
  const effectivePos = scrubbingMs != null ? scrubbingMs : positionMs;
  const sliderRatio = durationMs > 0 ? Math.min(1, Math.max(0, effectivePos / durationMs)) : 0;

  const sliderPan = useRef<any>(null);
  if (!sliderPan.current) {
    let startMs = 0;
    sliderPan.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startMs = positionMs;
        setScrubbingMs(startMs);
      },
      onPanResponderMove: (_, g) => {
        if (durationMs <= 0) return;
        const deltaMs = (g.dx / sliderWidth) * durationMs;
        const next = Math.max(0, Math.min(durationMs, startMs + deltaMs));
        setScrubbingMs(next);
      },
      onPanResponderRelease: (_, g) => {
        if (durationMs <= 0) { setScrubbingMs(null); return; }
        const deltaMs = (g.dx / sliderWidth) * durationMs;
        const next = Math.max(0, Math.min(durationMs, startMs + deltaMs));
        setScrubbingMs(null);
        seek(next);
      },
      onPanResponderTerminate: () => setScrubbingMs(null),
    });
  }

  // Skip back/forward 10s — a common-enough convention that beats adding
  // prev/next track buttons at this point (queue ordering is a separate UX).
  const skipBack = () => { triggerHaptic('light'); seek(Math.max(0, positionMs - 10000)); };
  const skipForward = () => { triggerHaptic('light'); seek(Math.min(durationMs - 200, positionMs + 10000)); };

  if (!current) return null;

  const queueRecent: Track[] = recent.filter((t) => t.id !== current.id);
  const sheetBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';
  const translateY = Animated.add(slide, dragY);

  return (
    <Modal visible={playerOpen} transparent animationType="none" statusBarTranslucent onRequestClose={animateClose}>
      <StatusBar hidden />
      <View style={StyleSheet.absoluteFill}>
        {/* Backdrop — fades opaque to dim the underlying app while open. */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <Pressable style={{ flex: 1 }} onPress={animateClose} />
        </View>

        <Animated.View style={[styles.sheet, { backgroundColor: sheetBg, transform: [{ translateY }], paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* Drag handle — only this region claims pan gestures so the inner
              scroll/slider behave normally. */}
          <View {...sheetPan.panHandlers} style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }} />
          </View>

          {/* Top row — collapse button on the right */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 6 }}>
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11, textTransform: 'uppercase' }}>Сейчас играет</Text>
            <Pressable onPress={animateClose} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="chevron-down" size={16} color={theme.colors.text.primary} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Artwork + title */}
            <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 18 }}>
              <CachedImage uri={current.artwork} style={{ width: 220, height: 220, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.1)' }} resizeMode="cover" />
              <Text variant="body" weight="bold" style={{ fontSize: 18, marginTop: 14 }} numberOfLines={1}>{current.title}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 13 }}>{current.artist}</Text>
                {current.isPreview ? (
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                    <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10 }}>30 с</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Slider */}
            <View style={{ paddingHorizontal: 24 }}>
              <View
                {...sliderPan.current.panHandlers}
                style={{ height: 28, justifyContent: 'center' }}
              >
                {/* Track */}
                <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${sliderRatio * 100}%`, backgroundColor: theme.colors.accent.primary, borderRadius: 2 }} />
                </View>
                {/* Thumb */}
                <View style={{ position: 'absolute', left: sliderRatio * sliderWidth - 7, top: 4, width: 14, height: 14, borderRadius: 7, backgroundColor: theme.colors.accent.primary, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 2, elevation: 2 }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{fmt(effectivePos)}</Text>
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{fmt(durationMs)}</Text>
              </View>
            </View>

            {/* Transport controls */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 28, paddingTop: 18, paddingBottom: 22 }}>
              <Pressable onPress={skipBack} hitSlop={10} style={styles.skipBtn}>
                <Feather name="rotate-ccw" size={22} color={theme.colors.text.primary} />
                <Text variant="caption" weight="semibold" color={theme.colors.text.primary} style={{ position: 'absolute', fontSize: 9, top: 16 }}>10</Text>
              </Pressable>
              <Pressable
                onPress={() => { triggerHaptic('light'); toggle(); }}
                hitSlop={10}
                style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center', shadowColor: theme.colors.accent.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 8 }}
              >
                <Feather name={isPlaying ? 'pause' : 'play'} size={28} color="#FFFFFF" style={isPlaying ? undefined : { marginLeft: 3 }} />
              </Pressable>
              <Pressable onPress={skipForward} hitSlop={10} style={styles.skipBtn}>
                <Feather name="rotate-cw" size={22} color={theme.colors.text.primary} />
                <Text variant="caption" weight="semibold" color={theme.colors.text.primary} style={{ position: 'absolute', fontSize: 9, top: 16 }}>10</Text>
              </Pressable>
            </View>

            {/* Recent tracks list */}
            {queueRecent.length > 0 ? (
              <View style={{ paddingHorizontal: 24, paddingTop: 4 }}>
                <Text variant="caption" weight="semibold" color={theme.colors.text.tertiary} style={{ fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>Недавно играли</Text>
                {queueRecent.map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() => { triggerHaptic('light'); play(t); }}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}
                  >
                    <CachedImage uri={t.artwork} style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.1)' }} resizeMode="cover" />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 13 }}>{t.title}</Text>
                      <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{t.artist}</Text>
                    </View>
                    <Feather name="play" size={14} color={theme.colors.text.tertiary} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: PLAYER_TOP,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 16,
  },
  skipBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
