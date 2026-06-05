import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, FlatList, TextInput, Pressable, Platform, StyleSheet, ImageBackground, Alert, Animated, PanResponder } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle, interpolate, Extrapolation } from 'react-native-reanimated';
import ContextMenu from 'react-native-context-menu-view';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { FormattedText } from '../../src/components/ui/FormattedText';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { useChatStore, useEntityStore } from '../../src/store';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY, DEFAULT_CHAT_SETTINGS } from '../../src/store/chatSettingsStore';
import { supabase } from '../../src/lib/supabase';
import { mockMessages, mockConversations, formatMessageTime } from '../../src/utils/mockData';
import { showToast } from '../../src/store/toastStore';
import { ChatMessage } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';

const REPLY_THRESHOLD = 56;

function MessageBubble({ message, isOwn, fontSize, bubbleRadius, fontFamily, onAction }: { message: ChatMessage; isOwn: boolean; fontSize: number; bubbleRadius: number; fontFamily: string; onAction: (action: string, message: ChatMessage) => void }) {
  const theme = useTheme();
  const fontFamilyStyle = fontFamily === 'mono' ? 'monospace' : fontFamily === 'serif' ? 'serif' : undefined;
  const translateX = useRef(new Animated.Value(0)).current;
  const triggered = useRef(false);

  const actions = isOwn
    ? [
        { title: 'Ответить', systemIcon: 'arrowshape.turn.up.left' },
        { title: 'Копировать', systemIcon: 'doc.on.doc' },
        { title: 'Редактировать', systemIcon: 'pencil' },
        { title: 'Удалить', destructive: true, systemIcon: 'trash' },
      ]
    : [
        { title: 'Ответить', systemIcon: 'arrowshape.turn.up.left' },
        { title: 'Копировать', systemIcon: 'doc.on.doc' },
      ];

  const handlePress = (e: any) => {
    onAction(e.nativeEvent.name as string, message);
  };

  // Swipe-left to reply
  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dx < -10 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderMove: (_, g) => {
      const dx = Math.max(g.dx, -90);
      if (dx < 0) {
        translateX.setValue(dx);
        if (!triggered.current && dx <= -REPLY_THRESHOLD) {
          triggered.current = true;
          triggerHaptic('light');
        }
      }
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx <= -REPLY_THRESHOLD) onAction('Ответить', message);
      triggered.current = false;
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 140, friction: 12 }).start();
    },
    onPanResponderTerminate: () => {
      triggered.current = false;
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 140, friction: 12 }).start();
    },
  })).current;

  const replyIconOpacity = translateX.interpolate({ inputRange: [-REPLY_THRESHOLD, -20, 0], outputRange: [1, 0, 0], extrapolate: 'clamp' });

  return (
    <View style={{ justifyContent: 'center' }}>
      {/* Reply hint icon revealed on swipe */}
      <Animated.View style={{ position: 'absolute', right: 16, opacity: replyIconOpacity }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.accent.primary + '20', alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="corner-up-left" size={16} color={theme.colors.accent.primary} />
        </View>
      </Animated.View>

      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <ContextMenu
          actions={actions}
          onPress={handlePress}
          previewBackgroundColor="transparent"
          style={{ alignSelf: isOwn ? 'flex-end' : 'flex-start', maxWidth: '78%', marginLeft: isOwn ? 0 : 16, marginRight: isOwn ? 16 : 0, marginBottom: 4 }}
        >
          <View style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: bubbleRadius,
            backgroundColor: isOwn ? theme.colors.accent.primary : theme.colors.background.tertiary,
            borderBottomRightRadius: isOwn ? 4 : bubbleRadius,
            borderBottomLeftRadius: isOwn ? bubbleRadius : 4,
          }}>
            <FormattedText color={isOwn ? '#FFFFFF' : theme.colors.text.primary} style={{ fontSize, fontFamily: fontFamilyStyle }}>{message.text}</FormattedText>
            <Text variant="caption" color={isOwn ? 'rgba(255,255,255,0.6)' : theme.colors.text.tertiary} style={{ marginTop: 3, alignSelf: 'flex-end', fontSize: 10 }}>
              {formatMessageTime(message.createdAt)}
            </Text>
          </View>
        </ContextMenu>
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
  const { messages: storeMessages, setMessages, addMessage } = useChatStore();
  const flatListRef = useRef<FlatList>(null);

  // Keyboard animation progress on the UI thread (0 closed → 1 open), no React re-renders
  const { progress } = useReanimatedKeyboardAnimation();

  const conversation = mockConversations.find((c) => c.id === id);
  const [profileData, setProfileData] = useState<any>(null);

  const entityConversations = useEntityStore((s) => s.conversations);
  const entityConv = entityConversations.find(c => c.id === id);
  const participantId = paramParticipantId || entityConv?.participantId || (conversation as any)?.participantId || id;

  const chatMessages = (storeMessages[id || ''] || []) as ChatMessage[];

  // Chat settings — select raw map, merge with useMemo (avoid new object in selector → infinite loop)
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

  // Gradient backdrop under the input fades out as the keyboard opens (UI thread, no re-render)
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0], Extrapolation.CLAMP),
  }));

  // Prefer cached profile data from entityStore (works offline); only hit network as fallback
  const cachedProfile = useEntityStore((s) => (participantId ? s.profiles[participantId] : undefined));

  useEffect(() => {
    if (conversation) return;
    if (cachedProfile) {
      setProfileData(cachedProfile);
      return;
    }
    if (participantId) {
      supabase.from('profiles').select('*').eq('id', participantId).single().then(({ data }) => {
        if (data) setProfileData(data);
      }).catch(() => {});
    }
  }, [participantId, conversation, cachedProfile]);

  useEffect(() => {
    if (id && mockMessages[id]) {
      setMessages(id, mockMessages[id]);
    }
  }, [id]);

  const displayName = conversation?.participantName || profileData?.display_name || 'Чат';
  const displayEmoji = (conversation as any)?.participantEmoji || profileData?.emoji || '😊';
  const displayVerified = profileData?.is_verified || false;
  const profileId = participantId;

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => flatListRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const handleMessageAction = useCallback((action: string, message: ChatMessage) => {
    if (action === 'Копировать') {
      Clipboard.setStringAsync(message.text);
      triggerHaptic('light');
      showToast('Скопировано', 'check');
    } else if (action === 'Ответить') {
      setEditing(null);
      setReplyTo(message);
      triggerHaptic('light');
    } else if (action === 'Редактировать') {
      setReplyTo(null);
      setEditing(message);
      setInputText(message.text);
      triggerHaptic('light');
    } else if (action === 'Удалить') {
      Alert.alert('Удалить сообщение?', '', [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить', style: 'destructive', onPress: () => {
            if (!id) return;
            const next = (storeMessages[id] || []).filter((m) => m.id !== message.id);
            setMessages(id, next as any);
            triggerHaptic('medium');
          },
        },
      ]);
    }
  }, [id, storeMessages, setMessages]);

  const handleSend = async () => {
    if (!inputText.trim() || !id) return;
    triggerHaptic('medium');
    const text = inputText.trim();
    setInputText('');

    // Editing an existing message — replace its text
    if (editing) {
      const next = (storeMessages[id] || []).map((m) => (m.id === editing.id ? { ...m, text } : m));
      setMessages(id, next as any);
      setEditing(null);
      return;
    }

    const replyPrefix = replyTo ? `↩︎ ${replyTo.text.slice(0, 40)}\n` : '';
    setReplyTo(null);

    const newMessage: ChatMessage = {
      id: 'm-' + Date.now(),
      conversationId: id,
      senderId: 'current',
      text: replyPrefix + text,
      createdAt: new Date().toISOString(),
      isRead: true,
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
        await supabase.from('messages').insert({ conversation_id: convId, sender_id: user.id, text: newMessage.text });
      }

      const store = useEntityStore.getState();
      const existingConvs = store.conversations;
      if (!existingConvs.find(c => c.participantId === participantId)) {
        store.setConversations([{ id: convId || id || '', participantId: participantId || '', participantName: displayName || 'Чат', participantUsername: '', participantEmoji: displayEmoji }, ...existingConvs]);
      }
    } catch {}
  };

  const renderItem = useCallback(({ item }: { item: ChatMessage }) => (
    <MemoMessageBubble
      message={item}
      isOwn={item.senderId === 'current'}
      fontSize={chatSettings.fontSize}
      bubbleRadius={chatSettings.bubbleRadius}
      fontFamily={chatSettings.fontFamily}
      onAction={handleMessageAction}
    />
  ), [chatSettings.fontSize, chatSettings.bubbleRadius, chatSettings.fontFamily, handleMessageAction]);

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {/* Background image covers the ENTIRE screen, behind everything */}
      {chatSettings.backgroundImage && (
        <ImageBackground
          source={{ uri: chatSettings.backgroundImage }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      )}

      {/* Messages in natural top→down order, pinned to the bottom; scroll behind the input */}
      <FlatList
        ref={flatListRef}
        data={chatMessages}
        style={StyleSheet.absoluteFill}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingTop: headerContentHeight + 8, paddingBottom: inputBarBottomPad + 60 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        removeClippedSubviews={false}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={9}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
      />

      {/* Input bar — sticks to the keyboard with no gap (UI thread) */}
      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom + 8 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Reanimated.View style={[StyleSheet.absoluteFill, backdropStyle]} pointerEvents="none">
          <LinearGradient colors={[bgTransparent, bgColor]} style={StyleSheet.absoluteFill} />
        </Reanimated.View>

        {/* Reply / edit banner — inside an elevated container pill */}
        {(replyTo || editing) && (
          <View style={{ marginHorizontal: 12, marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.colors.background.elevated, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border.light, paddingHorizontal: 12, paddingVertical: 8 }}>
            <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: theme.colors.accent.primary }} />
            <Feather name={editing ? 'edit-2' : 'corner-up-left'} size={16} color={theme.colors.accent.primary} />
            <View style={{ flex: 1 }}>
              <Text variant="caption" weight="semibold" color={theme.colors.accent.primary}>{editing ? 'Редактирование' : 'Ответ'}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>{(editing || replyTo)?.text}</Text>
            </View>
            <Pressable onPress={() => { setReplyTo(null); setEditing(null); setInputText(''); }} hitSlop={8}>
              <Feather name="x" size={18} color={theme.colors.text.tertiary} />
            </Pressable>
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 10, paddingBottom: inputBarBottomPad }}>
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
      </KeyboardStickyView>

      {/* Gradient fade header — same as main page */}
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient colors={[bgColor, bgColor, bgTransparent]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
          {/* Back button (left) */}
          <Pressable onPress={() => router.back()} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
            <Feather name="chevron-left" size={22} color={theme.colors.text.primary} />
          </Pressable>
          {/* Name (center) inside a compact pill container */}
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId, fromChat: '1' } })} style={[styles.headerPill, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
              <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{displayName}</Text>
              {displayVerified && <VerifiedBadge size={12} />}
            </Pressable>
          </View>
          {/* Avatar (right) inside a circle container */}
          <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId, fromChat: '1' } })} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, overflow: 'hidden' }]}>
            <Avatar emoji={displayEmoji} name={displayName} size="xs" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  headerCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  headerPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: 16 },
});
