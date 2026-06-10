import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Pressable, TextInput, FlatList, ActivityIndicator, Text as RNText } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { searchTracks, Track } from '../../src/services/musicService';
import { useMusicStore } from '../../src/store/musicStore';
import { kvGetJSONSync, kvSetJSON } from '../../src/services/kvStore';
import { triggerHaptic } from '../../src/utils/haptics';

interface MusicMessage { id: string; query: string; track?: Track | null; tracks?: Track[]; ts: number }

const HISTORY_KEY = 'music_chat_history';

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function TrackCard({ track }: { track: Track }) {
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
          <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{track.artist}</Text>
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

const MemoTrackCard = React.memo(TrackCard, (p, n) => p.track.id === n.track.id);

export default function MusicChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<MusicMessage[]>(() => {
    try { return kvGetJSONSync<MusicMessage[]>(HISTORY_KEY, []); } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const listRef = useRef<FlatList>(null);

  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const INPUT_BAR = 60;
  const headerSpacerStyle = useAnimatedStyle(() => ({ height: Math.abs(keyboardHeight.value) + INPUT_BAR + insets.bottom }));
  const inputPadStyle = useAnimatedStyle(() => {
    const open = Math.abs(keyboardHeight.value) > 1;
    return { paddingBottom: open ? 8 : (insets.bottom > 0 ? insets.bottom : 16) };
  });

  useEffect(() => { kvSetJSON(HISTORY_KEY, messages.slice(-50)); }, [messages]);

  useEffect(() => {
    try { require('../../src/store/specialChatsStore').useSpecialChatsStore.getState().markOpened('music'); } catch {}
  }, []);

  const handleSend = useCallback(async () => {
    const q = input.trim();
    if (!q || isSearching) return;
    triggerHaptic('light');
    setInput('');
    const msgId = Date.now().toString();
    // Push an "in-flight" message — `tracks` stays undefined until search completes,
    // so the row shows the searching indicator instead of a premature "not found".
    setMessages((prev) => [...prev, { id: msgId, query: q, ts: Date.now() }]);
    setIsSearching(true);
    const results = await searchTracks(q);
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, tracks: results } : m)));
    setIsSearching(false);
    // Autoplay the single most relevant result.
    if (results[0]) useMusicStore.getState().play(results[0]);
  }, [input, isSearching]);

  const invertedData = React.useMemo(() => [...messages].reverse(), [messages]);

  const renderItem = useCallback(({ item }: { item: MusicMessage }) => {
    // Search is "done" only when we've written tracks/track on the message.
    // Until then we render an in-flight bubble (indicator) instead of "Не найдено".
    const tracks: Track[] = item.tracks && item.tracks.length
      ? item.tracks
      : (item.track ? [item.track] : []);
    const hasResults = tracks.length > 0;
    const done = item.tracks !== undefined || item.track !== undefined;
    return (
      <View style={{ marginBottom: 12 }}>
        {/* User's query bubble */}
        <View style={{ alignSelf: 'flex-end', maxWidth: '80%', backgroundColor: theme.colors.accent.primary, borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 8 }}>
          <Text variant="body" color="#FFFFFF" style={{ fontSize: 14 }}>{item.query}</Text>
        </View>
        {hasResults ? (
          <View style={{ alignSelf: 'flex-start', width: '88%', gap: 8 }}>
            {tracks.map((t) => (
              <MemoTrackCard key={t.id} track={t} />
            ))}
          </View>
        ) : done ? (
          <View style={{ alignSelf: 'flex-start', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 }}>
            <Text variant="caption" color={theme.colors.text.tertiary}>Не найдено</Text>
          </View>
        ) : (
          // In-flight: show an inline indicator on the message itself so each search
          // has its own context, not just the global header indicator.
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }}>
            <ActivityIndicator size="small" color={theme.colors.accent.primary} />
            <Text variant="caption" color={theme.colors.text.tertiary}>Ищу…</Text>
          </View>
        )}
      </View>
    );
  }, [theme]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 }}>
        <LinearGradient colors={[theme.colors.background.primary, theme.colors.background.primary, theme.colors.background.primary + '00']} locations={[0, 0.7, 1]} style={{ paddingTop: insets.top + 8, paddingBottom: 20, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.back()} style={{ borderRadius: 17, overflow: 'hidden' }}>
              <BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="chevron-left" size={18} color="#FFFFFF" />
              </BlurView>
            </Pressable>
            <View style={{ alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text variant="body" weight="bold">Музыка</Text>
                <VerifiedBadge size={13} />
              </View>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10 }}>Поиск и прослушивание</Text>
            </View>
            <View style={{ width: 34 }} />
          </View>
        </LinearGradient>
      </View>

      <FlatList
        ref={listRef}
        data={invertedData}
        keyExtractor={(item) => item.id}
        inverted
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        removeClippedSubviews
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={9}
        ListHeaderComponent={
          <>
            {isSearching ? (
              <View style={{ paddingBottom: 8 }}>
                <View style={{ borderRadius: 14, overflow: 'hidden', alignSelf: 'flex-start' }}>
                  <BlurView intensity={80} tint="dark" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7 }}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={{ fontSize: 11, color: '#FFFFFF', fontWeight: '500' }}>Ищу...</Text>
                  </BlurView>
                </View>
              </View>
            ) : null}
            <Reanimated.View style={headerSpacerStyle} />
          </>
        }
        ListFooterComponent={<View style={{ height: insets.top + 72 }} />}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 60, transform: [{ scaleY: -1 }] }}>
            <RNText style={{ fontSize: 48 }} allowFontScaling={false}>🎵</RNText>
            <Text variant="body" weight="bold" style={{ marginTop: 12 }}>Музыка</Text>
            <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginTop: 8, paddingHorizontal: 40, lineHeight: 18 }}>
              Напиши название песни — найду и включу. Играет даже когда свернёшь чат.
            </Text>
          </View>
        }
      />

      {/* Input */}
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Reanimated.View style={[{ paddingHorizontal: 16, paddingTop: 8, backgroundColor: theme.colors.background.primary }, inputPadStyle]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', backgroundColor: theme.isDark ? 'rgba(40,40,40,0.95)' : 'rgba(245,245,245,0.95)', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.border.light }}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Название песни или исполнителя..."
              placeholderTextColor={theme.colors.text.tertiary}
              multiline
              style={{ flex: 1, fontSize: 14, color: theme.colors.text.primary, maxHeight: 100, paddingVertical: 4 }}
              onSubmitEditing={handleSend}
              returnKeyType="search"
            />
            <Pressable onPress={handleSend} disabled={!input.trim() || isSearching} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: input.trim() ? theme.colors.accent.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}>
              <Feather name="search" size={14} color={input.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
            </Pressable>
          </View>
        </Reanimated.View>
      </KeyboardStickyView>
    </View>
  );
}
