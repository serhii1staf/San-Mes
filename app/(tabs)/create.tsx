import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, TextInput, Pressable, ViewStyle, ScrollView, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { useAuthStore } from '../../src/store/authStore';
import { useFeedStore } from '../../src/store/feedStore';
import { useConnectivityStore } from '../../src/store';
import { createRepost, createPost, uploadPostImage, joinImageUrls } from '../../src/lib/supabase';
import { queueMutation, generateTempId } from '../../src/services/offlineQueue';
import { sanitizeUserText } from '../../src/utils/sanitizeText';
import { accountKey } from '../../src/services/cacheService';
import { FormatHelpModal } from '../../src/components/ui/FormatHelpModal';
import { useT } from '../../src/i18n/store';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { validatePost } from '../../src/services/moderation';

const MAX_CHARS = 500;
const MAX_IMAGES = 6;
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
// Truly-constant gradient stops for the header fade — hoisted so the
// LinearGradient doesn't receive a fresh array identity on every render.
const HEADER_GRADIENT_LOCATIONS = [0, 0.55, 1] as const;

type Audience = 'public' | 'friends';

export default function CreateScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Mount-time marker — surfaces in the perf-monitor panel. Create has
  // photo-picker chrome that occasionally lags on cold tab switch; this
  // attribution helps tell whether that lag is in the screen's first
  // render or downstream picker work. Skipped when the monitor is off.
  const mountStart = useRef(Date.now()).current;
  // Fire ONCE on first mount. See (tabs)/index.tsx for the same fix
  // rationale — store-read at effect-time avoids stale-mountStart re-fires.
  useEffect(() => {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    perfMonitor.markScreenMount('(tabs)/create', Date.now() - mountStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
      (async () => {
        const { apiGet } = await import('../../src/services/apiClient');
        let originalData: any = (await apiGet<any>(`/v1/posts/${encodeURIComponent(pendingRepostId)}`)).data;
        if (originalData) {
          // Follow repost chain to find actual original content.
          const { isRepost: isRepostFn } = await import('../../src/lib/supabase');
          let depth = 0;
          while (originalData && depth < 10) {
            const ri = isRepostFn(originalData.content || '');
            if (ri.isRepost && ri.originalPostId) {
              const { data: deeper } = await apiGet<any>(`/v1/posts/${encodeURIComponent(ri.originalPostId)}`);
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
      })();
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
      Alert.alert(t('create.alert.limit_title'), t('create.alert.limit_images', undefined, { n: MAX_IMAGES }));
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('create.alert.access_title'), t('create.alert.access_gallery'));
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
          Alert.alert(t('create.alert.file_too_large_title'), t('create.alert.file_too_large_pick'));
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
      Alert.alert(t('create.alert.limit_title'), t('create.alert.limit_images', undefined, { n: MAX_IMAGES }));
      return;
    }

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('create.alert.access_title'), t('create.alert.access_camera'));
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 1.0,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_IMAGE_SIZE_BYTES) {
        Alert.alert(t('create.alert.file_too_large_title'), t('create.alert.file_too_large_camera'));
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
        Alert.alert(t('create.alert.upload_error_title'), t('create.alert.upload_error_msg', undefined, { reason: error }));
        return null;
      }
      return url;
    } catch (e: any) {
      console.log('Upload failed:', e);
      Alert.alert(t('create.alert.upload_error_title'), t('create.alert.upload_error_msg', undefined, { reason: e?.message || t('create.alert.unknown_error') }));
      return null;
    }
  };

  const handlePost = async () => {
    if (!content.trim() && imageUris.length === 0 && !repostData) return;
    if (!user) {
      Alert.alert(t('create.alert.error_title'), t('create.alert.must_login'));
      return;
    }

    // Rate limit check
    const { checkRateLimit, recordAction, detectSuspiciousContent } = await import('../../src/services/rateLimit');
    const action = repostData ? 'repost' : 'post';
    const rl = checkRateLimit(action);
    if (!rl.allowed) {
      const secs = Math.ceil(rl.retryAfterMs / 1000);
      Alert.alert(t('create.alert.wait_title'), t('create.alert.wait_msg', undefined, { n: secs }));
      return;
    }

    // Spam/phishing check
    if (content.trim()) {
      const spam = detectSuspiciousContent(content);
      if (spam.isSuspicious) {
        Alert.alert(t('create.alert.blocked_title'), spam.reason || t('create.alert.blocked_default'));
        return;
      }
    }

    // Content moderation: hard-block ONLY zero-tolerance categories (CSAM,
    // extreme violence). Profanity / slurs / explicit content are allowed
    // — the app aims for neutrality, mirroring how Telegram, Instagram,
    // and X let users write freely in posts. The strict rule lives only on
    // usernames / display names (validateName), not on post bodies.
    //
    // Apple App Review still requires a moderation surface — that's covered
    // by the existing report-and-block flow on PostMenuModal, NOT by
    // upfront filtering of every post.
    if (content.trim()) {
      const mod = validatePost(content);
      if (!mod.ok) {
        Alert.alert(t('create.alert.blocked_title'), t(mod.reasonKey || 'moderation.reason.profanity'));
        return;
      }
      // Soft warnings deliberately ignored — neutral platform.
    }

    // Strip dangerous invisible / control / bidi-override characters from the
    // post body before persisting. Decorative Unicode + emoji are preserved;
    // this only neutralises hidden-text smuggling, RTL spoofing and Zalgo.
    const safePostText = sanitizeUserText(content, { maxLength: MAX_CHARS });

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

        const { post, error } = await createRepost(user.id, repostData.id, safePostText.trim() || undefined, repostImageUrl);
        if (error) {
          Alert.alert(t('create.alert.error_title'), error);
          setIsPosting(false);
          return;
        }
        // Optimistically push the new repost into the profile posts store
        // + caches, mirroring the regular createPost branch. Without this
        // the repost persisted to D1 but never appeared in the user's own
        // profile: `loadMyPosts` is throttle-gated (shouldSync('my_posts')),
        // so on the next profile visit it returns early and the cache —
        // which never got the new repost — is what renders. The user saw
        // "I reposted but it's not in my profile". Building the Post here
        // with its `originalPost` resolved (we already have `repostData`)
        // makes it show instantly, exactly like a fresh post.
        if (post) {
          const { parseImageUrls } = await import('../../src/lib/supabase');
          const repostImages = parseImageUrls(repostImageUrl);
          const newRepost = {
            id: post.id,
            authorId: user.id,
            authorName: user.displayName || '',
            authorUsername: user.username || '',
            authorEmoji: user.emoji || '😊',
            content: safePostText.trim() || '',
            imageUrl: repostImages[0] || undefined,
            imageUrls: repostImages.length > 0 ? repostImages : undefined,
            likesCount: 0,
            commentsCount: 0,
            sharesCount: 0,
            isLiked: false,
            isBookmarked: false,
            createdAt: post.created_at,
            isRepost: true,
            originalPost: {
              id: repostData.id,
              authorName: repostData.authorName,
              authorUsername: (repostData as any).authorUsername || 'user',
              authorEmoji: repostData.authorEmoji,
              content: repostData.content,
              imageUrl: repostData.imageUrl,
              imageUrls: repostData.imageUrl ? [repostData.imageUrl] : undefined,
            },
          };
          try {
            const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
            const feedCached = await AsyncStorage.getItem(accountKey('@san:feed_posts'));
            const feedPosts = feedCached ? JSON.parse(feedCached) : [];
            await AsyncStorage.setItem(accountKey('@san:feed_posts'), JSON.stringify([newRepost, ...feedPosts].slice(0, 20)));
            const myCached = await AsyncStorage.getItem(accountKey('@san:my_posts'));
            const myPosts = myCached ? JSON.parse(myCached) : [];
            await AsyncStorage.setItem(accountKey('@san:my_posts'), JSON.stringify([newRepost, ...myPosts].slice(0, 20)));
          } catch {}
          const currentProfilePosts = useFeedStore.getState().profilePosts;
          useFeedStore.getState().setProfilePosts([newRepost, ...currentProfilePosts].slice(0, 20));
        }
        setContent('');
        setImageUris([]);
        setRepostData(null);
        setIsPosting(false);
        router.replace('/(tabs)');
        return;
      }

      // ===== EDITING MODE: update existing post =====
      if (editingPostId) {
        const postContent = safePostText.trim() || '';

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

          const { apiPatch } = await import('../../src/services/apiClient');
          const { data, error } = await apiPatch<any>(
            `/v1/posts/${encodeURIComponent(editingPostId)}`,
            { content: postContent, image_url: imageUrl || null },
          );

          if (error || !data) {
            Alert.alert(t('create.alert.error_title'), error || 'edit failed');
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
          Alert.alert(t('create.alert.error_title'), e?.message || t('create.alert.update_failed'));
          // Do NOT clear the form on error
        }
        return;
      }

      // ===== CREATE MODE: create new post =====
      const { isOnline } = useConnectivityStore.getState();
      const tempId = generateTempId();
      const postContent = safePostText.trim() || '';

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

  const containerStyle: ViewStyle = useMemo(() => ({
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  }), [theme.colors.background.primary]);

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;
  const headerTitle = repostData ? t('create.title.repost') : editingPostId ? t('create.title.edit') : t('create.title.new');

  return (
    <View style={containerStyle}>
      {/* Custom gradient header like feed screen */}
      <View style={[createStyles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient colors={[bgColor, bgColor, bgTransparent]} locations={HEADER_GRADIENT_LOCATIONS} style={StyleSheet.absoluteFill} />
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
                  {t('create.send')}
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
            {repostData.imageUrl && <CachedImage uri={repostData.imageUrl} style={{ width: '100%', height: 120 }} resizeMode="cover" proxyWidth={500} />}
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
              placeholder={t('create.placeholder')}
              placeholderTextColor={theme.colors.text.tertiary}
              multiline
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
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
                    <CachedImage
                      uri={uri}
                      style={{
                        width: imageUris.length === 1 ? 200 : 140,
                        height: imageUris.length === 1 ? 200 : 140,
                        borderRadius: 12,
                        backgroundColor: theme.colors.background.secondary,
                      }}
                      resizeMode="cover"
                      proxyWidth={imageUris.length === 1 ? 200 : 140}
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
                  {t('create.photos_count', undefined, { n: imageUris.length, max: MAX_IMAGES })}
                </Text>
                {isSpoilerPhoto && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.colors.accent.primary + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                    <Feather name="eye-off" size={10} color={theme.colors.accent.primary} />
                    <Text variant="caption" color={theme.colors.accent.primary} style={{ fontSize: 10 }}>{t('create.spoiler_hidden')}</Text>
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
            {t('create.audience.label')}
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
                {t('create.audience.public')}
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
                {t('create.audience.friends')}
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
