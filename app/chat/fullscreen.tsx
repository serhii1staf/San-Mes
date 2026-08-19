// Full-screen message viewer.
//
// Reached from the expand button next to a bubble's timestamp. It presents ONE
// message per page, swipeable left and right through the conversation, with a
// composer pinned at the bottom so a reply can be sent without leaving.
//
// ── WHY A ROUTE AND NOT A MODAL ───────────────────────────────────────────────
// A real route gets the platform's own push/pop transition and back-gesture for
// free, keeps the system status bar behaviour consistent, and — the reason that
// actually matters here — it does NOT keep the chat screen's message list mounted
// underneath doing layout work. A modal overlay would leave the FlashList, its
// gestures and its Reanimated layers live behind the viewer.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────────
// It does not re-fetch anything. The transcript is already in the chat store, so
// the viewer reads it from there and renders images through `CachedImage` at the
// SAME proxy width the bubbles used — so paging is instant and served from memory
// rather than re-decoding at a new size.
//
// ── FIXES APPLIED AFTER THE FIRST PASS (all reported from the device) ─────────
//  • The status bar no longer disappears. `ModalStatusBar` (which is
//    `<StatusBar hidden />` on iOS) was being rendered here — correct for an
//    immersive image viewer, wrong for a pushed screen with a composer, where the
//    clock vanishing reads as a glitch.
//  • The composer sits ON the keyboard. It was inside a `KeyboardAvoidingView`
//    that was not the bottom-most element, so the padding it added landed in the
//    wrong place and left a large gap. It now uses `KeyboardStickyView` from
//    `react-native-keyboard-controller`, the same mechanism the other chat screens
//    use, which tracks the keyboard frame on the UI thread.
//  • Long messages are no longer clipped. Each page is a ScrollView, so a long
//    text scrolls instead of overflowing a centred fixed box.
//  • ALL photos are shown, not the first one with a "+2" badge.
//  • Link previews render, like they do in the transcript.
//  • Own vs incoming messages are visually distinct (side, bubble colour, label).

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Dimensions,
  FlatList,
  ScrollView,
  TextInput,
  type ListRenderItemInfo,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { FormattedText } from '../../src/components/ui/FormattedText';
import { LinkPreview } from '../../src/components/ui/LinkPreview';
import { extractFirstUrl } from '../../src/services/linkPreview';
import { useChatStore, useAuthStore } from '../../src/store';
import { usePinnedMessagesStore, selectPinnedIds } from '../../src/store/pinnedMessagesStore';
import { useT, useI18nStore } from '../../src/i18n/store';
import { useLiquidGlassActive, GlassBg } from '../../src/components/ui/LiquidGlass';
import { triggerHaptic } from '../../src/utils/haptics';
import { formatDaySeparator } from '../../src/utils/chatDaySeparators';
import { readableTextOn, withOpacity } from '../../src/constants/bubbleColors';
import { useSettingsStore } from '../../src/store/settingsStore';
import type { ChatMessage } from '../../src/types';

const { width: SCREEN_W } = Dimensions.get('window');

// Match the chat bubbles' proxy width so a page shows the image the bubble
// already decoded instead of requesting a new size (a different cache key).
const VIEWER_IMG_MAX_W = Math.min(Math.round(SCREEN_W), 1080);

