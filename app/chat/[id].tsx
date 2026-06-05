import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, FlatList, TextInput, Pressable, Platform, StyleSheet, ImageBackground, Alert, Animated, PanResponder } from 'react-native';
import { KeyboardAvoidingView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle, interpolate, Extrapolation } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { FormattedText } from '../../src/components/ui/FormattedText';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { MessageContextMenu, MessageAction } from '../../src/components/ui/MessageContextMenu';
import { useChatStore, useEntityStore } from '../../src/store';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY, DEFAULT_CHAT_SETTINGS } from '../../src/store/chatSettingsStore';
import { supabase } from '../../src/lib/supabase';
import { mockMessages, mockConversations, formatMessageTime } from '../../src/utils/mockData';
import { showToast } from '../../src/store/toastStore';
import { ChatMessage } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';

const REPLY_THRESHOLD = 60;

function MessageBubble({ message, isOwn, fontSize, bubbleRadius, fontFamily, onReply, onLongPress, onSwipeActive }: { message: ChatMessage; isOwn: boolean; fontSize: number; bubbleRadius: number; fontFamily: string; onReply: (m: ChatMessage) => void; onLongPress: (m: ChatMessage) => void; onSwipeActive: (active: boolean) => void }) {
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
          }}>
            {message.replyToText ? (
              <View style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.accent.primary, marginBottom: 6 }}>
                <Text variant="caption" weight="semibold" color={isOwn ? 'rgba(255,255,255,0.9)' : theme.colors.accent.primary} numberOfLines={1} style={{ fontSize: 11 }}>
                  {message.replyToIsOwn ? 'Вы' : 'Собеседник'}
                </Text>
                <Text variant="caption" color={isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>
                  {message.replyToText}
                </Text>
              </View>
            ) : null}
            <FormattedText color={isOwn ? '#FFFFFF' : theme.colors.text.primary} linkColor={isOwn ? '#FFFFFF' : theme.colors.accent.primary} style={{ fontSize, fontFamily: fontFamilyStyle }}>{message.text}</FormattedText>
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
  const [inputText, setInputText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [menuMessage, setMenuMessage] = useState<ChatMessage | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const { messages: storeMessages, setMessages, addMessage } = useChatStore();
  const flatListRef = useRef<FlatList>(null);

  const { progress } = useReanimatedKeyboardAnimation();

  const conversation = mockConversations.find((c) => c.id === id);
  const [profileData, setProfileData] = useState<any>(null);

  const entityConversations = useEntityStore((s) => s.conversations);
  const entityConv = entityConversations.find(c => c.id === id);
  const participantId = paramParticipantId || entityConv?.participantId || (conversation as any)?.participantId || id;

  const chatMessages = (storeMessages[id || ''] || []) as ChatMessage[];

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

  const cachedProfile = useEntityStore((s) => (participantId ? s.profiles[participantId] : undefined));

  useEffect(() => {
    if (conversation) return;
    if (cachedProfile) { setProfileData(cachedProfile); return; }
    if (participantId) {
      supabase.from('profiles').select('*').eq('id', participantId).single().then(({ data }) => {
        if (data) setProfileData(data);
      }).catch(() => {});
    }
  }, [participantId, conversation, cachedProfile]);

  useEffect(() => {
    if (id && mockMessages[id]) setMessages(id, mockMessages[id]);
  }, [id]);

  const displayName = conversation?.participantName || profileData?.display_name || 'Чат';
  const displayEmoji = (conversation as any)?.participantEmoji || profileData?.emoji || '😊';
  const displayVerified = profileData?.is_verified || false;
  const profileId = participantId;

  const scrollToEnd = useCallback((animated = true) => {
    requestAnimationFrame(() => flatListRef.current?.scrollToEnd({ animated }));
  }, []);

  const startReply = useCallback((message: ChatMessage) => {
    setEditing(null);
    setReplyTo(message);
    triggerHaptic('light');
  }, []);

  const handleMenuAction = useCallback((action: MessageAction, message: ChatMessage) => {
    if (action === 'copy') {
      Clipboard.setStringAsync(message.text);
      showToast('Скопировано', 'check');
    } else if (action === 'reply') {
      startReply(message);
    } else if (action === 'edit') {
      setReplyTo(null);
      setEditing(message);
      setInputText(message.text);
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

  const handleSend = async () => {
    if (!inputText.trim() || !id) return;
    triggerHaptic('medium');
    const text = inputText.trim();
    setInputText('');

    if (editing) {
      setMessages(id, (storeMessages[id] || []).map((m) => (m.id === editing.id ? { ...m, text } : m)) as any);
      setEditing(null);
      return;
    }

    const currentReply = replyTo;
    setReplyTo(null);

    const newMessage: ChatMessage = {
      id: 'm-' + Date.now(),
      conversationId: id,
      senderId: 'current',
      text,
      createdAt: new Date().toISOString(),
      isRead: true,
      replyToId: currentReply?.id,
      replyToText: currentReply?.text,
      replyToIsOwn: currentReply ? currentReply.senderId === 'current' : undefined,
    };
    addMessage(id, newMessage);
    scrollToEnd();

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
        await supabase.from('messages').insert({ conversation_id: convId, sender_id: user.id, text });
      }

      const store = useEntityStore.getState();
      const existingConvs = store.conversations;
      if (!existingConvs.find(c => c.participantId === participantId)) {
        store.setConversations([{ id: convId || id || '', participantId: participantId || '', participantName: displayName || 'Чат', participantUsername: '', participantEmoji: displayEmoji }, ...existingConvs]);
      }
    } catch {}
  };

  const handleSwipeActive = useCallback((active: boolean) => setScrollEnabled(!active), []);

  const renderItem = useCallback(({ item }: { item: ChatMessage }) => (
    <MemoMessageBubble
      message={item}
      isOwn={item.senderId === 'current'}
      fontSize={chatSettings.fontSize}
      bubbleRadius={chatSettings.bubbleRadius}
      fontFamily={chatSettings.fontFamily}
      onReply={startReply}
      onLongPress={setMenuMessage}
      onSwipeActive={handleSwipeActive}
    />
  ), [chatSettings.fontSize, chatSettings.bubbleRadius, chatSettings.fontFamily, startReply, handleSwipeActive]);

  const banner = editing || replyTo;
  const menuIsOwn = menuMessage?.senderId === 'current';

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {chatSettings.backgroundImage && (
        <ImageBackground source={{ uri: chatSettings.backgroundImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        {/* Messages: normal flow, newest at the bottom; scroll always works */}
        <FlatList
          ref={flatListRef}
          data={chatMessages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingTop: headerContentHeight + 8, paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
          scrollEnabled={scrollEnabled}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          removeClippedSubviews={false}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={9}
          onContentSizeChange={() => scrollToEnd(false)}
        />

        {/* Input bar — normal flex child below the list */}
        <View>
          <Reanimated.View style={[StyleSheet.absoluteFill, backdropStyle]} pointerEvents="none">
            <LinearGradient colors={[bgTransparent, bgColor]} style={StyleSheet.absoluteFill} />
          </Reanimated.View>

          {banner && (
            <View style={{ marginHorizontal: 12, marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.colors.background.elevated, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border.light, paddingHorizontal: 12, paddingVertical: 6 }}>
              <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: theme.colors.accent.primary }} />
              <Feather name={editing ? 'edit-2' : 'corner-up-left'} size={15} color={theme.colors.accent.primary} />
              <View style={{ flex: 1 }}>
                <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} style={{ fontSize: 12 }}>{editing ? 'Редактирование' : 'Ответ на сообщение'}</Text>
                <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 12 }}>{banner.text}</Text>
              </View>
              <Pressable onPress={() => { setReplyTo(null); setEditing(null); setInputText(''); }} hitSlop={8}>
                <Feather name="x" size={18} color={theme.colors.text.tertiary} />
              </Pressable>
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, paddingBottom: inputBarBottomPad }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 22, paddingHorizontal: 14, minHeight: 44, borderWidth: 1, borderColor: theme.colors.border.light }}>
              <TextInput
                value={inputText}
                onChangeText={setInputText}
                placeholder="Сообщение..."
                placeholderTextColor={theme.colors.text.tertiary}
                style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 100, paddingVertical: Platform.OS === 'ios' ? 10 : 6 }}
                multiline
              />
            </View>
            <Pressable onPress={handleSend} style={{ marginLeft: 8, width: 44, height: 44, borderRadius: 22, backgroundColor: inputText.trim() ? theme.colors.accent.primary : theme.colors.background.elevated, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name={editing ? 'check' : 'send'} size={18} color={inputText.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Gradient fade header */}
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient colors={[bgColor, bgColor, bgTransparent]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
          <Pressable onPress={() => router.back()} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
            <Feather name="chevron-left" size={22} color={theme.colors.text.primary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId, fromChat: '1' } })} style={[styles.headerPill, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
              <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{displayName}</Text>
              {displayVerified && <VerifiedBadge size={12} />}
            </Pressable>
          </View>
          <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId, fromChat: '1' } })} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, overflow: 'hidden' }]}>
            <Avatar emoji={displayEmoji} name={displayName} size="xs" />
          </Pressable>
        </View>
      </View>

      {/* Long-press message menu */}
      <MessageContextMenu
        visible={!!menuMessage}
        message={menuMessage}
        isOwn={menuIsOwn}
        bubbleColor={menuIsOwn ? theme.colors.accent.primary : theme.colors.background.tertiary}
        bubbleTextColor={menuIsOwn ? '#FFFFFF' : theme.colors.text.primary}
        bubbleRadius={chatSettings.bubbleRadius}
        onClose={() => setMenuMessage(null)}
        onAction={handleMenuAction}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  headerCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  headerPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: 16 },
});
