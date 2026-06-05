import React, { useState, useEffect, useRef } from 'react';
import { View, FlatList, TextInput, Pressable, Platform, ActivityIndicator, StyleSheet, Text as RNText } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { FormattedText } from '../../src/components/ui/FormattedText';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { useAuthStore, useConnectivityStore } from '../../src/store';
import { getComments, createComment, isRepost, parseImageUrls } from '../../src/lib/supabase';
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
  const [postData, setPostData] = useState<any>(null);
  const [repostOriginal, setRepostOriginal] = useState<any>(null);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList>(null);

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  useEffect(() => {
    loadComments();
    // Load post from entity store (cached) — no network request needed
    if (postId) {
      const { useEntityStore } = require('../../src/store');
      const cached = useEntityStore.getState().posts[postId];
      if (cached) {
        // Get author profile from store
        const profile = useEntityStore.getState().profiles[cached.author_id];
        setPostData({ ...cached, profiles: profile || null });
      } else {
        loadPost();
      }
    }
  }, [postId]);

  const loadPost = async () => {
    if (!postId) return;
    const { supabase } = await import('../../src/lib/supabase');
    const { data } = await supabase.from('posts').select('*, profiles:author_id (id, display_name, username, emoji, badge, is_verified)').eq('id', postId).single();
    if (data) setPostData(data);
  };

  const loadComments = async () => {
    if (!postId) return;
    setIsLoading(true);
    const { comments: data } = await getComments(postId);
    setComments(data);
    setIsLoading(false);
    // Scroll to last comment
    if (data.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 150);
    }
  };

  // If this post is a repost, resolve the original post (with author) to render a proper preview
  useEffect(() => {
    if (!postData?.content) { setRepostOriginal(null); return; }
    const info = isRepost(postData.content);
    if (!info.isRepost || !info.originalPostId) { setRepostOriginal(null); return; }
    let cancelled = false;
    (async () => {
      const { useEntityStore } = require('../../src/store');
      const cachedOrig = useEntityStore.getState().posts[info.originalPostId!];
      if (cachedOrig) {
        const prof = useEntityStore.getState().profiles[cachedOrig.author_id];
        if (!cancelled) setRepostOriginal({ ...cachedOrig, profiles: prof || null });
        return;
      }
      // Don't hit the network when offline
      if (!useConnectivityStore.getState().isOnline) return;
      const { supabase } = await import('../../src/lib/supabase');
      const { data } = await supabase.from('posts').select('*, profiles:author_id (id, display_name, username, emoji, badge, is_verified)').eq('id', info.originalPostId).single();
      if (!cancelled && data) setRepostOriginal(data);
    })();
    return () => { cancelled = true; };
  }, [postData?.content]);

  const handleSend = async () => {
    if (!text.trim() || !user?.id || !postId) return;
    playSendSound();
    const sendText = text.trim();
    setText('');
    setIsSending(true);
    const { error } = await createComment(postId, user.id, sendText);
    if (!error) {
      const { comments: data } = await getComments(postId);
      setComments(data);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
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
            ref={listRef}
            data={comments}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerContentHeight, paddingBottom: 20 }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={postData ? (() => {
              const repostInfo = isRepost(postData.content || '');
              const repostComment = repostInfo.isRepost ? (repostInfo.comment || '') : '';
              const mainContent = repostInfo.isRepost ? repostComment : (postData.content || '');
              const origProfile = repostOriginal ? (Array.isArray(repostOriginal.profiles) ? repostOriginal.profiles[0] : repostOriginal.profiles) : null;
              const origImages = repostOriginal ? parseImageUrls(repostOriginal.image_url) : [];
              return (
              <View style={{ marginBottom: 16, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
                {repostInfo.isRepost && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                    <Feather name="repeat" size={12} color={theme.colors.text.tertiary} />
                    <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ flexShrink: 1 }}>{postData.profiles?.display_name || 'User'} сделал(а) репост</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <Avatar emoji={postData.profiles?.emoji || '😊'} size="sm" />
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <Text variant="body" weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>{postData.profiles?.display_name || 'User'}</Text>
                      {postData.profiles?.is_verified && <VerifiedBadge size={12} />}
                      {postData.profiles?.badge && <UserBadge badge={postData.profiles.badge} size="sm" />}
                    </View>
                    <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>@{postData.profiles?.username}</Text>
                  </View>
                </View>
                {mainContent ? <FormattedText style={{ fontSize: 15, lineHeight: 21, marginBottom: 8 }}>{mainContent}</FormattedText> : null}
                {!repostInfo.isRepost && postData.image_url && <CachedImage uri={postData.image_url.split(',')[0]} style={{ width: '100%', height: 200, borderRadius: 12, marginBottom: 8 }} resizeMode="cover" />}

                {/* Repost — embedded original post preview */}
                {repostInfo.isRepost && (
                  repostOriginal ? (
                    <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: origProfile?.id || repostOriginal.author_id } })} style={{ borderWidth: 1, borderColor: theme.colors.border.light, borderRadius: 14, padding: 10, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                        <Avatar emoji={origProfile?.emoji || '😊'} size="xs" />
                        <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{origProfile?.display_name || 'User'}</Text>
                        {origProfile?.is_verified && <VerifiedBadge size={10} />}
                        {origProfile?.badge && <UserBadge badge={origProfile.badge} size="sm" />}
                        {origProfile?.username ? <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11, flexShrink: 0 }}>@{origProfile.username}</Text> : null}
                      </View>
                      {repostOriginal.content ? <FormattedText style={{ fontSize: 13 }} color={theme.colors.text.secondary}>{repostOriginal.content}</FormattedText> : null}
                      {origImages.length > 0 && <CachedImage uri={origImages[0]} style={{ width: '100%', height: 160, borderRadius: 10, marginTop: 6 }} resizeMode="cover" />}
                    </Pressable>
                  ) : (
                    <View style={{ borderWidth: 1, borderColor: theme.colors.border.light, borderRadius: 14, padding: 14, alignItems: 'center' }}>
                      <ActivityIndicator size="small" color={theme.colors.accent.primary} />
                    </View>
                  )
                )}
              </View>
              );
            })() : null}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 40 }}>
                <RNText style={{ fontSize: 32 }} allowFontScaling={false}>💬</RNText>
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
                    <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{item.profiles?.display_name || 'User'}</Text>
                    {item.profiles?.is_verified && <VerifiedBadge size={10} />}
                    {item.profiles?.badge && <UserBadge badge={item.profiles.badge} size="sm" />}
                    <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ marginLeft: 4, flexShrink: 0 }}>{formatTime(item.created_at)}</Text>
                  </View>
                  <FormattedText style={{ marginTop: 3, fontSize: 14 }}>{item.content}</FormattedText>
                </View>
              </View>
            )}
          />
        )}

        {/* Input area — clean pill, no outer container */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14, paddingTop: 8, backgroundColor: bgColor }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: theme.colors.border.light }}>
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
          <Pressable onPress={handleSend} disabled={!text.trim() || isSending} style={{ marginLeft: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: text.trim() ? theme.colors.accent.primary : theme.colors.background.elevated, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="send" size={16} color={text.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
});
