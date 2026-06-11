import React, { useState, useEffect } from 'react';
import { View, TextInput, Pressable, ViewStyle, ScrollView, Alert, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store/authStore';
import { useFeedStore } from '../../src/store/feedStore';
import { useConnectivityStore } from '../../src/store';
import { createRepost, createPost, supabase, uploadPostImage, joinImageUrls } from '../../src/lib/supabase';
import { queueMutation, generateTempId } from '../../src/services/offlineQueue';
import { useEntityStore } from '../../src/services/entityStore';
import { accountKey } from '../../src/services/cacheService';
import { FormatHelpModal } from '../../src/components/ui/FormatHelpModal';

const MAX_CHARS = 500;
const MAX_IMAGES = 6;
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

type Audience = 'public' | 'friends';

export default function CreateScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  // Field-level selectors so the create screen doesn't re-render on every
  // unrelated feed-store mutation (likes, posts list, etc.) coming from the home tab.
  const user = useAuthStore((s) => s.user);
  const pendingRepostId = useFeedStore((s) => s.pendingRepostId);
  const setPendingRepost = useFeedStore((s) => s.setPendingRepost);
  const editingPost = useFeedStore((s) => s.editingPost);
  const setEditingPost = useFeedStore((s) => s.setEditingPost);
  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [audience, setAudience] = useState<Audience>('public');
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [imageUploading, setImageUploading] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [repostData, setRepostData] = useState<{ id: string; authorName: string; authorEmoji: string; content: string; imageUrl?: string } | null>(null);
  const [showFormatHelp, setShowFormatHelp] = useState(false);
  const [isSpoilerPhoto, setIsSpoilerPhoto] = useState(false);

  // Load editing post data
  useEffect(() => {
    if (editingPost) {
      setContent(editingPost.content || '');
      setEditingPostId(editingPost.id);
      // Prefer the full image array; fall back to the single imageUrl.
      if (editingPost.imageUrls && editingPost.imageUrls.length > 0) {
        setImageUris(editingPost.imageUrls);
      } else if (editingPost.imageUrl) {
        setImageUris([editingPost.imageUrl]);
      }
      setEditingPost(null);
    }
  }, [editingPost]);

  // Load repost data from store
  useEffect(() => {
    if (pendingRepostId) {
      supabase.from('posts').select('*, profiles:author_id (display_name, emoji)').eq('id', pendingRepostId).single().then(async ({ data }) => {
        if (data) {
          let originalData = data;
          // Follow repost chain to find actual original content
          const { isRepost: isRepostFn } = await import('../../src/lib/supabase');
          let depth = 0;
          while (originalData && depth < 10) {
            const ri = isRepostFn(originalData.content || '');
            if (ri.isRepost && ri.originalPostId) {
              const { data: deeper } = await supabase.from('posts').select('*, profiles:author_id (display_name, emoji)').eq('id', ri.originalPostId).single();
              if (deeper) {
                originalData = deeper;
                depth++;
              } else break;
            } else break;
          }
          const profile = Array.isArray(originalData.profiles) ? originalData.profiles[0] : originalData.profiles;
          const { isRepost: checkRepost } = await import('../../src/lib/supabase');
          const ri = checkRepost(originalData.content || '');
          setRepostData({
            id: originalData.id,
            authorName: profile?.display_name || 'User',
            authorEmoji: profile?.emoji || '😊',
            content: ri.isRepost ? (ri.comment || '') : (originalData.content || ''),
            imageUrl: originalData.image_url || undefined,
          });
        }
        setPendingRepost(null);
      });
    }
  }, [pendingRepostId]);

  const canPost = !!(content.trim() || imageUris.length > 0 || repostData);

  // Hide default header — we render our own gradient header
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  // Ref to hold the latest handlePost function for headerRight access
  const handlePostRef = React.useRef<(() => void) | null>(null);

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
      quality: 1.0,
    });

    if (!result.canceled && result.assets.length > 0) {
      const validAssets = result.assets.filter(asset => {
        if (asset.fileSize && asset.fileSize > MAX_IMAGE_SIZE_BYTES) {
          Alert.alert('Файл слишком большой', `Максимальный размер изображения — 20 МБ. Выберите другое изображение.`);
          return false;
        }
        return true;
      });
      if (validAssets.length > 0) {
        const newUris = validAssets.map(a => a.uri);
        setImageUris(prev => [...prev, ...newUris].slice(0, MAX_IMAGES));
      }
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
      quality: 1.0,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_IMAGE_SIZE_BYTES) {
        Alert.alert('Файл слишком большой', `Максимальный размер изображения — 20 МБ. Попробуйте сделать другое фото.`);
        return;
      }
      setImageUris(prev => [...prev, asset.uri].slice(0, MAX_IMAGES));
    }
  };

  const uploadImage = async (uri: string): Promise<string | null> => {
    try {
      const { url, error } = await uploadPostImage(uri);
      if (error) {
        console.log('Upload error:', error);
        Alert.alert('Ошибка загрузки', `Не удалось загрузить изображение: ${error}`);
        return null;
      }
      return url;
    } catch (e: any) {
      console.log('Upload failed:', e);
      Alert.alert('Ошибка загрузки', `Не удалось загрузить изображение: ${e?.message || 'Неизвестная ошибка'}`);
      return null;
    }
  };

  const handlePost = async () => {
    if (!content.trim() && imageUris.length === 0 && !repostData) return;
    if (!user) {
      Alert.alert('Ошибка', 'Необходимо войти в аккаунт');
      return;
    }

    // Rate limit check
    const { checkRateLimit, recordAction, detectSuspiciousContent } = await import('../../src/services/rateLimit');
    const action = repostData ? 'repost' : 'post';
    const rl = checkRateLimit(action);
    if (!rl.allowed) {
      const secs = Math.ceil(rl.retryAfterMs / 1000);
      Alert.alert('Подождите', `Слишком частые действия. Попробуйте через ${secs} сек.`);
      return;
    }

    // Spam/phishing check
    if (content.trim()) {
      const spam = detectSuspiciousContent(content);
      if (spam.isSuspicious) {
        Alert.alert('Контент заблокирован', spam.reason || 'Подозрительный контент');
        return;
      }
    }

    setIsPosting(true);
    try {
      // Handle repost — now supports images
      if (repostData) {
        let repostImageUrl: string | undefined;

        // Upload images if user added any
        if (imageUris.length > 0) {
          setImageUploading(true);
          const uploadedUrls: string[] = [];
          for (const uri of imageUris) {
            if (uri.startsWith('https://')) {
              uploadedUrls.push(uri);
            } else {
              const uploadedUrl = await uploadImage(uri);
              if (uploadedUrl) uploadedUrls.push(uploadedUrl);
            }
          }
          setImageUploading(false);
          if (uploadedUrls.length > 0) {
            repostImageUrl = joinImageUrls(uploadedUrls);
          }
        }

        const { post, error } = await createRepost(user.id, repostData.id, content.trim() || undefined, repostImageUrl);
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

      // ===== EDITING MODE: update existing post =====
      if (editingPostId) {
        const postContent = content.trim() || '';

        try {
          let imageUrl: string | undefined;

          if (imageUris.length > 0) {
            setImageUploading(true);
            const uploadedUrls: string[] = [];
            for (const uri of imageUris) {
              if (uri.startsWith('https://')) {
                // Existing remote URL — use as-is without re-uploading
                uploadedUrls.push(uri);
              } else {
                // Local file (file://) — upload via uploadPostImage
                const uploadedUrl = await uploadImage(uri);
                if (uploadedUrl) {
                  uploadedUrls.push(uploadedUrl);
                }
              }
            }
            setImageUploading(false);
            if (uploadedUrls.length > 0) {
              imageUrl = joinImageUrls(uploadedUrls);
            }
          }

          const { data, error } = await supabase
            .from('posts')
            .update({ content: postContent, image_url: imageUrl || null })
            .eq('id', editingPostId)
            .select()
            .single();

          if (error) {
            Alert.alert('Ошибка', error.message);
            // Do NOT clear the form on error
            return;
          }

          // Build updated post data for cache and store
          const { parseImageUrls } = await import('../../src/lib/supabase');
          const parsedImages = parseImageUrls(data.image_url);
          const updatedPostData = {
            content: data.content || '',
            imageUrl: parsedImages[0] || undefined,
            imageUrls: parsedImages.length > 0 ? parsedImages : undefined,
          };

          // Update AsyncStorage cache — find post by id and replace data
          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;

          const feedCached = await AsyncStorage.getItem(accountKey('@san:feed_posts'));
          if (feedCached) {
            const feedPosts = JSON.parse(feedCached);
            const updatedFeed = feedPosts.map((p: any) =>
              p.id === editingPostId ? { ...p, ...updatedPostData } : p
            );
            await AsyncStorage.setItem(accountKey('@san:feed_posts'), JSON.stringify(updatedFeed));
          }

          const myCached = await AsyncStorage.getItem(accountKey('@san:my_posts'));
          if (myCached) {
            const myPosts = JSON.parse(myCached);
            const updatedMy = myPosts.map((p: any) =>
              p.id === editingPostId ? { ...p, ...updatedPostData } : p
            );
            await AsyncStorage.setItem(accountKey('@san:my_posts'), JSON.stringify(updatedMy));
          }

          // Update Zustand store
          useFeedStore.getState().updatePost(editingPostId, updatedPostData);

          // Reset state and navigate back
          setContent('');
          setImageUris([]);
          setEditingPostId(null);
          router.back();
        } catch (e: any) {
          setImageUploading(false);
          Alert.alert('Ошибка', e?.message || 'Не удалось обновить пост');
          // Do NOT clear the form on error
        }
        return;
      }

      // ===== CREATE MODE: create new post =====
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

          const { post, error } = await createPost(user.id, postContent, isSpoilerPhoto && imageUrl ? `::spoiler::${imageUrl}` : imageUrl);
          if (!error && post) {
            // Add to local feed cache immediately so it appears in feed + profile
            const { parseImageUrls } = await import('../../src/lib/supabase');
            const parsedImages = parseImageUrls(post.image_url);
            const newPost = {
              id: post.id,
              authorId: post.author_id,
              authorName: user.displayName || '',
              authorUsername: user.username || '',
              authorEmoji: user.emoji || '😊',
              content: post.content || '',
              imageUrl: parsedImages[0] || undefined,
              imageUrls: parsedImages.length > 0 ? parsedImages : undefined,
              isSpoilerImage: isSpoilerPhoto,
              likesCount: 0,
              commentsCount: 0,
              sharesCount: 0,
              isLiked: false,
              isBookmarked: false,
              createdAt: post.created_at,
              isRepost: false,
            };

            // Update feed cache
            const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
            const feedCached = await AsyncStorage.getItem(accountKey('@san:feed_posts'));
            const feedPosts = feedCached ? JSON.parse(feedCached) : [];
            await AsyncStorage.setItem(accountKey('@san:feed_posts'), JSON.stringify([newPost, ...feedPosts].slice(0, 20)));

            // Update profile posts cache
            const myCached = await AsyncStorage.getItem(accountKey('@san:my_posts'));
            const myPosts = myCached ? JSON.parse(myCached) : [];
            await AsyncStorage.setItem(accountKey('@san:my_posts'), JSON.stringify([newPost, ...myPosts].slice(0, 20)));

            // Update Zustand profile posts store so profile shows the new post immediately
            const currentProfilePosts = useFeedStore.getState().profilePosts;
            useFeedStore.getState().setProfilePosts([newPost, ...currentProfilePosts].slice(0, 20));

            setContent('');
            setImageUris([]);
            setEditingPostId(null);
            setIsSpoilerPhoto(false);
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
      // Record action for rate limiting
      recordAction(repostData ? 'repost' : 'post');
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

  // Keep handlePostRef in sync with latest handlePost
  handlePostRef.current = handlePost;

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;
  const headerTitle = repostData ? 'Репост' : editingPostId ? 'Редактировать' : 'Новый пост';

  return (
    <View style={containerStyle}>
      {/* Custom gradient header like feed screen */}
      <View style={[createStyles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient colors={[bgColor, bgColor, bgTransparent]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <View style={[createStyles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
          <Text variant="body" weight="bold">{headerTitle}</Text>
          <Pressable
            onPress={() => { handlePostRef.current?.(); }}
            disabled={!canPost || isPosting}
            style={{ opacity: (!canPost || isPosting) ? 0.4 : 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            {isPosting ? (
              <ActivityIndicator size="small" color={theme.colors.accent.primary} />
            ) : (
              <>
                <Feather name="send" size={16} color={theme.colors.accent.primary} />
                <Text variant="caption" weight="semibold" color={theme.colors.accent.primary}>
                  Пост
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100, paddingTop: headerContentHeight }}>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <Text variant="caption" color={theme.colors.text.tertiary}>
                  {imageUris.length}/{MAX_IMAGES} фото
                </Text>
                {isSpoilerPhoto && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.colors.accent.primary + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                    <Feather name="eye-off" size={10} color={theme.colors.accent.primary} />
                    <Text variant="caption" color={theme.colors.accent.primary} style={{ fontSize: 10 }}>скрыто</Text>
                  </View>
                )}
              </View>
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
                <Pressable onPress={() => setShowFormatHelp(true)} style={{ padding: 4 }}>
                  <Feather name="type" size={22} color={theme.colors.accent.primary} />
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
      </View>
    </ScrollView>
    <FormatHelpModal visible={showFormatHelp} onClose={() => setShowFormatHelp(false)} onInsert={(text) => setContent(prev => prev + text)} onToggleSpoilerPhoto={() => setIsSpoilerPhoto(prev => !prev)} hasPhotos={imageUris.length > 0} />
    </View>
  );
}

const createStyles = StyleSheet.create({
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 8 },
});
