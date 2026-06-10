import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Pressable, TextInput, FlatList, ActivityIndicator, Text as RNText, Platform, LayoutAnimation, UIManager, Alert } from 'react-native';
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
import { searchTracks, Track } from '../../src/services/musicService';
import { useMusicStore } from '../../src/store/musicStore';
import { kvGetJSONSync, kvSetJSON } from '../../src/services/kvStore';
import { triggerHaptic } from '../../src/utils/haptics';

interface MusicMessage { id: string; query: string; track?: Track | null; tracks?: Track[]; ts: number }

const HISTORY_KEY = 'music_chat_history';

// Available slash-style commands users can quickly run from the input bar.
type CommandId = 'last' | 'clear' | 'playlist';
interface CommandDef { id: CommandId; icon: string; label: string; description: string }
const COMMANDS: CommandDef[] = [
  { id: 'last', icon: 'rotate-cw', label: 'Последняя музыка', description: 'Снова найти то, что искали в прошлый раз' },
  { id: 'clear', icon: 'eraser', label: 'Очистить текст', description: 'Стереть переписку, найденная музыка останется в виджете' },
  { id: 'playlist', icon: 'list', label: 'Создать плейлист', description: 'Скоро: соберём плейлист из найденных треков' },
];

// Enable LayoutAnimation on Android (no-op on iOS).
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
  // Synchronous re-entrancy guard — see below.
  const inFlightRef = useRef(false);
  const [authorTrack, setAuthorTrack] = useState<Track | null>(null);
  const [commandsOpen, setCommandsOpen] = useState(false);
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

  // Run a search for `q` — extracted so commands ("last") can re-trigger it.
  const runSearch = useCallback(async (q: string) => {
    if (!q || isSearching || inFlightRef.current) return;
    inFlightRef.current = true;
    triggerHaptic('light');
    setInput('');
    const msgId = Date.now().toString();
    setMessages((prev) => [...prev, { id: msgId, query: q, ts: Date.now() }]);
    setIsSearching(true);
    try {
      const results = await searchTracks(q);
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, tracks: results } : m)));
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
  // The "Команды" button on the input bar opens this drawer; the drawer is
  // anchored ABOVE the keyboard so it sits between header and input.
  const runCommand = useCallback((id: CommandId) => {
    setCommandsOpen(false);
    triggerHaptic('light');
    if (id === 'last') {
      // Replay the most recent user query (ignores in-flight rows that have no
      // results yet — those will retry on their own).
      const last = [...messages].reverse().find((m) => m.tracks !== undefined && m.tracks.length > 0);
      if (last) void runSearch(last.query);
      else Alert.alert('Нет последнего поиска', 'Сначала найдите что-нибудь.');
    } else if (id === 'clear') {
      // Clear the chat transcript but keep the now-playing track active so the
      // user can keep listening; the floating widget continues to show it.
      Alert.alert('Очистить переписку?', 'Найденная музыка продолжит играть.', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Очистить', style: 'destructive', onPress: () => setMessages([]) },
      ]);
    } else if (id === 'playlist') {
      Alert.alert('Скоро', 'Сборка плейлиста появится в следующем обновлении.');
    }
  }, [messages, runSearch]);

  const invertedData = React.useMemo(() => [...messages].reverse(), [messages]);

  // Pick the freshest track to show in the "About author" modal — most-recent
  // search result, or the currently playing one if it's older.
  const latestTrack = useMemo<Track | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const t = messages[i].tracks?.[0] || messages[i].track;
      if (t) return t;
    }
    return null;
  }, [messages]);

  const renderItem = useCallback(({ item, index }: { item: MusicMessage; index: number }) => {
    const tracks: Track[] = item.tracks && item.tracks.length
      ? item.tracks
      : (item.track ? [item.track] : []);
    const hasResults = tracks.length > 0;
    const done = item.tracks !== undefined || item.track !== undefined;
    // `index` is the inverted-list index — index 0 is the newest message.
    // Show the "Об авторе" button only on the newest results bubble so the
    // chat doesn't get cluttered with one button per old search.
    const isNewestResults = index === 0 && hasResults;
    return (
      <View style={{ marginBottom: 12 }}>
        <View style={{ alignSelf: 'flex-end', maxWidth: '80%', backgroundColor: theme.colors.accent.primary, borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 8 }}>
          <Text variant="body" color="#FFFFFF" style={{ fontSize: 14 }}>{item.query}</Text>
        </View>
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

  // While typing, the "Команды" pill collapses to an icon-only button so the
  // input has room to grow. Empty input → full label is shown.
  const showCommandLabel = input.length === 0;

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

      {/* Input bar with commands drawer */}
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Reanimated.View style={[{ paddingHorizontal: 16, paddingTop: 8, backgroundColor: theme.colors.background.primary }, inputPadStyle]}>
          {/* Commands drawer — slides in above the input row when toggled. */}
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
            {/* Commands button — sits OUTSIDE the text input, on the left,
                mirroring the photo/attachment button in the regular chat. */}
            <Pressable
              onPress={() => { triggerHaptic('light'); LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setCommandsOpen((v) => !v); }}
              hitSlop={6}
              style={{
                height: 44,
                paddingHorizontal: showCommandLabel ? 14 : 0,
                width: showCommandLabel ? undefined : 44,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                borderRadius: 22,
                borderWidth: 1,
                borderColor: theme.colors.border.light,
                backgroundColor: commandsOpen ? theme.colors.accent.primary : theme.colors.background.elevated,
              }}
            >
              <Feather name="command" size={16} color={commandsOpen ? '#FFFFFF' : theme.colors.accent.primary} />
              {/* Label is rendered while it has room (empty input). When the
                  user starts typing the parent View animates the button width
                  via LayoutAnimation, so the label fades/collapses smoothly
                  instead of disappearing instantly. */}
              {showCommandLabel ? (
                <Text variant="caption" weight="semibold" color={commandsOpen ? '#FFFFFF' : theme.colors.accent.primary} style={{ fontSize: 12 }} numberOfLines={1}>Команды</Text>
              ) : null}
            </Pressable>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: theme.isDark ? 'rgba(40,40,40,0.95)' : 'rgba(245,245,245,0.95)', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.border.light, minHeight: 44 }}>
              <TextInput
                value={input}
                onChangeText={(t) => {
                  // When transitioning between empty/non-empty, animate the
                  // commands button's width so its label collapses smoothly.
                  if ((t.length === 0) !== (input.length === 0)) {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  }
                  setInput(t);
                }}
                placeholder="Название песни или исполнителя..."
                placeholderTextColor={theme.colors.text.tertiary}
                multiline
                textAlignVertical="center"
                style={{ flex: 1, fontSize: 14, color: theme.colors.text.primary, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20, alignSelf: 'center' }}
                onSubmitEditing={handleSend}
                returnKeyType="search"
                onContentSizeChange={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); }}
              />
              <Pressable onPress={handleSend} disabled={!input.trim() || isSearching} style={{ alignSelf: 'flex-end', width: 32, height: 32, borderRadius: 16, backgroundColor: input.trim() ? theme.colors.accent.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginLeft: 8, marginBottom: 2 }}>
                <Feather name="search" size={14} color={input.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
              </Pressable>
            </View>
          </View>
        </Reanimated.View>
      </KeyboardStickyView>

      {/* Author info — native iOS pageSheet so the OS handles slide-up + drag-to-close. */}
      <AuthorInfoModal visible={!!authorTrack} track={authorTrack} onClose={() => setAuthorTrack(null)} />
    </View>
  );
}
