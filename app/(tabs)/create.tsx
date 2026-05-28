import React, { useState, useEffect } from 'react';
import { View, TextInput, Pressable, ViewStyle, ScrollView, Alert, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store/authStore';
import { useFeedStore } from '../../src/store/feedStore';
import { useConnectivityStore } from '../../src/store';
import { createRepost, createPost, supabase, uploadPostImage, joinImageUrls } from '../../src/lib/supabase';
import { queueMutation, generateTempId } from '../../src/services/offlineQueue';
import { useEntityStore } from '../../src/services/entityStore';

const MAX_CHARS = 500;
const MAX_IMAGES = 6;

type Audience = 'public' | 'friends';

export default function CreateScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { pendingRepostId, setPendingRepost, editingPost, setEditingPost } = useFeedStore();
  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [audience, setAudience] = useState<Audience>('public');
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [imageUploading, setImageUploading] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [repostData, setRepostData] = useState<{ id: string; authorName: string; authorEmoji: string; content: string; imageUrl?: string } | null>(null);

  // Load editing post data
  useEffect(() => {
    if (editingPost) {
      setContent(editingPost.content || '');
      setEditingPostId(editingPost.id);
      if (editingPost.imageUrl) {
        setImageUris([editingPost.imageUrl]);
      } else if (editingPost.imageUrls && editingPost.imageUrls.length > 0) {
        setImageUris(editingPost.imageUrls);
      }
      setEditingPost(null);
    }
  }, [editingPost]);

  // Load repost data from store
  useEffect(() => {
    if (pendingRepostId) {
      supabase.from('posts').select('*, profiles:author_id (display_name, emoji)').eq('id', pendingRepostId).single().then(({ data }) => {
        if (data) {
          setRepostData({
            id: data.id,
            authorName: (Array.isArray(data.profiles) ? data.profiles[0]?.display_name : data.profiles?.display_name) || 'User',
            authorEmoji: (Array.isArray(data.profiles) ? data.profiles[0]?.emoji : data.profiles?.emoji) || '😊',
            content: data.content || '',
            imageUrl: data.image_url || undefined,
          });
        }
        setPendingRepost(null);
      });
    }
  }, [pendingRepostId]);

  const pickImages = async () => {
    if (imageUris.length >= MAX_IMAGES) {
      Alert.alert('Лимит', `Максимум ${MAX_IMAGES} изображений`);
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Доступ', 'Нужен доступ к галерее для выбора изображения');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES - imageUris.length,
      quality: 0.8,
    });

    if (!result.canceled && result.assets.length > 0) {
      const newUris = result.assets.map(a => a.uri);
      setImageUris(prev => [...prev, ...newUris].slice(0, MAX_IMAGES));
    }
  };

  const takePhoto = async () => {
    if (imageUris.length >= MAX_IMAGES) {
      Alert.alert('Лимит', `Максимум ${MAX_IMAGES} изображений`);
      return;
    }

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Доступ', 'Нужен доступ к камере');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUris(prev => [...prev, result.assets[0].uri].slice(0, MAX_IMAGES));
    }
  };

  const uploadImage = async (uri: string): Promise<string | null> => {
    try {
      const { url, error } = await uploadPostImage(uri);
      if (error) {
        console.log('Upload error:', error);
        return null;
      }
      return url;
    } catch (e) {
      console.log('Upload failed:', e);
      return null;
    }
  };

  const handlePost = async () => {
    if (!content.trim() && imageUris.length === 0 && !repostData) return;
    if (!user) {
      Alert.alert('Ошибка', 'Необходимо войти в аккаунт');
      return;
    }

    setIsPosting(true);
    try {
      // Handle repost (keep as-is)
      if (repostData) {
        const { post, error } = await createRepost(user.id, repostData.id, content.trim() || undefined);
        if (error) {
          Alert.alert('Ошибка', error);
        } else {
          setContent('');
          setImageUris([]);
          setRepostData(null);
        }
        setIsPosting(false);
        return;
      }

      const { isOnline } = useConnectivityStore.getState();
      const tempId = generateTempId();
      const postContent = content.trim() || '';

      if (isOnline) {
        // Online: try direct API call with image upload
        try {
          let imageUrl: string | undefined;

          if (imageUris.length > 0) {
            setImageUploading(true);
            const uploadedUrls: string[] = [];
            for (const uri of imageUris) {
              const uploadedUrl = await uploadImage(uri);
              if (uploadedUrl) {
                uploadedUrls.push(uploadedUrl);
              }
            }
            setImageUploading(false);
            if (uploadedUrls.length > 0) {
              imageUrl = joinImageUrls(uploadedUrls);
            }
          }

          const { post, error } = await createPost(user.id, postContent, imageUrl);
          if (!error && post) {
            // Success — update entity store with server data
            const store = useEntityStore.getState();
            store.upsertPost({
              id: post.id,
              author_id: post.author_id,
              content: post.content,
              image_url: post.image_url,
              likes_count: post.likes_count,
              comments_count: post.comments_count,
              shares_count: post.shares_count,
              created_at: post.created_at,
              status: 'synced',
            });
            store.setFeedIds([post.id, ...store.feedIds]);
            store.setMyPostIds([post.id, ...store.myPostIds]);

            setContent('');
            setImageUris([]);
            router.replace('/(tabs)');
            return;
          }

          // API call failed — fall back to queue silently
          await queueMutation('create_post', {
            tempId,
            authorId: user.id,
            content: postContent,
            imageUris: imageUris.length > 0 ? [...imageUris] : [],
          });

          setContent('');
          setImageUris([]);
          router.replace('/(tabs)');
        } catch (e) {
          // Network error — fall back to queue silently
          setImageUploading(false);
          await queueMutation('create_post', {
            tempId,
            authorId: user.id,
            content: postContent,
            imageUris: imageUris.length > 0 ? [...imageUris] : [],
          });

          setContent('');
          setImageUris([]);
          router.replace('/(tabs)');
        }
      } else {
        // Offline: queue mutation with local image URIs
        await queueMutation('create_post', {
          tempId,
          authorId: user.id,
          content: postContent,
          imageUris: imageUris.length > 0 ? [...imageUris] : [],
        });

        setContent('');
        setImageUris([]);
        router.replace('/(tabs)');
      }
    } finally {
      setIsPosting(false);
      setImageUploading(false);
    }
  };

  const removeImage = (index: number) => {
    setImageUris(prev => prev.filter((_, i) => i !== index));
  };

  const charsRemaining = MAX_CHARS - content.length;
  const charColor = charsRemaining < 50
    ? theme.colors.status.error
    : charsRemaining < 100
      ? theme.colors.status.warning
      : theme.colors.text.tertiary;

  const canPost = content.trim() || imageUris.length > 0 || repostData;

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
    paddingTop: insets.top,
  };

  return (
    <ScrollView style={containerStyle} contentContainerStyle={{ paddingBottom: 100 }}>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.base }}>
        <View>
          <Text variant="subheading" weight="bold" style={{ marginBottom: theme.spacing.lg }}>
            {repostData ? 'Репост' : editingPostId ? 'Редактировать' : 'Новый пост'}
          </Text>
        </View>

        {/* Repost preview */}
        {repostData && (
          <View style={{ marginBottom: theme.spacing.base, borderWidth: 1, borderColor: theme.colors.border.light, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
              <Avatar emoji={repostData.authorEmoji} size="xs" />
              <Text variant="caption" weight="semibold" style={{ marginLeft: 8 }}>{repostData.authorName}</Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => setRepostData(null)}>
                <Feather name="x" size={16} color={theme.colors.text.tertiary} />
              </Pressable>
            </View>
            {repostData.content && <Text variant="body" numberOfLines={3} style={{ paddingHorizontal: 12, paddingBottom: 12 }}>{repostData.content}</Text>}
            {repostData.imageUrl && <Image source={{ uri: repostData.imageUrl }} style={{ width: '100%', height: 120 }} resizeMode="cover" />}
          </View>
        )}

        <View>
          <View
            style={{
              backgroundColor: theme.colors.background.elevated,
              borderRadius: theme.borderRadius.lg,
              padding: theme.spacing.base,
              minHeight: 160,
              borderWidth: 1,
              borderColor: theme.colors.border.light,
            }}
          >
            <TextInput
              value={content}
              onChangeText={(text) => setContent(text.slice(0, MAX_CHARS))}
              placeholder="Что у вас нового?"
              placeholderTextColor={theme.colors.text.tertiary}
              multiline
              style={{
                fontSize: theme.typography.sizes.base,
                fontFamily: theme.fontFamily.regular,
                color: theme.colors.text.primary,
                minHeight: 100,
                textAlignVertical: 'top',
              }}
            />

            {/* Image previews - horizontal scroll */}
            {imageUris.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: 12 }}
                contentContainerStyle={{ gap: 8 }}
              >
                {imageUris.map((uri, index) => (
                  <View key={index} style={{ position: 'relative' }}>
                    <Image
                      source={{ uri }}
                      style={{
                        width: imageUris.length === 1 ? 200 : 140,
                        height: imageUris.length === 1 ? 200 : 140,
                        borderRadius: 12,
                        backgroundColor: theme.colors.background.secondary,
                      }}
                      resizeMode="cover"
                    />
                    <Pressable
                      onPress={() => removeImage(index)}
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        backgroundColor: 'rgba(0,0,0,0.6)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Feather name="x" size={14} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}

            {/* Image count indicator */}
            {imageUris.length > 0 && (
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 6 }}>
                {imageUris.length}/{MAX_IMAGES} фото
              </Text>
            )}

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              {/* Media buttons */}
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <Pressable onPress={pickImages} style={{ padding: 4 }}>
                  <Feather name="image" size={22} color={imageUris.length >= MAX_IMAGES ? theme.colors.text.tertiary : theme.colors.accent.primary} />
                </Pressable>
                <Pressable onPress={takePhoto} style={{ padding: 4 }}>
                  <Feather name="camera" size={22} color={imageUris.length >= MAX_IMAGES ? theme.colors.text.tertiary : theme.colors.accent.primary} />
                </Pressable>
              </View>
              {/* Char counter */}
              <Text variant="caption" color={charColor}>
                {charsRemaining}
              </Text>
            </View>
          </View>
        </View>

        {/* Audience selector */}
        <View style={{ marginTop: theme.spacing.lg }}>
          <Text variant="caption" weight="medium" color={theme.colors.text.secondary} style={{ marginBottom: theme.spacing.sm }}>
            Аудитория
          </Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable
              onPress={() => setAudience('public')}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 12,
                borderRadius: theme.borderRadius.md,
                backgroundColor: audience === 'public'
                  ? theme.colors.accent.primary + '20'
                  : theme.colors.background.secondary,
                borderWidth: audience === 'public' ? 1.5 : 1,
                borderColor: audience === 'public'
                  ? theme.colors.accent.primary
                  : theme.colors.border.light,
              }}
            >
              <Feather
                name="globe"
                size={16}
                color={audience === 'public' ? theme.colors.accent.primary : theme.colors.text.tertiary}
              />
              <Text
                variant="caption"
                weight={audience === 'public' ? 'semibold' : 'regular'}
                color={audience === 'public' ? theme.colors.accent.primary : theme.colors.text.secondary}
              >
                Для всех
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setAudience('friends')}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 12,
                borderRadius: theme.borderRadius.md,
                backgroundColor: audience === 'friends'
                  ? theme.colors.accent.primary + '20'
                  : theme.colors.background.secondary,
                borderWidth: audience === 'friends' ? 1.5 : 1,
                borderColor: audience === 'friends'
                  ? theme.colors.accent.primary
                  : theme.colors.border.light,
              }}
            >
              <Feather
                name="users"
                size={16}
                color={audience === 'friends' ? theme.colors.accent.primary : theme.colors.text.tertiary}
              />
              <Text
                variant="caption"
                weight={audience === 'friends' ? 'semibold' : 'regular'}
                color={audience === 'friends' ? theme.colors.accent.primary : theme.colors.text.secondary}
              >
                Для друзей
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={{ marginTop: theme.spacing.xl }}>
          <Pressable
            onPress={handlePost}
            style={{
              backgroundColor: canPost
                ? theme.colors.accent.primary
                : theme.colors.border.light,
              borderRadius: theme.borderRadius.pill,
              paddingVertical: theme.spacing.base,
              alignItems: 'center',
            }}
            disabled={isPosting || !canPost}
          >
            <Text variant="body" weight="semibold" color={theme.colors.text.inverse}>
              {imageUploading ? 'Загрузка фото...' : isPosting ? 'Публикация...' : 'Опубликовать'}
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}
