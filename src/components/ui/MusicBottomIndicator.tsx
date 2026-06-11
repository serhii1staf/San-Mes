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
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const playerOpen = useMusicStore((s) => s.playerOpen);
  const toggle = useMusicStore((s) => s.toggle);
  const openPlayer = useMusicStore((s) => s.openPlayer);
  const stop = useMusicStore((s) => s.stop);

  // The music chat already has its own player UI on-screen, and the full
  // player covers the indicator anyway when open. startsWith handles any
  // future query/hash on the route without breaking the check.
  const onMusicScreen = !!pathname && pathname.indexOf('/chat/music') === 0;
  const show = !!current && !onMusicScreen && !playerOpen;

  // Slide-in/out from below — native-driven so it stays smooth on weak devices.
  const slideY = useRef(new Animated.Value(80)).current;
  // Horizontal swipe-to-dismiss offset.
  const dragX = useRef(new Animated.Value(0)).current;
  const dismissing = useRef(false);

  useEffect(() => {
    Animated.spring(slideY, { toValue: show ? 0 : 80, useNativeDriver: true, tension: 60, friction: 11 }).start();
    if (show) {
      // Reset drag when the indicator becomes visible again (e.g., user
      // started a new track after dismissing). Without this, a previous
      // dismissed state could persist.
      dragX.setValue(0);
      dismissing.current = false;
    }
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
          const target = g.dx < 0 ? -SCREEN_WIDTH : SCREEN_WIDTH;
          // Continue the swipe out using whatever velocity the user gave it,
          // then nuke playback. The store reset (current → null) makes
          // `show` go false on the next render and the View unmounts.
          Animated.timing(dragX, { toValue: target, duration: 180, useNativeDriver: true }).start(() => {
            triggerHaptic('light');
            stop();
            // Defensive: reset for the next time a track plays.
            dragX.setValue(0);
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
      style={[styles.wrap, { transform: [{ translateY: slideY }] }]}
    >
      {/* Inner wrapper carries the swipe-X transform so it rides INSIDE the
          slide-Y wrapper, keeping the two animations independent. */}
      <Animated.View
        {...pan.panHandlers}
        style={{
          transform: [{ translateX: dragX }],
          // Fade out as the user pulls — gives clear visual feedback that the
          // gesture is going to commit.
          opacity: dragX.interpolate({ inputRange: [-SCREEN_WIDTH, -DISMISS_DX, 0, DISMISS_DX, SCREEN_WIDTH], outputRange: [0, 0.5, 1, 0.5, 0] }),
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
    // Tab bar geometry: marginBottom 24 + paddingVertical 12*2 + ~28px tab
    // height ≈ 88px tall, ending ~24px from the screen bottom. The indicator
    // sits 8px above it so they read as a stacked pair.
    bottom: 24 + 64 + 8,
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
