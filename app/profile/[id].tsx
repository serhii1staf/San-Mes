import React, { useEffect, useState, useRef } from 'react';
import { View, Pressable, ActivityIndicator, Image, Dimensions, Modal, Animated, Share, Alert, ScrollView as RNScrollView } from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { LinkedText } from '../../src/components/ui/LinkedText';
import { parseImageUrls, getProfile, getFollowCounts, deletePost } from '../../src/lib/supabase';
import { useAuthStore } from '../../src/store';
import { useEntityStore } from '../../src/store';
import { syncProfile, syncUserPosts } from '../../src/services/syncService';
import { queueMutation } from '../../src/services/offlineQueue';
import { openUrl } from '../../src/utils/openUrl';
import { triggerHaptic } from '../../src/utils/haptics';
import { formatTimeAgo } from '../../src/utils/mockData';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { PanResponder } from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
type TabName = 'posts' | 'replies' | 'media' | 'likes';

const REPORT_CATEGORIES = ['Спам', 'Насилие', 'Ложная информация', 'Мошенничество', 'Другое'];

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
  if (lower.includes('spotify.com') || lower.includes('open.spotify.com')) return 'spotify';
  return 'website';
}

function SocialLinkIcon({ type, url }: { type: string; url: string }) {
  const theme = useTheme();
  const icons: Record<string, { name: string; color: string; isBrand: boolean }> = {
    github: { name: 'github', color: theme.isDark ? '#FFF' : '#333', isBrand: true },
    twitter: { name: 'twitter', color: '#1DA1F2', isBrand: true },
    instagram: { name: 'instagram', color: '#E4405F', isBrand: true },
    youtube: { name: 'youtube', color: '#FF0000', isBrand: true },
    telegram: { name: 'telegram-plane', color: '#0088CC', isBrand: true },
    tiktok: { name: 'tiktok', color: theme.isDark ? '#FFF' : '#000', isBrand: true },
    linkedin: { name: 'linkedin-in', color: '#0A66C2', isBrand: true },
    discord: { name: 'discord', color: '#5865F2', isBrand: true },
    twitch: { name: 'twitch', color: '#9146FF', isBrand: true },
    spotify: { name: 'spotify', color: '#1DB954', isBrand: true },
    website: { name: 'globe', color: '#2563EB', isBrand: false },
  };
  const detected = detectLinkType(url);
  const icon = icons[detected] || icons[type] || icons.website;
  return (
    <Pressable onPress={() => { triggerHaptic('light'); openUrl(url); }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: icon.color + '18', alignItems: 'center', justifyContent: 'center' }}>
      {icon.isBrand ? <FontAwesome5 name={icon.name} size={13} color={icon.color} brand /> : <Feather name={icon.name as any} size={13} color={icon.color} />}
    </Pressable>
  );
}

