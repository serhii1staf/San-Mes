import React, { useEffect, useRef, useState } from 'react';
import { View, Modal, Pressable, ScrollView, Linking, Animated, Dimensions, PanResponder, ActivityIndicator } from 'react-native';
import { ModalStatusBar } from './ModalStatusBar';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { Track } from '../../services/musicService';
import { triggerHaptic } from '../../utils/haptics';
import { kvGetJSONSync, kvSetJSON } from '../../services/kvStore';
import { useT } from '../../i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

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

// Per-track in-memory cache so re-opening the same author doesn't re-fetch.
// Mirrored to MMKV with a generous 24h TTL — author profiles barely change.
const memCache = new Map<string, AuthorInfo>();
const KV_PREFIX = 'author_info:';
const KV_TTL_MS = 24 * 60 * 60 * 1000;

function readCached(trackId: string): AuthorInfo | null {
  const mem = memCache.get(trackId);
  if (mem) return mem;
  try {
    const persisted = kvGetJSONSync<{ ts: number; data: AuthorInfo } | null>(KV_PREFIX + trackId, null);
    if (persisted && Date.now() - persisted.ts < KV_TTL_MS) {
      memCache.set(trackId, persisted.data);
      return persisted.data;
    }
  } catch {}
  return null;
}

function writeCached(trackId: string, data: AuthorInfo): void {
  memCache.set(trackId, data);
  try { kvSetJSON(KV_PREFIX + trackId, { ts: Date.now(), data }); } catch {}
}

