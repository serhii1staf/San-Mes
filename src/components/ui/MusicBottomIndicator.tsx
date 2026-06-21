import React, { useEffect, useRef } from 'react';
import { View, Pressable, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { useMusicStore } from '../../store/musicStore';
import { triggerHaptic } from '../../utils/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Slim "now-playing" pill that sits just ABOVE the floating tab bar. It is the
// ONLY mini-player surface in the app — the previous top floating widget was
// removed in favour of a single bottom-anchored UI that visually integrates
// with the custom tab bar (matching horizontal margin and corner radius).
//
// Interactions:
//   - Tap row → opens the full-screen MusicFullPlayer.
//   - Tap play/pause button → toggles playback without opening the player.
//   - Swipe LEFT or RIGHT past the dismiss threshold → fully dismisses and
//     stops playback (the user has explicitly waved the widget away).
//
// Performance:
//   - Solid background (no BlurView) — cheap on weak Androids.
//   - Progress bar is its own subscriber so the 500 ms position updates only
//     re-render the inner View, never the row/artwork/text.
//   - Mounts only when (current && !onMusicScreen && !playerOpen) and unmounts
//     otherwise — zero cost when there's nothing playing.

const PROGRESS_HEIGHT = 2;
const DISMISS_DX = 90;          // pixels of horizontal drag that count as a dismiss
const DISMISS_VX = 0.55;        // |velocity| in dp/ms that counts as a fling

const InlineProgress = React.memo(function InlineProgress({ accent, track }: { accent: string; track: string }) {
  const positionMs = useMusicStore((s) => s.positionMs);
  const durationMs = useMusicStore((s) => s.durationMs);
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  return (
    <View style={{ height: PROGRESS_HEIGHT, backgroundColor: track, overflow: 'hidden' }}>
      <View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: accent }} />
    </View>
  );
});

