import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Pressable, ActivityIndicator, Dimensions, Image, Animated, Modal, Share, Alert } from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { LinkedText } from '../../src/components/ui/LinkedText';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { useAuthStore } from '../../src/store';
import { useFeedStore } from '../../src/store/feedStore';
import { isRepost, parseImageUrls, getFollowCounts, supabase, deletePost } from '../../src/lib/supabase';
import { openUrl } from '../../src/utils/openUrl';
import { Post } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';
import { formatTimeAgo } from '../../src/utils/mockData';

const SCREEN_WIDTH = Dimensions.get('window').width;
const MY_POSTS_CACHE_KEY = '@san:my_posts';
type TabName = 'posts' | 'replies' | 'media' | 'likes';

function detectLinkType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('github.com')) return 'github';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
  if (lower.includes('instagram.com')) return 'instagram';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('t.me') || lower.includes('telegram.me')) return 'telegram';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('linkedin.com')) return 'linkedin';
  if (lower.includes('discord.gg') || lower.includes('discord.com')) return 'discord';
  if (lower.includes('twitch.tv')) return 'twitch';
  if (lower.includes('spotify.com')) return 'spotify';
  if (lower.includes('reddit.com')) return 'reddit';
  if (lower.includes('vk.com')) return 'vk';
  return 'website';
}

