// Full-screen message viewer.
//
// Reached from the small expand button in the corner of a chat bubble (top-LEFT
// on your own messages, top-RIGHT on incoming ones — i.e. always the outer
// corner, away from the tail). It presents ONE message per page, swipeable left
// and right through the conversation, with a composer pinned at the bottom so a
// reply can be sent without leaving.
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
// the viewer reads it from there and renders the images through `CachedImage` at
// the SAME proxy width the bubbles used — so paging is instant and served from
// memory rather than re-decoding at a new size (the mistake that made the context
// menu look like it re-downloaded photos).

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Dimensions,
  FlatList,
  TextInput,
  type ListRenderItemInfo,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { FormattedText } from '../../src/components/ui/FormattedText';
import { ModalStatusBar } from '../../src/components/ui/ModalStatusBar';
import { useChatStore, useAuthStore } from '../../src/store';
import { useT, useI18nStore } from '../../src/i18n/store';
import { useLiquidGlassActive, GlassBg } from '../../src/components/ui/LiquidGlass';
import { triggerHaptic } from '../../src/utils/haptics';
import { formatDaySeparator } from '../../src/utils/chatDaySeparators';
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
      />
    ),
    [currentUserId, theme, insets.top],
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

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background.primary }]}>
      <ModalStatusBar />

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

      {/* Floating close button + caption. Sits above the pages, inset by the safe
          area so it clears the notch / Dynamic Island on every device. */}
      <View
        style={[styles.header, { top: insets.top + 8, paddingHorizontal: 12 }]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={close}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.close', 'Закрыть')}
          style={styles.closeBtn}
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
          {dayLabel ? (
            <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>
              {dayLabel}
            </Text>
          ) : null}
        </View>

        {/* Page counter — mirrors the close button's width so the caption stays
            optically centred. */}
        <View style={styles.counter} pointerEvents="none">
          {pages.length > 1 ? (
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>
              {index + 1}/{pages.length}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Composer. `KeyboardAvoidingView` from react-native-keyboard-controller
          (already a dependency, used by the chat screen) keeps it above the
          keyboard without the JS-driven lift the chat screen needs for its
          docked panels. */}
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>
        <View style={{ paddingBottom: insets.bottom + 8 }}>
          <FullscreenComposer
            conversationId={conversationId}
            theme={theme}
            glassActive={glassActive}
            placeholder={t('chat.input_placeholder')}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * One page: the message's images (if any) above its text.
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
}: {
  message: ChatMessage;
  isOwn: boolean;
  theme: any;
  topInset: number;
}) {
  const images = message.imageUrls ?? [];

  return (
    <View style={[styles.page, { width: SCREEN_W, paddingTop: topInset + 56 }]}>
      {images.length > 0 ? (
        <View style={styles.imageWrap}>
          {images.slice(0, 1).map((uri) => (
            <CachedImage
              key={uri}
              uri={uri}
              style={styles.image}
              resizeMode="contain"
              proxyWidth={VIEWER_IMG_MAX_W}
            />
          ))}
          {images.length > 1 ? (
            <View style={styles.moreBadge}>
              <Text variant="caption" color="#FFFFFF" style={{ fontSize: 11 }}>
                +{images.length - 1}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {message.text ? (
        <View
          style={[
            styles.textWrap,
            {
              alignSelf: isOwn ? 'flex-end' : 'flex-start',
              backgroundColor: theme.colors.background.elevated,
            },
          ]}
        >
          <FormattedText
            color={theme.colors.text.primary}
            linkColor={theme.colors.accent.primary}
            style={{ fontSize: 16, lineHeight: 22 }}
          >
            {message.text}
          </FormattedText>
        </View>
      ) : null}
    </View>
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
  page: { flex: 1, justifyContent: 'center', paddingHorizontal: 16, paddingBottom: 16 },
  imageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  moreBadge: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  textWrap: {
    maxWidth: '92%',
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  caption: { flex: 1, alignItems: 'center' },
  // Same width as the close button so the caption between them stays centred.
  counter: { width: 36, alignItems: 'flex-end' },
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
