import React, { useState, useRef, useEffect } from 'react';
import { View, FlatList, TextInput, Pressable, ViewStyle, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { useChatStore } from '../../src/store';
import { mockMessages, mockConversations, formatMessageTime, formatMessageDate } from '../../src/utils/mockData';
import { ChatMessage } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';
import { playSendSound } from '../../src/utils/sounds';

function MessageBubble({ message, isOwn }: { message: ChatMessage; isOwn: boolean }) {
  const theme = useTheme();
  const bubbleStyle: ViewStyle = {
    maxWidth: '75%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    marginBottom: 4,
    backgroundColor: isOwn ? theme.colors.accent.primary : theme.colors.background.tertiary,
    alignSelf: isOwn ? 'flex-end' : 'flex-start',
    marginLeft: isOwn ? 0 : 16,
    marginRight: isOwn ? 16 : 0,
    borderBottomRightRadius: isOwn ? 4 : 18,
    borderBottomLeftRadius: isOwn ? 18 : 4,
  };

  return (
    <View style={bubbleStyle}>
      <Text variant="body" color={isOwn ? '#FFFFFF' : theme.colors.text.primary}>{message.text}</Text>
      <Text variant="caption" color={isOwn ? 'rgba(255,255,255,0.6)' : theme.colors.text.tertiary} style={{ marginTop: 3, alignSelf: 'flex-end', fontSize: 10 }}>
        {formatMessageTime(message.createdAt)}
      </Text>
    </View>
  );
}

function DateSeparator({ date }: { date: string }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', marginVertical: 12 }}>
      <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: theme.colors.background.tertiary }}>
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10 }}>{date}</Text>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [inputText, setInputText] = useState('');
  const [showTyping, setShowTyping] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const { messages: storeMessages, setMessages, addMessage } = useChatStore();

  const conversation = mockConversations.find((c) => c.id === id);
  const chatMessages = (storeMessages[id || ''] || []) as ChatMessage[];

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  useEffect(() => {
    if (id && mockMessages[id]) {
      setMessages(id, mockMessages[id]);
    }
  }, [id]);

  const handleSend = () => {
    if (!inputText.trim() || !id) return;
    playSendSound();
    const newMessage: ChatMessage = {
      id: 'm-' + Date.now(),
      conversationId: id,
      senderId: 'current',
      text: inputText.trim(),
      createdAt: new Date().toISOString(),
      isRead: true,
    };
    addMessage(id, newMessage);
    setInputText('');
    setShowTyping(true);
    setTimeout(() => setShowTyping(false), 2000);
  };

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {/* Gradient fade header */}
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient colors={[bgColor, bgColor, bgTransparent]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
          <Pressable onPress={() => router.back()}>
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          {/* Name centered in rounded container */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors.background.elevated, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: theme.colors.border.light }}>
            <Text variant="caption" weight="semibold">{conversation?.participantName || 'Чат'}</Text>
            {(conversation as any)?.isVerified && <VerifiedBadge size={11} />}
          </View>
          {/* Avatar right */}
          <Pressable onPress={() => { if (conversation) router.push({ pathname: '/profile/[id]', params: { id: conversation.participantId || '' } }); }}>
            <Avatar emoji={(conversation as any)?.participantEmoji || '😊'} size="sm" />
          </Pressable>
        </View>
      </View>

      {/* Messages + Input */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={flatListRef}
          data={chatMessages}
          keyExtractor={(item) => item.id}
          inverted
          renderItem={({ item }) => <MessageBubble message={item} isOwn={item.senderId === 'current'} />}
          contentContainerStyle={{ paddingHorizontal: 0, paddingTop: 8 }}
          showsVerticalScrollIndicator={false}
        />

        {/* Input */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, paddingTop: 6, backgroundColor: bgColor }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.border.light }}>
            <TextInput
              value={inputText}
              onChangeText={setInputText}
              placeholder="Сообщение..."
              placeholderTextColor={theme.colors.text.tertiary}
              style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 80 }}
              multiline
            />
          </View>
          <Pressable onPress={handleSend} style={{ marginLeft: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: inputText.trim() ? theme.colors.accent.primary : theme.colors.background.elevated, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="send" size={16} color={inputText.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
});
