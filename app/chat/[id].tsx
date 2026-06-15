import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, FlatList, TextInput, Pressable, Platform, StyleSheet, Alert, Animated, PanResponder, Modal, StatusBar, Dimensions, Keyboard, InteractionManager } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation, useKeyboardHandler } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle, interpolate, Extrapolation, useSharedValue } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { FormattedText } from '../../src/components/ui/FormattedText';
import { LinkPreview } from '../../src/components/ui/LinkPreview';
import { extractFirstUrl } from '../../src/services/linkPreview';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { MessageContextMenu, MessageAction } from '../../src/components/ui/MessageContextMenu';
import { TranslationSheet } from '../../src/components/ui/TranslationSheet';
import { ChatInputBar, ChatInputBarHandle } from '../../src/components/chat/ChatInputBar';
import { GiphyPicker } from '../../src/components/ui/GiphyPicker';
import { getRealtime, chatChannelName, userNotificationsChannelName } from '../../src/services/realtime/ably';
import { useContextMenuGuard } from '../../src/hooks/useContextMenuGuard';
import { useChatStore, useEntityStore, useConnectivityStore, useAuthStore } from '../../src/store';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY, DEFAULT_CHAT_SETTINGS } from '../../src/store/chatSettingsStore';
import { useBrowserStore } from '../../src/store/browserStore';
import { ChatBackgroundLayer } from '../../src/components/ui/ChatBackgroundLayer';
import { PixelIcon } from '../../src/components/pixel-icons/PixelIcon';
import { uploadChatImage } from '../../src/lib/supabase';
import { kvGetJSONSync, kvSetJSON, kvWarm } from '../../src/services/kvStore';
import { mockMessages, mockConversations, formatMessageTime } from '../../src/utils/mockData';
import { showToast } from '../../src/store/toastStore';
import { ChatMessage } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';

const REPLY_THRESHOLD = 60;
const SCREEN_WIDTH = Dimensions.get('window').width;

// Hoisted static atoms for the message bubble. Each visible bubble was
// previously allocating ~10 fresh inline objects per render — for the
// `initialNumToRender: 8` first batch that's ~80 throwaway objects on the
// open-the-chat frame. The remaining truly-dynamic bits (theme colors,
// alignSelf, margins) are still applied as small override objects, which
// React happily diffs without re-walking the whole tree.
const bubbleStyles = StyleSheet.create({
  row: { justifyContent: 'center' },
  swipeIcon: { position: 'absolute', right: 16 },
  swipeIconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bubbleBase: { paddingHorizontal: 14, paddingVertical: 10 },
  replyBlock: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, borderLeftWidth: 2, marginBottom: 6 },
  replyTextWrap: { flex: 1 },
  replyAvatar: { width: 30, height: 30, borderRadius: 6 },
  replyPixel: { borderRadius: 6 },
  replyHeading: { fontSize: 11 },
  replyBody: { fontSize: 11 },
  imagesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  imageSingle: { width: 200, height: 200, borderRadius: 12 },
  imageMulti: { width: 120, height: 120, borderRadius: 12 },
  linkPreviewWrap: { marginTop: 6, width: 280, maxWidth: '100%' },
  timestamp: { marginTop: 3, alignSelf: 'flex-end', fontSize: 10 },
});

function MessageBubble({ message, isOwn, fontSize, bubbleRadius, fontFamily, linkEmoji, highlighted, onReply, onLongPress, onSwipeActive, onImagePress }: { message: ChatMessage; isOwn: boolean; fontSize: number; bubbleRadius: number; fontFamily: string; linkEmoji?: string; highlighted?: boolean; onReply: (m: ChatMessage) => void; onLongPress: (m: ChatMessage) => void; onSwipeActive: (active: boolean) => void; onImagePress: (images: string[], index: number) => void }) {
  const theme = useTheme();
  const t = useT();
  const fontFamilyStyle = fontFamily === 'mono' ? 'monospace' : fontFamily === 'serif' ? 'serif' : undefined;
  const translateX = useRef(new Animated.Value(0)).current;
  const fired = useRef(false);

  // Lazy-init the PanResponder past the navigation/scroll interaction.
  //
  // On first chat open, the FlatList synchronously mounts ~5 MessageBubbles.
  // Eagerly calling `PanResponder.create({...})` per bubble allocated 5
  // closures × 5 bubbles = 25 closures on the same RAF as the navigation
  // transition — the dominant remaining cause of the 60 → 30 FPS drop the
  // user reported when opening a chat. Wiring the swipe gesture in past
  // `runAfterInteractions` means the bubbles render dirt cheap during the
  // transition; swipe-to-reply becomes available a frame after the user
  // lifts their finger from the conversation row, which is well before the
  // chat is interactive anyway.
  const [panHandlers, setPanHandlers] = useState<any>(null);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      const pr = PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dx < -14 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderGrant: () => { onSwipeActive(true); },
        onPanResponderMove: (_, g) => {
          const dx = Math.max(Math.min(g.dx, 0), -80);
          translateX.setValue(dx);
          if (!fired.current && dx <= -REPLY_THRESHOLD) { fired.current = true; triggerHaptic('light'); }
        },
        onPanResponderRelease: (_, g) => {
          if (g.dx <= -REPLY_THRESHOLD) onReply(message);
          fired.current = false;
          onSwipeActive(false);
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 140, friction: 12 }).start();
        },
        onPanResponderTerminate: () => {
          fired.current = false;
          onSwipeActive(false);
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 140, friction: 12 }).start();
        },
      });
      setPanHandlers(pr.panHandlers);
    });
    return () => handle.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replyIconOpacity = translateX.interpolate({ inputRange: [-REPLY_THRESHOLD, -24, 0], outputRange: [1, 0, 0], extrapolate: 'clamp' });

  return (
    <View style={bubbleStyles.row}>
      <Animated.View style={[bubbleStyles.swipeIcon, { opacity: replyIconOpacity }]}>
        <View style={[bubbleStyles.swipeIconCircle, { backgroundColor: theme.colors.accent.primary + '20' }]}>
          <Feather name="corner-up-left" size={16} color={theme.colors.accent.primary} />
        </View>
      </Animated.View>

      <Animated.View style={{ transform: [{ translateX }], alignSelf: isOwn ? 'flex-end' : 'flex-start', maxWidth: '78%', marginLeft: isOwn ? 0 : 16, marginRight: isOwn ? 16 : 0, marginBottom: 4 }} {...(panHandlers || {})}>
        <Pressable onLongPress={() => { triggerHaptic('medium'); onLongPress(message); }} delayLongPress={300}>
          <View style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: bubbleRadius,
            backgroundColor: isOwn ? theme.colors.accent.primary : theme.colors.background.tertiary,
            borderBottomRightRadius: isOwn ? 4 : bubbleRadius,
            borderBottomLeftRadius: isOwn ? bubbleRadius : 4,
            borderWidth: highlighted ? 2 : 0,
            borderColor: highlighted ? theme.colors.accent.primary : 'transparent',
          }}>
            {message.replyToText || message.replyToImage || message.replyPixelIconId ? (
              <View style={[bubbleStyles.replyBlock, { borderLeftColor: isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.accent.primary }]}>
                {message.replyToImage ? (
                  <CachedImage uri={message.replyToImage} style={bubbleStyles.replyAvatar} resizeMode="cover" />
                ) : null}
                {/* Pixel icon attached to the reply via the chat-level
                    setting. Renders alongside the text/image preview —
                    additive, never replaces the existing avatar. Small
                    so it reads as a decoration rather than the primary
                    affordance. */}
                {message.replyPixelIconId ? (
                  <PixelIcon id={message.replyPixelIconId} size={22} style={bubbleStyles.replyPixel} />
                ) : null}
                <View style={bubbleStyles.replyTextWrap}>
                  <Text variant="caption" weight="semibold" color={isOwn ? 'rgba(255,255,255,0.9)' : theme.colors.accent.primary} numberOfLines={1} style={bubbleStyles.replyHeading}>
                    {message.replyToIsOwn ? t('chat.you') : t('chat.peer')}
                  </Text>
                  <Text variant="caption" color={isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.text.tertiary} numberOfLines={1} style={bubbleStyles.replyBody}>
                    {message.replyToText || (message.replyToImage ? t('chat.photo') : '')}
                  </Text>
                </View>
              </View>
            ) : null}
            {message.imageUrls && message.imageUrls.length > 0 ? (
              <View style={[bubbleStyles.imagesRow, { marginBottom: message.text ? 6 : 0 }]}>
                {message.imageUrls.map((uri, idx) => (
                  <Pressable key={idx} onPress={() => onImagePress(message.imageUrls!, idx)} onLongPress={() => { triggerHaptic('medium'); onLongPress(message); }} delayLongPress={300}>
                    <CachedImage uri={uri} style={message.imageUrls!.length === 1 ? bubbleStyles.imageSingle : bubbleStyles.imageMulti} resizeMode="cover" />
                  </Pressable>
                ))}
              </View>
            ) : null}
            {message.text ? (
              <FormattedText color={isOwn ? '#FFFFFF' : theme.colors.text.primary} linkColor={isOwn ? '#FFFFFF' : theme.colors.accent.primary} style={{ fontSize, fontFamily: fontFamilyStyle }}>{message.text}</FormattedText>
            ) : null}
            {(() => {
              const link = (!message.imageUrls || message.imageUrls.length === 0) ? extractFirstUrl(message.text) : null;
              return link ? (
                <Pressable onLongPress={() => { triggerHaptic('medium'); onLongPress(message); }} delayLongPress={300} style={bubbleStyles.linkPreviewWrap}>
                  <LinkPreview
                    url={link}
                    textColor={isOwn ? '#FFFFFF' : undefined}
                    emoji={linkEmoji}
                    onLongPress={() => { triggerHaptic('medium'); onLongPress(message); }}
                    delayLongPress={300}
                  />
                </Pressable>
              ) : null;
            })()}
            <Text variant="caption" color={isOwn ? 'rgba(255,255,255,0.6)' : theme.colors.text.tertiary} style={bubbleStyles.timestamp}>
              {formatMessageTime(message.createdAt)}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const MemoMessageBubble = React.memo(MessageBubble, (prev, next) => {
  // Callbacks are stabilized with useCallback in the screen, so we compare only
  // the data that actually affects this bubble's output. This stops the whole
  // list from re-rendering when unrelated state (typing, scroll, search) changes.
  const pm = prev.message;
  const nm = next.message;
  return (
    pm.id === nm.id &&
    pm.text === nm.text &&
    pm.createdAt === nm.createdAt &&
    pm.replyToText === nm.replyToText &&
    pm.replyToImage === nm.replyToImage &&
    pm.replyToIsOwn === nm.replyToIsOwn &&
    pm.replyPixelIconId === nm.replyPixelIconId &&
    (pm.imageUrls === nm.imageUrls ||
      (pm.imageUrls?.length === nm.imageUrls?.length &&
        (pm.imageUrls || []).every((u, i) => u === nm.imageUrls?.[i]))) &&
    prev.isOwn === next.isOwn &&
    prev.fontSize === next.fontSize &&
    prev.bubbleRadius === next.bubbleRadius &&
    prev.fontFamily === next.fontFamily &&
    prev.linkEmoji === next.linkEmoji &&
    prev.highlighted === next.highlighted
  );
});

