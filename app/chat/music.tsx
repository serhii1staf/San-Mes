import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Pressable, TextInput, FlatList, ActivityIndicator, Text as RNText, Platform, LayoutAnimation, UIManager, Alert, Animated, InteractionManager, StyleSheet } from 'react-native';
import type { ScrollViewProps } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { ChatKeyboardScrollView } from '../../src/components/ui/ChatKeyboardScrollView';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useLiquidGlassActive, NativeGlassView, GlassBg } from '../../src/components/ui/LiquidGlass';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { TrackResultCard } from '../../src/components/ui/TrackResultCard';
import { AuthorInfoModal } from '../../src/components/ui/AuthorInfoModal';
import { PlaylistSheet } from '../../src/components/ui/PlaylistSheet';
import { searchTracks, classifyMusicInput, Track } from '../../src/services/musicService';
import { useMusicStore } from '../../src/store/musicStore';
import { kvGetJSONSync, kvSetJSON } from '../../src/services/kvStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useChatKeyboardMode } from '../../src/hooks/useChatKeyboardMode';

interface MusicMessage { id: string; query: string; track?: Track | null; tracks?: Track[]; ts: number }

const HISTORY_KEY = 'music_chat_history';

type CommandId = 'last' | 'clear' | 'playlist';
interface CommandDef { id: CommandId; icon: string; label: string; description: string }

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Truly-constant list content padding — hoisted to module scope so the
// FlatList doesn't receive a fresh style object on every keystroke re-render.
const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 16, paddingTop: 8 },
});

