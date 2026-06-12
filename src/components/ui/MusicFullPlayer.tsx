import React, { useRef, useCallback, useState } from 'react';
import { View, Modal, Pressable, StyleSheet, Animated, PanResponder, ScrollView, StatusBar, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { useMusicStore } from '../../store/musicStore';
import { Track } from '../../services/musicService';
import { triggerHaptic } from '../../utils/haptics';
import { useT } from '../../i18n/store';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Full-screen player. Slides up from where the bottom indicator was, occupying
// roughly half the screen and growing into a comfortable sheet. Drag-down on
// the header (or tap "свернуть") closes it without stopping playback.
//
// Performance for weak devices:
//   - All transforms are useNativeDriver: true.
//   - Progress slider uses ONLY local state during scrubbing; the drop-release
//     commits a single seek().
//   - Track-row list is a plain map (recents capped at 12) — no FlatList
//     overhead is needed at this size.

const PLAYER_TOP = 60; // sheet starts this far below the top edge
const SLIDER_HPAD = 24;
const SLIDER_THUMB = 14;
const SLIDER_TRACK_H = 4;
const SLIDER_AREA_H = 32;

// Lightweight outer component — subscribes ONLY to `playerOpen`. The heavy
// content with its 500ms-cadence positionMs subscription is only mounted when
// the player is actually open. Before this split the root tree re-rendered
// every 500ms while music played, even with the player dismissed.
export function MusicFullPlayer() {
  const playerOpen = useMusicStore((s) => s.playerOpen);
  if (!playerOpen) return null;
  return <MusicFullPlayerContent />;
}

function MusicFullPlayerContent() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();

  const playerOpen = useMusicStore((s) => s.playerOpen);
  const closePlayer = useMusicStore((s) => s.closePlayer);
  const current = useMusicStore((s) => s.current);
  const recent = useMusicStore((s) => s.recent);
  const discovered = useMusicStore((s) => s.discovered);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const positionMs = useMusicStore((s) => s.positionMs);
  const durationMs = useMusicStore((s) => s.durationMs);
  const toggle = useMusicStore((s) => s.toggle);
  const seek = useMusicStore((s) => s.seek);
  const play = useMusicStore((s) => s.play);

  // Slide animation. translateY=0 → fully open. translateY=SCREEN_HEIGHT → off-screen.
  // The component is now only mounted when the player is open, so the entry
  // spring runs once on mount.
  const slide = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  React.useEffect(() => {
    closing.current = false;
    slide.setValue(SCREEN_HEIGHT);
    dragY.setValue(0);
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, tension: 65, friction: 12 }).start();
  }, []);

  const animateClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(slide, { toValue: SCREEN_HEIGHT, duration: 240, useNativeDriver: true }).start(() => {
      closePlayer();
    });
  }, [closePlayer, slide]);

  // Drag-down on the header dismisses the player. We grab the gesture
  // aggressively (small dy threshold, generous header tap area) so the user's
  // first downward flick reliably dismisses.
  const sheetPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (closing.current) return;
        if (g.dy > 0) dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (closing.current) return;
        if (g.dy > 80 || g.vy > 0.5) {
          // Continue the swipe out using whatever momentum the user gave it.
          closing.current = true;
          Animated.timing(slide, { toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: true }).start(() => {
            dragY.setValue(0);
            closePlayer();
          });
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 90, friction: 11 }).start();
        }
      },
      onPanResponderTerminate: () => {
        if (!closing.current) Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 90, friction: 11 }).start();
      },
    }),
  ).current;

  // ── Progress slider ────────────────────────────────────────────────────────
  // Render the slider thumb at a position derived from EITHER the live playback
  // position OR a "scrubbing" offset while the user drags the thumb. Scrubbing
  // is buttery (no audio call per move); only the release commits a single
  // seek(). While scrubbing we disable the parent ScrollView so the gesture
  // can't be stolen.
  const sliderWidth = SCREEN_WIDTH - SLIDER_HPAD * 2;
  const [scrubbingMs, setScrubbingMs] = useState<number | null>(null);
  const effectivePos = scrubbingMs != null ? scrubbingMs : positionMs;
  const sliderRatio = durationMs > 0 ? Math.min(1, Math.max(0, effectivePos / durationMs)) : 0;

  const sliderPan = useRef<any>(null);
  if (!sliderPan.current) {
    let startMs = 0;
    sliderPan.current = PanResponder.create({
      // Capture variants win the gesture against any ancestor (ScrollView)
      // before children get a chance — critical for slider responsiveness.
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        startMs = useMusicStore.getState().positionMs;
        // Tap-to-seek: jump immediately to where the finger landed.
        const x = e.nativeEvent.locationX;
        const dur = useMusicStore.getState().durationMs;
        if (dur > 0 && Number.isFinite(x)) {
          const ratio = Math.max(0, Math.min(1, x / sliderWidth));
          startMs = ratio * dur;
        }
        setScrubbingMs(startMs);
      },
      onPanResponderMove: (_, g) => {
        const dur = useMusicStore.getState().durationMs;
        if (dur <= 0) return;
        const deltaMs = (g.dx / sliderWidth) * dur;
        const next = Math.max(0, Math.min(dur, startMs + deltaMs));
        setScrubbingMs(next);
      },
      onPanResponderRelease: (_, g) => {
        const dur = useMusicStore.getState().durationMs;
        if (dur <= 0) { setScrubbingMs(null); return; }
        const deltaMs = (g.dx / sliderWidth) * dur;
        const next = Math.max(0, Math.min(dur, startMs + deltaMs));
        setScrubbingMs(null);
        seek(next);
      },
      onPanResponderTerminate: () => setScrubbingMs(null),
    });
  }

  // Skip back/forward 10s — common-enough convention. Calls seek() which
  // also updates positionMs immediately so the slider visually jumps.
  const skipBack = () => {
    triggerHaptic('light');
    const cur = useMusicStore.getState().positionMs;
    seek(Math.max(0, cur - 10000));
  };
  const skipForward = () => {
    triggerHaptic('light');
    const { positionMs: cur, durationMs: dur } = useMusicStore.getState();
    seek(Math.min((dur || 0) - 200, cur + 10000));
  };

  if (!current) return null;

  // Queue = everything the user has surfaced in the music chat (deduped),
  // falling back to plays-only history if discovery hasn't been seeded yet
  // (e.g. fresh install). Current track filtered out — it's already shown at
  // the top of the player.
  const seen = new Set<string>([current.id]);
  const merged: Track[] = [];
  for (const t of discovered) { if (!seen.has(t.id)) { seen.add(t.id); merged.push(t); } }
  for (const t of recent) { if (!seen.has(t.id)) { seen.add(t.id); merged.push(t); } }
  const queueAll: Track[] = merged;
  const sheetBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';
  const translateY = Animated.add(slide, dragY);

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={animateClose}>
      <StatusBar hidden />
      <View style={StyleSheet.absoluteFill}>
        {/* Backdrop — tap dismisses. */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <Pressable style={{ flex: 1 }} onPress={animateClose} />
        </View>

        <Animated.View style={[styles.sheet, { backgroundColor: sheetBg, transform: [{ translateY }], paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* Drag area covers the whole header (handle + title row). Wider
              tap region = much more reliable swipe-down dismissal. */}
          <View {...sheetPan.panHandlers}>
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 6 }}>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11, textTransform: 'uppercase' }}>{t('music_player.now_playing')}</Text>
              <Pressable onPress={animateClose} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="chevron-down" size={16} color={theme.colors.text.primary} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            // Disable scroll while the user is actively scrubbing the slider so
            // the slider's pan never gets stolen by the scroll gesture.
            scrollEnabled={scrubbingMs == null}
            // Sticky index 1 = the controls block (title + artist + slider +
            // transport). When the user scrolls past the artwork it pins to
            // the top of the scroll viewport, so the queue can scroll beneath
            // it without hiding playback controls.
            stickyHeaderIndices={[1]}
            contentContainerStyle={{ paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* [0] Artwork — scrolls away with the rest of the content. */}
            <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 14 }}>
              <CachedImage uri={current.artwork} style={{ width: 220, height: 220, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.1)' }} resizeMode="cover" />
            </View>

            {/* [1] Sticky controls — opaque background is required so the
                artwork doesn't show through once this block pins to the top.
                Includes the title, slider and transport buttons. */}
            <View style={{ backgroundColor: sheetBg }}>
              <View style={{ alignItems: 'center', paddingBottom: 8 }}>
                <Text variant="body" weight="bold" style={{ fontSize: 18 }} numberOfLines={1}>{current.title}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 13 }}>{current.artist}</Text>
                  {current.isPreview ? (
                    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                      <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10 }}>{t('music_player.preview_seconds')}</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* Slider — track and thumb both vertically centred inside a
                  32px-tall hit area for comfortable touch targets. */}
              <View style={{ paddingHorizontal: SLIDER_HPAD }}>
                <View
                  {...sliderPan.current.panHandlers}
                  style={{ height: SLIDER_AREA_H, justifyContent: 'center' }}
                >
                  {/* Track */}
                  <View style={{ height: SLIDER_TRACK_H, borderRadius: SLIDER_TRACK_H / 2, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                    <View style={{ height: '100%', width: `${sliderRatio * 100}%`, backgroundColor: theme.colors.accent.primary, borderRadius: SLIDER_TRACK_H / 2 }} />
                  </View>
                  {/* Thumb — vertically centred within the SLIDER_AREA_H container. */}
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      left: sliderRatio * sliderWidth - SLIDER_THUMB / 2,
                      top: (SLIDER_AREA_H - SLIDER_THUMB) / 2,
                      width: SLIDER_THUMB,
                      height: SLIDER_THUMB,
                      borderRadius: SLIDER_THUMB / 2,
                      backgroundColor: theme.colors.accent.primary,
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.2,
                      shadowRadius: 2,
                      elevation: 2,
                    }}
                  />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{fmt(effectivePos)}</Text>
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{fmt(durationMs)}</Text>
                </View>
              </View>

              {/* Transport controls */}
              <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 28, paddingTop: 14, paddingBottom: 18 }}>
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
            </View>

            {/* [2] Queue — scrolls beneath the sticky controls. */}
            {queueAll.length > 0 ? (
              <View style={{ paddingHorizontal: 24, paddingTop: 8 }}>
                <Text variant="caption" weight="semibold" color={theme.colors.text.tertiary} style={{ fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>{t('music_player.queue_label')}</Text>
                {queueAll.map((t) => (
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
