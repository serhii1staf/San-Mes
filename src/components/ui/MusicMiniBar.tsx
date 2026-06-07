import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { useMusicStore } from '../../store/musicStore';

// App-wide floating music widget (Telegram/Spotify-style). Shows current track
// artwork, title/artist, a progress bar and play/pause. Renders only while a
// track is loaded. Lightweight: subscribes to the music store primitives, no
// timers of its own (progress comes from the store's playback-status updates).
export function MusicMiniBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const current = useMusicStore((s) => s.current);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const positionMs = useMusicStore((s) => s.positionMs);
  const durationMs = useMusicStore((s) => s.durationMs);
  const toggle = useMusicStore((s) => s.toggle);
  const stop = useMusicStore((s) => s.stop);

  if (!current) return null;

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  return (
    <View style={[styles.wrap, { top: insets.top + 6 }]} pointerEvents="box-none">
      <View style={[styles.card, { backgroundColor: theme.isDark ? 'rgba(28,28,30,0.96)' : 'rgba(255,255,255,0.97)', borderColor: theme.colors.border.light }]}>
        <CachedImage uri={current.artwork} style={styles.art} resizeMode="cover" />
        <View style={{ flex: 1, marginLeft: 10, marginRight: 8 }}>
          <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 12 }}>{current.title}</Text>
          <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{current.artist}</Text>
          {/* Progress */}
          <View style={{ height: 3, borderRadius: 2, backgroundColor: theme.colors.border.light, marginTop: 5, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: theme.colors.accent.primary, borderRadius: 2 }} />
          </View>
        </View>
        <Pressable onPress={toggle} hitSlop={8} style={[styles.btn, { backgroundColor: theme.colors.accent.primary }]}>
          <Feather name={isPlaying ? 'pause' : 'play'} size={16} color="#FFFFFF" style={isPlaying ? undefined : { marginLeft: 2 }} />
        </Pressable>
        <Pressable onPress={stop} hitSlop={8} style={{ paddingLeft: 8, paddingRight: 2 }}>
          <Feather name="x" size={16} color={theme.colors.text.tertiary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 300 },
  card: {
    flexDirection: 'row', alignItems: 'center', width: '92%',
    borderRadius: 16, paddingHorizontal: 8, paddingVertical: 8, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 8,
  },
  art: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.1)' },
  btn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
