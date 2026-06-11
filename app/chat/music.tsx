import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Pressable, TextInput, FlatList, ActivityIndicator, Text as RNText, Platform, LayoutAnimation, UIManager, Alert, Animated } from 'react-native';
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
import { TrackResultCard } from '../../src/components/ui/TrackResultCard';
import { AuthorInfoModal } from '../../src/components/ui/AuthorInfoModal';
import { PlaylistSheet } from '../../src/components/ui/PlaylistSheet';
import { searchTracks, classifyMusicInput, Track } from '../../src/services/musicService';
import { useMusicStore } from '../../src/store/musicStore';
import { kvGetJSONSync, kvSetJSON } from '../../src/services/kvStore';
import { triggerHaptic } from '../../src/utils/haptics';

interface MusicMessage { id: string; query: string; track?: Track | null; tracks?: Track[]; ts: number }

const HISTORY_KEY = 'music_chat_history';

type CommandId = 'last' | 'clear' | 'playlist';
interface CommandDef { id: CommandId; icon: string; label: string; description: string }
const COMMANDS: CommandDef[] = [
  { id: 'last', icon: 'rotate-cw', label: 'Последняя музыка', description: 'Снова найти то, что искали в прошлый раз' },
  { id: 'clear', icon: 'eraser', label: 'Очистить текст', description: 'Скрыть свои сообщения, найденная музыка останется' },
  { id: 'playlist', icon: 'list', label: 'Создать плейлист', description: 'Собрать все найденные треки в один список' },
];

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function MusicChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<MusicMessage[]>(() => {
    try { return kvGetJSONSync<MusicMessage[]>(HISTORY_KEY, []); } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const inFlightRef = useRef(false);
  const [authorTrack, setAuthorTrack] = useState<Track | null>(null);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const listRef = useRef<FlatList>(null);

  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const INPUT_BAR = 60;
  const headerSpacerStyle = useAnimatedStyle(() => ({ height: Math.abs(keyboardHeight.value) + INPUT_BAR + insets.bottom }));
  const inputPadStyle = useAnimatedStyle(() => {
    const open = Math.abs(keyboardHeight.value) > 1;
    return { paddingBottom: open ? 8 : (insets.bottom > 0 ? insets.bottom : 16) };
  });

  useEffect(() => { kvSetJSON(HISTORY_KEY, messages.slice(-50)); }, [messages]);

  // Seed the global "discovered" queue with everything already in the chat
  // history so the full-screen player has the user's library available even
  // before they make a fresh search this session.
  useEffect(() => {
    const all: Track[] = [];
    for (const m of messages) {
      const list = m.tracks || (m.track ? [m.track] : []);
      for (const t of list) all.push(t);
    }
    if (all.length > 0) useMusicStore.getState().addDiscovered(all);
    // Run once on mount; later searches add their results inline via runSearch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try { require('../../src/store/specialChatsStore').useSpecialChatsStore.getState().markOpened('music'); } catch {}
  }, []);

  // Tell the global music indicator to hide while we're on this screen — the
  // chat already has its own player UI inline, so the floating widget would
  // duplicate controls. Plain mount/unmount is more reliable than focus
  // events: useFocusEffect from expo-router can have a tick-of-delay on
  // mount, which lets the widget flash for ~one frame.
  useEffect(() => {
    useMusicStore.getState().setInMusicChat(true);
    return () => { useMusicStore.getState().setInMusicChat(false); };
  }, []);

  // ── Commands button — animated label/width ──────────────────────────────────
  // Collapsed = 40×40 circle (matches the input bubble's height exactly).
  // Expanded  = 110×40 pill with the "Команды" label.
  // Two animated values are derived from a single source so the label opacity
  // finishes BEFORE the width fully shrinks — that prevents the icon from
  // briefly drifting toward the right edge as the pill collapses.
  const commandExpand = useRef(new Animated.Value(1)).current; // 1 = expanded, 0 = collapsed
  useEffect(() => {
    Animated.timing(commandExpand, {
      toValue: input.length === 0 ? 1 : 0,
      duration: 220,
      useNativeDriver: false, // width can't go through the native driver
    }).start();
  }, [input.length === 0]);
  // Single source of truth → 4 derived values, all in lock-step:
  //   width      40 ↔ 110   (whole pill)
  //   labelW      0 ↔  64   (animated text width — collapses to 0 so flex
  //                          centering treats the icon as the only content)
  //   labelML     0 ↔   5   (gap between icon and text)
  //   labelOpac   0 ↔   1   (text fades out a touch before width hits zero)
  const commandWidth = commandExpand.interpolate({ inputRange: [0, 1], outputRange: [40, 110] });
  const commandLabelW = commandExpand.interpolate({ inputRange: [0, 1], outputRange: [0, 64] });
  const commandLabelML = commandExpand.interpolate({ inputRange: [0, 1], outputRange: [0, 5] });
  const commandLabelOpacity = commandExpand.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] });

  // ── Search ──────────────────────────────────────────────────────────────────
  const runSearch = useCallback(async (q: string) => {
    if (!q || isSearching || inFlightRef.current) return;

    // If the user pasted a direct audio URL, play it immediately. Any other
    // URL (YouTube, Discord, etc.) silently falls through to the regular text
    // search — which returns nothing, so the user sees the standard "Не
    // найдено" bubble. No alert, no friction.
    const intent = classifyMusicInput(q);
    if (intent.kind === 'audio') {
      triggerHaptic('light');
      setInput('');
      const msgId = Date.now().toString();
      setMessages((prev) => [...prev, { id: msgId, query: q, ts: Date.now(), tracks: [intent.track] }]);
      useMusicStore.getState().addDiscovered([intent.track]);
      useMusicStore.getState().play(intent.track);
      return;
    }

    inFlightRef.current = true;
    triggerHaptic('light');
    setInput('');
    const msgId = Date.now().toString();
    setMessages((prev) => [...prev, { id: msgId, query: q, ts: Date.now() }]);
    setIsSearching(true);
    try {
      const results = await searchTracks(q);
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, tracks: results } : m)));
      // Mirror the search results into the music store so the global player
      // can show the user's full library, not just tracks they've actually
      // played. Order is preserved (first-seen first).
      if (results.length > 0) useMusicStore.getState().addDiscovered(results);
      if (results[0]) useMusicStore.getState().play(results[0]);
    } finally {
      setIsSearching(false);
      inFlightRef.current = false;
    }
  }, [isSearching]);

  const handleSend = useCallback(() => {
    void runSearch(input.trim());
  }, [input, runSearch]);

  // ── Commands ────────────────────────────────────────────────────────────────
  // Unique tracks across the whole transcript — used both by "Создать плейлист"
  // and as an availability check (don't bother showing an empty playlist).
  const allUniqueTracks = useMemo<Track[]>(() => {
    const seen = new Set<string>();
    const out: Track[] = [];
    for (const m of messages) {
      const list = m.tracks || (m.track ? [m.track] : []);
      for (const t of list) {
        if (!seen.has(t.id)) { seen.add(t.id); out.push(t); }
      }
    }
    return out;
  }, [messages]);

  const runCommand = useCallback((id: CommandId) => {
    setCommandsOpen(false);
    triggerHaptic('light');
    if (id === 'last') {
      const last = [...messages].reverse().find((m) => m.tracks !== undefined && m.tracks.length > 0);
      if (last) void runSearch(last.query);
      else Alert.alert('Нет последнего поиска', 'Сначала найдите что-нибудь.');
    } else if (id === 'clear') {
      // "Очистить текст" — wipe every USER QUERY bubble but keep the track
      // cards (so the music history stays visible) AND keep playback going
      // (the music store is untouched, the floating widget keeps playing).
      // Empty `query` is the signal to renderItem that the user bubble should
      // not be drawn. Messages with no tracks (failed/in-flight searches)
      // become empty and are filtered out.
      Alert.alert('Очистить текст?', 'Найденная музыка и воспроизведение останутся.', [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Очистить', style: 'destructive', onPress: () => {
            setMessages((prev) =>
              prev
                .filter((m) => (m.tracks && m.tracks.length > 0) || !!m.track)
                .map((m) => ({ ...m, query: '' })),
            );
          },
        },
      ]);
    } else if (id === 'playlist') {
      if (allUniqueTracks.length === 0) {
        Alert.alert('Плейлист пуст', 'Сначала найдите хотя бы один трек.');
      } else {
        setPlaylistOpen(true);
      }
    }
  }, [messages, runSearch, allUniqueTracks.length]);

  const invertedData = useMemo(() => [...messages].reverse(), [messages]);

  const renderItem = useCallback(({ item, index }: { item: MusicMessage; index: number }) => {
    const tracks: Track[] = item.tracks && item.tracks.length
      ? item.tracks
      : (item.track ? [item.track] : []);
    const hasResults = tracks.length > 0;
    const done = item.tracks !== undefined || item.track !== undefined;
    const isNewestResults = index === 0 && hasResults;
    return (
      <View style={{ marginBottom: 12 }}>
        {/* User query bubble — rendered only when query is non-empty so the
            "Очистить текст" command can hide all queries at once. */}
        {item.query ? (
          <View style={{ alignSelf: 'flex-end', maxWidth: '80%', backgroundColor: theme.colors.accent.primary, borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 8 }}>
            <Text variant="body" color="#FFFFFF" style={{ fontSize: 14 }}>{item.query}</Text>
          </View>
        ) : null}
        {hasResults ? (
          <View style={{ alignSelf: 'flex-start', width: '88%', gap: 8 }}>
            {tracks.map((t) => (
              <TrackResultCard key={t.id} track={t} />
            ))}
            {isNewestResults ? (
              <Pressable
                onPress={() => { triggerHaptic('light'); setAuthorTrack(tracks[0]); }}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 12, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}
              >
                <Feather name="info" size={13} color={theme.colors.text.secondary} />
                <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ fontSize: 12 }}>Об авторе</Text>
              </Pressable>
            ) : null}
          </View>
        ) : done ? (
          <View style={{ alignSelf: 'flex-start', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 }}>
            <Text variant="caption" color={theme.colors.text.tertiary}>Не найдено</Text>
          </View>
        ) : (
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
        ListHeaderComponent={<Reanimated.View style={headerSpacerStyle} />}
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

      {/* Input bar */}
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Reanimated.View style={[{ paddingHorizontal: 16, paddingTop: 8, backgroundColor: theme.colors.background.primary }, inputPadStyle]}>
          {/* Commands drawer — anchored ABOVE the input row, slides in via
              LayoutAnimation when toggled. */}
          {commandsOpen ? (
            <View style={{ marginBottom: 8, backgroundColor: theme.colors.background.elevated, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border.light, overflow: 'hidden' }}>
              {COMMANDS.map((c, i) => (
                <Pressable
                  key={c.id}
                  onPress={() => runCommand(c.id)}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 0.5, borderTopColor: theme.colors.border.light }}
                >
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.accent.primary + '15', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                    <Feather name={c.icon as any} size={15} color={theme.colors.accent.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="caption" weight="semibold" style={{ fontSize: 13 }}>{c.label}</Text>
                    <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11, marginTop: 1 }}>{c.description}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            {/* Commands button — same VISUAL height as the input bubble (40px),
                width animates between full label (124) and icon-only (44) via
                a single Animated.Value. Label fades out faster than the width
                shrinks so the text never looks "squished".
                NOTE on perf: width can't go through the native driver, but
                this is one View that animates only on empty↔non-empty
                transitions (~once per typing session), not per keystroke.
                Opacity could go through native, but pinning both to the same
                JS-driven value keeps them perfectly in sync. */}
            <Animated.View style={{ width: commandWidth, height: 40, alignSelf: 'flex-end', overflow: 'hidden' }}>
              <Pressable
                onPress={() => { triggerHaptic('light'); setCommandsOpen((v) => !v); }}
                hitSlop={6}
                style={{
                  width: '100%',
                  height: '100%',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  // 20 = 50% of 40, so collapsed (40×40) is a perfect circle.
                  // Expanded (110×40) keeps the same 20px radius for a smooth
                  // capsule.
                  borderRadius: 20,
                  backgroundColor: commandsOpen ? theme.colors.accent.primary : (theme.isDark ? 'rgba(40,40,40,0.95)' : 'rgba(245,245,245,0.95)'),
                  borderWidth: 1,
                  borderColor: theme.colors.border.light,
                }}
              >
                {/* Both children participate in the flex row, so flex centring
                    naturally handles every animation frame — icon-only when
                    label width is 0, icon+gap+label when expanded. No more
                    absolute-positioning math, no drift on either end. */}
                <Feather name="command" size={16} color={commandsOpen ? '#FFFFFF' : theme.colors.accent.primary} />
                <Animated.Text
                  numberOfLines={1}
                  allowFontScaling={false}
                  style={{
                    width: commandLabelW,
                    marginLeft: commandLabelML,
                    opacity: commandLabelOpacity,
                    fontSize: 12,
                    fontWeight: '600',
                    color: commandsOpen ? '#FFFFFF' : theme.colors.accent.primary,
                  }}
                >Команды</Animated.Text>
              </Pressable>
            </Animated.View>

            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: theme.isDark ? 'rgba(40,40,40,0.95)' : 'rgba(245,245,245,0.95)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, borderWidth: 1, borderColor: theme.colors.border.light, minHeight: 40 }}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Название песни..."
                placeholderTextColor={theme.colors.text.tertiary}
                multiline
                textAlignVertical="center"
                style={{ flex: 1, fontSize: 14, color: theme.colors.text.primary, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20, alignSelf: 'center' }}
                onSubmitEditing={handleSend}
                returnKeyType="search"
                onContentSizeChange={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); }}
              />
              <Pressable onPress={handleSend} disabled={!input.trim() || isSearching} style={{ alignSelf: 'flex-end', width: 28, height: 28, borderRadius: 14, backgroundColor: input.trim() ? theme.colors.accent.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginLeft: 8, marginBottom: 1 }}>
                <Feather name="search" size={13} color={input.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
              </Pressable>
            </View>
          </View>
        </Reanimated.View>
      </KeyboardStickyView>

      <AuthorInfoModal visible={!!authorTrack} track={authorTrack} onClose={() => setAuthorTrack(null)} />
      <PlaylistSheet visible={playlistOpen} tracks={allUniqueTracks} onClose={() => setPlaylistOpen(false)} />
    </View>
  );
}
