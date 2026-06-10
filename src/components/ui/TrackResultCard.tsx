import React from 'react';
import { View, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { Track } from '../../services/musicService';
import { useMusicStore } from '../../store/musicStore';
import { triggerHaptic } from '../../utils/haptics';

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Memoized search-result track card. Extracted from app/chat/music.tsx so the
// component identity is stable across re-renders of the chat list. Memo by
// `track.id` matches the prior local `MemoTrackCard` exactly — the live
// playback state (active/progress/play/pause) comes from the store hooks
// inside, so cards still update without depending on prop equality.
function TrackResultCardBase({ track }: { track: Track }) {
  const theme = useTheme();
  const current = useMusicStore((s) => s.current);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const positionMs = useMusicStore((s) => s.positionMs);
  const durationMs = useMusicStore((s) => s.durationMs);
  const play = useMusicStore((s) => s.play);
  const active = current?.id === track.id;
  const progress = active && durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  return (
    <Pressable onPress={() => { triggerHaptic('light'); play(track); }} style={{ backgroundColor: active ? theme.colors.accent.primary + '15' : (theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'), borderRadius: 16, padding: 8, borderWidth: active ? 1 : 0, borderColor: theme.colors.accent.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <CachedImage uri={track.artwork} style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.1)' }} resizeMode="cover" />
        <View style={{ flex: 1, marginLeft: 10, marginRight: 8 }}>
          <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 13 }}>{track.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ flexShrink: 1, fontSize: 11 }}>{track.artist}</Text>
            {/* Quiet "30 с" pill marks iTunes preview clips so the user knows playback is shortened. */}
            {track.isPreview ? (
              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 9 }}>30 с</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={active && isPlaying ? 'pause' : 'play'} size={16} color="#FFFFFF" style={active && isPlaying ? undefined : { marginLeft: 2 }} />
        </View>
      </View>
      {active ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: theme.colors.border.light, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: theme.colors.accent.primary, borderRadius: 2 }} />
          </View>
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10 }}>{fmtTime(positionMs)} / {fmtTime(durationMs)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export const TrackResultCard = React.memo(TrackResultCardBase, (p, n) => p.track.id === n.track.id);
