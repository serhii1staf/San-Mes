import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, FlatList, TextInput, Pressable, Platform, StyleSheet, ImageBackground, Alert, Animated, PanResponder, Modal, StatusBar, Dimensions, Keyboard } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle, interpolate, Extrapolation } from 'react-native-reanimated';
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
import { ChatInputBar, ChatInputBarHandle } from '../../src/components/chat/ChatInputBar';
import { GiphyPicker } from '../../src/components/ui/GiphyPicker';
import { useChatStore, useEntityStore, useConnectivityStore } from '../../src/store';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY, DEFAULT_CHAT_SETTINGS } from '../../src/store/chatSettingsStore';
import { supabase, uploadChatImage } from '../../src/lib/supabase';
import { kvGetJSONSync, kvSetJSON, kvWarm } from '../../src/services/kvStore';
import { mockMessages, mockConversations, formatMessageTime } from '../../src/utils/mockData';
import { showToast } from '../../src/store/toastStore';
import { ChatMessage } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';

const REPLY_THRESHOLD = 60;
const SCREEN_WIDTH = Dimensions.get('window').width;

function MessageBubble({ message, isOwn, fontSize, bubbleRadius, fontFamily, linkEmoji, highlighted, onReply, onLongPress, onSwipeActive, onImagePress }: { message: ChatMessage; isOwn: boolean; fontSize: number; bubbleRadius: number; fontFamily: string; linkEmoji?: string; highlighted?: boolean; onReply: (m: ChatMessage) => void; onLongPress: (m: ChatMessage) => void; onSwipeActive: (active: boolean) => void; onImagePress: (images: string[], index: number) => void }) {
  const theme = useTheme();
  const fontFamilyStyle = fontFamily === 'mono' ? 'monospace' : fontFamily === 'serif' ? 'serif' : undefined;
  const translateX = useRef(new Animated.Value(0)).current;
  const fired = useRef(false);

  // Swipe-to-reply: claim the gesture only for clearly horizontal left swipes,
  // and lock the list's vertical scroll while swiping (Telegram-style)
  const panResponder = useRef(PanResponder.create({
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
  })).current;

  const replyIconOpacity = translateX.interpolate({ inputRange: [-REPLY_THRESHOLD, -24, 0], outputRange: [1, 0, 0], extrapolate: 'clamp' });

  return (
    <View style={{ justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', right: 16, opacity: replyIconOpacity }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.accent.primary + '20', alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="corner-up-left" size={16} color={theme.colors.accent.primary} />
        </View>
      </Animated.View>

      <Animated.View style={{ transform: [{ translateX }], alignSelf: isOwn ? 'flex-end' : 'flex-start', maxWidth: '78%', marginLeft: isOwn ? 0 : 16, marginRight: isOwn ? 16 : 0, marginBottom: 4 }} {...panResponder.panHandlers}>
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
            {message.replyToText || message.replyToImage ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.accent.primary, marginBottom: 6 }}>
                {message.replyToImage ? (
                  <CachedImage uri={message.replyToImage} style={{ width: 30, height: 30, borderRadius: 6 }} resizeMode="cover" />
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text variant="caption" weight="semibold" color={isOwn ? 'rgba(255,255,255,0.9)' : theme.colors.accent.primary} numberOfLines={1} style={{ fontSize: 11 }}>
                    {message.replyToIsOwn ? 'Вы' : 'Собеседник'}
                  </Text>
                  <Text variant="caption" color={isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>
                    {message.replyToText || (message.replyToImage ? 'Фото' : '')}
                  </Text>
                </View>
              </View>
            ) : null}
            {message.imageUrls && message.imageUrls.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: message.text ? 6 : 0 }}>
                {message.imageUrls.map((uri, idx) => (
                  <Pressable key={idx} onPress={() => onImagePress(message.imageUrls!, idx)} onLongPress={() => { triggerHaptic('medium'); onLongPress(message); }} delayLongPress={300}>
                    <CachedImage uri={uri} style={{ width: message.imageUrls!.length === 1 ? 200 : 120, height: message.imageUrls!.length === 1 ? 200 : 120, borderRadius: 12 }} resizeMode="cover" />
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
                <Pressable onLongPress={() => { triggerHaptic('medium'); onLongPress(message); }} delayLongPress={300} style={{ marginTop: 6, width: 280, maxWidth: '100%' }}>
                  <LinkPreview url={link} textColor={isOwn ? '#FFFFFF' : undefined} emoji={linkEmoji} />
                </Pressable>
              ) : null;
            })()}
            <Text variant="caption" color={isOwn ? 'rgba(255,255,255,0.6)' : theme.colors.text.tertiary} style={{ marginTop: 3, alignSelf: 'flex-end', fontSize: 10 }}>
              {formatMessageTime(message.createdAt)}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const MemoMessageBubble = React.memo(MessageBubble);

export default function ChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id, participantId: paramParticipantId } = useLocalSearchParams<{ id: string; participantId?: string }>();
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [menuMessage, setMenuMessage] = useState<ChatMessage | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [viewerImages, setViewerImages] = useState<{ images: string[]; index: number } | null>(null);
  const [gifPickerVisible, setGifPickerVisible] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [searchActiveIdx, setSearchActiveIdx] = useState(0);
  const { messages: storeMessages, setMessages, addMessage } = useChatStore();
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<ChatInputBarHandle>(null);

  const { progress, height: keyboardHeight } = useReanimatedKeyboardAnimation();

  const conversation = mockConversations.find((c) => c.id === id);
  const [profileData, setProfileData] = useState<any>(null);

  const entityConversations = useEntityStore((s) => s.conversations);
  const entityConv = entityConversations.find(c => c.id === id);
  const participantId = paramParticipantId || entityConv?.participantId || (conversation as any)?.participantId || id;

  const chatMessages = (storeMessages[id || ''] || []) as ChatMessage[];

  // Seed the store SYNCHRONOUSLY on first render from the MMKV cache so messages
  // are on screen in the very first frame (no blank flash). useState initializer
  // runs during render, before paint — unlike a useEffect which defers a tick.
  const seededRef = useRef<string | null>(null);
  if (id && seededRef.current !== id && (storeMessages[id] || []).length === 0) {
    seededRef.current = id;
    try {
      const cached = kvGetJSONSync<ChatMessage[]>(`chat_messages:${id}`, []);
      if (cached.length > 0) {
        setMessages(id, cached as any);
      } else if (mockMessages[id]) {
        setMessages(id, mockMessages[id]);
      }
    } catch {}
  }

  const settingsMap = useChatSettingsStore((s) => s.settings);
  const chatSettings = useMemo(() => {
    const global = settingsMap[GLOBAL_CHAT_SETTINGS_KEY];
    const specific = settingsMap[id || ''];
    return { ...DEFAULT_CHAT_SETTINGS, ...global, ...specific };
  }, [settingsMap, id]);

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

  // List bottom spacer matches the input bar's real height so the newest message keeps
  // a comfortable gap above the input (closed) and stays reachable above the keyboard (open).
  const INPUT_BAR_HEIGHT = 60;
  const listFooterStyle = useAnimatedStyle(() => {
    const padBottom = interpolate(progress.value, [0, 1], [inputBarBottomPad, 8], Extrapolation.CLAMP);
    return { height: Math.abs(keyboardHeight.value) + INPUT_BAR_HEIGHT + padBottom + 12 };
  });

  const cachedProfile = useEntityStore((s) => (participantId ? s.profiles[participantId] : undefined));

  useEffect(() => {
    if (conversation) return;
    if (cachedProfile) { setProfileData(cachedProfile); return; }
    if (participantId) {
      // Skip the network call when offline so it can't hang and congest the JS thread
      if (!useConnectivityStore.getState().isOnline) return;
      supabase.from('profiles').select('*').eq('id', participantId).single().then(({ data }) => {
        if (data) setProfileData(data);
      }).catch(() => {});
    }
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
  // Depend on the specific chat array (not the whole map) to avoid extra work
  // when other chats update.
  const myMessages = storeMessages[id || ''];

  // Warm the image cache for the most recent messages so they appear instantly
  // (no black flash) when the chat opens — Telegram-style.
  useEffect(() => {
    if (!myMessages || myMessages.length === 0) return;
    const recent = myMessages.slice(-20);
    const uris: string[] = [];
    for (const m of recent) {
      if ((m as any).imageUrls) for (const u of (m as any).imageUrls) uris.push(u);
    }
    if (uris.length) { import('../../src/components/ui/CachedImage').then(({ prefetchImages }) => prefetchImages(uris)).catch(() => {}); }
  }, [id]);
  useEffect(() => {
    if (!id) return;
    if (myMessages && myMessages.length > 0) {
      kvSetJSON(`chat_messages:${id}`, myMessages);
    }
  }, [id, myMessages]);

  const chatLocalName = settingsMap[id || '']?.localName;
  const displayName = chatLocalName || conversation?.participantName || profileData?.display_name || entityConv?.participantName || 'Чат';
  const displayEmoji = (conversation as any)?.participantEmoji || profileData?.emoji || entityConv?.participantEmoji || '😊';
  const displayVerified = profileData?.is_verified || cachedProfile?.is_verified || (entityConv as any)?.participantVerified || false;
  const displayBadge = profileData?.badge || cachedProfile?.badge || (entityConv as any)?.participantBadge || null;
  const profileId = participantId;

  const scrollToEnd = useCallback((animated = true) => {
    requestAnimationFrame(() => flatListRef.current?.scrollToEnd({ animated }));
  }, []);

  // Only auto-scroll to the bottom when the number of messages grows (new
  // message / first load) — NOT on every content-size change. Otherwise tapping
  // an inline video (which grows the row) would yank the list to the end.
  const prevMsgCountRef = useRef(0);
  const handleContentSizeChange = useCallback(() => {
    const count = chatMessages.length;
    if (count !== prevMsgCountRef.current) {
      prevMsgCountRef.current = count;
      scrollToEnd(false);
    }
  }, [chatMessages.length, scrollToEnd]);

  // Robust initial scroll-to-bottom: when a chat first opens, images/previews
  // load slightly after mount and grow the content, which can leave the list
  // parked in the middle. We keep the list invisible until it's pinned to the
  // newest message, then fade it in — so the user never SEES the jump. A few
  // re-pins during the first ~700ms absorb late-loading image/preview heights.
  const didInitialScrollRef = useRef(false);
  const [listReady, setListReady] = useState(false);
  useEffect(() => {
    didInitialScrollRef.current = false;
    setListReady(false);
  }, [id]);
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    if (!chatMessages.length) { setListReady(true); return; }
    didInitialScrollRef.current = true;
    // Pin to the bottom several times WHILE the list is still invisible, then
    // reveal once on the final pin — so the scroll-into-place is never seen.
    const timers = [0, 80, 200, 380].map((d) =>
      setTimeout(() => {
        try { flatListRef.current?.scrollToEnd({ animated: false }); } catch {}
        if (d === 380) setListReady(true);
      }, d)
    );
    return () => timers.forEach(clearTimeout);
  }, [id, chatMessages.length]);

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

  const scrollToIndex = useCallback((index: number) => {
    if (index < 0 || index >= chatMessages.length) return;
    try {
      flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
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
      replyToText: currentReply?.text || (currentReply?.imageUrls && currentReply.imageUrls.length > 0 ? 'Фото' : undefined),
      replyToIsOwn: currentReply ? currentReply.senderId === 'current' : undefined,
      replyToImage: currentReply?.imageUrls?.[0],
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
        const { data: myConvs } = await supabase.from('conversation_participants').select('conversation_id').eq('user_id', user.id);
        const { data: theirConvs } = await supabase.from('conversation_participants').select('conversation_id').eq('user_id', participantId);
        let convId: string | null = null;
        if (myConvs && theirConvs) {
          const myIds = new Set(myConvs.map((c: any) => c.conversation_id));
          const shared = theirConvs.find((c: any) => myIds.has(c.conversation_id));
          if (shared) convId = shared.conversation_id;
        }
        if (!convId) {
          const { data: newConv } = await supabase.from('conversations').insert({}).select().single();
          if (newConv) {
            convId = newConv.id;
            await supabase.from('conversation_participants').insert([
              { conversation_id: convId, user_id: user.id },
              { conversation_id: convId, user_id: participantId },
            ]);
          }
        }
        if (convId) {
          await supabase.from('messages').insert({ conversation_id: convId, sender_id: user.id, text: `::img::${url}::` });
        }
      } catch {}
    })();
  }, [id, replyTo, addMessage, scrollToEnd, participantId]);

  const handleMenuAction = useCallback((action: MessageAction, message: ChatMessage) => {
    if (action === 'copy') {
      Clipboard.setStringAsync(message.text);
      showToast('Скопировано', 'check');
    } else if (action === 'reply') {
      startReply(message);
    } else if (action === 'edit') {
      setReplyTo(null);
      setEditing(message);
      inputRef.current?.setText(message.text);
      // Load existing photos so they can be removed/replaced while editing
      setPendingImages(message.imageUrls || []);
    } else if (action === 'delete') {
      Alert.alert('Удалить сообщение?', '', [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить', style: 'destructive', onPress: () => {
            if (!id) return;
            setMessages(id, (storeMessages[id] || []).filter((m) => m.id !== message.id) as any);
            triggerHaptic('medium');
          },
        },
      ]);
    }
  }, [id, storeMessages, setMessages, startReply]);

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
      setMessages(id, (storeMessages[id] || []).map((m) => (m.id === editing.id ? { ...m, text, imageUrls: finalImages } : m)) as any);
      if (localOnes.length > 0) {
        const results = await Promise.all(pendingImages.map((u) => u.startsWith('http') ? Promise.resolve({ url: u, error: null }) : uploadChatImage(u)));
        const urls = results.map((r) => r.url).filter(Boolean) as string[];
        setMessages(id, (useChatStore.getState().messages[id] || []).map((m) => (m.id === editing.id ? { ...m, imageUrls: urls.length ? urls : undefined } : m)) as any);
      }
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
      replyToText: currentReply?.text || (currentReply?.imageUrls && currentReply.imageUrls.length > 0 ? (currentReply.imageUrls.length > 1 ? `${currentReply.imageUrls.length} фото` : 'Фото') : undefined),
      replyToIsOwn: currentReply ? currentReply.senderId === 'current' : undefined,
      replyToImage: currentReply?.imageUrls?.[0],
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
      const { useAuthStore, useEntityStore } = await import('../../src/store');
      const user = useAuthStore.getState().user;
      if (!user) return;

      const { data: myConvs } = await supabase.from('conversation_participants').select('conversation_id').eq('user_id', user.id);
      const { data: theirConvs } = await supabase.from('conversation_participants').select('conversation_id').eq('user_id', participantId);

      let convId: string | null = null;
      if (myConvs && theirConvs) {
        const myIds = new Set(myConvs.map((c: any) => c.conversation_id));
        const shared = theirConvs.find((c: any) => myIds.has(c.conversation_id));
        if (shared) convId = shared.conversation_id;
      }

      if (!convId) {
        const { data: newConv } = await supabase.from('conversations').insert({}).select().single();
        if (newConv) {
          convId = newConv.id;
          await supabase.from('conversation_participants').insert([
            { conversation_id: convId, user_id: user.id },
            { conversation_id: convId, user_id: participantId },
          ]);
        }
      }

      if (convId) {
        // Encode attached images into the stored text with a marker so it round-trips without schema changes
        const imageMarker = uploadedUrls.length > 0 ? `::img::${uploadedUrls.join('|')}::` : '';
        await supabase.from('messages').insert({ conversation_id: convId, sender_id: user.id, text: imageMarker + text });
      }

      const store = useEntityStore.getState();
      const existingConvs = store.conversations;
      if (!existingConvs.find(c => c.participantId === participantId)) {
        store.setConversations([{ id: convId || id || '', participantId: participantId || '', participantName: displayName || 'Чат', participantUsername: '', participantEmoji: displayEmoji }, ...existingConvs]);
      }
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

  // Guard against the freeze caused by rapid long-presses / taps while a menu is
  // opening or closing. A time-lock drops any repeat open within the window, we
  // never open a second menu while one is shown, and we defer the state update
  // out of the gesture callback with requestAnimationFrame so the JS thread is
  // never hit by a burst of synchronous opens.
  const menuLockRef = useRef(0);
  const openMenu = useCallback((m: ChatMessage) => {
    const now = Date.now();
    if (now < menuLockRef.current) return;        // still locked from a recent open/close
    menuLockRef.current = now + 600;               // lock the next 600ms
    requestAnimationFrame(() => {
      setMenuMessage((prev) => (prev ? prev : m));  // never replace an open menu
    });
  }, []);

  const closeMenu = useCallback(() => {
    setMenuMessage(null);
    // Keep the lock through the close animation so a stray long-press during it
    // can't immediately reopen and stack another modal.
    menuLockRef.current = Date.now() + 450;
  }, []);

  const renderItem = useCallback(({ item, index }: { item: ChatMessage; index: number }) => {
    const m = parseMessage(item);
    return (
      <MemoMessageBubble
        message={m}
        isOwn={m.senderId === 'current'}
        fontSize={chatSettings.fontSize}
        bubbleRadius={chatSettings.bubbleRadius}
        fontFamily={chatSettings.fontFamily}
        linkEmoji={chatSettings.linkEmoji}
        highlighted={index === activeMatchIndex}
        onReply={startReply}
        onLongPress={openMenu}
        onSwipeActive={handleSwipeActive}
        onImagePress={openImageViewer}
      />
    );
  }, [chatSettings.fontSize, chatSettings.bubbleRadius, chatSettings.fontFamily, chatSettings.linkEmoji, startReply, handleSwipeActive, openImageViewer, parseMessage, activeMatchIndex, openMenu]);

  const banner = editing || replyTo;
  const menuIsOwn = menuMessage?.senderId === 'current';

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {chatSettings.backgroundImage && (
        <ImageBackground source={{ uri: chatSettings.backgroundImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}

      {/* Messages fill the whole screen; newest at the bottom; scroll behind the input to the very bottom */}
      <FlatList
        ref={flatListRef}
        data={chatMessages}
        style={[StyleSheet.absoluteFill, { opacity: listReady ? 1 : 0 }]}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingTop: headerContentHeight + 8 }}
        ListFooterComponent={<Reanimated.View style={listFooterStyle} />}
        showsVerticalScrollIndicator={false}
        scrollEnabled={scrollEnabled}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        removeClippedSubviews={true}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={9}
        onContentSizeChange={handleContentSizeChange}
        onScrollToIndexFailed={(info) => {
          // Item not measured yet — wait a frame then scroll to the offset estimate
          setTimeout(() => {
            try { flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }); } catch {}
          }, 120);
        }}
      />

      {/* Input bar sticks to the keyboard top; hidden while searching */}
      {!searchMode && (
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Reanimated.View style={[StyleSheet.absoluteFill, backdropStyle]} pointerEvents="none">
          <LinearGradient colors={[bgTransparent, bgColor]} style={StyleSheet.absoluteFill} />
        </Reanimated.View>

        {banner && (
          <View style={{ marginHorizontal: 12, marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.colors.background.elevated, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border.light, paddingHorizontal: 12, paddingVertical: 6 }}>
            <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: theme.colors.accent.primary }} />
            <Feather name={editing ? 'edit-2' : 'corner-up-left'} size={15} color={theme.colors.accent.primary} />
            {banner.imageUrls && banner.imageUrls.length > 0 ? (
              <CachedImage uri={banner.imageUrls[0]} style={{ width: 32, height: 32, borderRadius: 6 }} resizeMode="cover" />
            ) : null}
            <View style={{ flex: 1 }}>
              <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} style={{ fontSize: 12 }}>{editing ? 'Редактирование' : 'Ответ на сообщение'}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 12 }}>{banner.text || (banner.imageUrls && banner.imageUrls.length > 0 ? `📷 ${banner.imageUrls.length > 1 ? banner.imageUrls.length + ' фото' : 'Фото'}` : '')}</Text>
            </View>
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

      {/* Gradient fade header */}
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient colors={[bgColor, bgColor, bgTransparent]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        {searchMode ? (
          <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 20, borderWidth: 1, borderColor: theme.colors.border.light, paddingHorizontal: 14, height: 40 }}>
              <Feather name="search" size={16} color={theme.colors.text.tertiary} />
              <TextInput
                autoFocus
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Поиск по сообщениям..."
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

      {/* Long-press message menu */}
      <MessageContextMenu
        visible={!!menuMessage}
        message={menuMessage}
        isOwn={menuIsOwn}
        bubbleColor={menuIsOwn ? theme.colors.accent.primary : theme.colors.background.tertiary}
        bubbleTextColor={menuIsOwn ? '#FFFFFF' : theme.colors.text.primary}
        bubbleRadius={chatSettings.bubbleRadius}
        linkEmoji={chatSettings.linkEmoji}
        onClose={closeMenu}
        onAction={handleMenuAction}
      />

      {/* GIF picker (GIPHY) */}
      <GiphyPicker visible={gifPickerVisible} onClose={() => setGifPickerVisible(false)} onSelect={sendGif} />

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