// Author info sheet — same chrome as the feed PostMenuModal so the music chat
// uses the platform's familiar bottom-sheet shape (rounded 28, side margin 8,
// shadow, drag-to-close, dismiss-on-backdrop).
//
// Cached: when the user reopens for the same track we render instantly from
// cache; the background refetch only happens if the cache is empty.
export function AuthorInfoModal({ visible, track, onClose }: AuthorInfoModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Seed from cache so the sheet content is visible IMMEDIATELY on second open.
  const [info, setInfo] = useState<AuthorInfo | null>(() => track ? readCached(track.id) : null);
  const [loading, setLoading] = useState(false);

  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const isClosing = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 10,
      onPanResponderMove: (_, g) => { if (g.dy > 0) dragY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) dismiss();
        else Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 120, friction: 10 }).start();
      },
    })
  ).current;

  // Open animation + cached/network fetch.
  useEffect(() => {
    if (!visible) return;
    isClosing.current = false;
    dragY.setValue(0);
    slideAnim.setValue(SCREEN_HEIGHT);
    backdropAnim.setValue(0);
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
      Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    if (!track) return;
    const cached = readCached(track.id);
    if (cached) {
      setInfo(cached);
      setLoading(false);
      return;
    }
    // Cold cache — show what we have synchronously (artist name) and load.
    setInfo({ name: track.artist || 'Unknown' });
    setLoading(true);
    let cancelled = false;
    fetchAuthorInfo(track).then((data) => {
      if (cancelled) return;
      writeCached(track.id, data);
      setInfo(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [visible, track?.id]);

  const dismiss = () => {
    if (isClosing.current) return;
    isClosing.current = true;
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => setTimeout(onClose, 30));
  };

  if (!track) return null;

  const formatCount = (n: number | undefined): string | null => {
    if (n == null) return null;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const translateY = Animated.add(slideAnim, dragY);
  const sheetBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <ModalStatusBar />
      <View style={{ flex: 1 }}>
        {/* Backdrop */}
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdropAnim }}>
          <Pressable style={{ flex: 1 }} onPress={dismiss} />
        </Animated.View>

        {/* Sheet — anchored to bottom, height grows with content (capped). */}
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY }] }} {...panResponder.panHandlers}>
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: sheetBg, borderRadius: 28, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}>
              {/* Handle */}
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
              </View>

              {/* Title row */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 4 }}>
                <Text variant="body" weight="semibold" style={{ fontSize: 15 }}>{t('author_info.title')}</Text>
                <Pressable onPress={dismiss} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="x" size={14} color={theme.colors.text.primary} />
                </Pressable>
              </View>

              {/* Body — capped so the sheet stops growing on huge bios. */}
              <ScrollView
                style={{ maxHeight: SCREEN_HEIGHT * 0.55 }}
                contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8) + 16 }}
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                {/* Identity */}
                <View style={{ alignItems: 'center', paddingTop: 4, paddingBottom: 14 }}>
                  {info?.avatar ? (
                    <CachedImage uri={info.avatar} style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: theme.colors.background.secondary }} resizeMode="cover" skeleton />
                  ) : (
                    <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: theme.colors.background.secondary, alignItems: 'center', justifyContent: 'center' }}>
                      <Feather name="user" size={30} color={theme.colors.text.tertiary} />
                    </View>
                  )}
                  <Text variant="body" weight="bold" style={{ marginTop: 10, fontSize: 17 }} numberOfLines={1}>{info?.name || track.artist || 'Unknown'}</Text>
                  {info?.handle ? (
                    <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 2 }}>@{info.handle}</Text>
                  ) : null}
                </View>

                {(info?.followers != null || info?.trackCount != null) && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, marginBottom: 12, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: 14 }}>
                    {info?.trackCount != null && (
                      <View style={{ alignItems: 'center' }}>
                        <Text variant="body" weight="bold">{formatCount(info.trackCount)}</Text>
                        <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{t('author_info.tracks_label')}</Text>
                      </View>
                    )}
                    {info?.followers != null && (
                      <View style={{ alignItems: 'center' }}>
                        <Text variant="body" weight="bold">{formatCount(info.followers)}</Text>
                        <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{t('author_info.followers_label')}</Text>
                      </View>
                    )}
                  </View>
                )}

                {info?.bio ? (
                  <View style={{ marginBottom: 12, padding: 12, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: 14 }}>
                    <Text variant="caption" weight="semibold" color={theme.colors.text.tertiary} style={{ marginBottom: 4, textTransform: 'uppercase', fontSize: 10 }}>{t('author_info.bio_label')}</Text>
                    <Text variant="body" style={{ fontSize: 13, lineHeight: 19 }}>{info.bio}</Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4, marginBottom: 10 }}>
                  <Feather name="music" size={11} color={theme.colors.text.tertiary} />
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10 }}>
                    {t('author_info.source_label', undefined, { host: track.sourceHost.includes('soundcloud') ? 'SoundCloud' : track.sourceHost.includes('itunes') ? 'iTunes' : track.sourceHost.includes('audius') ? 'Audius' : track.sourceHost.includes('jamendo') ? 'Jamendo' : track.sourceHost })}
                  </Text>
                </View>

                {info?.url ? (
                  <Pressable
                    onPress={() => { triggerHaptic('light'); Linking.openURL(info.url!).catch(() => {}); }}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: theme.colors.accent.primary }}
                  >
                    <Feather name="external-link" size={14} color="#FFFFFF" />
                    <Text variant="body" weight="semibold" color="#FFFFFF" style={{ fontSize: 14 }}>{t('author_info.open_profile')}</Text>
                  </Pressable>
                ) : null}

                {loading && !info ? (
                  <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={theme.colors.accent.primary} />
                  </View>
                ) : null}
              </ScrollView>
            </View>
          </Animated.View>
        </View>
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
      return { ...fallback, url: `https://soundcloud.com/search/people?q=${encodeURIComponent(track.artist)}` };
    } else if (track.id.startsWith('itunes-')) {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(track.artist)}&entity=musicArtist&limit=1`, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const json = await res.json();
        const a = Array.isArray(json?.results) ? json.results[0] : null;
        if (a) return { name: a.artistName || fallback.name, url: a.artistLinkUrl };
      }
    }
  } catch {}
  return fallback;
}