export function MusicBottomIndicator() {
  const theme = useTheme();
  const pathname = usePathname();
  const current = useMusicStore((s) => s.current);
  const currentId = current?.id ?? null;
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const playerOpen = useMusicStore((s) => s.playerOpen);
  const inMusicChat = useMusicStore((s) => s.inMusicChat);
  const toggle = useMusicStore((s) => s.toggle);
  const openPlayer = useMusicStore((s) => s.openPlayer);
  const stop = useMusicStore((s) => s.stop);

  // Hide while the music chat is on screen. We check BOTH the synchronous
  // pathname AND the inMusicChat flag (set by the chat's mount/unmount
  // useEffect). The pathname check catches the race where the user dismisses
  // the indicator, navigates back to /chat/music, and instantly taps a
  // recommended track — the new track triggers a re-render BEFORE the chat's
  // mount-effect has had a chance to set inMusicChat=true. Pathname is
  // updated synchronously by the router, so it wins that race.
  const onMusicScreenSync = !!pathname && pathname.indexOf('/chat/music') === 0;
  const show = !!current && !onMusicScreenSync && !inMusicChat && !playerOpen;

  // Slide-in/out from below — native-driven so it stays smooth on weak devices.
  // Initial offset is large enough to fully clear the screen bottom: indicator
  // sits at `bottom: 102` and is ~60 tall, so 180 px of downward translation
  // puts the entire card below the device's bottom edge before showing. The
  // result: it spawns from off-screen and rises into place rather than
  // appearing in the middle of the tab-bar area.
  const HIDDEN_Y = 180;
  const slideY = useRef(new Animated.Value(HIDDEN_Y)).current;
  // Horizontal swipe-to-dismiss offset.
  const dragX = useRef(new Animated.Value(0)).current;
  const dismissing = useRef(false);
  // Stable opacity node for the swipe fade. Created ONCE — recreating the
  // interpolation on every parent re-render could momentarily reset the
  // mapping mid-gesture and flash the card.
  const dismissOpacity = useRef(
    dragX.interpolate({
      inputRange: [-SCREEN_WIDTH * 1.25, -DISMISS_DX, 0, DISMISS_DX, SCREEN_WIDTH * 1.25],
      outputRange: [0, 0.55, 1, 0.55, 0],
      extrapolate: 'clamp',
    }),
  ).current;

  // Tracks the previous render's currentId so we can detect a transition
  // from "no track" → "new track" — the case where slideY may have been
  // left at 0 (visible) by a prior render, and we need to snap it back to
  // HIDDEN_Y so the slide-up animation actually has somewhere to start.
  const prevId = useRef<string | null>(null);

  useEffect(() => {
    const wasNull = prevId.current == null;
    prevId.current = currentId;
    // Detection of "fresh appearance after a null period" — the bug case
    // where the user dismissed the indicator (current → null), then played
    // a new track. Without this snap, slideY could be stuck at 0 and the
    // indicator would render at its visible position above the music
    // chat's input bar before the show effect catches up.
    if (wasNull && currentId) {
      slideY.setValue(HIDDEN_Y);
      dragX.setValue(0);
      dismissing.current = false;
    }
  }, [currentId]);

  useEffect(() => {
    if (show) {
      dragX.setValue(0);
      dismissing.current = false;
    }
    Animated.spring(slideY, { toValue: show ? 0 : HIDDEN_Y, useNativeDriver: true, tension: 60, friction: 11 }).start();
  }, [show]);

  // Pan responder only claims the gesture on clear HORIZONTAL movement so
  // taps still go through to the Pressable. Vertical-leaning gestures fall
  // through to whatever's below (currently nothing — the indicator floats).
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        if (dismissing.current) return;
        dragX.setOffset(0);
        dragX.setValue(0);
      },
      onPanResponderMove: (_, g) => {
        if (dismissing.current) return;
        dragX.setValue(g.dx);
      },
      onPanResponderRelease: (_, g) => {
        if (dismissing.current) return;
        const dismiss = Math.abs(g.dx) > DISMISS_DX || Math.abs(g.vx) > DISMISS_VX;
        if (dismiss) {
          dismissing.current = true;
          // Slide further than the screen edge so even on devices where the
          // shadow extends ~16 px past the card, no edge artefact remains
          // visible by the time the dismiss animation finishes.
          const target = g.dx < 0 ? -SCREEN_WIDTH * 1.25 : SCREEN_WIDTH * 1.25;
          // Continue the swipe out using whatever velocity the user gave it.
          Animated.timing(dragX, { toValue: target, duration: 200, useNativeDriver: true }).start(() => {
            triggerHaptic('light');
            stop();
            // DON'T reset dragX here: setting it back to 0 while the component
            // is still mounted for one more frame flashed the card back to the
            // center before unmount (the "исчезает→появляется→исчезает"
            // artefact). The reset happens cleanly on the NEXT appearance via
            // the `wasNull && currentId` effect above.
            dismissing.current = false;
          });
        } else {
          Animated.spring(dragX, { toValue: 0, useNativeDriver: true, tension: 110, friction: 10 }).start();
        }
      },
      onPanResponderTerminate: () => {
        if (!dismissing.current) Animated.spring(dragX, { toValue: 0, useNativeDriver: true, tension: 110, friction: 10 }).start();
      },
    }),
  ).current;

  if (!current) return null;

  return (
    <Animated.View
      pointerEvents={show ? 'box-none' : 'none'}
      style={[
        styles.wrap,
        {
          // Tab bar geometry: marginBottom 24 + container height ~62
          // ≈ 86 px from the screen bottom. The indicator sits just 6 px
          // above its top edge so the two read as a tight stacked pair
          // (was 16 — that left too big a gap above the tab bar).
          bottom: 24 + 62 + 6,
          transform: [{ translateY: slideY }],
        },
      ]}
    >
      {/* Inner wrapper carries the swipe-X transform so it rides INSIDE the
          slide-Y wrapper, keeping the two animations independent. */}
      <Animated.View
        {...pan.panHandlers}
        // pointerEvents tied to the global show flag so the dismissed-and-
        // animating-out card can never re-claim a touch mid-flight.
        pointerEvents={show && !playerOpen ? 'auto' : 'none'}
        style={{
          transform: [{ translateX: dragX }],
          // Fade out as the user pulls — gives clear visual feedback that the
          // gesture is going to commit. Endpoints at ±SCREEN_WIDTH * 1.25
          // match the dismiss target so opacity hits 0 just as the card
          // finishes its slide-off, leaving zero ghost frames.
          opacity: dismissOpacity,
        }}
      >
        {/* Card body — borderRadius/marginHorizontal mirror the CustomTabBar
            (32 / 16) so the indicator visually "rolls into" the tab bar with
            a shared rounded silhouette. */}
        <View style={[styles.card, {
          backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF',
          borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        }]}>
          <Pressable
            onPress={() => { triggerHaptic('light'); openPlayer(); }}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 }}
          >
            <CachedImage uri={current.artwork} style={styles.art} resizeMode="cover" />
            <View style={{ flex: 1, marginLeft: 10, marginRight: 8 }}>
              <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 12 }}>{current.title}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 10 }}>{current.artist}</Text>
            </View>
            <Pressable
              onPress={(e) => { e.stopPropagation(); triggerHaptic('light'); toggle(); }}
              hitSlop={6}
              style={[styles.btn, { backgroundColor: theme.colors.accent.primary }]}
            >
              <Feather name={isPlaying ? 'pause' : 'play'} size={14} color="#FFFFFF" style={isPlaying ? undefined : { marginLeft: 2 }} />
            </Pressable>
          </Pressable>
          <InlineProgress
            accent={theme.colors.accent.primary}
            track={theme.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)'}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    // bottom is set inline so it can pick up safe-area insets if needed.
    // Match tab bar's marginHorizontal exactly so the two widgets share a
    // continuous left/right edge.
    left: 16,
    right: 16,
    zIndex: 250,
  },
  card: {
    // 32 = same borderRadius as CustomTabBar; together the two read as one
    // unit with shared corner geometry.
    borderRadius: 32,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 8,
  },
  art: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.1)' },
  btn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
