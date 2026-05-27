import React, { useState, useEffect } from 'react';
import { View, TextInput, Pressable, ViewStyle, ScrollView, Alert, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store/authStore';
import { useFeedStore } from '../../src/store/feedStore';
import { createPost, createRepost, supabase, uploadPostImage } from '../../src/lib/supabase';

const MAX_CHARS = 500;

type Audience = 'public' | 'friends';

export default function CreateScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { addPost, pendingRepostId, setPendingRepost } = useFeedStore();
  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [audience, setAudience] = useState<Audience>('public');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [repostData, setRepostData] = useState<{ id: string; authorName: string; authorEmoji: string; content: string; imageUrl?: string } | null>(null);

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

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Доступ', 'Нужен доступ к галерее для выбора изображения');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
      aspect: [4, 3],
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Доступ', 'Нужен доступ к камере');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
      aspect: [4, 3],
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
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
    if (!content.trim() && !imageUri && !repostData) return;
    if (!user) {
      Alert.alert('Ошибка', 'Необходимо войти в аккаунт');
      return;
    }

    setIsPosting(true);
    try {
      // Handle repost
      if (repostData) {
        const { post, error } = await createRepost(user.id, repostData.id, content.trim() || undefined);
        if (error) {
          Alert.alert('Ошибка', error);
        } else {
          setContent('');
          setImageUri(null);
          setRepostData(null);
        }
        setIsPosting(false);
        return;
      }

      let imageUrl: string | undefined;

      if (imageUri) {
        setImageUploading(true);
        const uploadedUrl = await uploadImage(imageUri);
        setImageUploading(false);
        if (uploadedUrl) {
          imageUrl = uploadedUrl;
        }
      }

      const { post, error } = await createPost(user.id, content.trim() || '', imageUrl);
      if (error) {
        Alert.alert('Ошибка', error);
      } else {
        if (post) {
          addPost({
            id: post.id,
            authorId: user.id,
            authorName: user.displayName,
            authorUsername: user.username,
            authorEmoji: user.emoji,
            content: post.content,
            imageUrl: post.image_url || undefined,
            likesCount: 0,
            commentsCount: 0,
            sharesCount: 0,
            isLiked: false,
            isBookmarked: false,
            createdAt: post.created_at,
          });
        }
        setContent('');
        setImageUri(null);
      }
    } catch (e) {
      Alert.alert('Ошибка', 'Не удалось опубликовать пост');
    } finally {
      setIsPosting(false);
      setImageUploading(false);
    }
  };

  const removeImage = () => {
    setImageUri(null);
  };

  const charsRemaining = MAX_CHARS - content.length;
  const charColor = charsRemaining < 50
    ? theme.colors.status.error
    : charsRemaining < 100
      ? theme.colors.status.warning
      : theme.colors.text.tertiary;

  const canPost = content.trim() || imageUri || repostData;

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
            {repostData ? 'Репост' : 'Новый пост'}
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

            {/* Image preview */}
            {imageUri && (
              <View style={{ marginTop: 12, position: 'relative' }}>
                <Image
                  source={{ uri: imageUri }}
                  style={{
                    width: '100%',
                    height: 200,
                    borderRadius: 12,
                    backgroundColor: theme.colors.background.secondary,
                  }}
                  resizeMode="cover"
                />
                <Pressable
                  onPress={removeImage}
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Feather name="x" size={16} color="#fff" />
                </Pressable>
              </View>
            )}

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              {/* Media buttons */}
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <Pressable onPress={pickImage} style={{ padding: 4 }}>
                  <Feather name="image" size={22} color={theme.colors.accent.primary} />
                </Pressable>
                <Pressable onPress={takePhoto} style={{ padding: 4 }}>
                  <Feather name="camera" size={22} color={theme.colors.accent.primary} />
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