function SocialLinkIcon({ type, url }: { type: string; url: string }) {
  const theme = useTheme();
  const brandIcons: Record<string, { name: string; color: string; isBrand: boolean }> = {
    github: { name: 'github', color: theme.isDark ? '#FFFFFF' : '#333333', isBrand: true },
    twitter: { name: 'twitter', color: '#1DA1F2', isBrand: true },
    instagram: { name: 'instagram', color: '#E4405F', isBrand: true },
    youtube: { name: 'youtube', color: '#FF0000', isBrand: true },
    telegram: { name: 'telegram-plane', color: '#0088CC', isBrand: true },
    linkedin: { name: 'linkedin-in', color: '#0A66C2', isBrand: true },
    twitch: { name: 'twitch', color: '#9146FF', isBrand: true },
    spotify: { name: 'spotify', color: '#1DB954', isBrand: true },
    tiktok: { name: 'tiktok', color: theme.isDark ? '#FFFFFF' : '#000000', isBrand: true },
    discord: { name: 'discord', color: '#5865F2', isBrand: true },
    website: { name: 'globe', color: '#2563EB', isBrand: false },
  };
  const detected = detectLinkType(url);
  const icon = brandIcons[detected] || brandIcons[type] || brandIcons.website;
  return (
    <Pressable onPress={() => { triggerHaptic('light'); openUrl(url); }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: icon.color + '18', alignItems: 'center', justifyContent: 'center' }}>
      {icon.isBrand ? <FontAwesome5 name={icon.name} size={13} color={icon.color} brand /> : <Feather name={icon.name as any} size={13} color={icon.color} />}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabName>('posts');
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [userPosts, setUserPosts] = useState<Post[]>([]);
  const [showQR, setShowQR] = useState(false);
  const [viewingImage, setViewingImage] = useState<{ uri: string; postId: string } | null>(null);
  const hasFetched = useRef(false);

  // 1. Load from cache on mount
  useEffect(() => {
    AsyncStorage.getItem(MY_POSTS_CACHE_KEY).then((cached) => {
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) setUserPosts(parsed);
        } catch {}
      }
    }).catch(() => {});
  }, []);

  // 2. Fetch fresh data once
  useEffect(() => {
    if (hasFetched.current || !user?.id) return;
    hasFetched.current = true;
    loadMyPosts();
    loadFollows();
  }, [user?.id]);

  const loadMyPosts = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase.from('posts').select('*').eq('author_id', user.id).order('created_at', { ascending: false }).limit(20);
      if (!data) return;
      const mapped: Post[] = data.map((p: any) => {
        const repostInfo = isRepost(p.content || '');
        const parsedImages = parseImageUrls(p.image_url);
        return { id: p.id, authorId: p.author_id, authorName: user.displayName || '', authorUsername: user.username || '', authorEmoji: user.emoji || '😊', content: repostInfo.isRepost ? (repostInfo.comment || '') : (p.content || ''), imageUrl: parsedImages[0] || undefined, imageUrls: parsedImages.length > 0 ? parsedImages : undefined, likesCount: p.likes_count || 0, commentsCount: p.comments_count || 0, sharesCount: p.shares_count || 0, isLiked: false, isBookmarked: false, createdAt: p.created_at, isRepost: repostInfo.isRepost };
      });
      setUserPosts(mapped);
      AsyncStorage.setItem(MY_POSTS_CACHE_KEY, JSON.stringify(mapped)).catch(() => {});
    } catch {}
  }, [user?.id]);

  const loadFollows = useCallback(async () => {
    if (!user?.id) return;
    try { const counts = await getFollowCounts(user.id); setFollowCounts(counts); } catch {}
  }, [user?.id]);

  if (!user) return <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={theme.colors.accent.primary} /></View>;

  const userLinks: { type: string; url: string }[] = (user as any).links || [];
  const bannerUrl = (user as any)?.bannerUrl;
  const tabs: { key: TabName; label: string }[] = [{ key: 'posts', label: 'Посты' }, { key: 'replies', label: 'Ответы' }, { key: 'media', label: 'Медиа' }, { key: 'likes', label: 'Лайки' }];
  const scrollY = useRef(new Animated.Value(0)).current;
  const headerOpacity = scrollY.interpolate({ inputRange: [0, 50, 120], outputRange: [0, 0, 1], extrapolate: 'clamp' });
  const buttonsTranslateX = scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, -60], extrapolate: 'clamp' });
  const settingsTranslateX = scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, 60], extrapolate: 'clamp' });
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://san-mes.vercel.app/profile/${user.id}`)}`;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, height: insets.top + 50, opacity: headerOpacity }} pointerEvents="none">
        <LinearGradient colors={[theme.colors.background.primary, theme.colors.background.primary, theme.colors.background.primary + '00']} locations={[0, 0.6, 1]} style={{ flex: 1 }} />
      </Animated.View>
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 100 }}>
        <Animated.View style={{ transform: [{ translateX: buttonsTranslateX }] }}><Pressable onPress={() => { triggerHaptic('light'); setShowQR(true); }} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}><FontAwesome5 name="qrcode" size={15} color="#FFFFFF" /></Pressable></Animated.View>
        <Animated.View style={{ transform: [{ translateX: settingsTranslateX }] }}><Pressable onPress={() => { triggerHaptic('light'); router.push('/settings'); }} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}><Feather name="settings" size={16} color="#FFFFFF" /></Pressable></Animated.View>
      </View>
      <Animated.ScrollView showsVerticalScrollIndicator={false} bounces={false} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={{ height: 150, backgroundColor: theme.colors.accent.primary + '20' }}>{bannerUrl ? <CachedImage uri={bannerUrl} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}<LinearGradient colors={['transparent', theme.colors.background.primary]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 50 }} /></View>
        <View style={{ paddingHorizontal: 16, marginTop: -36 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, overflow: 'hidden', borderWidth: 3, borderColor: theme.colors.background.primary, backgroundColor: theme.isDark ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' }}><Avatar emoji={user.emoji} size="lg" /></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <View style={{ flex: 1 }}><Text variant="body" weight="bold" numberOfLines={1}>{user.displayName}</Text><Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>@{user.username}</Text></View>
            <Pressable onPress={() => { triggerHaptic('light'); router.push('/profile/edit'); }} style={{ paddingHorizontal: 16, paddingVertical: 7, borderWidth: 1, borderColor: theme.colors.border.medium, borderRadius: 20 }}><Text variant="caption" weight="semibold">Редактировать</Text></Pressable>
          </View>
          <View style={{ flexDirection: 'row', marginTop: 10, gap: 16 }}>
            <Text variant="caption"><Text variant="caption" weight="bold">{userPosts.length}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>posts</Text></Text>
            <Text variant="caption"><Text variant="caption" weight="bold">{followCounts.following}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>following</Text></Text>
            <Text variant="caption"><Text variant="caption" weight="bold">{followCounts.followers}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>followers</Text></Text>
          </View>
          {user.bio ? <LinkedText style={{ marginTop: 8 }}>{user.bio}</LinkedText> : null}
          {userLinks.length > 0 && <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>{userLinks.map((link, idx) => <SocialLinkIcon key={idx} type={link.type} url={link.url} />)}</View>}
        </View>
        <View style={{ marginTop: 16, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
          <View style={{ flexDirection: 'row' }}>{tabs.map((tab) => (<Pressable key={tab.key} onPress={() => { triggerHaptic('selection'); setActiveTab(tab.key); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 11 }}><Text variant="caption" weight={activeTab === tab.key ? 'bold' : 'regular'} color={activeTab === tab.key ? theme.colors.text.primary : theme.colors.text.tertiary}>{tab.label}</Text></Pressable>))}</View>
          <View style={{ position: 'absolute', bottom: 0, height: 2, backgroundColor: theme.colors.accent.primary, width: SCREEN_WIDTH / 4, left: tabs.findIndex(t => t.key === activeTab) * (SCREEN_WIDTH / 4) }} />
        </View>
        {activeTab === 'posts' && (userPosts.length === 0 ? <View style={{ alignItems: 'center', paddingVertical: 40 }}><Text variant="caption" color={theme.colors.text.tertiary}>Ещё нет публикаций</Text></View> : (
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>{userPosts.map(post => {
            const imgs = post.imageUrls && post.imageUrls.length > 0 ? post.imageUrls : post.imageUrl ? [post.imageUrl] : [];
            const hasImage = imgs.length > 0;
            return (
            <Pressable key={post.id} onPress={() => router.push({ pathname: '/comments/[id]', params: { id: post.id } })} style={{ flexDirection: 'row', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.75)', borderRadius: 28, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.4)', shadowColor: theme.isDark ? '#000' : '#c8a060', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 4, overflow: 'hidden' }}>
              {/* Left: Post image (square, rounded) — tap opens fullscreen */}
              {hasImage && (
                <Pressable onPress={() => setViewingImage({ uri: imgs[0], postId: post.id })}>
                  <CachedImage uri={imgs[0]} style={{ width: 100, height: 100, borderRadius: 20 }} resizeMode="cover" />
                </Pressable>
              )}
              {/* Right: Info */}
              <View style={{ flex: 1, marginLeft: hasImage ? 14 : 4, justifyContent: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Avatar emoji={user.emoji} size="xs" />
                  <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>{user.displayName}</Text>
                </View>
                {post.content ? <Text variant="caption" numberOfLines={2} color={theme.colors.text.secondary} style={{ marginBottom: 6 }}>{post.content}</Text> : null}
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{formatTimeAgo(post.createdAt)}</Text>
                <View style={{ flexDirection: 'row', marginTop: 6, gap: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Feather name="heart" size={12} color={theme.colors.text.tertiary} /><Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{post.likesCount}</Text></View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Feather name="message-circle" size={12} color={theme.colors.text.tertiary} /><Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{post.commentsCount}</Text></View>
                </View>
              </View>
            </Pressable>
            );
          })}</View>
        ))}
        {activeTab !== 'posts' && <View style={{ alignItems: 'center', paddingVertical: 40 }}><Text variant="caption" color={theme.colors.text.tertiary}>Пока пусто</Text></View>}
      </Animated.ScrollView>
      <Modal visible={showQR} transparent animationType="fade" onRequestClose={() => setShowQR(false)} statusBarTranslucent>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' }} onPress={() => setShowQR(false)}>
          <Text variant="body" weight="bold" color="#FFFFFF" style={{ marginBottom: 20 }}>Мой QR-код</Text>
          <View style={{ backgroundColor: '#FFF', borderRadius: 20, padding: 20 }}><Image source={{ uri: qrUrl }} style={{ width: 200, height: 200 }} resizeMode="contain" /></View>
          <Text variant="caption" color="#FFFFFF" style={{ marginTop: 20, opacity: 0.7 }}>Нажмите чтобы закрыть</Text>
        </Pressable>
      </Modal>

      {/* Fullscreen Image Viewer */}
      <Modal visible={!!viewingImage} transparent animationType="fade" onRequestClose={() => setViewingImage(null)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }}>
          {/* Close — top right */}
          <Pressable onPress={() => setViewingImage(null)} style={{ position: 'absolute', top: insets.top + 12, right: 16, zIndex: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="x" size={20} color="#FFFFFF" />
          </Pressable>
          {/* Image — full width */}
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            {viewingImage && <CachedImage uri={viewingImage.uri} style={{ width: SCREEN_WIDTH - 32, height: SCREEN_WIDTH - 32, borderRadius: 16 }} resizeMode="contain" />}
          </View>
          {/* Bottom actions */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingBottom: insets.bottom + 20 }}>
            <Pressable onPress={() => { setViewingImage(null); useFeedStore.getState().setEditingPost({ id: viewingImage!.postId, content: userPosts.find(p => p.id === viewingImage!.postId)?.content || '', imageUrl: viewingImage!.uri }); router.push('/(tabs)/create'); }} style={{ alignItems: 'center' }}>
              <Feather name="edit-2" size={20} color="#FFFFFF" />
              <Text variant="caption" color="#FFFFFF" style={{ marginTop: 4, fontSize: 10 }}>Редактировать</Text>
            </Pressable>
            <Pressable onPress={async () => { if (viewingImage) { try { await Share.share({ message: viewingImage.uri }); } catch {} } }} style={{ alignItems: 'center' }}>
              <Feather name="share" size={20} color="#FFFFFF" />
              <Text variant="caption" color="#FFFFFF" style={{ marginTop: 4, fontSize: 10 }}>Поделиться</Text>
            </Pressable>
            <Pressable onPress={() => { if (viewingImage && user?.id) { Alert.alert('Удалить пост?', 'Это действие нельзя отменить', [{ text: 'Отмена', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: async () => { await deletePost(viewingImage.postId, user.id); setViewingImage(null); loadMyPosts(); } }]); } }} style={{ alignItems: 'center' }}>
              <Feather name="trash-2" size={20} color="#FF3B30" />
              <Text variant="caption" color="#FF3B30" style={{ marginTop: 4, fontSize: 10 }}>Удалить</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
