import React, { useState, useRef, useCallback } from 'react';
import { View, Pressable, ActivityIndicator, Dimensions, Image, Animated, Modal, ScrollView as RNScrollView } from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { LinkedText } from '../../src/components/ui/LinkedText';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { useAuthStore, useEntityStore } from '../../src/store';
import { isRepost, parseImageUrls, getFollowCounts } from '../../src/lib/supabase';
import { syncUserPosts } from '../../src/services/syncService';
import { LocalPost } from '../../src/services/entityStore';
import { openUrl } from '../../src/utils/openUrl';
import { Post } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';

const SCREEN_WIDTH = Dimensions.get('window').width;
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
  const [showQR, setShowQR] = useState(false);

  // Read posts from entityStore instead of local state
  const myLocalPosts = useEntityStore((s) => s.getMyPosts());
  const profile = useEntityStore((s) => s.profiles[user?.id ?? '']);

  // Map LocalPost[] to Post[] for rendering
  const userPosts: Post[] = myLocalPosts.map((p: LocalPost) => {
    const repostInfo = isRepost(p.content || '');
    const parsedImages = parseImageUrls(p.image_url);
    return {
      id: p.id,
      authorId: p.author_id,
      authorName: user?.displayName || profile?.display_name || '',
      authorUsername: user?.username || profile?.username || '',
      authorEmoji: user?.emoji || profile?.emoji || '😊',
      content: repostInfo.isRepost ? (repostInfo.comment || '') : (p.content || ''),
      imageUrl: parsedImages[0] || undefined,
      imageUrls: parsedImages.length > 0 ? parsedImages : undefined,
      likesCount: p.likes_count || 0,
      commentsCount: p.comments_count || 0,
      sharesCount: p.shares_count || 0,
      isLiked: false,
      isBookmarked: false,
      createdAt: p.created_at,
      isRepost: repostInfo.isRepost,
      status: p.status, // Keep status for pending indicator
    } as Post & { status?: string };
  });

  const loadFollows = useCallback(async () => {
    if (!user?.id) return;
    try { const counts = await getFollowCounts(user.id); setFollowCounts(counts); } catch {}
  }, [user?.id]);

  useFocusEffect(useCallback(() => {
    if (!user?.id) return;
    // Trigger background sync for user posts
    syncUserPosts(user.id);
    // Load follow counts from supabase (not cached in entityStore yet)
    loadFollows();
  }, [user?.id]));

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
            const isPending = (post as any).status === 'pending';
            return (
            <Pressable key={post.id} onPress={() => router.push({ pathname: '/comments/[id]', params: { id: post.id } })} style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 14, padding: 14, marginBottom: 10, opacity: isPending ? 0.6 : 1 }}>
              {isPending && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}><ActivityIndicator size="small" color={theme.colors.accent.primary} /><Text variant="caption" color={theme.colors.text.tertiary}>Отправка...</Text></View>}
              {(() => { const imgs = post.imageUrls && post.imageUrls.length > 0 ? post.imageUrls : post.imageUrl ? [post.imageUrl] : []; if (!imgs.length) return null; if (imgs.length === 1) return <CachedImage uri={imgs[0]} style={{ width: '100%', height: 160, borderRadius: 10, marginBottom: 10 }} resizeMode="cover" />; return <RNScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 6 }}>{imgs.map((url: string, i: number) => <CachedImage key={i} uri={url} style={{ width: (SCREEN_WIDTH-80)*0.8, height: 160, borderRadius: 10 }} resizeMode="cover" />)}</RNScrollView>; })()}
              {post.content ? <Text variant="body" numberOfLines={3}>{post.content}</Text> : null}
              <View style={{ flexDirection: 'row', marginTop: 8, gap: 14 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Feather name="heart" size={13} color={theme.colors.text.tertiary} /><Text variant="caption" color={theme.colors.text.tertiary}>{post.likesCount}</Text></View><View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Feather name="message-circle" size={13} color={theme.colors.text.tertiary} /><Text variant="caption" color={theme.colors.text.tertiary}>{post.commentsCount}</Text></View></View>
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
    </View>
  );
}
