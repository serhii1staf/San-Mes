import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, FlatList, TextInput, Pressable, ViewStyle, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { useChatStore, useEntityStore } from '../../src/store';
import { supabase } from '../../src/lib/supabase';
import { mockMessages, mockConversations, formatMessageTime } from '../../src/utils/mockData';
import { ChatMessage } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';

function MessageBubble({ message, isOwn }: { message: ChatMessage; isOwn: boolean }) {
  const theme = useTheme();
  return (
    <View style={{
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
    }}>
      <Text variant="body" color={isOwn ? '#FFFFFF' : theme.colors.text.primary}>{message.text}</Text>
      <Text variant="caption" color={isOwn ? 'rgba(255,255,255,0.6)' : theme.colors.text.tertiary} style={{ marginTop: 3, alignSelf: 'flex-end', fontSize: 10 }}>
        {formatMessageTime(message.createdAt)}
      </Text>
    </View>
  );
}

export default function ChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id, participantId: paramParticipantId } = useLocalSearchParams<{ id: string; participantId?: string }>();
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const { messages: storeMessages, setMessages, addMessage } = useChatStore();
  const hasScrolled = useRef(false);

  // Try to find conversation in mock data, or load profile from DB
  const conversation = mockConversations.find((c) => c.id === id);
  const [profileData, setProfileData] = useState<any>(null);

  // The actual participant ID: from URL param, from entity store, from mock conversation, or fallback to id
  const entityConversations = useEntityStore((s) => s.conversations);
  const entityConv = entityConversations.find(c => c.id === id);
  const participantId = paramParticipantId || entityConv?.participantId || (conversation as any)?.participantId || id;

  const chatMessages = (storeMessages[id || ''] || []) as ChatMessage[];

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  // Load profile data for chat header if not in mock conversations
  useEffect(() => {
    if (!conversation && participantId) {
      supabase.from('profiles').select('*').eq('id', participantId).single().then(({ data }) => {
        if (data) setProfileData(data);
      });
    }
  }, [participantId, conversation]);

  useEffect(() => {
    if (id && mockMessages[id]) {
      setMessages(id, mockMessages[id]);
    }
  }, [id]);

  // Scroll to end once after initial render
  const scrollToBottom = useCallback(() => {
    if (chatMessages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 50);
    }
  }, [chatMessages.length]);

  useEffect(() => {
    if (!hasScrolled.current && chatMessages.length > 0) {
      hasScrolled.current = true;
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 150);
    }
  }, [chatMessages.length]);

  const handleSend = async () => {
    if (!inputText.trim() || !id) return;
    triggerHaptic('medium');
    const text = inputText.trim();
    setInputText('');

    const newMessage: ChatMessage = {
      id: 'm-' + Date.now(),
      conversationId: id,
      senderId: 'current',
      text,
      createdAt: new Date().toISOString(),
      isRead: true,
    };
    addMessage(id, newMessage);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);

    // Save to Supabase (non-blocking)
    try {
      const { useAuthStore, useEntityStore } = await import('../../src/store');
      const user = useAuthStore.getState().user;
      if (!user) return;

      // Find existing conversation between these two users
      const { data: myConvs } = await supabase.from('conversation_participants').select('conversation_id').eq('user_id', user.id);
      const { data: theirConvs } = await supabase.from('conversation_participants').select('conversation_id').eq('user_id', participantId);

      let convId: string | null = null;
      if (myConvs && theirConvs) {
        const myIds = new Set(myConvs.map((c: any) => c.conversation_id));
        const shared = theirConvs.find((c: any) => myIds.has(c.conversation_id));
        if (shared) convId = shared.conversation_id;
      }

      if (!convId) {
        // Create new conversation
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

      // Update entity store so chat appears in list
      const store = useEntityStore.getState();
      const existingConvs = store.conversations;
      if (!existingConvs.find(c => c.participantId === participantId)) {
        store.setConversations([{ id: convId || id || '', participantId: participantId || '', participantName: displayName || 'Чат', participantUsername: '', participantEmoji: displayEmoji }, ...existingConvs]);
      }
    } catch {}
  };

  // Display name and emoji from conversation or profile
  const displayName = conversation?.participantName || profileData?.display_name || 'Чат';
  const displayEmoji = (conversation as any)?.participantEmoji || profileData?.emoji || '😊';
  const displayVerified = profileData?.is_verified || false;
  const profileId = participantId;

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
          <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors.background.elevated, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: theme.colors.border.light }}>
            <Text variant="caption" weight="semibold">{displayName}</Text>
            {displayVerified && <VerifiedBadge size={11} />}
          </Pressable>
          {/* Avatar right — tap opens profile */}
          <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId } })}>
            <Avatar emoji={displayEmoji} size="sm" />
          </Pressable>
        </View>
      </View>

      {/* Messages + Input */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={flatListRef}
          data={chatMessages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} isOwn={item.senderId === 'current'} />}
          contentContainerStyle={{ paddingTop: headerContentHeight, paddingBottom: 8 }}
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