export default function ChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { id, participantId: paramParticipantId } = useLocalSearchParams<{ id: string; participantId?: string }>();
  // Mount-time marker — captures how long the chat screen took to commit
  // its first render so the perf-monitor panel can attribute open-the-chat
  // freezes. Reads `Date.now()` once at first render via useRef so the
  // measurement starts at the start of the render, not at commit time.
  // Skipped at the call site when the monitor is off.
  const mountStart = useRef(Date.now()).current;
  const perfEnabled = useSettingsStore((s) => s.perfMonitorEnabled);
  useEffect(() => {
    if (!perfEnabled) return;
    perfMonitor.markScreenMount('chat/[id]', Date.now() - mountStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfEnabled]);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  // Long-press menu opener — see useContextMenuGuard for the rate-limit/raf
  // semantics that prevent rapid long-press storms from freezing the JS thread.
  const { target: actionMessage, open: openMenu, close: closeMenu } = useContextMenuGuard<ChatMessage>({ lockMs: 500, closeLockMs: 350 });

  // Long-pressing a message should dismiss the keyboard so the slide-up
  // action menu doesn't end up half-covered by it. iOS's
  // `keyboardDismissMode="interactive"` only handles the drag gesture, not
  // a programmatic open of an overlay, so we wrap the open with an
  // explicit dismiss here.
  const onMessageLongPress = useCallback(
    (m: ChatMessage) => {
      Keyboard.dismiss();
      openMenu(m);
    },
    [openMenu],
  );
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Defer the ChatBackgroundLayer mount past the navigation slide-in. When a
  // user has set a custom chat wallpaper, the layer mounts a CachedImage that
  // synchronously decodes a full-bleed bitmap on the open-chat frame — that
  // landed on the same RAF as the slide-in transition and contributed to the
  // ~120 ms long task users were seeing the moment they tapped a conversation.
  // Showing a flat bgColor for the first ~300 ms is identical to what users
  // see with no wallpaper set, so the visual delta is imperceptible.
  const [chromeReady, setChromeReady] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setChromeReady(true));
    return () => handle.cancel();
  }, []);
  const [viewerImages, setViewerImages] = useState<{ images: string[]; index: number } | null>(null);
  const [gifPickerVisible, setGifPickerVisible] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [searchActiveIdx, setSearchActiveIdx] = useState(0);
  // Individual selectors — destructuring `useChatStore()` subscribes to the
  // whole store and re-renders this (already heavy) chat on any unrelated
  // store change. Selecting each field independently keeps re-renders tied
  // to the data this screen actually reads.
  // Narrow the messages selector to ONLY this chat's array — the previous
  // `s.messages` selector exposed the whole `chatId -> messages[]` map, so
  // every unrelated chat's background sync re-rendered this entire screen
  // (including its 5–8 mounted bubbles). Subscribing to the slice for `id`
  // means a background sync to another chat becomes a no-op for this screen.
  const myStoreMessages = useChatStore((s) => (id ? s.messages[id] : undefined));
  const setMessages = useChatStore((s) => s.setMessages);
  const addMessage = useChatStore((s) => s.addMessage);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<ChatInputBarHandle>(null);

  const { progress, height: keyboardHeight } = useReanimatedKeyboardAnimation();

  // Memoize the conversation lookup so the linear scan over `mockConversations`
  // doesn't run on every parent render — typing in the input bar (when local
  // state was hoisted) and every keyboard frame would otherwise re-walk this.
  const conversation = useMemo(() => mockConversations.find((c) => c.id === id), [id]);
  const [profileData, setProfileData] = useState<any>(null);

  const entityConversations = useEntityStore((s) => s.conversations);
  const entityConv = useMemo(
    () => entityConversations.find((c) => c.id === id),
    [entityConversations, id],
  );
  const participantId = paramParticipantId || entityConv?.participantId || (conversation as any)?.participantId || id;

  // Synchronously read this chat's cached messages ONCE so the very first render
  // already has content (no blank frame). Memoized per id so it's a single MMKV
  // read, not on every render.
  const seedMessages = useMemo<ChatMessage[]>(() => {
    if (!id) return [];
    // One-shot read at chat-open time. We deliberately use getState() instead
    // of subscribing — the seed only matters for the first render frame, and
    // the live `myStoreMessages` selector below feeds subsequent updates.
    const fromStore = useChatStore.getState().messages[id];
    if (fromStore && fromStore.length > 0) return fromStore as ChatMessage[];
    try {
      const cached = kvGetJSONSync<ChatMessage[]>(`chat_messages:${id}`, []);
      if (cached.length > 0) return cached;
      if (mockMessages[id]) return mockMessages[id] as ChatMessage[];
    } catch {}
    return [];
  }, [id]);

  // Use the store value when present, else the synchronous seed — so the list is
  // never empty on the first frame if a cache exists.
  const storeChat = (myStoreMessages || []) as ChatMessage[];
  const chatMessages = storeChat.length > 0 ? storeChat : seedMessages;

  // Push the seed into the store once (after paint) so edits/sends work normally.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id) return;
    if (seededRef.current === id) return;
    seededRef.current = id;
    if ((useChatStore.getState().messages[id] || []).length === 0 && seedMessages.length > 0) {
      setMessages(id, seedMessages as any);
    }
  }, [id, seedMessages]);

  // Narrow the chat-settings subscription to only the two slices this chat
  // actually reads — global defaults and this chat's own overrides. The
  // previous selector (`s => s.settings`) returned the entire chatId→settings
  // map, which meant any other chat's settings change re-rendered THIS chat
  // (and its 5 mounted message bubbles). Two atomic selectors with shallow
  // equality keep references stable across unrelated updates.
  const globalSettings = useChatSettingsStore((s) => s.settings[GLOBAL_CHAT_SETTINGS_KEY]);
  const specificSettings = useChatSettingsStore((s) => s.settings[id || '']);
  const chatSettings = useMemo(() => {
    return { ...DEFAULT_CHAT_SETTINGS, ...globalSettings, ...specificSettings };
  }, [globalSettings, specificSettings]);

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;
  const inputBarBottomPad = Math.max(insets.bottom, 12);

  // Gradient backdrop fades out as keyboard opens (UI thread)
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0], Extrapolation.CLAMP),
  }));

  // Input row bottom padding: safe-area when keyboard closed → small gap when open (UI thread)
  const inputRowStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(progress.value, [0, 1], [inputBarBottomPad, 8], Extrapolation.CLAMP),
  }));

  // Compensate the KeyboardStickyView's `offset.opened` for the bottom-
  // docked browser widget. When the band is active it lives INSIDE the
  // root flex column as a 56-px-tall sibling of the Stack wrapper, which
  // squeezes every screen (including this chat) so its bottom edge is
  // 56 px above the actual screen bottom. The chat input sticks to the
  // chat-screen bottom, and KSV translates the sticky surface upward by
  // the keyboard height when the keyboard appears — but because the
  // chat screen is already 56 px above the screen bottom, the input
  // ends up 56 px ABOVE the keyboard top instead of right on it. The
  // user perceives this as an unexpectedly large gap between the input
  // bar and the keyboard whenever a browser widget is docked at the
  // bottom. Adding `BAND_HEIGHT` to KSV's `translateY` when the
  // keyboard is open pushes the input back down into the band's
  // overlapped region (the keyboard hides the band anyway), so the
  // input lands flush against the keyboard top in both states.
  const minimizedUrl = useBrowserStore((s) => s.minimizedUrl);
  const browserWidgetPosition = useSettingsStore((s) => s.browserWidgetPosition);
  const stickyOpenedOffset = !!minimizedUrl && browserWidgetPosition === 'bottom' ? 56 : 0;
  const stickyOffset = useMemo(
    () => ({ closed: 0, opened: stickyOpenedOffset }),
    [stickyOpenedOffset],
  );

  // Shift the entire message list upward by exactly the keyboard height when
  // it rises. We drive the translation from `useKeyboardHandler.onMove`
  // — the same lowest-level event source `KeyboardStickyView` uses for the
  // input bar — so the list lifts in lock-step with the input bar instead
  // of occasionally desyncing into a snap when the JS thread is briefly
  // busy on the first chat open. `e.height` is the live keyboard height in
  // pixels, fed to translateY as a negative offset.
  //
  // `onInteractive` mirrors the same height during an iOS interactive
  // dismiss gesture (when the user drags the keyboard down with a finger):
  // without it the list stayed pinned at the keyboard-up position while
  // the input bar followed the finger, leaving a phantom strip where the
  // last message used to sit. Now both follow the finger together.
  const listShiftY = useSharedValue(0);
  useKeyboardHandler(
    {
      onMove: (e) => {
        'worklet';
        listShiftY.value = -e.height;
      },
      onInteractive: (e) => {
        'worklet';
        listShiftY.value = -e.height;
      },
      onEnd: (e) => {
        'worklet';
        listShiftY.value = -e.height;
      },
    },
    [],
  );
  const listShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: listShiftY.value }],
  }));

  // List bottom spacer matches the input bar's real height so the newest
  // message keeps a comfortable gap above the input. We deliberately keep
  // this STATIC (no keyboardHeight in the layout) — animating the spacer's
  // height on every keyboard frame caused the FlatList to relayout mid-
  // scroll, which manifested as the content jumping up/down when the user
  // tapped the input field while the list was still in motion. The input
  // bar itself rides KeyboardStickyView, so it always stays above the
  // keyboard regardless of this constant.
  const INPUT_BAR_HEIGHT = 60;
  const LIST_FOOTER_HEIGHT = INPUT_BAR_HEIGHT + inputBarBottomPad + 12;

  const cachedProfile = useEntityStore((s) => (participantId ? s.profiles[participantId] : undefined));

  useEffect(() => {
    if (conversation) return;
    if (cachedProfile) { setProfileData(cachedProfile); return; }
    if (!participantId) return;
    // Skip the network call when offline so it can't hang and congest the JS thread
    if (!useConnectivityStore.getState().isOnline) return;
    // Defer the profile fetch past the navigation transition — the network
    // request setup (URL build, fetch dispatch, response parse) was landing
    // on the same frame as first paint and contributing to the 60→40 fps
    // drop when opening a chat with no cached profile.
    const handle = InteractionManager.runAfterInteractions(() => {
      // Phase 5: profile fetch goes through the Worker.
      import('../../src/services/apiClient').then(({ apiGet }) =>
        apiGet<any>(`/v1/profiles/${encodeURIComponent(participantId)}`).then(({ data }) => {
          if (data) setProfileData(data);
        }).catch(() => {})
      );
    });
    return () => handle.cancel();
  }, [participantId, conversation, cachedProfile]);

  // Fallback for devices without MMKV: warm the AsyncStorage mirror, then hydrate
  // if the synchronous seed above found nothing.
  useEffect(() => {
    if (!id) return;
    if ((useChatStore.getState().messages[id] || []).length > 0) return;
    const cacheKey = `chat_messages:${id}`;
    kvWarm([cacheKey]).then(() => {
      const cached = kvGetJSONSync<ChatMessage[]>(cacheKey, []);
      if (cached.length > 0 && (useChatStore.getState().messages[id] || []).length === 0) {
        setMessages(id, cached as any);
      } else if (cached.length === 0 && mockMessages[id] && (useChatStore.getState().messages[id] || []).length === 0) {
        setMessages(id, mockMessages[id]);
      }
    }).catch(() => {});
  }, [id]);

  // Persist messages to KV cache whenever THIS chat's messages change.
  // `myStoreMessages` (above) already narrows the subscription to this chat,
  // so the array reference is stable across other chats' background syncs.
  const myMessages = myStoreMessages;

  // Warm the image cache for the most recent messages so they appear instantly
  // (no black flash) when the chat opens — Telegram-style. Deferred past the
  // navigation transition: the dynamic `import('CachedImage')` + Image.prefetch
  // dispatch was landing on the same frame as the FlatList's initial bubble
  // mount and was a measurable contributor to the open-the-chat fps drop.
  useEffect(() => {
    if (!myMessages || myMessages.length === 0) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      const recent = myMessages.slice(-20);
      const uris: string[] = [];
      for (const m of recent) {
        if ((m as any).imageUrls) for (const u of (m as any).imageUrls) uris.push(u);
      }
      if (uris.length) {
        import('../../src/components/ui/CachedImage')
          .then(({ prefetchImages }) => prefetchImages(uris))
          .catch(() => {});
      }
    });
    return () => handle.cancel();
  }, [id]);
  useEffect(() => {
    if (!id) return;
    if (myMessages && myMessages.length > 0) {
      kvSetJSON(`chat_messages:${id}`, myMessages);
    }
  }, [id, myMessages]);

  const chatLocalName = specificSettings?.localName;
  const displayName = chatLocalName || conversation?.participantName || profileData?.display_name || entityConv?.participantName || t('chat.fallback_name');
  const displayEmoji = (conversation as any)?.participantEmoji || profileData?.emoji || entityConv?.participantEmoji || '😊';
  const displayVerified = profileData?.is_verified || cachedProfile?.is_verified || (entityConv as any)?.participantVerified || false;
  const displayBadge = profileData?.badge || cachedProfile?.badge || (entityConv as any)?.participantBadge || null;
  const profileId = participantId;

  // ── Canonical conversation reconciliation (Bug 3) ─────────────────────
  // A chat opened from a profile carries the OTHER user's id as the route
  // `id`, not a conversation id. The conversation is created lazily on the
  // first send (POST /v1/conversations is idempotent — create-or-get). Once
  // the server hands back the canonical conversation id we must converge the
  // whole local picture onto it, otherwise the messages tab (keyed by the
  // real conversation id from the server) and this screen (keyed by the user
  // id) drift apart — the conversation then either duplicates or goes missing
  // from the list. This helper:
  //   1) upserts the conversation row in the entity store, deduped by the
  //      stable participant user id (matching RealtimeAccountBridge);
  //   2) migrates any optimistic messages from the user-id bucket into the
  //      canonical conversation-id bucket;
  //   3) rewrites the route param so `id` becomes the canonical id, which
  //      re-keys the realtime channel, the message selector and the reopen
  //      path with zero extra plumbing.
  const reconcileConversation = useCallback(
    (convId: string | null, lastMessage: string) => {
      if (!convId) return;
      try {
        const store = useEntityStore.getState();
        const existing = store.conversations || [];
        const idx = existing.findIndex(
          (c) => c.id === convId || (!!participantId && c.participantId === participantId),
        );
        const row = {
          id: convId,
          participantId: participantId || '',
          participantName: displayName || t('chat.fallback_name'),
          participantUsername: '',
          participantEmoji: displayEmoji,
          lastMessage,
          lastMessageAt: new Date().toISOString(),
        };
        if (idx >= 0) {
          const merged = [...existing];
          merged[idx] = { ...existing[idx], ...row };
          store.setConversations(merged as any);
        } else {
          store.setConversations([row as any, ...existing]);
        }
      } catch {}

      if (convId !== id) {
        try {
          const cs = useChatStore.getState();
          const fromOld = cs.messages[id] || [];
          if (fromOld.length > 0) {
            const intoNew = cs.messages[convId] || [];
            const seen = new Set(intoNew.map((m: any) => m.id));
            const mergedMsgs = [...intoNew, ...fromOld.filter((m: any) => !seen.has(m.id))];
            setMessages(convId, mergedMsgs as any);
          }
        } catch {}
        try {
          router.setParams({ id: convId, participantId: participantId || '' } as any);
        } catch {}
      }
    },
    [id, participantId, displayName, displayEmoji, setMessages, t],
  );

  // Inverted list: the newest message is at scroll offset 0, so "scroll to end"
  // (newest) = scroll to offset 0. No manual scroll needed on open.
  const scrollToEnd = useCallback((_animated = true) => {
    requestAnimationFrame(() => { try { flatListRef.current?.scrollToOffset({ offset: 0, animated: _animated }); } catch {} });
  }, []);

  // ── Realtime channel: incoming messages from the other participant ─────────
  //
  // Both sides of a chat use the same `id` route param when navigating to the
  // chat screen, so they end up subscribed to the same Ably channel. When the
  // peer publishes a new message we add it to the local store; we deliberately
  // skip publishes from our own user id because the optimistic addMessage in
  // handleSend / sendGif already put the message on screen.
  //
  // The connection itself is opened lazily via getRealtime() — the wrapper
  // pulls a 1-hour token from /api/ably-token and reuses one client across
  // every chat the user opens. We only subscribe / unsubscribe to the
  // per-chat channel here, not the connection.
  //
  // Three event types:
  //   - 'msg'        → new message from peer
  //   - 'msg.edit'   → peer edited a message they sent earlier
  //   - 'msg.delete' → peer deleted a message
  useEffect(() => {
    if (!id) return;
    const realtime = getRealtime();
    if (!realtime) return; // Not authenticated yet, or no deviceKey — degrade silently.
    const channel = realtime.channels.get(chatChannelName(id));
    const ownUserId = useAuthStore.getState().user?.id;

    const onNewMessage = (msg: { data?: any }) => {
      const payload = msg?.data;
      if (!payload || typeof payload !== 'object') return;
      // Skip our own publishes — the optimistic addMessage already showed
      // the message; receiving it again would dupe it.
      if (payload.senderId && ownUserId && payload.senderId === ownUserId) return;
      // Dedupe by id against the current store snapshot. Messages from the
      // peer are tagged with a stable client-side id by the publisher, so
      // a quick subscribe-after-publish race won't add the same row twice.
      const existing = useChatStore.getState().messages[id] || [];
      if (existing.some((m) => m.id === payload.id)) return;
      // Translate the wire payload into our ChatMessage shape. From THIS
      // device's perspective the sender is "peer", so we mark accordingly
      // so the bubble aligns left.
      const incoming: ChatMessage = {
        id: payload.id,
        conversationId: id,
        senderId: 'peer',
        text: payload.text || '',
        createdAt: payload.createdAt || new Date().toISOString(),
        isRead: false,
        replyToId: payload.replyToId,
        replyToText: payload.replyToText,
        replyToIsOwn: payload.replyToIsOwn === true ? false : payload.replyToIsOwn === false ? true : undefined,
        replyToImage: payload.replyToImage,
        replyPixelIconId: payload.replyPixelIconId,
        imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls : undefined,
      };
      addMessage(id, incoming);
    };

    // Edit — peer changed text / images of a message we already have.
    // Match by id; if not found (e.g. message loaded from Supabase has a
    // different UUID-form id), the update is a silent no-op.
    const onEdit = (msg: { data?: any }) => {
      const payload = msg?.data;
      if (!payload || typeof payload !== 'object' || !payload.id) return;
      const current = useChatStore.getState().messages[id] || [];
      const next = current.map((m) =>
        m.id === payload.id
          ? { ...m, text: typeof payload.text === 'string' ? payload.text : m.text, imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls : m.imageUrls }
          : m,
      );
      setMessages(id, next as any);
    };

    // Delete — peer removed a message. We just filter it out of the local
    // list; no Supabase round-trip required because the peer already did
    // (or will, when DB-side delete lands).
    const onDelete = (msg: { data?: any }) => {
      const payload = msg?.data;
      if (!payload || typeof payload !== 'object' || !payload.id) return;
      const current = useChatStore.getState().messages[id] || [];
      setMessages(id, current.filter((m) => m.id !== payload.id) as any);
    };

    void channel.subscribe('msg', onNewMessage);
    void channel.subscribe('msg.edit', onEdit);
    void channel.subscribe('msg.delete', onDelete);
    return () => {
      try { channel.unsubscribe('msg', onNewMessage); } catch {}
      try { channel.unsubscribe('msg.edit', onEdit); } catch {}
      try { channel.unsubscribe('msg.delete', onDelete); } catch {}
    };
  }, [id, addMessage, setMessages]);

  // ── Message search ──────────────────────────────────────────────────────────
  const openSearch = useCallback(() => {
    triggerHaptic('light');
    setSearchMode(true);
  }, []);

  const closeSearch = useCallback(() => {
    // Dismiss the keyboard first so the bottom input bar doesn't get stuck at the
    // keyboard's last position when it re-mounts (KeyboardStickyView).
    Keyboard.dismiss();
    setSearchQuery('');
    setSearchMatches([]);
    setSearchActiveIdx(0);
    // Exit search after the keyboard has had a frame to start closing.
    setTimeout(() => setSearchMode(false), 50);
  }, []);

  // Search match indices are in original order; map to the inverted list index.
  const scrollToIndex = useCallback((index: number) => {
    if (index < 0 || index >= chatMessages.length) return;
    const invIndex = chatMessages.length - 1 - index;
    try {
      flatListRef.current?.scrollToIndex({ index: invIndex, animated: true, viewPosition: 0.5 });
    } catch {}
  }, [chatMessages.length]);

  // Recompute matches when the query changes; jump to the most recent match
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) { setSearchMatches([]); setSearchActiveIdx(0); return; }
    const matches: number[] = [];
    chatMessages.forEach((m, i) => {
      if (m.text && m.text.toLowerCase().includes(q)) matches.push(i);
    });
    setSearchMatches(matches);
    if (matches.length > 0) {
      const last = matches.length - 1;
      setSearchActiveIdx(last);
      scrollToIndex(matches[last]);
    }
  }, [searchQuery, chatMessages, scrollToIndex]);

  const goToPrevMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const next = (searchActiveIdx - 1 + searchMatches.length) % searchMatches.length;
    setSearchActiveIdx(next);
    scrollToIndex(searchMatches[next]);
    triggerHaptic('light');
  }, [searchMatches, searchActiveIdx, scrollToIndex]);

  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const next = (searchActiveIdx + 1) % searchMatches.length;
    setSearchActiveIdx(next);
    scrollToIndex(searchMatches[next]);
    triggerHaptic('light');
  }, [searchMatches, searchActiveIdx, scrollToIndex]);

  const startReply = useCallback((message: ChatMessage) => {
    setEditing(null);
    setReplyTo(message);
    triggerHaptic('light');
  }, []);

  const pickImages = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 6,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    triggerHaptic('light');

    // Downscale picked images immediately to a display-friendly size so rendering
    // (thumbnails, context-menu preview, viewer) stays smooth even offline, and the
    // eventual upload is light. GIFs are left untouched to preserve animation.
    const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
    const processed = await Promise.all(result.assets.map(async (a) => {
      const isGif = (a.uri.split('.').pop() || '').toLowerCase() === 'gif';
      if (isGif) return a.uri;
      try {
        const r = await manipulateAsync(a.uri, [{ resize: { width: 1280 } }], { compress: 0.6, format: SaveFormat.JPEG });
        return r.uri;
      } catch {
        return a.uri;
      }
    }));
    setPendingImages((prev) => [...prev, ...processed].slice(0, 6));
  }, []);

  const openImageViewer = useCallback((images: string[], index: number) => {
    setViewerImages({ images, index });
  }, []);

  // Send a GIF (from GIPHY) as a message. We store the remote GIF URL directly in
  // imageUrls — no upload to our storage (zero server load), and it renders +
  // animates through the existing image path (expo-image animates GIFs).
  const sendGif = useCallback((url: string) => {
    if (!id || !url) return;
    triggerHaptic('light');
    const currentReply = replyTo;
    setReplyTo(null);
    const newMessage: ChatMessage = {
      id: 'm-' + Date.now(),
      conversationId: id,
      senderId: 'current',
      text: '',
      createdAt: new Date().toISOString(),
      isRead: true,
      replyToId: currentReply?.id,
      replyToText: currentReply?.text || (currentReply?.imageUrls && currentReply.imageUrls.length > 0 ? t('chat.photo') : undefined),
      replyToIsOwn: currentReply ? currentReply.senderId === 'current' : undefined,
      replyToImage: currentReply?.imageUrls?.[0],
      // Per-chat decorative pixel icon stamped onto reply messages.
      // Only set when this message is actually a reply — otherwise
      // there's no reply-block to render the icon in. Read directly
      // off the merged settings object so it picks up the latest
      // pick from the picker without a re-render dependency.
      replyPixelIconId: currentReply ? chatSettings.replyPixelIcon : undefined,
      imageUrls: [url],
    };
    addMessage(id, newMessage);
    scrollToEnd();

    // Persist to the DB (best-effort) using the same image marker scheme.
    if (!useConnectivityStore.getState().isOnline) return;
    (async () => {
      try {
        const { useAuthStore } = await import('../../src/store');
        const user = useAuthStore.getState().user;
        if (!user) return;
        const { apiPost } = await import('../../src/services/apiClient');
        // Idempotent: returns existing 1:1 conversation if one already
        // exists between this pair, otherwise creates and returns the new id.
        const { data: convData } = await apiPost<{ conversation_id: string }>(
          '/v1/conversations',
          { otherUserId: participantId },
        );
        const convId = convData?.conversation_id || null;
        if (convId) {
          await apiPost(`/v1/conversations/${encodeURIComponent(convId)}/messages`, {
            text: `::img::${url}::`,
          });
          // Realtime publish — same pattern as handleSend. The peer sees
          // the GIF instantly via subscribe-on-mount. Publish on the
          // canonical conversation channel so a profile-initiated chat
          // reaches a peer who opened the chat from their messages tab.
          try {
            const realtime = getRealtime();
            if (realtime && id) {
              const channel = realtime.channels.get(chatChannelName(convId));
              void channel.publish('msg', {
                id: newMessage.id,
                senderId: user.id,
                text: '',
                createdAt: newMessage.createdAt,
                imageUrls: [url],
                replyToId: newMessage.replyToId,
                replyToText: newMessage.replyToText,
                replyToIsOwn: newMessage.replyToIsOwn,
                replyToImage: newMessage.replyToImage,
                replyPixelIconId: newMessage.replyPixelIconId,
              });
            }
            // Ping the peer's personal channel so the conversation row +
            // preview appear in their messages tab before they open the
            // chat (Telegram-style), matching handleSend.
            if (realtime && participantId) {
              const peerChan = realtime.channels.get(userNotificationsChannelName(participantId));
              const me = useAuthStore.getState().user;
              void peerChan.publish('new_message', {
                conversationId: convId,
                senderId: user.id,
                senderName: me?.displayName || '',
                senderUsername: me?.username || '',
                senderEmoji: me?.emoji || '😊',
                lastMessage: '📷',
                lastMessageAt: newMessage.createdAt,
                message: {
                  id: newMessage.id,
                  senderId: user.id,
                  text: '',
                  createdAt: newMessage.createdAt,
                  imageUrls: [url],
                },
              });
            }
          } catch {}

          // Converge local state onto the canonical conversation id (Bug 3)
          // so a GIF-first chat started from a profile shows up in the
          // messages list and reopens to the same thread.
          reconcileConversation(convId, '📷');
        }
      } catch {}
    })();
  }, [id, replyTo, addMessage, scrollToEnd, participantId, t, reconcileConversation]);

  // Translation sheet state — receives source text on demand and animates
  // up. Reset to '' when closed so the next open re-fetches (the service
  // hits its 7-day MMKV cache so this is essentially free).
  const [translateText, setTranslateText] = useState<string>('');

  const handleMenuAction = useCallback((action: MessageAction, message: ChatMessage) => {
    if (action === 'copy') {
      Clipboard.setStringAsync(message.text);
      showToast(t('toast.copied'), 'check');
    } else if (action === 'reply') {
      startReply(message);
    } else if (action === 'translate') {
      // Open the translation sheet with the source message text. The sheet
      // does the LibreTranslate fetch + result UI itself.
      if (message.text && message.text.trim()) setTranslateText(message.text);
    } else if (action === 'edit') {
      setReplyTo(null);
      setEditing(message);
      // Use `?? ''` so attachment-only messages (GIF / photo, where
      // `text` is empty or undefined) don't propagate undefined into the
      // TextInput — they should open the editor with a blank text field
      // and the existing media pre-loaded for replace/remove.
      inputRef.current?.setText(message.text ?? '');
      // Load existing photos / GIF URLs so they can be removed or replaced
      // via the existing pendingImages flow (× to remove, image picker to
      // add a new photo, GIF button to swap to a new GIF).
      setPendingImages(message.imageUrls || []);
    } else if (action === 'delete') {
      Alert.alert(t('chat.delete_message_title'), '', [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'), style: 'destructive', onPress: () => {
            if (!id) return;
            // Read the latest snapshot from getState() rather than from the
            // closed-over selector — avoids the callback being recreated on
            // every store update (and rebuilding all bubbles' onLongPress).
            const current = useChatStore.getState().messages[id] || [];
            setMessages(id, current.filter((m) => m.id !== message.id) as any);
            triggerHaptic('medium');
            // Sync delete to the peer in realtime — so when this user
            // deletes a message on their side, it disappears from the
            // peer's open chat too. Telegram-style "delete for both".
            try {
              const realtime = getRealtime();
              if (realtime && id) {
                const channel = realtime.channels.get(chatChannelName(id));
                void channel.publish('msg.delete', { id: message.id });
              }
            } catch {}
          },
        },
      ]);
    }
  }, [id, setMessages, startReply, t]);

  const handleSend = async (rawText: string) => {
    const hasImages = pendingImages.length > 0;
    if ((!rawText.trim() && !hasImages) || !id) return;
    triggerHaptic('medium');
    const text = rawText.trim();

    if (editing) {
      // Re-upload any newly added local images (those that aren't already remote URLs)
      let finalImages: string[] | undefined = pendingImages.length > 0 ? pendingImages : undefined;
      const localOnes = pendingImages.filter((u) => !u.startsWith('http'));
      setEditing(null);
      setPendingImages([]);
      setMessages(id, (useChatStore.getState().messages[id] || []).map((m) => (m.id === editing.id ? { ...m, text, imageUrls: finalImages } : m)) as any);
      if (localOnes.length > 0) {
        const results = await Promise.all(pendingImages.map((u) => u.startsWith('http') ? Promise.resolve({ url: u, error: null }) : uploadChatImage(u)));
        const urls = results.map((r) => r.url).filter(Boolean) as string[];
        setMessages(id, (useChatStore.getState().messages[id] || []).map((m) => (m.id === editing.id ? { ...m, imageUrls: urls.length ? urls : undefined } : m)) as any);
        finalImages = urls.length ? urls : undefined;
      }
      // Sync the edit to the peer's open chat. The receiver's subscription
      // handler updates the message in place by id. Same caveats as
      // realtime delete — only matches by message.id, so peers viewing
      // history loaded from Supabase (which has its own UUIDs) won't see
      // the edit; but anyone who received the message via the live Ably
      // stream WILL.
      try {
        const realtime = getRealtime();
        if (realtime && id) {
          const channel = realtime.channels.get(chatChannelName(id));
          void channel.publish('msg.edit', {
            id: editing.id,
            text,
            imageUrls: finalImages,
          });
        }
      } catch {}
      return;
    }

    const currentReply = replyTo;
    setReplyTo(null);

    const localImages = pendingImages;
    setPendingImages([]);

    const newMessage: ChatMessage = {
      id: 'm-' + Date.now(),
      conversationId: id,
      senderId: 'current',
      text,
      createdAt: new Date().toISOString(),
      isRead: true,
      replyToId: currentReply?.id,
      replyToText: currentReply?.text || (currentReply?.imageUrls && currentReply.imageUrls.length > 0 ? (currentReply.imageUrls.length > 1 ? t('chat.photos_count', undefined, { n: currentReply.imageUrls.length }) : t('chat.photo')) : undefined),
      replyToIsOwn: currentReply ? currentReply.senderId === 'current' : undefined,
      replyToImage: currentReply?.imageUrls?.[0],
      // See sendGif — same per-chat pixel-icon stamp on outgoing
      // replies. Stays out of non-reply messages so memoized
      // bubbles don't re-render unnecessarily.
      replyPixelIconId: currentReply ? chatSettings.replyPixelIcon : undefined,
      imageUrls: localImages.length > 0 ? localImages : undefined,
    };
    addMessage(id, newMessage);
    scrollToEnd();

    // Upload images in the background, then swap local URIs for remote URLs.
    // Skip all network work when offline so the JS thread / keyboard stay smooth.
    if (!useConnectivityStore.getState().isOnline) return;

    let uploadedUrls: string[] = [];
    if (localImages.length > 0) {
      setUploading(true);
      try {
        const results = await Promise.all(localImages.map((uri) => uploadChatImage(uri)));
        uploadedUrls = results.map((r) => r.url).filter(Boolean) as string[];
        if (uploadedUrls.length > 0) {
          setMessages(id, (useChatStore.getState().messages[id] || []).map((m) =>
            m.id === newMessage.id ? { ...m, imageUrls: uploadedUrls } : m
          ) as any);
        }
      } catch {}
      setUploading(false);
    }

    try {
      const { useAuthStore } = await import('../../src/store');
      const user = useAuthStore.getState().user;
      if (!user) return;

      const { apiPost } = await import('../../src/services/apiClient');
      const { data: convData } = await apiPost<{ conversation_id: string }>(
        '/v1/conversations',
        { otherUserId: participantId },
      );
      const convId = convData?.conversation_id || null;

      if (convId) {
        // Encode attached images into the stored text with a marker so it
        // round-trips without schema changes.
        const imageMarker = uploadedUrls.length > 0 ? `::img::${uploadedUrls.join('|')}::` : '';
        await apiPost(`/v1/conversations/${encodeURIComponent(convId)}/messages`, {
          text: imageMarker + text,
        });

        // Publish to the realtime channel so the peer's chat screen picks
        // up this message instantly. The channel name is `chat:<id>` (the
        // route param), so both sides see the same channel as long as they
        // navigated through the same conversation entry. We deliberately
        // publish AFTER the Supabase insert resolved — that guarantees the
        // peer's optimistic addMessage maps to a real DB row, so when they
        // re-open the chat the message persists.
        //
        // We ALSO publish to the peer's personal `user:<peerId>:notifications`
        // channel so the message + the conversation entry appear in their
        // messages-tab list before they open the chat at all (Telegram-style
        // "new chat appears with first message"). RealtimeAccountBridge
        // subscribes to this channel app-wide.
        try {
          const realtime = getRealtime();
          if (realtime) {
            const messageBody = {
              id: newMessage.id,
              senderId: user.id,
              text,
              createdAt: newMessage.createdAt,
              imageUrls: uploadedUrls.length > 0 ? uploadedUrls : undefined,
              replyToId: newMessage.replyToId,
              replyToText: newMessage.replyToText,
              replyToIsOwn: newMessage.replyToIsOwn,
              replyToImage: newMessage.replyToImage,
              replyPixelIconId: newMessage.replyPixelIconId,
            };
            if (id) {
              const chatChan = realtime.channels.get(chatChannelName(convId));
              void chatChan.publish('msg', messageBody);
            }
            if (participantId) {
              const peerChan = realtime.channels.get(userNotificationsChannelName(participantId));
              // Pull our own profile out of the auth store to enrich the
              // notification payload — that way the recipient's bridge has
              // all the fields it needs to render the conversation row
              // without an extra `profiles` round-trip.
              const me = useAuthStore.getState().user;
              void peerChan.publish('new_message', {
                conversationId: convId,
                senderId: user.id,
                senderName: me?.displayName || '',
                senderUsername: me?.username || '',
                senderEmoji: me?.emoji || '😊',
                lastMessage: text || (uploadedUrls.length > 0 ? '📷' : ''),
                lastMessageAt: newMessage.createdAt,
                message: messageBody,
              });
            }
          }
        } catch {}
      }

      // Converge the local picture onto the canonical conversation id the
      // server just handed back (Bug 3) — upserts the list row deduped by
      // participant, migrates optimistic messages, and re-keys the route.
      reconcileConversation(convId, text || (uploadedUrls.length > 0 ? '📷' : ''));
    } catch {}
  };

  const handleSwipeActive = useCallback((active: boolean) => setScrollEnabled(!active), []);

  // Parse the ::img::url1|url2:: marker for messages coming from the DB
  const parseMessage = useCallback((m: ChatMessage): ChatMessage => {
    if (m.imageUrls || !m.text?.startsWith('::img::')) return m;
    const end = m.text.indexOf('::', 7);
    if (end === -1) return m;
    const urls = m.text.slice(7, end).split('|').filter(Boolean);
    return { ...m, imageUrls: urls.length ? urls : undefined, text: m.text.slice(end + 2) };
  }, []);

  const activeMatchIndex = searchMatches.length > 0 ? searchMatches[searchActiveIdx] : -1;
  const activeMatchId = activeMatchIndex >= 0 && activeMatchIndex < chatMessages.length ? chatMessages[activeMatchIndex]?.id : null;

  // Inverted data: render newest-first so the FlatList's natural bottom is the
  // newest message — no auto-scroll-to-end needed.
  // latest message (no scrolling needed). Memoized to avoid re-reversing on every
  // keystroke / re-render.
  const invertedMessages = useMemo(() => {
    const arr = chatMessages.slice();
    arr.reverse();
    return arr;
  }, [chatMessages]);

  // Guard against the freeze caused by rapid long-presses / taps while a menu is
  // opening or closing — see `useContextMenuGuard` (declared above with the
  // other hooks) for the time-lock + requestAnimationFrame defer.

  const renderItem = useCallback(({ item }: { item: ChatMessage; index: number }) => {
    const m = parseMessage(item);
    return (
      <MemoMessageBubble
        message={m}
        isOwn={m.senderId === 'current'}
        fontSize={chatSettings.fontSize}
        bubbleRadius={chatSettings.bubbleRadius}
        fontFamily={chatSettings.fontFamily}
        linkEmoji={chatSettings.linkEmoji}
        highlighted={item.id === activeMatchId}
        onReply={startReply}
        onLongPress={onMessageLongPress}
        onSwipeActive={handleSwipeActive}
        onImagePress={openImageViewer}
      />
    );
  }, [chatSettings.fontSize, chatSettings.bubbleRadius, chatSettings.fontFamily, chatSettings.linkEmoji, startReply, handleSwipeActive, openImageViewer, parseMessage, activeMatchId, onMessageLongPress]);

  // Stable callback refs for FlatList — without these, every parent render
  // hands FlatList fresh function identities and breaks its row recycling
  // shortcuts. Both functions only close over `flatListRef.current`, so they
  // never need to change.
  const chatKeyExtractor = useCallback((item: ChatMessage) => item.id, []);
  const onScrollToIndexFailedCb = useCallback((info: { index: number; averageItemLength: number; highestMeasuredFrameIndex: number }) => {
    setTimeout(() => {
      try { flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }); } catch {}
    }, 120);
  }, []);

  const banner = editing || replyTo;
  const menuIsOwn = actionMessage?.senderId === 'current';

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {chromeReady && chatSettings.backgroundImage && (
        <ChatBackgroundLayer uri={chatSettings.backgroundImage} style={StyleSheet.absoluteFill} />
      )}

      {/* Inverted list — newest message sits at the bottom with NO scrolling
          needed (exactly like the AI chat). This removes the open-at-top-then-
          jump-to-bottom behaviour entirely and makes keyboard handling trivial.
          The whole list is wrapped in a Reanimated.View whose translateY is
          driven by the keyboard frame on the UI thread, so when the keyboard
          rises every message rides up with it (last message stays visible
          above the input bar) without triggering FlatList layout. */}
      <Reanimated.View style={[StyleSheet.absoluteFill, listShiftStyle]} pointerEvents="box-none">
      <FlatList
        ref={flatListRef}
        data={invertedMessages}
        style={StyleSheet.absoluteFill}
        keyExtractor={chatKeyExtractor}
        renderItem={renderItem}
        inverted
        contentContainerStyle={{ paddingBottom: 8 }}
        ListHeaderComponent={<View style={{ height: LIST_FOOTER_HEIGHT }} />}
        ListFooterComponent={<View style={{ height: headerContentHeight + 8 }} />}
        showsVerticalScrollIndicator={false}
        scrollEnabled={scrollEnabled}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        removeClippedSubviews={true}
        // Tuned for iPhone 12 / weak Android: ~5 bubbles fit the visible
        // window above the input bar. Lower than the previous 8/6/7 — each
        // bubble synchronously creates a `PanResponder` (5 closures) and an
        // `Animated.Value`, plus a `LinkPreview` allocation, all on the same
        // RAF as the navigation transition. Cutting 3 bubbles saves
        // ~20–30 ms on the chat-open frame, which was the dominant cost
        // behind `SLOW long task @ (tabs)/messages 164ms` users were seeing
        // when tapping a conversation row.
        initialNumToRender={5}
        maxToRenderPerBatch={4}
        windowSize={5}
        // Larger update batching window — keeps cell mounting from competing
        // with scroll gestures on weak devices. Default is 50 ms; bumping to
        // 80 ms is invisible to the user and lets scroll frames win.
        updateCellsBatchingPeriod={80}
        onScrollToIndexFailed={onScrollToIndexFailedCb}
      />
      </Reanimated.View>

      {/* Input bar sticks to the keyboard top; hidden while searching */}
      {!searchMode && (
      <KeyboardStickyView offset={stickyOffset} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Reanimated.View style={[StyleSheet.absoluteFill, backdropStyle]} pointerEvents="none">
          {/* Three-stop fade so messages scrolling above the input bar
              ghost into the chrome rather than getting hard-clipped by a
              solid bg slab. Mirror of the top-header gradient. */}
          <LinearGradient
            colors={[bgTransparent, bgColor + 'B3', bgColor]}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Reanimated.View>

        {banner && (
          <View style={{ marginHorizontal: 12, marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.colors.background.elevated, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border.light, paddingHorizontal: 12, paddingVertical: 6 }}>
            <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: theme.colors.accent.primary }} />
            <Feather name={editing ? 'edit-2' : 'corner-up-left'} size={15} color={theme.colors.accent.primary} />
            {banner.imageUrls && banner.imageUrls.length > 0 ? (
              <CachedImage uri={banner.imageUrls[0]} style={{ width: 32, height: 32, borderRadius: 6 }} resizeMode="cover" />
            ) : null}
            <View style={{ flex: 1 }}>
              <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} style={{ fontSize: 12 }}>{editing ? t('chat.editing') : t('chat.replying')}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 12 }}>{banner.text || (banner.imageUrls && banner.imageUrls.length > 0 ? `📷 ${banner.imageUrls.length > 1 ? t('chat.photos_count', undefined, { n: banner.imageUrls.length }) : t('chat.photo')}` : '')}</Text>
            </View>
            {/* Pixel-icon picker entry — only relevant on a reply
                compose, not on edit. Shows the currently-selected
                icon (per-chat) so the user can see at a glance what
                will be stamped onto the outgoing reply. Opens the
                picker bound to this chat. */}
            {!editing ? (
              <Pressable
                onPress={() => {
                  triggerHaptic('light');
                  router.push({ pathname: '/settings/pixel-icons', params: { purpose: 'chat-reply', chatId: id || '' } });
                }}
                hitSlop={8}
                style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
              >
                {chatSettings.replyPixelIcon ? (
                  <PixelIcon id={chatSettings.replyPixelIcon} size={22} />
                ) : (
                  <Feather name="image" size={18} color={theme.colors.text.tertiary} />
                )}
              </Pressable>
            ) : null}
            <Pressable onPress={() => { setReplyTo(null); setEditing(null); inputRef.current?.clear(); }} hitSlop={8}>
              <Feather name="x" size={18} color={theme.colors.text.tertiary} />
            </Pressable>
          </View>
        )}

        {/* Pending image attachments preview */}
        {pendingImages.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
            {pendingImages.map((uri, idx) => (
              <View key={idx} style={{ position: 'relative' }}>
                <CachedImage uri={uri} style={{ width: 60, height: 60, borderRadius: 10 }} resizeMode="cover" />
                <Pressable onPress={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))} style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="x" size={13} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <ChatInputBar
          ref={inputRef}
          isEditing={!!editing}
          hasPendingImages={pendingImages.length > 0}
          onSend={handleSend}
          onPickImages={pickImages}
          onOpenGif={() => setGifPickerVisible(true)}
          inputRowStyle={inputRowStyle}
        />
      </KeyboardStickyView>
      )}

      {/* Gradient fade header — three stops with a translucent middle so
          content scrolling under the header reads as a soft ghost rather
          than being abruptly clipped by a solid bg slab. The chrome
          (back / name / avatar) sits ON TOP of the gradient, so it stays
          fully readable; only the message list behind it fades through
          the dimming zone. */}
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient
          colors={[bgColor, bgColor + 'B3', bgTransparent]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        {searchMode ? (
          <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 20, borderWidth: 1, borderColor: theme.colors.border.light, paddingHorizontal: 14, height: 40 }}>
              <Feather name="search" size={16} color={theme.colors.text.tertiary} />
              <TextInput
                autoFocus
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={t('chat.search_placeholder')}
                placeholderTextColor={theme.colors.text.tertiary}
                style={{ flex: 1, marginLeft: 8, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular }}
              />
              {searchQuery.length > 0 && (
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 12, marginRight: 4 }}>
                  {searchMatches.length > 0 ? `${searchActiveIdx + 1}/${searchMatches.length}` : '0'}
                </Text>
              )}
            </View>
            {searchMatches.length > 0 && (
              <View style={{ flexDirection: 'row', marginLeft: 6 }}>
                <Pressable onPress={goToPrevMatch} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
                  <Feather name="chevron-up" size={18} color={theme.colors.text.primary} />
                </Pressable>
                <Pressable onPress={goToNextMatch} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, marginLeft: 6 }]}>
                  <Feather name="chevron-down" size={18} color={theme.colors.text.primary} />
                </Pressable>
              </View>
            )}
            <Pressable onPress={closeSearch} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, marginLeft: 6 }]}>
              <Feather name="x" size={20} color={theme.colors.text.primary} />
            </Pressable>
          </View>
        ) : (
          <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
            <Pressable onPress={() => router.back()} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
              <Feather name="chevron-left" size={22} color={theme.colors.text.primary} />
            </Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Pressable
                onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId, fromChat: '1' } })}
                onLongPress={openSearch}
                delayLongPress={300}
                style={[styles.headerPill, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}
              >
                <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{displayName}</Text>
                {displayVerified && <VerifiedBadge size={12} />}
                {displayBadge && <UserBadge badge={displayBadge} size="sm" />}
              </Pressable>
            </View>
            <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId, fromChat: '1' } })} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, overflow: 'hidden' }]}>
              <Avatar emoji={displayEmoji} name={displayName} size="xs" />
            </Pressable>
          </View>
        )}
      </View>

      {/* Long-press message menu — in-screen overlay (not a native Modal) so it
          can never deadlock with the GIF/image/video modals. High zIndex keeps it
          above the input bar and header. */}
      {!!actionMessage && (
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
          <MessageContextMenu
            visible={!!actionMessage}
            message={actionMessage}
            isOwn={menuIsOwn}
            bubbleColor={menuIsOwn ? theme.colors.accent.primary : theme.colors.background.tertiary}
            bubbleTextColor={menuIsOwn ? '#FFFFFF' : theme.colors.text.primary}
            bubbleRadius={chatSettings.bubbleRadius}
            linkEmoji={chatSettings.linkEmoji}
            onClose={closeMenu}
            onAction={handleMenuAction}
          />
        </View>
      )}

      {/* GIF picker (GIPHY) */}
      <GiphyPicker visible={gifPickerVisible} onClose={() => setGifPickerVisible(false)} onSelect={sendGif} />

      {/* Translation sheet — opens when the user picks "Translate" from
          the long-press menu. Source text is the message body; target is
          the app's UI locale. */}
      <TranslationSheet
        visible={!!translateText}
        text={translateText}
        onClose={() => setTranslateText('')}
      />

      {/* Fullscreen image viewer */}
      <Modal visible={!!viewerImages} transparent animationType="fade" onRequestClose={() => setViewerImages(null)} statusBarTranslucent>
        <StatusBar hidden />
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' }}>
          <Pressable onPress={() => setViewerImages(null)} style={{ position: 'absolute', top: insets.top + 12, right: 16, zIndex: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="x" size={20} color="#FFFFFF" />
          </Pressable>
          {viewerImages && (
            <FlatList
              data={viewerImages.images}
              horizontal
              pagingEnabled
              initialScrollIndex={viewerImages.index}
              getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
              keyExtractor={(uri, i) => uri + i}
              showsHorizontalScrollIndicator={false}
              style={{ flex: 1 }}
              renderItem={({ item }) => (
                <View style={{ width: SCREEN_WIDTH, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                  <CachedImage uri={item} style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH }} resizeMode="contain" />
                </View>
              )}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  headerCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  headerPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: 16 },
});
