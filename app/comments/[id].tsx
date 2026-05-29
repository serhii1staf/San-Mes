import React, { useState, useEffect, useRef } from 'react';
import { View, FlatList, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { FormattedText } from '../../src/components/ui/FormattedText';
import { useAuthStore } from '../../src/store';
import { getComments, createComment } from '../../src/lib/supabase';
import { triggerHaptic } from '../../src/utils/haptics';
import { playSendSound } from '../../src/utils/sounds';

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

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

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
    playSendSound();
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
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {/* Gradient fade header */}
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient colors={[bgColor, bgColor, bgTransparent]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
          <Pressable onPress={() => router.back()}>
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="body" weight="bold">Комментарии</Text>
          <View style={{ width: 24 }} />
        </View>
      </View>

      {/* Comments list */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={theme.colors.accent.primary} />
          </View>
        ) : (
          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerContentHeight, paddingBottom: 20 }}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 40 }}>
                <Text style={{ fontSize: 32 }}>💬</Text>
                <Text variant="body" color={theme.colors.text.tertiary} style={{ marginTop: 8 }}>Пока нет комментариев</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={{ flexDirection: 'row', marginBottom: 16 }}>
                <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: item.profiles?.id || item.author_id } })}>
                  <Avatar emoji={item.profiles?.emoji || '😊'} size="sm" />
                </Pressable>
                <View style={{ marginLeft: 10, flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Text variant="caption" weight="semibold">{item.profiles?.display_name || 'User'}</Text>
                    {item.profiles?.is_verified && <VerifiedBadge size={10} />}
                    {item.profiles?.badge && <UserBadge badge={item.profiles.badge} size="sm" />}
                    <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginLeft: 4 }}>{formatTime(item.created_at)}</Text>
                  </View>
                  <FormattedText style={{ marginTop: 3, fontSize: 14 }}>{item.content}</FormattedText>
                </View>
              </View>
            )}
          />
        )}

        {/* Input area */}
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, paddingTop: 6, backgroundColor: bgColor }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.border.light }}>
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={setText}
                placeholder="Комментарий..."
                placeholderTextColor={theme.colors.text.tertiary}
                style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 80 }}
                multiline
              />
            </View>
            <Pressable onPress={handleSend} disabled={!text.trim() || isSending} style={{ marginLeft: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: text.trim() ? theme.colors.accent.primary : theme.colors.background.elevated, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="send" size={16} color={text.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
});
