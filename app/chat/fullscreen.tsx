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
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle, interpolate, Extrapolation } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { bottomScrimColorsStrong, composerScrimHeight, headerScrimHeights, SCRIM_LOCATIONS, topScrimColors } from '../../src/theme/scrim';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { FormattedText, hasCodeBlock } from '../../src/components/ui/FormattedText';
import { LinkPreview } from '../../src/components/ui/LinkPreview';
import { extractFirstUrl } from '../../src/services/linkPreview';
import { extractInAppCardUrl, isInAppCardUrl, stripInAppCardUrl } from '../../src/utils/appLinks';
import { useChatStore, useAuthStore } from '../../src/store';
import { usePinnedMessagesStore, selectPinnedIds } from '../../src/store/pinnedMessagesStore';
import { useT, useI18nStore } from '../../src/i18n/store';
import { useLiquidGlassActive, GlassBg } from '../../src/components/ui/LiquidGlass';
import { triggerHaptic } from '../../src/utils/haptics';
import { formatDaySeparator } from '../../src/utils/chatDaySeparators';
import { readableTextOn, withOpacity } from '../../src/constants/bubbleColors';
import { useSettingsStore } from '../../src/store/settingsStore';
import { getImageDims, setImageDims } from '../../src/services/imageDimsCache';
import { showToast } from '../../src/store/toastStore';
import type { ChatMessage } from '../../src/types';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

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
  const bgColor = theme.colors.background.primary;

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

  // ── Save to the photo library ─────────────────────────────────────────────
  //
  // Only offered when the page actually has a photo. `expo-media-library` is
  // already a dependency and `NSPhotoLibraryAddUsageDescription` is already
  // declared and accurate, so this ships over-the-air with no new permission.
  // Everything is lazily imported so the module is not pulled in on screens that
  // never save anything.
  const currentImages = current?.imageUrls ?? [];
  const canSave = currentImages.length > 0;
  const [saving, setSaving] = useState(false);

  const onSave = useCallback(async () => {
    const uri = currentImages[0];
    if (!uri || saving) return;
    setSaving(true);
    try {
      const MediaLibrary = await import('expo-media-library');
      // `writeOnly: true` asks for the add-only scope — the least access that can
      // save a file, and it never grants us the ability to READ the library.
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) {
        showToast(t('toast.error_generic'), 'alert-circle');
        return;
      }
      // Resolve to a local file first: `createAssetAsync` cannot take a remote URL.
      // expo-image has almost certainly already cached this exact derivative,
      // because the viewer requests the same proxy width the bubble used.
      const { Image: ExpoImage } = await import('expo-image');
      const proxied = uri;
      let localUri: string | null = null;
      try {
        const cached = await ExpoImage.getCachePathAsync(proxied);
        if (cached) localUri = cached.startsWith('file') ? cached : 'file://' + cached;
      } catch {
        // fall through to a download
      }
      if (!localUri) {
        const FileSystem = await import('expo-file-system');
        const target = `${(FileSystem as any).cacheDirectory}san-save-${Date.now()}.jpg`;
        const res = await (FileSystem as any).downloadAsync(proxied, target);
        localUri = res?.uri ?? null;
      }
      if (!localUri) {
        showToast(t('toast.error_generic'), 'alert-circle');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(localUri);
      triggerHaptic('medium');
      // Reuses the existing swipe-to-screenshot strings rather than adding a second
      // pair of keys that say the same thing in both locales.
      showToast(t('swipeable.saved_to_gallery'), 'check');
    } catch {
      showToast(t('swipeable.save_failed'), 'alert-circle');
    } finally {
      setSaving(false);
    }
  }, [currentImages, saving, t]);

  // ── Composer dock padding ─────────────────────────────────────────────────
  //
  // The bottom safe-area inset must NOT be added while the keyboard is up: the
  // keyboard's own frame already covers the home-indicator strip, so adding it
  // again left roughly 34 pt of dead space between the field and the keyboard —
  // the reported "the distance between them is big". Interpolated on the UI thread
  // from the live keyboard height, so it closes as the keyboard rises rather than
  // snapping when it finishes.
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const composerPadStyle = useAnimatedStyle(() => {
    const raw = keyboardHeight.value;
    const kb = raw < 0 ? -raw : raw;
    // 0 → keyboard fully down, 1 → fully up.
    const up = interpolate(kb, [0, 60], [0, 1], Extrapolation.CLAMP);
    return { paddingBottom: interpolate(up, [0, 1], [insets.bottom + 8, 8]) };
  });

  const headerBtnFrame = useMemo(
    () => ({
      backgroundColor: theme.colors.background.elevated,
      borderWidth: 1,
      borderColor: theme.colors.border.light,
    }),
    [theme.colors.background.elevated, theme.colors.border.light],
  );
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

      {/* ── Header bar ──────────────────────────────────────────────────────
          A REAL header, not three buttons floating on the photo. The first
          version had no bar at all, so the controls sat directly on the image
          with nothing behind them and read as unanchored. This mirrors the chat
          screen's header: a three-stop gradient backdrop (opaque at the top,
          translucent in the middle, clear at the bottom) so content scrolling
          under it fades out instead of being cut off, with the chrome painted on
          top so it stays legible over any photo.

          `box-none` so only the buttons take touches — the pages behind stay
          swipeable across the full height. */}
      {/* Height comes from `headerScrimHeights` rather than a local `insets.top + 52`.
          This screen was the only one still hand-rolling it, so it did not pick up the
          shared header overhang and its top ramp was shorter than every other screen's —
          the same ramp compressed into less distance, which reads as weaker. */}
      <View style={[styles.header, { height: headerScrimHeights(insets.top, 8).gradient }]} pointerEvents="box-none">
        <LinearGradient
          colors={topScrimColors(theme.isDark, bgColor)}
          locations={SCRIM_LOCATIONS}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.headerRow, { paddingTop: insets.top }]} pointerEvents="box-none">
          {/* Left slot reserves the same width as the right action cluster — see the note on
              `headerSide` for why the caption drifts without it. */}
          <View style={styles.headerSide} pointerEvents="box-none">
          <Pressable
            onPress={close}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('common.close', 'Закрыть')}
            style={[styles.headerBtn, glassActive ? null : headerBtnFrame]}
          >
            {glassActive ? (
              <GlassBg borderRadius={18} glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} />
            ) : null}
            <Feather name="x" size={18} color={theme.colors.text.primary} />
          </Pressable>
          </View>

          {/* Name + day/page caption. Framed for the same reason as the buttons: this header
              sits over a PHOTO, so unbacked text has no guaranteed contrast. Glass supplies
              its own surface; otherwise it gets the flat elevated fill + hairline. */}
          {/* Two views on purpose: the OUTER one takes `flex: 1` and only centres, the INNER
              one is the frame and shrink-wraps its text.

              With `flex: 1` on the frame itself it stretched to fill the whole gap between
              the close button and the action cluster — a full-width slab holding two short
              lines of centred text. `flexShrink: 1` plus `maxWidth` lets it hug the name and
              still truncate rather than push the buttons around. */}
          <View style={styles.captionSlot} pointerEvents="none">
          <View
            style={[styles.captionFrame, glassActive ? null : headerBtnFrame]}
            pointerEvents="none"
          >
            {glassActive ? (
              <GlassBg borderRadius={15} glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} />
            ) : null}
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
          </View>

          {/* Save (photos only) + pin. Right-hand cluster. */}
          <View style={styles.headerActions} pointerEvents="box-none">
            {canSave ? (
              <Pressable
                onPress={onSave}
                disabled={saving}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('common.save')}
                style={[styles.headerBtn, glassActive ? null : headerBtnFrame]}
              >
                {glassActive ? (
                  <GlassBg borderRadius={18} glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} />
                ) : null}
                <Feather
                  name="download"
                  size={17}
                  color={saving ? theme.colors.text.tertiary : theme.colors.text.primary}
                />
              </Pressable>
            ) : null}

            <Pressable
              onPress={onTogglePin}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={currentPinned ? t('chat.unpin', 'Открепить') : t('chat.pin', 'Закрепить')}
              style={[styles.headerBtn, glassActive ? null : headerBtnFrame]}
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
        </View>
      </View>

      {/* Composer. `KeyboardStickyView` (react-native-keyboard-controller, already a
          dependency and what the other chat screens use) tracks the keyboard frame
          on the UI thread, so the field sits ON the keyboard instead of the large
          gap a mis-placed KeyboardAvoidingView produced. */}
      {/* Bottom scrim. This screen was the only one of the five composer screens with
          no bottom ramp at all — it had a top scrim and nothing underneath, which is
          why the darkening was present above and missing below the input field.

          Pinned to the screen bottom and rendered BEFORE the composer, so the composer
          paints over it — same order as the tab bar's fade and the other chats. Height
          matches this screen's own composer padding (`insets.bottom + 8`), so the ramp
          finishes level with the top of the field rather than reaching over the
          message. */}
      <LinearGradient
        colors={bottomScrimColorsStrong(theme.isDark, theme.colors.background.primary)}
        locations={SCRIM_LOCATIONS}
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: composerScrimHeight(insets.bottom + 8, 16) }}
      />

      <KeyboardStickyView
        offset={{ closed: 0, opened: 0 }}
        style={styles.composerDock}
      >
        <Reanimated.View style={[styles.composerPad, composerPadStyle]}>
          <FullscreenComposer
            conversationId={conversationId}
            theme={theme}
            glassActive={glassActive}
            placeholder={t('chat.input_placeholder')}
          />
        </Reanimated.View>
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
  // ── THE SAME TWO GUARDS THE CHAT BUBBLE APPLIES ────────────────────────────
  //
  // Reported as: in fullscreen an emoji/GIF message "looks like a link with a micro-preview", and
  // previews generally do not match the chat.
  //
  // This read `message.text ? extractFirstUrl(message.text) : null` — missing BOTH conditions the
  // bubble uses. The consequences are exactly what was described:
  //
  //   • no `!hasImages` — media messages are stored with their URL in the text (`::gif::<url>`),
  //     so a GIF or photo message extracted its OWN url and rendered a link card of it. That is
  //     the "emoji shown as a link with a tiny preview".
  //   • no `!hasCodeBlock` — a URL inside a fenced code block got unfurled, which is wrong
  //     anywhere and doubly odd next to monospaced text.
  //
  // Written as one expression matching `previewLink` in the bubble, so the two are diffable by
  // eye. They drifted because the decision was duplicated rather than shared, and duplicating it
  // is what let one copy grow two guards while the other kept none.
  // ── OUR OWN LINK WINS THE PREVIEW SLOT, HERE TOO ──────────────────────────
  //
  // The note above says this expression is written to be diffable by eye against the bubble's
  // `previewLink`, and that they drifted once because the decision was duplicated. So it gets the same
  // change: scan for OUR shapes before falling back to "the first url in the text". See
  // `extractInAppCardUrl` for why the positional first match was the wrong question.
  const linkUrl = !images.length && message.text && !hasCodeBlock(message.text)
    ? extractInAppCardUrl(message.text) ?? extractFirstUrl(message.text)
    : null;

  // ── AND THE BODY LOSES THE URL, WHICH IT DID NOT BEFORE ───────────────────
  //
  // The bubble has stripped our own share URLs out of its body text for a long time, because the card
  // below already shows everything the link points at. This screen rendered `{message.text}` RAW, so
  // opening a shared post in fullscreen printed the bare elided `san-m-app.com/post` above the card —
  // the exact duplication the transcript fixed, still present one tap away.
  //
  // Same helper, same rule: only OUR links go, a third-party URL keeps its text.
  const bodyText = isInAppCardUrl(linkUrl) ? stripInAppCardUrl(message.text, linkUrl) : (message.text || '');

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

      {/* EVERY photo, stacked, each at its OWN aspect ratio. */}
      {images.map((uri) => (
        <ViewerPhoto key={uri} uri={uri} />
      ))}

      {bodyText ? (
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
            {bodyText}
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
 * One photo in a page, at its NATURAL aspect ratio and edge to edge.
 *
 * The first version letterboxed every photo inside a fixed 360 pt box with
 * `resizeMode="contain"`, which left thick empty bars above and below a wide shot
 * and squeezed a tall one into a third of the screen. That is the "the image looks
 * awful" report.
 *
 * The size comes from `imageDimsCache`, the same store the chat bubbles use, so a
 * photo that has ever been displayed already has its dimensions on disk and mounts
 * at the RIGHT shape on the very first frame — no square-then-snap. For a photo that
 * has never been seen we start at 4:3, which is the least wrong guess, and correct it
 * from `onLoad`; the measured size is written back so it is instant next time.
 *
 * Height is capped at 78 % of the screen so a very tall panorama still leaves the
 * caption and the composer reachable rather than pushing them a screen away.
 */
const ViewerPhoto = React.memo(function ViewerPhoto({ uri }: { uri: string }) {
  const cached = getImageDims(uri);
  const [ratio, setRatio] = useState(cached ? cached.w / cached.h : 4 / 3);

  const width = SCREEN_W - 32;
  const maxHeight = SCREEN_H * 0.78;
  const height = Math.min(width / Math.max(ratio, 0.05), maxHeight);

  const onLoad = useCallback(
    (e: any) => {
      const w = e?.source?.width ?? e?.nativeEvent?.source?.width;
      const h = e?.source?.height ?? e?.nativeEvent?.source?.height;
      if (!w || !h) return;
      setImageDims(uri, w, h);
      const next = w / h;
      setRatio((prev) => (Math.abs(prev - next) < 0.01 ? prev : next));
    },
    [uri],
  );

  return (
    <View style={[styles.photoBox, { width, height }]}>
      <CachedImage
        uri={uri}
        style={styles.image}
        // `cover` inside a box that already matches the photo's ratio: no bars, no
        // distortion, and the image fills its rounded frame exactly.
        resizeMode="cover"
        proxyWidth={VIEWER_IMG_MAX_W}
        onLoad={onLoad}
      />
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
      // A `multiline` TextInput aligns its text to the TOP of its own box on iOS, and
      // Android adds its own font padding on top of that. Inside a field that centres
      // its children (`composerField`: alignItems 'center', minHeight 44,
      // paddingVertical 10) the result was a placeholder and caret sitting visibly
      // above the middle of the pill.
      //
      // An explicit `lineHeight` makes the glyph box a known height instead of
      // font-metric-dependent, `includeFontPadding: false` removes Android's extra
      // inset, and `textAlignVertical: 'center'` handles Android's own alignment. With
      // those three the input's box is exactly one line tall and the parent's centring
      // then actually centres it.
      textAlignVertical="center"
      style={{
        flex: 1,
        fontSize: 15,
        lineHeight: 20,
        maxHeight: 100,
        minHeight: 20,
        paddingTop: 0,
        paddingBottom: 0,
        includeFontPadding: false,
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
  // Rounded frame sized to the photo's own aspect ratio (see `ViewerPhoto`), so
  // there are never letterbox bars. `overflow: hidden` is required for the radius to
  // actually clip the image on iOS.
  photoBox: {
    alignSelf: 'center',
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 12,
    backgroundColor: 'rgba(127,127,127,0.10)',
  },
  image: { width: '100%', height: '100%' },
  textWrap: {
    maxWidth: '92%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  bodyText: { fontSize: 16, lineHeight: 22 },
  // ── THE CARD NEEDS A WIDTH, NOT JUST A CEILING ────────────────────────────
  //
  // This was `{ maxWidth: '92%' }` with no `width`, and that is why the previews looked wrong here:
  // reported as "из-за того, что превьюшки или контейнеры маленькие... контент как будто не
  // помещается".
  //
  // A `maxWidth` alone does not give a child any room — the wrapper shrink-wraps to the content's
  // intrinsic size, and these cards (`PostPreviewCard`, `ProfilePreviewCard`, `MiniAppPreviewCard`,
  // the OG row) are all built to fill the width they are handed: 56 px thumbnail, then a flexing text
  // column beside it. Handed no width, the text column collapses toward zero and every line wraps or
  // clips. The transcript never showed this because its wrapper states `width: 280` outright
  // (`bubbleStyles.linkPreviewWrap`).
  //
  // 320 rather than 280: this screen exists to look at content on a full page, so the card can be
  // wider than it is in a bubble. `maxWidth` keeps it inside the page gutters on a narrow device,
  // which is the job that attribute was doing correctly all along.
  previewWrap: { width: 320, maxWidth: '92%', marginTop: 10 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    flex: 1,
  },
  // ── Both side slots reserve the SAME width ──────────────────────────────────────
  //
  // The caption is centred inside the space LEFT OVER between the two sides, so it is only
  // optically centred on screen when those sides are equal. They were not: one 36 pt close
  // button on the left against a right cluster that is 36 when the page is text and
  // 36 + 8 + 36 = 80 when the page is an image and the download button appears. So the
  // caption sat centred at rest and slid left the moment the user paged onto a photo — with
  // no way to tell that a button had appeared, only that the title moved.
  //
  // 80 is the widest the right cluster ever gets, so reserving it on both sides keeps the
  // caption fixed whether the download button is showing or not.
  headerSide: { minWidth: 80, flexDirection: 'row', alignItems: 'center' },
  headerActions: { minWidth: 80, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  caption: { flex: 1, alignItems: 'center' },
  // Transparent centring slot. Takes the flexible width so the frame inside it does not have
  // to, which is what keeps the frame the width of its text.
  captionSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Frame for the caption pill, same treatment as the buttons so the header reads as
  // three chrome elements rather than text floating on a photo.
  captionFrame: {
    flexShrink: 1,
    maxWidth: '100%',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 15,
    overflow: 'hidden',
    // NOTE: no `borderWidth` here. It lives in `headerBtnFrame`, which is applied only on
    // the non-glass path — a border declared here would also draw in glass mode, where
    // RN's default black `borderColor` would put a hairline across the glass surface.
  },
  captionSub: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  captionSubText: { fontSize: 11 },
  composerDock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  composerPad: { paddingTop: 8 },
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
