import React, { useEffect, useRef, useState } from 'react';
import { View, Modal, Pressable, ScrollView, Linking, StyleSheet, ActivityIndicator, Animated, Dimensions, PanResponder } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { Track } from '../../services/musicService';
import { triggerHaptic } from '../../utils/haptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
// Sheet occupies a comfortable ~62% of the screen and is inset from every edge
// so it never touches them — Telegram-style floating card.
const SHEET_HEIGHT = Math.min(560, SCREEN_HEIGHT * 0.62);
// How far the user has to drag down before we treat it as a dismiss intent.
const DISMISS_THRESHOLD = SHEET_HEIGHT * 0.25;

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

// Floating bottom sheet with author details. Custom rather than the iOS
// pageSheet so:
//   - it's inset from every screen edge (margins instead of edge-to-edge),
//   - drag-to-close uses our own PanResponder (smooth, no first-tap-misses
//     and no half-open artefacts the system pageSheet sometimes produces),
//   - the same UI works identically on iOS and Android.
export function AuthorInfoModal({ visible, track, onClose }: AuthorInfoModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<AuthorInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Animated state. `translateY` drives both the open/close transitions and
  // the live drag. `backdrop` cross-fades the dim background.
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT + 60)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  // True for the duration of the dismiss animation so any further pan events
  // are ignored — prevents the "sometimes doesn't close on first swipe" feel.
  const closing = useRef(false);

  // Open animation when `visible` flips on.
  useEffect(() => {
    if (visible) {
      closing.current = false;
      translateY.setValue(SHEET_HEIGHT + 60);
      backdrop.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 60, friction: 11 }),
        Animated.timing(backdrop, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  // Fetch author meta only when we actually need it.
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

  const animateClose = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(translateY, { toValue: SHEET_HEIGHT + 60, duration: 220, useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      onClose();
    });
  };

  // Pan handler — claim only clearly-vertical downward gestures so the inner
  // ScrollView still owns its own scroll, and so a tap on a button never
  // accidentally arms a dismiss.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_, g) => {
        if (closing.current) return;
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (closing.current) return;
        // Either pulled past the threshold OR flicked downward → dismiss.
        if (g.dy > DISMISS_THRESHOLD || g.vy > 0.6) {
          animateClose();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 90, friction: 11 }).start();
        }
      },
      onPanResponderTerminate: () => {
        if (!closing.current) {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 90, friction: 11 }).start();
        }
      },
    }),
  ).current;

  if (!track) return null;

  const formatCount = (n: number | undefined): string | null => {
    if (n == null) return null;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  // Side margins keep the sheet off the edges. Bottom margin sits above the
  // home indicator. SHEET_HEIGHT is fixed so the sheet always stops at the
  // same place no matter how tall the device.
  const sheetBottomMargin = Math.max(insets.bottom, 12) + 8;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={animateClose} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        {/* Backdrop — tap to dismiss, fades in/out */}
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdrop }]}>
          <Pressable style={{ flex: 1 }} onPress={animateClose} />
        </Animated.View>

        {/* Floating sheet — inset from edges, animated translate */}
        <Animated.View
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: sheetBottomMargin,
            height: SHEET_HEIGHT,
            backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF',
            borderRadius: 24,
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.22,
            shadowRadius: 24,
            elevation: 14,
            transform: [{ translateY }],
          }}
        >
          {/* Drag handle area — only this region claims pan gestures so the
              ScrollView below scrolls normally. */}
          <View {...panResponder.panHandlers} style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }} />
          </View>

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 }}>
            <Text variant="body" weight="bold" style={{ fontSize: 16 }}>Об авторе</Text>
            <Pressable onPress={animateClose} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="x" size={16} color={theme.colors.text.primary} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
            showsVerticalScrollIndicator={false}
            // Disable bounce so the user's dismiss-pull at the top doesn't
            // get caught by a rubber-band; the sheet's own pan handles it.
            bounces={false}
          >
            <View style={{ alignItems: 'center', paddingTop: 4, paddingBottom: 16 }}>
              {info?.avatar ? (
                <CachedImage uri={info.avatar} style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: theme.colors.background.secondary }} resizeMode="cover" />
              ) : (
                <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: theme.colors.background.secondary, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="user" size={32} color={theme.colors.text.tertiary} />
                </View>
              )}
              <Text variant="body" weight="bold" style={{ marginTop: 10, fontSize: 17 }} numberOfLines={1}>{info?.name || track.artist || 'Unknown'}</Text>
              {info?.handle ? (
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 2 }}>@{info.handle}</Text>
              ) : null}
            </View>

            {(info?.followers != null || info?.trackCount != null) && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, marginBottom: 14, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: 14 }}>
                {info?.trackCount != null && (
                  <View style={{ alignItems: 'center' }}>
                    <Text variant="body" weight="bold">{formatCount(info.trackCount)}</Text>
                    <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>треков</Text>
                  </View>
                )}
                {info?.followers != null && (
                  <View style={{ alignItems: 'center' }}>
                    <Text variant="body" weight="bold">{formatCount(info.followers)}</Text>
                    <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>подписчиков</Text>
                  </View>
                )}
              </View>
            )}

            {info?.bio ? (
              <View style={{ marginBottom: 14, padding: 14, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: 14 }}>
                <Text variant="caption" weight="semibold" color={theme.colors.text.tertiary} style={{ marginBottom: 4, textTransform: 'uppercase', fontSize: 10 }}>Биография</Text>
                <Text variant="body" style={{ fontSize: 13, lineHeight: 19 }}>{info.bio}</Text>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6, marginBottom: 12 }}>
              <Feather name="music" size={11} color={theme.colors.text.tertiary} />
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10 }}>
                Источник: {track.sourceHost.includes('soundcloud') ? 'SoundCloud' : track.sourceHost.includes('itunes') ? 'iTunes' : track.sourceHost.includes('audius') ? 'Audius' : track.sourceHost}
              </Text>
            </View>

            {info?.url ? (
              <Pressable
                onPress={() => { triggerHaptic('light'); Linking.openURL(info.url!).catch(() => {}); }}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: theme.colors.accent.primary }}
              >
                <Feather name="external-link" size={14} color="#FFFFFF" />
                <Text variant="body" weight="semibold" color="#FFFFFF" style={{ fontSize: 14 }}>Открыть профиль</Text>
              </Pressable>
            ) : null}

            {loading ? (
              <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={theme.colors.accent.primary} />
              </View>
            ) : null}

            {!loading && !info ? (
              <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ paddingVertical: 12 }}>
                Информация об авторе недоступна
              </Text>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

async function fetchAuthorInfo(track: Track): Promise<AuthorInfo> {
  const fallback: AuthorInfo = { name: track.artist || 'Unknown' };
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    if (track.sourceHost.includes('audius')) {
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
      return {
        ...fallback,
        url: `https://soundcloud.com/search/people?q=${encodeURIComponent(track.artist)}`,
      };
    } else if (track.id.startsWith('itunes-')) {
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
