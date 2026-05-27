import React, { useState, useEffect, useRef } from 'react';
import { View, FlatList, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { getComments, createComment } from '../../src/lib/supabase';
import { triggerHaptic } from '../../src/utils/haptics';

export default function CommentsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id: postId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    loadComments();
  }, [postId]);

  const loadComments = async () => {
    if (!postId) return;
    setIsLoading(true);
    const { comments: data } = await getComments(postId);
    setComments(data);
    setIsLoading(false);
  };

  const handleSend = async () => {
    if (!text.trim() || !user?.id || !postId) return;
    triggerHaptic('light');
    setIsSending(true);
    const { error } = await createComment(postId, user.id, text.trim());
    if (!error) {
      setText('');
      await loadComments();
    }
    setIsSending(false);
  };

  const formatTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'сейчас';
    if (mins < 60) return `${mins}м`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}ч`;
    return `${Math.floor(hours / 24)}д`;
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.background.primary }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: insets.top + 8, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
        <Pressable onPress={() => router.back()}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="body" weight="semibold" style={{ marginLeft: 12 }}>Комментарии</Text>
      </View>

      {/* Comments list */}
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        </View>
      ) : (
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <View style={{ width: 50, height: 50, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 32 }}>💬</Text>
              </View>
              <Text variant="body" color={theme.colors.text.tertiary} style={{ marginTop: 8 }}>Пока нет комментариев</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={{ flexDirection: 'row', marginBottom: 16 }}>
              <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: item.profiles?.id || item.author_id } })}>
                <Avatar emoji={item.profiles?.emoji || '😊'} size="sm" />
              </Pressable>
              <View style={{ marginLeft: 10, flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text variant="caption" weight="semibold">{item.profiles?.display_name || 'User'}</Text>
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginLeft: 8 }}>{formatTime(item.created_at)}</Text>
                </View>
                <Text variant="body" style={{ marginTop: 2 }}>{item.content}</Text>
              </View>
            </View>
          )}
        />
      )}

      {/* Input */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, paddingBottom: insets.bottom + 10, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light, backgroundColor: theme.colors.background.elevated }}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder="Написать комментарий..."
          placeholderTextColor={theme.colors.text.tertiary}
          style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: theme.colors.background.secondary, borderRadius: 20 }}
          multiline
        />
        <Pressable onPress={handleSend} disabled={!text.trim() || isSending} style={{ marginLeft: 10, opacity: text.trim() ? 1 : 0.4 }}>
          <Feather name="send" size={22} color={theme.colors.accent.primary} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