function ProfileMenuModal({ visible, profile, onClose }: { visible: boolean; profile: any; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const [showQR, setShowQR] = useState(false);
  const [mode, setMode] = useState<'menu' | 'report'>('menu');
  const isClosing = useRef(false);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 8,
    onPanResponderMove: (_, g) => { if (g.dy > 0) dragY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 80 || g.vy > 0.5) handleClose();
      else Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 100, friction: 10 }).start();
    },
  })).current;

  useEffect(() => {
    if (visible) {
      isClosing.current = false;
      setMode('menu');
      dragY.setValue(0);
      slideAnim.setValue(SCREEN_HEIGHT);
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 10 }).start();
    }
  }, [visible]);

  const handleClose = () => {
    if (isClosing.current) return;
    isClosing.current = true;
    Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 180, useNativeDriver: true }).start(() => {
      setShowQR(false);
      setMode('menu');
      onClose();
    });
  };

  const switchToReport = () => {
    // Animate out, switch mode, animate in (like PostMenuModal)
    Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 150, useNativeDriver: true }).start(() => {
      setMode('report');
      dragY.setValue(0);
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }).start();
    });
  };

  const handleCopyLink = async () => {
    triggerHaptic('light');
    await Clipboard.setStringAsync(`https://san-mes.vercel.app/profile/${profile?.id}`);
    handleClose();
  };

  const handleShare = async () => {
    triggerHaptic('light');
    try { await Share.share({ message: `${profile?.display_name || 'User'} в San\nhttps://san-mes.vercel.app/profile/${profile?.id}` }); } catch {}
    handleClose();
  };

  const handleReport = (cat: string) => {
    triggerHaptic('medium');
    Alert.alert('Жалоба отправлена', 'Спасибо, мы рассмотрим обращение.');
    handleClose();
  };

  if (!profile) return null;
  const translateY = Animated.add(slideAnim, dragY);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://san-mes.vercel.app/profile/${profile.id}`)}`;

  // QR fullscreen view
  if (showQR) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setShowQR(false)} statusBarTranslucent>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' }} onPress={() => setShowQR(false)}>
          <View style={{ backgroundColor: '#FFF', borderRadius: 20, padding: 20 }}>
            <Image source={{ uri: qrUrl }} style={{ width: 200, height: 200 }} resizeMode="contain" />
          </View>
          <Text variant="caption" color="#FFFFFF" style={{ marginTop: 16 }}>Нажмите чтобы закрыть</Text>
        </Pressable>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={handleClose} />
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY }] }} {...panResponder.panHandlers}>
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 12 }}>
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)' }} />
              </View>

              {mode === 'menu' ? (
                <>
                  {/* Header with avatar + QR */}
                  <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Avatar emoji={profile.emoji || '😊'} size="lg" />
                      <View style={{ marginLeft: 12, flex: 1 }}>
                        <Text variant="body" weight="bold" numberOfLines={1}>{profile.display_name}</Text>
                        <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>@{profile.username}</Text>
                      </View>
                      <Pressable onPress={() => { triggerHaptic('light'); setShowQR(true); }} style={{ backgroundColor: '#FFF', borderRadius: 8, padding: 4 }}>
                        <Image source={{ uri: qrUrl }} style={{ width: 44, height: 44 }} resizeMode="contain" />
                      </Pressable>
                    </View>
                  </View>
                  <MenuItem icon="link" label="Скопировать ссылку" onPress={handleCopyLink} theme={theme} />
                  <MenuItem icon="share-2" label="Поделиться профилем" onPress={handleShare} theme={theme} />
                  <MenuItem icon="flag" label="Пожаловаться" onPress={() => { triggerHaptic('light'); switchToReport(); }} theme={theme} destructive />
                </>
              ) : (
                <>
                  <Text variant="body" weight="semibold" align="center" style={{ paddingVertical: 12 }}>Причина жалобы</Text>
                  {REPORT_CATEGORIES.map((cat, i) => (
                    <Pressable key={i} onPress={() => handleReport(cat)} style={{ paddingVertical: 14, paddingHorizontal: 20, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}>
                      <Text variant="body">{cat}</Text>
                    </Pressable>
                  ))}
                </>
              )}
              <View style={{ height: 12 }} />
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

function MenuItem({ icon, label, onPress, theme, destructive }: { icon: string; label: string; onPress: () => void; theme: any; destructive?: boolean }) {
  const color = destructive ? '#FF3B30' : theme.colors.text.primary;
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: destructive ? '#FF3B3010' : (theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'), alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon as any} size={17} color={color} />
      </View>
      <Text variant="body" color={color} style={{ marginLeft: 14 }}>{label}</Text>
    </Pressable>
  );
}

export default function UserProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user: currentUser } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [activeTab, setActiveTab] = useState<TabName>('posts');
  const [showMenu, setShowMenu] = useState(false);
  const [viewingImage, setViewingImage] = useState<{ uri: string; postId: string } | null>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const headerOpacity = scrollY.interpolate({ inputRange: [0, 50, 120], outputRange: [0, 0, 1], extrapolate: 'clamp' });
  const buttonsTranslateX = scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, -60], extrapolate: 'clamp' });
  const menuTranslateX = scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, 60], extrapolate: 'clamp' });
  const badgeOpacity = scrollY.interpolate({ inputRange: [180, 220], outputRange: [0, 1], extrapolate: 'clamp' });
  const badgeTranslateY = scrollY.interpolate({ inputRange: [180, 220], outputRange: [20, 0], extrapolate: 'clamp' });

  // Read profile from entity store (cached)
  const cachedProfile = useEntityStore((s) => s.profiles[id ?? '']);
  // Read follow state from entity store
  const isFollowingState = useEntityStore((s) => s.isFollowing(currentUser?.id ?? '', id ?? ''));
  // Read user posts from entity store, filtered by author_id
  const allPosts = useEntityStore((s) => s.posts);
  const userPosts = React.useMemo(() => {
    if (!id) return [];
    return Object.values(allPosts)
      .filter((p) => p.author_id === id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [allPosts, id]);

  // Fallback profile state (for when no cached data exists)
  const [fallbackProfile, setFallbackProfile] = useState<any>(null);

  useEffect(() => {
    if (!id) return;

    // If we have cached profile, show it immediately (no loading)
    if (cachedProfile) {
      setIsLoading(false);
    } else {
      // No cached data — load from Supabase directly as fallback
      setIsLoading(true);
      getProfile(id).then(({ profile: profileData }) => {
        if (profileData) {
          setFallbackProfile(profileData);
          // Also upsert into entity store for future use
          useEntityStore.getState().upsertProfile({
            id: profileData.id,
            username: profileData.username,
            display_name: profileData.display_name,
            emoji: profileData.emoji || '😀',
            bio: profileData.bio || '',
            banner_url: (profileData as any).banner_url || null,
            links: (profileData as any).links ? JSON.stringify((profileData as any).links) : null,
            created_at: profileData.created_at || null,
            updated_at: profileData.updated_at || null,
          });
        }
        setIsLoading(false);
      }).catch(() => setIsLoading(false));
    }

    // Trigger background sync for profile and user posts
    syncProfile(id);
    syncUserPosts(id);

    // Load follow counts from Supabase (keep direct call for counts display)
    getFollowCounts(id).then((counts) => setFollowCounts(counts)).catch(() => {});
  }, [id]);

  // Display profile: prefer cached from store, fallback to direct fetch
  const displayProfile = cachedProfile || fallbackProfile;

  // Display posts mapped for UI
  const displayPosts = React.useMemo(() => {
    return userPosts.map((p) => {
      const parsedImages = parseImageUrls(p.image_url);
      return {
        id: p.id,
        content: p.content,
        imageUrl: parsedImages[0] || undefined,
        imageUrls: parsedImages.length > 0 ? parsedImages : undefined,
        likesCount: p.likes_count || 0,
        commentsCount: p.comments_count || 0,
        createdAt: p.created_at,
        status: p.status,
      };
    });
  }, [userPosts]);

  const handleFollow = async () => {
    if (!currentUser?.id || !id) return;
    triggerHaptic('medium');
    if (isFollowingState) {
      setFollowCounts(c => ({ ...c, followers: Math.max(0, c.followers - 1) }));
      await queueMutation('unfollow', { followerId: currentUser.id, followingId: id });
    } else {
      setFollowCounts(c => ({ ...c, followers: c.followers + 1 }));
      await queueMutation('follow', { followerId: currentUser.id, followingId: id });
    }
  };

  if (isLoading && !displayProfile) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={theme.colors.accent.primary} /></View>;
  }

  if (!displayProfile) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="body" color={theme.colors.text.tertiary}>Пользователь не найден</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}><Text variant="body" color={theme.colors.accent.primary}>Назад</Text></Pressable>
      </View>
    );
  }

  const isOwnProfile = currentUser?.id === displayProfile.id;
  const bannerUrl = displayProfile.banner_url;
  const profileLinksRaw = displayProfile.links;
  const userLinks: { type: string; url: string }[] = profileLinksRaw ? (typeof profileLinksRaw === 'string' ? JSON.parse(profileLinksRaw) : profileLinksRaw) : [];
  const tabs: { key: TabName; label: string }[] = [
    { key: 'posts', label: 'Посты' }, { key: 'replies', label: 'Ответы' },
    { key: 'media', label: 'Медиа' }, { key: 'likes', label: 'Лайки' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header gradient overlay - smooth opacity based on scroll */}
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, height: insets.top + 50, opacity: headerOpacity }} pointerEvents="none">
        <LinearGradient colors={[theme.colors.background.primary, theme.colors.background.primary, theme.colors.background.primary + '00']} locations={[0, 0.6, 1]} style={{ flex: 1 }} />
      </Animated.View>

      {/* Fixed header buttons - animate out on scroll */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 100 }}>
        <Animated.View style={{ transform: [{ translateX: buttonsTranslateX }] }}>
          <Pressable onPress={() => router.back()} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="chevron-left" size={18} color="#FFFFFF" />
          </Pressable>
        </Animated.View>
        <Animated.View style={{ transform: [{ translateX: menuTranslateX }] }}>
          <Pressable onPress={() => { triggerHaptic('light'); setShowMenu(true); }} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="more-horizontal" size={18} color="#FFFFFF" />
          </Pressable>
        </Animated.View>
      </View>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        bounces={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* Banner */}
        <View style={{ height: 150, backgroundColor: theme.colors.accent.primary + '20' }}>
          {bannerUrl ? <Image source={{ uri: bannerUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
          <LinearGradient colors={['transparent', theme.colors.background.primary]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 50 }} />
        </View>

        {/* Profile info */}
        <View style={{ paddingHorizontal: 16, marginTop: -36 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, overflow: 'hidden', borderWidth: 3, borderColor: theme.colors.background.primary, backgroundColor: theme.isDark ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' }}>
            <Avatar emoji={displayProfile.emoji || '😊'} size="lg" />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text variant="body" weight="bold" numberOfLines={1}>{displayProfile.display_name}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>@{displayProfile.username}</Text>
            </View>
            {!isOwnProfile && (
              <Pressable onPress={handleFollow} style={{ paddingHorizontal: 20, paddingVertical: 8, backgroundColor: isFollowingState ? 'transparent' : theme.colors.accent.primary, borderWidth: isFollowingState ? 1 : 0, borderColor: theme.colors.border.medium, borderRadius: 8 }}>
                <Text variant="caption" weight="semibold" color={isFollowingState ? theme.colors.text.primary : '#FFFFFF'}>{isFollowingState ? 'Отписаться' : 'Подписаться'}</Text>
              </Pressable>
            )}
          </View>

          <View style={{ flexDirection: 'row', marginTop: 10, gap: 16 }}>
            <Text variant="caption"><Text variant="caption" weight="bold">{displayPosts.length}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>posts</Text></Text>
            <Text variant="caption"><Text variant="caption" weight="bold">{followCounts.following}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>following</Text></Text>
            <Text variant="caption"><Text variant="caption" weight="bold">{followCounts.followers}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>followers</Text></Text>
          </View>

          {displayProfile.bio ? <LinkedText style={{ marginTop: 8 }}>{displayProfile.bio}</LinkedText> : null}
          {userLinks.length > 0 && <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>{userLinks.map((link: any, idx: number) => <SocialLinkIcon key={idx} type={link.type} url={link.url} />)}</View>}
        </View>

        {/* Tabs */}
        <View style={{ marginTop: 16, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
          <View style={{ flexDirection: 'row' }}>
            {tabs.map((tab) => (
              <Pressable key={tab.key} onPress={() => { triggerHaptic('selection'); setActiveTab(tab.key); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 11 }}>
                <Text variant="caption" weight={activeTab === tab.key ? 'bold' : 'regular'} color={activeTab === tab.key ? theme.colors.text.primary : theme.colors.text.tertiary}>{tab.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ position: 'absolute', bottom: 0, height: 2, backgroundColor: theme.colors.accent.primary, width: SCREEN_WIDTH / 4, left: tabs.findIndex(t => t.key === activeTab) * (SCREEN_WIDTH / 4) }} />
        </View>

        {/* Content */}
        {activeTab === 'posts' && (displayPosts.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}><Text variant="caption" color={theme.colors.text.tertiary}>Ещё нет публикаций</Text></View>
        ) : (
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            {displayPosts.map((post: any) => {
              const postImages: string[] = post.imageUrls && post.imageUrls.length > 0 ? post.imageUrls : post.imageUrl ? [post.imageUrl] : [];
              const hasImage = postImages.length > 0;
              return (
              <Pressable key={post.id} onPress={() => router.push({ pathname: '/comments/[id]', params: { id: post.id } })} style={{ flexDirection: 'row', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.75)', borderRadius: 28, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.4)', shadowColor: theme.isDark ? '#000' : '#c8a060', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 4, overflow: 'hidden' }}>
                {/* Left: Post image (square, rounded) — tap opens fullscreen */}
                {hasImage && (
                  <Pressable onPress={() => setViewingImage({ uri: postImages[0], postId: post.id })}>
                    <CachedImage uri={postImages[0]} style={{ width: 100, height: 100, borderRadius: 20 }} resizeMode="cover" />
                  </Pressable>
                )}
                {/* Right: Info */}
                <View style={{ flex: 1, marginLeft: hasImage ? 14 : 4, justifyContent: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Avatar emoji={displayProfile.emoji || '😊'} size="xs" />
                    <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>{displayProfile.display_name}</Text>
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
            })}
          </View>
        ))}
        {activeTab !== 'posts' && <View style={{ alignItems: 'center', paddingVertical: 40 }}><Text variant="caption" color={theme.colors.text.tertiary}>Пока пусто</Text></View>}
      </Animated.ScrollView>

      {/* Bottom gradient - always visible */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, zIndex: 90 }} pointerEvents="none">
        <LinearGradient colors={['transparent', theme.colors.background.primary]} locations={[0, 0.8]} style={{ flex: 1 }} />
      </View>

      {/* Floating badge - animated */}
      {!isOwnProfile && (
        <Animated.View style={{ position: 'absolute', bottom: 28, left: 0, right: 0, alignItems: 'center', zIndex: 100, opacity: badgeOpacity, transform: [{ translateY: badgeTranslateY }] }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, gap: 8,
            borderRadius: 20,
            backgroundColor: theme.isDark ? 'rgba(22,22,22,0.95)' : 'rgba(255,255,255,0.95)',
            shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 6,
            borderWidth: 0.5, borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
          }}>
            <Avatar emoji={displayProfile.emoji || '😊'} size="xs" />
            <Text variant="caption" weight="semibold" numberOfLines={1} style={{ maxWidth: 100 }}>{displayProfile.display_name}</Text>
            <Pressable onPress={handleFollow} style={{ paddingHorizontal: 12, paddingVertical: 5, backgroundColor: isFollowingState ? 'transparent' : theme.colors.accent.primary, borderWidth: isFollowingState ? 1 : 0, borderColor: theme.colors.border.medium, borderRadius: 12 }}>
              <Text variant="caption" weight="semibold" color={isFollowingState ? theme.colors.text.primary : '#FFFFFF'} style={{ fontSize: 11 }}>{isFollowingState ? 'Отписаться' : 'Подписаться'}</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}

      <ProfileMenuModal visible={showMenu} profile={displayProfile} onClose={() => setShowMenu(false)} />

      {/* Fullscreen Image Viewer */}
      <Modal visible={!!viewingImage} transparent animationType="fade" onRequestClose={() => setViewingImage(null)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }}>
          {/* Close button — top right */}
          <Pressable onPress={() => setViewingImage(null)} style={{ position: 'absolute', top: insets.top + 12, right: 16, zIndex: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="x" size={20} color="#FFFFFF" />
          </Pressable>

          {/* Image */}
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            {viewingImage && <Image source={{ uri: viewingImage.uri }} style={{ width: SCREEN_WIDTH - 32, height: SCREEN_WIDTH - 32, borderRadius: 16 }} resizeMode="contain" />}
          </View>

          {/* Bottom actions */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingBottom: insets.bottom + 20 }}>
            {/* Edit — only for own posts */}
            {isOwnProfile ? (
              <Pressable onPress={() => { setViewingImage(null); router.push('/(tabs)/create'); }} style={{ alignItems: 'center' }}>
                <Feather name="edit-2" size={20} color="#FFFFFF" />
                <Text variant="caption" color="#FFFFFF" style={{ marginTop: 4, fontSize: 10 }}>Редактировать</Text>
              </Pressable>
            ) : <View style={{ width: 60 }} />}

            {/* Share — center */}
            <Pressable onPress={async () => { if (viewingImage) { try { await Share.share({ message: viewingImage.uri }); } catch {} } }} style={{ alignItems: 'center' }}>
              <Feather name="share" size={20} color="#FFFFFF" />
              <Text variant="caption" color="#FFFFFF" style={{ marginTop: 4, fontSize: 10 }}>Поделиться</Text>
            </Pressable>

            {/* Delete — only for own posts */}
            {isOwnProfile ? (
              <Pressable onPress={() => { if (viewingImage) { Alert.alert('Удалить пост?', 'Это действие нельзя отменить', [{ text: 'Отмена', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: async () => { if (currentUser?.id) { await deletePost(viewingImage.postId, currentUser.id); } setViewingImage(null); } }]); } }} style={{ alignItems: 'center' }}>
                <Feather name="trash-2" size={20} color="#FF3B30" />
                <Text variant="caption" color="#FF3B30" style={{ marginTop: 4, fontSize: 10 }}>Удалить</Text>
              </Pressable>
            ) : <View style={{ width: 60 }} />}
          </View>
        </View>
      </Modal>
    </View>
  );
}
