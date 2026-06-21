import React from 'react';
import { View, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { Track } from '../../services/musicService';
import { useMusicStore } from '../../store/musicStore';
import { triggerHaptic } from '../../utils/haptics';
import { useT } from '../../i18n/store';

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Progress bar + time readout for the ACTIVE track only. Split into its own
// component so that the ~2/sec `positionMs` store ticks re-render ONLY this
// one mounted node (the active card), instead of every TrackResultCard in the
// transcript — the latter was a re-render storm that froze frames on the music
// screen (perf monitor: 23 long tasks, worstFps 0 @ chat/music).
const TrackProgress = React.memo(function TrackProgress({ accent, trackColor, tertiaryColor }: { accent: string; trackColor: string; tertiaryColor: string }) {
  const positionMs = useMusicStore((s) => s.positionMs);
  const durationMs = useMusicStore((s) => s.durationMs);
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: trackColor, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: accent, borderRadius: 2 }} />
      </View>
      <Text variant="caption" color={tertiaryColor} style={{ fontSize: 10 }}>{fmtTime(positionMs)} / {fmtTime(durationMs)}</Text>
    </View>
  );
});

// Memoized search-result track card.
//
// Tap behaviour: ONLY the play/pause circle reacts to taps now — the rest of
// the card is a passive surface so the user can read the title/artist without
// accidentally toggling playback. `play(track)` already routes to toggle()
// when the same track is tapped again, so this single handler covers both
// "start a new track" and "pause/resume the current one".
//
// IMPORTANT (perf): this card subscribes ONLY to the active track id + the
// play/pause flag — both change rarely (track switch / pause). The fast-ticking
// `positionMs` lives in <TrackProgress>, mounted only for the active card, so a
// transcript of N cards no longer re-renders N times per second.
function TrackResultCardBase({ track }: { track: Track }) {
  const theme = useTheme();
  const t = useT();
  const activeId = useMusicStore((s) => s.current?.id ?? null);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const play = useMusicStore((s) => s.play);
  const active = activeId === track.id;
  const handleToggle = () => { triggerHaptic('light'); play(track); };
  return (
    <View style={{ backgroundColor: active ? theme.colors.accent.primary + '15' : (theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'), borderRadius: 16, padding: 8, borderWidth: active ? 1 : 0, borderColor: theme.colors.accent.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <CachedImage uri={track.artwork} style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.1)' }} resizeMode="cover" priority="low" proxyWidth={64} />
        <View style={{ flex: 1, marginLeft: 10, marginRight: 8 }}>
          <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 13 }}>{track.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ flexShrink: 1, fontSize: 11 }}>{track.artist}</Text>
            {track.isPreview ? (
              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 9 }}>{t('music_player.preview_seconds')}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <Pressable onPress={handleToggle} hitSlop={6} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={active && isPlaying ? 'pause' : 'play'} size={16} color="#FFFFFF" style={active && isPlaying ? undefined : { marginLeft: 2 }} />
        </Pressable>
      </View>
      {active ? (
        <TrackProgress accent={theme.colors.accent.primary} trackColor={theme.colors.border.light} tertiaryColor={theme.colors.text.tertiary} />
      ) : null}
    </View>
  );
}

export const TrackResultCard = React.memo(TrackResultCardBase, (p, n) => p.track.id === n.track.id);
