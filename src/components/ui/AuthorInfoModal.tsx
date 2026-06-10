import React, { useEffect, useState } from 'react';
import { View, Modal, Pressable, ScrollView, Linking, Platform, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { Track } from '../../services/musicService';
import { triggerHaptic } from '../../utils/haptics';

interface AuthorInfoModalProps {
  visible: boolean;
  track: Track | null;
  onClose: () => void;
}

interface AuthorInfo {
  name: string;
  handle?: string;
  bio?: string;
  avatar?: string;
  followers?: number;
  trackCount?: number;
  url?: string;
}

// Native pageSheet modal — uses iOS's standard sheet animation (slide up, dim
// the background, drag-down to dismiss). Stays inside the safe area on iOS,
// uses a neutral fade on Android. No edge-to-edge content; the OS adds the
// rounded corners and dim itself.
export function AuthorInfoModal({ visible, track, onClose }: AuthorInfoModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<AuthorInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !track) return;
    let cancelled = false;
    setInfo(null);
    setLoading(true);
    fetchAuthorInfo(track).then((data) => {
      if (!cancelled) {
        setInfo(data);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [visible, track?.id]);

  if (!track) return null;

  const formatCount = (n: number | undefined): string | null => {
    if (n == null) return null;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      // pageSheet on iOS = standard system sheet (rounded corners, drag-down,
      // content insets from edges). On Android falls back to fullScreen with
      // a custom close button — same UX, native feel.
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
      transparent={Platform.OS !== 'ios'}
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
        {/* Drag handle (visual only — pageSheet handles the actual gesture). */}
        {Platform.OS === 'ios' ? null : (
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }} />
          </View>
        )}

        {/* Header with close button. Inset from the edge so it never touches the screen. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 8 : 0, paddingBottom: 12 }}>
          <Text variant="subheading" weight="bold">Об авторе</Text>
          <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="x" size={18} color={theme.colors.text.primary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
          {/* Author header — large avatar + name */}
          <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 20 }}>
            {info?.avatar ? (
              <CachedImage uri={info.avatar} style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: theme.colors.background.secondary }} resizeMode="cover" />
            ) : (
              <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: theme.colors.background.secondary, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="user" size={36} color={theme.colors.text.tertiary} />
              </View>
            )}
            <Text variant="body" weight="bold" style={{ marginTop: 12, fontSize: 18 }} numberOfLines={1}>{info?.name || track.artist || 'Unknown'}</Text>
            {info?.handle ? (
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 2 }}>@{info.handle}</Text>
            ) : null}
          </View>

          {/* Stats row */}
          {(info?.followers != null || info?.trackCount != null) && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 14, marginBottom: 20, backgroundColor: theme.colors.background.elevated, borderRadius: 16 }}>
              {info?.trackCount != null && (
                <View style={{ alignItems: 'center' }}>
                  <Text variant="body" weight="bold">{formatCount(info.trackCount)}</Text>
                  <Text variant="caption" color={theme.colors.text.tertiary}>треков</Text>
                </View>
              )}
              {info?.followers != null && (
                <View style={{ alignItems: 'center' }}>
                  <Text variant="body" weight="bold">{formatCount(info.followers)}</Text>
                  <Text variant="caption" color={theme.colors.text.tertiary}>подписчиков</Text>
                </View>
              )}
            </View>
          )}

          {/* Bio */}
          {info?.bio ? (
            <View style={{ marginBottom: 20, padding: 16, backgroundColor: theme.colors.background.elevated, borderRadius: 16 }}>
              <Text variant="caption" weight="semibold" color={theme.colors.text.tertiary} style={{ marginBottom: 6, textTransform: 'uppercase', fontSize: 11 }}>Биография</Text>
              <Text variant="body" style={{ fontSize: 14, lineHeight: 20 }}>{info.bio}</Text>
            </View>
          ) : null}

          {/* Source pill — tells the user where the track came from */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, marginBottom: 16 }}>
            <Feather name="music" size={12} color={theme.colors.text.tertiary} />
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>
              Источник: {track.sourceHost.includes('soundcloud') ? 'SoundCloud' : track.sourceHost.includes('itunes') ? 'iTunes' : track.sourceHost.includes('audius') ? 'Audius' : track.sourceHost}
            </Text>
          </View>

          {/* Open external link — only if we have a URL */}
          {info?.url ? (
            <Pressable
              onPress={() => { triggerHaptic('light'); Linking.openURL(info.url!).catch(() => {}); }}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: theme.colors.accent.primary }}
            >
              <Feather name="external-link" size={16} color="#FFFFFF" />
              <Text variant="body" weight="semibold" color="#FFFFFF">Открыть профиль</Text>
            </Pressable>
          ) : null}

          {loading ? (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={theme.colors.accent.primary} />
            </View>
          ) : null}

          {!loading && !info ? (
            <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ paddingVertical: 12 }}>
              Информация об авторе недоступна
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

// Resolve author info for a Track — uses the track's `sourceHost` to pick the
// right API. Always returns SOMETHING so the modal isn't empty (at minimum the
// artist name from the track).
async function fetchAuthorInfo(track: Track): Promise<AuthorInfo> {
  const fallback: AuthorInfo = { name: track.artist || 'Unknown' };
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    if (track.sourceHost.includes('audius')) {
      // Audius track endpoint includes user details.
      const id = track.id;
      const res = await fetch(`https://${track.sourceHost.replace(/^https?:\/\//, '')}/v1/tracks/${id}?app_name=San-Mes`, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const json = await res.json();
        const u = json?.data?.user;
        if (u) {
          return {
            name: u.name || u.handle || fallback.name,
            handle: u.handle,
            bio: u.bio,
            avatar: u.profile_picture?.['480x480'] || u.profile_picture?.['150x150'],
            followers: u.follower_count,
            trackCount: u.track_count,
            url: u.handle ? `https://audius.co/${u.handle}` : undefined,
          };
        }
      }
    } else if (track.id.startsWith('sc-')) {
      // SoundCloud — we don't expose enough metadata in Track to round-trip
      // for full author detail without re-running search; surface what we have
      // plus a link to soundcloud.com search for the artist.
      return {
        ...fallback,
        url: `https://soundcloud.com/search/people?q=${encodeURIComponent(track.artist)}`,
      };
    } else if (track.id.startsWith('itunes-')) {
      // iTunes Search by artist returns biographical data via lookup.
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(track.artist)}&entity=musicArtist&limit=1`, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const json = await res.json();
        const a = Array.isArray(json?.results) ? json.results[0] : null;
        if (a) {
          return {
            name: a.artistName || fallback.name,
            url: a.artistLinkUrl,
          };
        }
      }
    }
  } catch {}
  return fallback;
}