export default function MusicChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Android: while focused, stop the OS window resize so ONLY our JS-driven
  // input lift moves content (kills the first-focus jump). No-op on iOS.
  useChatKeyboardMode();
  // Mount-time marker — perf-monitor panel attributes any open-the-music
  // chat freeze either to navigation overhead or to this commit duration.
  // Skipped at the call site when the monitor is off.
  const mountStart = useRef(Date.now()).current;
  const perfEnabled = useSettingsStore((s) => s.perfMonitorEnabled);
  useEffect(() => {
    if (!perfEnabled) return;
    perfMonitor.markScreenMount('chat/music', Date.now() - mountStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfEnabled]);
  const COMMANDS: CommandDef[] = useMemo(() => [
    { id: 'last', icon: 'rotate-cw', label: t('music_chat.command.last_label'), description: t('music_chat.command.last_desc') },
    { id: 'clear', icon: 'eraser', label: t('music_chat.command.clear_label'), description: t('music_chat.command.clear_desc') },
    { id: 'playlist', icon: 'list', label: t('music_chat.command.playlist_label'), description: t('music_chat.command.playlist_desc') },
  ], [t]);
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

  // Defer the iOS BlurView in the back button past the navigation transition.
  // UIVisualEffectView is one of the more expensive native views to construct
  // on first mount; on weak devices that mount lands on the same RAF as the
  // navigation animation and shaves the slide-in framerate from 60 → ~40.
  // Show a flat fallback for the first frame and swap to the BlurView one
  // interaction tick later.
  const [chromeReady, setChromeReady] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setChromeReady(true));
    return () => handle.cancel();
  }, []);
  // Native iOS-26 liquid glass for the floating back button. White icon over
  // the gradient header, so colorScheme 'dark' matches the profile chrome.
  const glassActive = useLiquidGlassActive();

  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const INPUT_BAR = 60;
  // Inverted-list keyboard lift — now handled NATIVELY by the official
  // KeyboardChatScrollView (via `renderScrollComponent` below). The library
  // repositions chat content on keyboard open/close with the default "always"
  // (Telegram/WhatsApp) lift, replacing the old per-frame translateY list
  // wrapper that relayout-jumped on the first focus / on dismiss. The bottom
  // spacer stays STATIC — it only reserves room for the floating input bar
  // while the keyboard is closed.
  const LIST_BOTTOM_SPACER = INPUT_BAR + insets.bottom;
  // Stable renderScrollComponent — FlatList requires a stable reference so it
  // doesn't tear down / rebuild the scroll view on every render. `inverted` is
  // forwarded so the wrapper's internal lift math matches the list.
  const renderScrollComponent = useCallback(
    (p: ScrollViewProps) => <ChatKeyboardScrollView {...p} inverted />,
    [],
  );
  const inputPadStyle = useAnimatedStyle(() => {
    const open = Math.abs(keyboardHeight.value) > 1;
    return { paddingBottom: open ? 8 : (insets.bottom > 0 ? insets.bottom : 16) };
  });

  // Persist the trimmed message history to MMKV. The JSON.stringify of up to
  // 50 messages (each potentially carrying multiple tracks worth of metadata)
  // can spike to 30–60 ms on weak devices; defer past the current interaction
  // so it never lands on the navigation frame.
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      kvSetJSON(HISTORY_KEY, messages.slice(-50));
    });
    return () => handle.cancel();
  }, [messages]);

  // Seed the global "discovered" queue with everything already in the chat
  // history so the full-screen player has the user's library available even
  // before they make a fresh search this session.
  // Deferred via InteractionManager so the loop over potentially 50 messages
  // (each with up to 10 tracks) doesn't pile up on the navigation transition
  // frame.
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      const all: Track[] = [];
      for (const m of messages) {
        const list = m.tracks || (m.track ? [m.track] : []);
        for (const t of list) all.push(t);
      }
      if (all.length > 0) useMusicStore.getState().addDiscovered(all);
    });
    return () => handle.cancel();
    // Run once on mount; later searches add their results inline via runSearch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Defer the special-chats `markOpened` write past the navigation
    // transition — it touches MMKV, which would otherwise pile up onto the
    // navigation frame.
    const handle = InteractionManager.runAfterInteractions(() => {
      try { require('../../src/store/specialChatsStore').useSpecialChatsStore.getState().markOpened('music'); } catch {}
    });
    return () => handle.cancel();
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
      // INTENTIONAL JS-DRIVEN LAYOUT TWEEN — do not flag.
      // Animates `width` (a layout prop) which can't go through the native
      // driver. A transform (scaleX) / opacity can't substitute without
      // changing the look: the pill REFLOWS from a 110px label-pill to a 40px
      // icon circle, and scaleX would squish the icon/label rather than
      // reflow. One-shot, fires only on the empty↔non-empty input transition
      // (≈once per typing session) so the JS-thread cost is negligible.
      useNativeDriver: false,
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
      else Alert.alert(t('music_chat.alert.no_last_title'), t('music_chat.alert.no_last_msg'));
    } else if (id === 'clear') {
      // "Очистить текст" — wipe every USER QUERY bubble but keep the track
      // cards (so the music history stays visible) AND keep playback going
      // (the music store is untouched, the floating widget keeps playing).
      // Empty `query` is the signal to renderItem that the user bubble should
      // not be drawn. Messages with no tracks (failed/in-flight searches)
      // become empty and are filtered out.
      Alert.alert(t('music_chat.alert.clear_title'), t('music_chat.alert.clear_msg'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('music_chat.alert.clear_confirm'), style: 'destructive', onPress: () => {
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
        Alert.alert(t('music_chat.alert.empty_playlist_title'), t('music_chat.alert.empty_playlist_msg'));
      } else {
        setPlaylistOpen(true);
      }
    }
  }, [messages, runSearch, allUniqueTracks.length, t]);

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
                <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ fontSize: 12 }}>{t('music_chat.about_author')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : done ? (
          <View style={{ alignSelf: 'flex-start', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 }}>
            <Text variant="caption" color={theme.colors.text.tertiary}>{t('music_chat.not_found')}</Text>
          </View>
        ) : (
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }}>
            <ActivityIndicator size="small" color={theme.colors.accent.primary} />
            <Text variant="caption" color={theme.colors.text.tertiary}>{t('music_chat.searching')}</Text>
          </View>
        )}
      </View>
    );
  }, [theme, t]);

  // Stable keyExtractor — FlatList re-keys/re-renders less when the reference
  // is stable across the per-keystroke re-renders of this screen.
  const keyExtractor = useCallback((item: MusicMessage) => item.id, []);

  // Memoized list chrome elements. These are static per their inputs, so
  // memoizing keeps FlatList from re-mounting the header/footer/empty subtrees
  // on every input change. Behaviour and layout are identical.
  const listHeader = useMemo(() => <View style={{ height: LIST_BOTTOM_SPACER }} />, [LIST_BOTTOM_SPACER]);
  const listFooter = useMemo(() => <View style={{ height: insets.top + 72 }} />, [insets.top]);
  const listEmpty = useMemo(() => (
    <View style={{ alignItems: 'center', paddingVertical: 60, transform: [{ scaleY: -1 }] }}>
      <RNText style={{ fontSize: 48 }} allowFontScaling={false}>🎵</RNText>
      <Text variant="body" weight="bold" style={{ marginTop: 12 }}>{t('music_chat.title')}</Text>
      <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginTop: 8, paddingHorizontal: 40, lineHeight: 18 }}>
        {t('music_chat.empty_hint')}
      </Text>
    </View>
  ), [theme, t]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 }}>
        <LinearGradient colors={[theme.colors.background.primary, theme.colors.background.primary, theme.colors.background.primary + '00']} locations={[0, 0.7, 1]} style={{ paddingTop: insets.top + 8, paddingBottom: 20, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.back()} style={glassActive ? { borderRadius: 17 } : { borderRadius: 17, overflow: 'hidden' }}>
              {glassActive ? (
                <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="chevron-left" size={18} color="#FFFFFF" />
                </NativeGlassView>
              ) : chromeReady ? (
                <BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="chevron-left" size={18} color="#FFFFFF" />
                </BlurView>
              ) : (
                <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
                  <Feather name="chevron-left" size={18} color="#FFFFFF" />
                </View>
              )}
            </Pressable>
            <View style={{ alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text variant="body" weight="bold">{t('music_chat.title')}</Text>
                <VerifiedBadge size={13} />
              </View>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10 }}>{t('music_chat.subtitle')}</Text>
            </View>
            <View style={{ width: 34 }} />
          </View>
        </LinearGradient>
      </View>

      <FlatList
        ref={listRef}
        data={invertedData}
        keyExtractor={keyExtractor}
        inverted
        renderScrollComponent={renderScrollComponent}
        contentContainerStyle={styles.listContent}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        removeClippedSubviews
        // Tightened from 12/8/9 — 12 TrackResultCards on first paint were
        // hammering the JS thread on the same RAF as the navigation transition,
        // which the perf monitor flagged as `SLOW long task @ (tabs)/messages
        // 292ms` when opening this screen. 6/4/5 leaves the visible-window
        // mounted on first frame and lets later batches stream in.
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={5}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        ListEmptyComponent={listEmpty}
      />

      {/* Static under-input fade — pinned to the screen bottom and kept
          OUTSIDE the KeyboardStickyView so it does NOT ride up with the
          keyboard. Mirrors the user-chat under-input gradient: the solid
          input container is gone, so track cards scroll UNDER the input and
          dissolve into the background instead of hitting a hard bar edge. */}
      <LinearGradient
        colors={[theme.colors.background.primary + '00', theme.colors.background.primary + 'B3', theme.colors.background.primary]}
        locations={[0, 0.45, 1]}
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: INPUT_BAR + insets.bottom + 56 }}
      />

      {/* Input bar — no solid backgroundColor: the fade above supplies the
          darkening so the input floats over content like the user chat. */}
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Reanimated.View style={[{ paddingHorizontal: 16, paddingTop: 8 }, inputPadStyle]}>
          {/* Commands drawer — anchored ABOVE the input row, slides in via
              LayoutAnimation when toggled. */}
          {commandsOpen ? (
            <View style={{ marginBottom: 8, borderRadius: 18, overflow: 'hidden', ...(glassActive ? null : { backgroundColor: theme.colors.background.elevated, borderWidth: 1, borderColor: theme.colors.border.light }) }}>
              {glassActive ? <GlassBg borderRadius={18} colorScheme={theme.isDark ? 'dark' : 'light'} /> : null}
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
                  // Active (commandsOpen) keeps the solid accent fill. When
                  // idle AND liquid glass is on, drop the flat fill/border and
                  // the clip so the interactive glass child can morph outward;
                  // otherwise the original flat capsule renders unchanged.
                  ...(commandsOpen
                    ? { backgroundColor: theme.colors.accent.primary, borderWidth: 1, borderColor: theme.colors.border.light }
                    : glassActive
                      ? null
                      : { backgroundColor: theme.isDark ? 'rgba(40,40,40,0.95)' : 'rgba(245,245,245,0.95)', borderWidth: 1, borderColor: theme.colors.border.light }),
                }}
              >
                {!commandsOpen && glassActive ? (
                  // Idle state → interactive liquid glass holding the icon +
                  // label as CHILDREN so the glass morphs outward on touch.
                  <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={{ width: '100%', height: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 20 }}>
                    <Feather name="command" size={16} color={theme.colors.accent.primary} />
                    <Animated.Text
                      numberOfLines={1}
                      allowFontScaling={false}
                      style={{
                        width: commandLabelW,
                        marginLeft: commandLabelML,
                        opacity: commandLabelOpacity,
                        fontSize: 12,
                        fontWeight: '600',
                        color: theme.colors.accent.primary,
                      }}
                    >{t('music_chat.commands_label')}</Animated.Text>
                  </NativeGlassView>
                ) : (
                  <>
                    {/* Both children participate in the flex row, so flex centring
                        naturally handles every animation frame — icon-only when
                        label width is 0, icon+gap+label when expanded. */}
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
                    >{t('music_chat.commands_label')}</Animated.Text>
                  </>
                )}
              </Pressable>
            </Animated.View>

            {glassActive ? (
              // Input wrap → interactive liquid glass holding the TextInput +
              // send button as CHILDREN, matching ChatInputBar. NO visible
              // border (the glass supplies the edge) and NO overflow clip so
              // the glass can morph outward on touch.
              <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, minHeight: 40 }}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder={t('music_chat.input_placeholder')}
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
              </NativeGlassView>
            ) : (
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, minHeight: 40, backgroundColor: theme.isDark ? 'rgba(40,40,40,0.95)' : 'rgba(245,245,245,0.95)', borderWidth: 1, borderColor: theme.colors.border.light }}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder={t('music_chat.input_placeholder')}
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
            )}
          </View>
        </Reanimated.View>
      </KeyboardStickyView>

      <AuthorInfoModal visible={!!authorTrack} track={authorTrack} onClose={() => setAuthorTrack(null)} />
      <PlaylistSheet visible={playlistOpen} tracks={allUniqueTracks} onClose={() => setPlaylistOpen(false)} />
    </View>
  );
}