export default function ChatFullscreenScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const locale = useI18nStore((s) => s.locale);
  const glassActive = useLiquidGlassActive();

  const { id: conversationId, messageId } = useLocalSearchParams<{
    id: string;
    messageId?: string;
  }>();

  const currentUserId = useAuthStore((s) => s.user?.id);
  // Read the transcript straight from the store — no request, and it is the same
  // array the chat screen is rendering, so the viewer can never disagree with it.
  const messages = useChatStore((s) => (conversationId ? s.messages[conversationId] : undefined));

  const pages = useMemo(() => messages ?? [], [messages]);

  // Own-bubble styling, read from the same settings the chat screen uses so a page
  // looks like the bubble it was opened from.
  const chatBubble = useSettingsStore((s) => s.chatBubble);
  const ownColors = useMemo<string[]>(
    () => (chatBubble && chatBubble.colors.length > 0 ? chatBubble.colors : [theme.colors.accent.primary]),
    [chatBubble, theme.colors.accent.primary],
  );
  const ownBg = withOpacity(ownColors[0], chatBubble?.opacity ?? 1);
  const ownTextColor = chatBubble && chatBubble.colors.length > 0 ? readableTextOn(chatBubble.colors) : '#FFFFFF';

  // ── Pinning ───────────────────────────────────────────────────────────────
  // Multiple pins per conversation are supported, so the viewer can pin whatever
  // page it is on without displacing an earlier pin.
  const pinnedIds = usePinnedMessagesStore(selectPinnedIds(conversationId));
  const togglePin = usePinnedMessagesStore((s) => s.toggle);

  // Where to open. Falls back to the newest message when the id is missing or no
  // longer present (it may have been deleted while the viewer was being opened).
  const initialIndex = useMemo(() => {
    if (!messageId) return Math.max(0, pages.length - 1);
    const i = pages.findIndex((m) => m.id === messageId);
    return i >= 0 ? i : Math.max(0, pages.length - 1);
  }, [messageId, pages]);

  const [index, setIndex] = useState(initialIndex);

  const listRef = useRef<FlatList<ChatMessage>>(null);

  const getItemLayout = useCallback(
    (_: unknown, i: number) => ({ length: SCREEN_W, offset: SCREEN_W * i, index: i }),
    [],
  );

  const keyExtractor = useCallback((m: ChatMessage) => m.id, []);

  // Page index from the settled offset. `onMomentumScrollEnd` only — deriving it
  // from every scroll frame would dispatch state per frame for a value that is
  // only meaningful once the page settles.
  const onMomentumEnd = useCallback((e: any) => {
    const x = e?.nativeEvent?.contentOffset?.x ?? 0;
    const next = Math.round(x / SCREEN_W);
    setIndex((prev) => (prev === next ? prev : next));
  }, []);

  const close = useCallback(() => {
    triggerHaptic('light');
    router.back();
  }, []);

  const renderPage = useCallback(
    ({ item }: ListRenderItemInfo<ChatMessage>) => (
      <FullscreenPage
        message={item}
        isOwn={item.senderId === currentUserId}
        theme={theme}
        topInset={insets.top}
        ownBg={ownBg}
        ownTextColor={ownTextColor}
        youLabel={t('chat.you', 'Вы')}
        peerLabel={t('chat.peer', 'Собеседник')}
      />
    ),
    [currentUserId, theme, insets.top, ownBg, ownTextColor, t],
  );

  const current = pages[index];
  // Header caption: who sent it and when, formatted with the same locale-aware
  // day logic the transcript's separators use.
  const dayLabel = current?.createdAt
    ? formatDaySeparator(current.createdAt, Date.now(), locale, t)
    : null;
  const senderLabel = current
    ? current.senderId === currentUserId
      ? t('chat.you', 'Вы')
      : t('chat.peer', 'Собеседник')
    : '';

  const currentPinned = !!current && pinnedIds.includes(current.id);

  const onTogglePin = useCallback(() => {
    if (!current || !conversationId) return;
    triggerHaptic('medium');
    togglePin(conversationId, current.id);
  }, [current, conversationId, togglePin]);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background.primary }]}>
      {/* No `ModalStatusBar` here on purpose — this is a pushed screen, not an
          immersive overlay, so the clock and battery must stay visible. */}

      <FlatList
        ref={listRef}
        data={pages}
        keyExtractor={keyExtractor}
        renderItem={renderPage}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={getItemLayout}
        onMomentumScrollEnd={onMomentumEnd}
        // One page either side is enough for a paging carousel, and keeps the
        // mounted image count to three.
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        windowSize={3}
        removeClippedSubviews
      />

      {/* Floating close button + caption + pin. Sits above the pages, inset by the
          safe area so it clears the notch / Dynamic Island on every device. */}
      <View
        style={[styles.header, { top: insets.top + 8, paddingHorizontal: 12 }]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={close}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.close', 'Закрыть')}
          style={styles.headerBtn}
        >
          {glassActive ? (
            <GlassBg borderRadius={18} glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} />
          ) : null}
          <Feather name="x" size={18} color={theme.colors.text.primary} />
        </Pressable>

        <View style={styles.caption} pointerEvents="none">
          <Text variant="caption" weight="semibold" numberOfLines={1}>
            {senderLabel}
          </Text>
          <View style={styles.captionSub}>
            {dayLabel ? (
              <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={styles.captionSubText}>
                {dayLabel}
              </Text>
            ) : null}
            {pages.length > 1 ? (
              <Text variant="caption" color={theme.colors.text.tertiary} style={styles.captionSubText}>
                · {index + 1}/{pages.length}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Pin toggle for the page on screen. Mirrors the close button's width so
            the caption between them stays optically centred. */}
        <Pressable
          onPress={onTogglePin}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={currentPinned ? t('chat.unpin', 'Открепить') : t('chat.pin', 'Закрепить')}
          style={styles.headerBtn}
        >
          {glassActive ? (
            <GlassBg borderRadius={18} glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} />
          ) : null}
          <Feather
            name="bookmark"
            size={17}
            color={currentPinned ? theme.colors.accent.primary : theme.colors.text.primary}
          />
        </Pressable>
      </View>

      {/* Composer. `KeyboardStickyView` (react-native-keyboard-controller, already a
          dependency and what the other chat screens use) tracks the keyboard frame
          on the UI thread, so the field sits ON the keyboard instead of the large
          gap a mis-placed KeyboardAvoidingView produced. */}
      <KeyboardStickyView
        offset={{ closed: 0, opened: 0 }}
        style={styles.composerDock}
      >
        <View style={{ paddingBottom: insets.bottom + 8, paddingTop: 8 }}>
          <FullscreenComposer
            conversationId={conversationId}
            theme={theme}
            glassActive={glassActive}
            placeholder={t('chat.input_placeholder')}
          />
        </View>
      </KeyboardStickyView>
    </View>
  );
}

