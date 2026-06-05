import React, { useState, useRef, useEffect } from 'react';
import { View, FlatList, TextInput, Pressable, Platform, StyleSheet, ImageBackground } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { useChatStore, useEntityStore } from '../../src/store';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY, DEFAULT_CHAT_SETTINGS } from '../../src/store/chatSettingsStore';
import { supabase } from '../../src/lib/supabase';
import { mockMessages, mockConversations, formatMessageTime } from '../../src/utils/mockData';
import { ChatMessage } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';

function MessageBubble({ message, isOwn, fontSize, bubbleRadius, fontFamily }: { message: ChatMessage; isOwn: boolean; fontSize: number; bubbleRadius: number; fontFamily: string }) {
  const theme = useTheme();
  const fontFamilyStyle = fontFamily === 'mono' ? 'monospace' : fontFamily === 'serif' ? 'serif' : undefined;

  return (
    <View style={{
      maxWidth: '75%',
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: bubbleRadius,
      marginBottom: 4,
      backgroundColor: isOwn ? theme.colors.accent.primary : theme.colors.background.tertiary,
      alignSelf: isOwn ? 'flex-end' : 'flex-start',
      marginLeft: isOwn ? 0 : 16,
      marginRight: isOwn ? 16 : 0,
      borderBottomRightRadius: isOwn ? 4 : bubbleRadius,
      borderBottomLeftRadius: isOwn ? bubbleRadius : 4,
    }}>
      <Text variant="body" color={isOwn ? '#FFFFFF' : theme.colors.text.primary} style={{ fontSize, fontFamily: fontFamilyStyle }}>{message.text}</Text>
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

  const conversation = mockConversations.find((c) => c.id === id);
  const [profileData, setProfileData] = useState<any>(null);

  const entityConversations = useEntityStore((s) => s.conversations);
  const entityConv = entityConversations.find(c => c.id === id);
  const participantId = paramParticipantId || entityConv?.participantId || (conversation as any)?.participantId || id;

  const chatMessages = (storeMessages[id || ''] || []) as ChatMessage[];

  // Chat settings — select raw maps and merge with useMemo to avoid creating
  // a new object inside the selector (which would cause an infinite render loop)
  const settingsMap = useChatSettingsStore((s) => s.settings);
  const chatSettings = React.useMemo(() => {
    const global = settingsMap[GLOBAL_CHAT_SETTINGS_KEY];
    const specific = settingsMap[id || ''];
    return { ...DEFAULT_CHAT_SETTINGS, ...global, ...specific };
  }, [settingsMap, id]);

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

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

  const displayName = conversation?.participantName || profileData?.display_name || 'Чат';
  const displayEmoji = (conversation as any)?.participantEmoji || profileData?.emoji || '😊';
  const displayVerified = profileData?.is_verified || false;
  const profileId = participantId;

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

      {/* Messages + Input */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <FlatList
          ref={flatListRef}
          style={{ flex: 1 }}
          data={chatMessages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              isOwn={item.senderId === 'current'}
              fontSize={chatSettings.fontSize}
              bubbleRadius={chatSettings.bubbleRadius}
              fontFamily={chatSettings.fontFamily}
            />
          )}
          contentContainerStyle={{ paddingTop: headerContentHeight + 8, paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        />

        {/* Input bar — normal flex child so messages stay above it; transparent outer bg lets wallpaper show */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8), backgroundColor: 'transparent' }}>
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
            <Feather name="send" size={18} color={inputText.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Gradient fade header — same as main page */}
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient colors={[bgColor, bgColor, bgTransparent]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
          {/* Back button with окантовка */}
          <Pressable onPress={() => router.back()} style={[styles.headerPill, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, width: 36, height: 36, paddingHorizontal: 0, justifyContent: 'center' }]}>
            <Feather name="chevron-left" size={22} color={theme.colors.text.primary} />
          </Pressable>
          {/* Name + avatar with окантовка */}
          <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId } })} style={[styles.headerPill, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, gap: 8 }]}>
            <Avatar emoji={displayEmoji} size="xs" />
            <Text variant="caption" weight="semibold">{displayName}</Text>
            {displayVerified && <VerifiedBadge size={11} />}
          </Pressable>
          {/* Spacer for symmetry */}
          <View style={{ width: 36 }} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  headerPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
});
