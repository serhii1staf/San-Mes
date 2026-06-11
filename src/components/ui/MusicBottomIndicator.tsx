import React, { useEffect, useRef } from 'react';
import { View, Pressable, StyleSheet, Animated, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { useMusicStore } from '../../store/musicStore';
import { triggerHaptic } from '../../utils/haptics';

// Slim "now-playing" pill that sits ABOVE the floating tab bar after the user
// collapses the top mini-widget. Tap to expand into the full-screen player.
//
// Performance:
//   - Solid background (no BlurView) — cheap on weak Androids.
//   - Progress bar is its own subscriber so the 500 ms position updates only
//     re-render the inner View, never the row/artwork/text.
//   - Mounts only when (current && collapsed && !onMusicScreen && !playerOpen)
//     and unmounts otherwise — zero cost when there's nothing playing.

const PROGRESS_HEIGHT = 2;

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
  const widgetMode = useMusicStore((s) => s.widgetMode);
  const playerOpen = useMusicStore((s) => s.playerOpen);
  const toggle = useMusicStore((s) => s.toggle);
  const openPlayer = useMusicStore((s) => s.openPlayer);
  const setWidgetMode = useMusicStore((s) => s.setWidgetMode);

  const onMusicScreen = pathname === '/chat/music';
  const show = !!current && widgetMode === 'collapsed' && !playerOpen && !onMusicScreen;

  // Slide-in/out from below — same native-driven Animated value used by the
  // top mini-bar so the two widgets feel like one continuous element.
  const slide = useRef(new Animated.Value(80)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: show ? 0 : 80, useNativeDriver: true, tension: 60, friction: 11 }).start();
  }, [show]);

  if (!current) return null;

  return (
    <Animated.View
      pointerEvents={show ? 'box-none' : 'none'}
      style={[styles.wrap, { transform: [{ translateY: slide }] }]}
    >
      {/* Card body — solid bg, no blur, GPU-light on weak devices. */}
      <View style={[styles.card, {
        backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF',
        borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      }]}>
        <Pressable
          onPress={() => { triggerHaptic('light'); openPlayer(); }}
          style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8 }}
        >
          <CachedImage uri={current.artwork} style={styles.art} resizeMode="cover" />
          <View style={{ flex: 1, marginLeft: 10, marginRight: 8 }}>
            <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 12 }}>{current.title}</Text>
            <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 10 }}>{current.artist}</Text>
          </View>
          {/* Restore the floating top widget */}
          <Pressable
            onPress={() => { triggerHaptic('light'); setWidgetMode('full'); }}
            hitSlop={8}
            style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }}
          >
            <Feather name="chevron-up" size={16} color={theme.colors.text.tertiary} />
          </Pressable>
          <Pressable
            onPress={(e) => { e.stopPropagation(); triggerHaptic('light'); toggle(); }}
            hitSlop={6}
            style={[styles.btn, { backgroundColor: theme.colors.accent.primary, marginLeft: 4 }]}
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
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    // Anchor right above the floating tab bar (which sits ~24px from bottom
    // and is ~64px tall). 6px gap so the indicator floats just above it.
    bottom: 24 + 64 + 4,
    left: 16,
    right: 16,
    zIndex: 250,
  },
  card: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 6,
  },
  art: { width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.1)' },
  btn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