/**
 * One page: the message's photos, its text, and a link preview if the text carries
 * a URL — the same pieces the transcript shows, at full size.
 *
 * Scrollable, because a long message has to be readable: the first version centred
 * everything in a fixed box, so anything taller than the screen was simply clipped.
 *
 * Memoized so paging never re-renders the neighbours. Images go through
 * `CachedImage` with the shared proxy width, so a photo already decoded for its
 * bubble is served from memory.
 */
const FullscreenPage = React.memo(function FullscreenPage({
  message,
  isOwn,
  theme,
  topInset,
  ownBg,
  ownTextColor,
  youLabel,
  peerLabel,
}: {
  message: ChatMessage;
  isOwn: boolean;
  theme: any;
  topInset: number;
  ownBg: string;
  ownTextColor: string;
  youLabel: string;
  peerLabel: string;
}) {
  const images = message.imageUrls ?? [];
  const linkUrl = message.text ? extractFirstUrl(message.text) : null;

  const textColor = isOwn ? ownTextColor : theme.colors.text.primary;
  const bubbleBg = isOwn ? ownBg : theme.colors.background.elevated;

  return (
    <ScrollView
      style={{ width: SCREEN_W }}
      contentContainerStyle={[
        styles.pageContent,
        // Clears the floating header at the top and the composer at the bottom.
        { paddingTop: topInset + 60, paddingBottom: 96 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Sender marker. The alignment and bubble colour already say whose message
          this is, but the label removes any doubt when a page is opened directly. */}
      <View style={[styles.senderRow, { alignSelf: isOwn ? 'flex-end' : 'flex-start' }]}>
        <Feather
          name={isOwn ? 'arrow-up-right' : 'arrow-down-left'}
          size={11}
          color={theme.colors.text.tertiary}
        />
        <Text variant="caption" color={theme.colors.text.tertiary} style={styles.senderText}>
          {isOwn ? youLabel : peerLabel}
        </Text>
      </View>

      {/* EVERY photo, stacked. The first version rendered `images[0]` with a "+2"
          badge, which meant the other photos were unreachable in the one screen
          whose entire job is looking at them. Each keeps its natural aspect ratio
          via `resizeMode="contain"` inside a generous fixed-height box. */}
      {images.map((uri) => (
        <View key={uri} style={styles.imageBox}>
          <CachedImage
            uri={uri}
            style={styles.image}
            resizeMode="contain"
            proxyWidth={VIEWER_IMG_MAX_W}
          />
        </View>
      ))}

      {message.text ? (
        <View
          style={[
            styles.textWrap,
            { alignSelf: isOwn ? 'flex-end' : 'flex-start', backgroundColor: bubbleBg },
          ]}
        >
          <FormattedText
            color={textColor}
            linkColor={isOwn ? textColor : theme.colors.accent.primary}
            style={styles.bodyText}
          >
            {message.text}
          </FormattedText>
        </View>
      ) : null}

      {/* Link preview, same component the transcript uses. `static` is NOT set, so
          a video link is playable here — this screen exists to look at content. */}
      {linkUrl ? (
        <View style={[styles.previewWrap, { alignSelf: isOwn ? 'flex-end' : 'flex-start' }]}>
          <LinkPreview url={linkUrl} textColor={theme.colors.text.primary} />
        </View>
      ) : null}
    </ScrollView>
  );
});

/**
 * Minimal composer for the viewer.
 *
 * Deliberately NOT the chat screen's `ChatInputBar`: that component owns the
 * docked emoji/GIF panels, the photo-swallow animation and the keyboard-lift
 * choreography, none of which belong here. Reusing it would drag all of that in
 * and make both screens harder to reason about.
 *
 * Sending routes through the SAME store action the chat screen uses, so a message
 * sent from here appears in the transcript (and in the chat-list preview, via
 * `addMessage`) exactly as if it had been sent from the chat.
 */
const FullscreenComposer = React.memo(function FullscreenComposer({
  conversationId,
  theme,
  glassActive,
  placeholder,
}: {
  conversationId: string | undefined;
  theme: any;
  glassActive: boolean;
  placeholder: string;
}) {
  const [text, setText] = useState('');
  const currentUserId = useAuthStore((s) => s.user?.id);
  const addMessage = useChatStore((s) => s.addMessage);

  const canSend = text.trim().length > 0;

  const send = useCallback(() => {
    const value = text.trim();
    if (!value || !conversationId) return;
    triggerHaptic('medium');
    setText('');
    addMessage(conversationId, {
      id: 'm-' + Date.now(),
      conversationId,
      senderId: currentUserId || 'current',
      text: value,
      createdAt: new Date().toISOString(),
      isRead: true,
    });
  }, [text, conversationId, currentUserId, addMessage]);

  return (
    <View style={styles.composerRow}>
      <View
        style={[
          styles.composerField,
          glassActive
            ? null
            : {
                backgroundColor: theme.colors.background.elevated,
                borderWidth: 1,
                borderColor: theme.colors.border.light,
              },
        ]}
      >
        {glassActive ? (
          <GlassBg borderRadius={22} glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} />
        ) : null}
        <ComposerInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          theme={theme}
        />
      </View>

      <Pressable
        onPress={send}
        disabled={!canSend}
        accessibilityRole="button"
        style={[
          styles.sendBtn,
          { backgroundColor: canSend ? theme.colors.accent.primary : theme.colors.background.elevated },
        ]}
      >
        <Feather name="send" size={18} color={canSend ? '#FFFFFF' : theme.colors.text.tertiary} />
      </Pressable>
    </View>
  );
});

/**
 * The TextInput, isolated in its own component so a keystroke re-renders ONLY
 * this leaf — never the pages behind it. Same isolation principle as the chat
 * screen's `ChatField`.
 */
const ComposerInput = React.memo(function ComposerInput({
  value,
  onChangeText,
  placeholder,
  theme,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  theme: any;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.text.tertiary}
      multiline
      style={{
        flex: 1,
        fontSize: 15,
        maxHeight: 100,
        minHeight: 22,
        paddingVertical: 0,
        color: theme.colors.text.primary,
        fontFamily: theme.fontFamily.regular,
      }}
    />
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  pageContent: { paddingHorizontal: 16, minHeight: '100%' },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  senderText: { fontSize: 11 },
  // Tall but bounded: `contain` keeps the aspect ratio, and a fixed box means the
  // page's scroll height is known before the images decode, so nothing jumps.
  imageBox: { width: '100%', height: 360, marginBottom: 12 },
  image: { width: '100%', height: '100%' },
  textWrap: {
    maxWidth: '92%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  bodyText: { fontSize: 16, lineHeight: 22 },
  previewWrap: { maxWidth: '92%', marginTop: 10 },
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  caption: { flex: 1, alignItems: 'center' },
  captionSub: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  captionSubText: { fontSize: 11 },
  composerDock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    gap: 8,
  },
  composerField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
