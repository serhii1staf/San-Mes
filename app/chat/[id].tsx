import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  FlatList,
  TextInput,
  Pressable,
  ViewStyle,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Animated, { FadeInUp, FadeIn } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useChatStore } from '../../src/store';
import { mockMessages, mockConversations, formatMessageTime, formatMessageDate } from '../../src/utils/mockData';
import { ChatMessage } from '../../src/types';

function TypingIndicator() {
  const theme = useTheme();
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: theme.spacing.base,
        paddingVertical: theme.spacing.sm,
        backgroundColor: theme.colors.background.tertiary,
        borderRadius: theme.borderRadius.lg,
        alignSelf: 'flex-start',
        marginLeft: theme.spacing.base,
        marginBottom: theme.spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: theme.colors.text.tertiary,
            }}
          />
        ))}
      </View>
    </Animated.View>
  );
}

function MessageBubble({ message, isOwn }: { message: ChatMessage; isOwn: boolean }) {
  const theme = useTheme();

  const bubbleStyle: ViewStyle = {
    maxWidth: '75%',
    paddingHorizontal: theme.spacing.base,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing.xs,
    backgroundColor: isOwn ? theme.colors.accent.primary : theme.colors.background.tertiary,
    alignSelf: isOwn ? 'flex-end' : 'flex-start',
    marginLeft: isOwn ? 0 : theme.spacing.base,
    marginRight: isOwn ? theme.spacing.base : 0,
    borderBottomRightRadius: isOwn ? 4 : theme.borderRadius.lg,
    borderBottomLeftRadius: isOwn ? theme.borderRadius.lg : 4,
  };

  return (
    <Animated.View entering={FadeInUp.duration(200)}>
      <View style={bubbleStyle}>
        <Text
          variant="body"
          color={isOwn ? theme.colors.text.inverse : theme.colors.text.primary}
        >
          {message.text}
        </Text>
        <Text
          variant="caption"
          color={isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.text.tertiary}
          style={{ marginTop: 4, alignSelf: 'flex-end' }}
        >
          {formatMessageTime(message.createdAt)}
        </Text>
      </View>
    </Animated.View>
  );
}

function DateSeparator({ date }: { date: string }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', marginVertical: theme.spacing.base }}>
      <View
        style={{
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
          borderRadius: theme.borderRadius.pill,
          backgroundColor: theme.colors.background.tertiary,
        }}
      >
        <Text variant="caption" color={theme.colors.text.tertiary}>{date}</Text>
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

  useEffect(() => {
    if (id && mockMessages[id]) {
      setMessages(id, mockMessages[id]);
    }
  }, [id]);

  const handleSend = () => {
    if (!inputText.trim() || !id) return;
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

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const headerStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.base,
    paddingTop: insets.top,
    paddingBottom: theme.spacing.md,
    backgroundColor: theme.colors.background.elevated,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border.light,
  };

  const inputBarStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.base,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.background.elevated,
    borderTopWidth: 0.5,
    borderTopColor: theme.colors.border.light,
    paddingBottom: Platform.OS === 'ios' ? theme.spacing.lg : theme.spacing.sm,
  };

  return (
    <KeyboardAvoidingView
      style={containerStyle}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={headerStyle}>
        <Pressable onPress={() => router.back()} style={{ marginRight: theme.spacing.md }}>
          <Feather name="arrow-left" size={22} color={theme.colors.text.primary} />
        </Pressable>
        <Avatar source={conversation?.participantAvatar} name={conversation?.participantName} size="sm" />
        <View style={{ marginLeft: theme.spacing.md, flex: 1 }}>
          <Text variant="body" weight="semibold">{conversation?.participantName || 'Chat'}</Text>
          {conversation?.isOnline && (
            <Text variant="caption" color={theme.colors.status.success}>Online</Text>
          )}
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={chatMessages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MessageBubble message={item} isOwn={item.senderId === 'current'} />
        )}
        ListHeaderComponent={<DateSeparator date={formatMessageDate(chatMessages[0]?.createdAt || new Date().toISOString())} />}
        ListFooterComponent={showTyping ? <TypingIndicator /> : null}
        contentContainerStyle={{ paddingVertical: theme.spacing.base }}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Input Bar */}
      <View style={inputBarStyle}>
        <Pressable style={{ marginRight: theme.spacing.sm }}>
          <Feather name="plus-circle" size={22} color={theme.colors.text.tertiary} />
        </Pressable>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: theme.colors.background.tertiary,
            borderRadius: theme.borderRadius.pill,
            paddingHorizontal: theme.spacing.base,
            paddingVertical: theme.spacing.sm,
          }}
        >
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message..."
            placeholderTextColor={theme.colors.text.tertiary}
            style={{
              flex: 1,
              fontSize: theme.typography.sizes.base,
              fontFamily: theme.fontFamily.regular,
              color: theme.colors.text.primary,
              paddingVertical: 2,
            }}
          />
        </View>
        <Pressable
          onPress={handleSend}
          style={{
            marginLeft: theme.spacing.sm,
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: inputText.trim() ? theme.colors.accent.primary : theme.colors.border.light,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="send" size={16} color={theme.colors.text.inverse} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
