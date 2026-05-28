import React, { useEffect, useState, useRef } from 'react';
import { View, Pressable, ActivityIndicator, Image, Dimensions, Modal, Animated, Share, Alert } from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { LinkedText } from '../../src/components/ui/LinkedText';
import { supabase, getPosts, loadProfileMeta } from '../../src/lib/supabase';
import { useAuthStore } from '../../src/store';
import { followUser, unfollowUser, isFollowing as checkIsFollowing, getFollowCounts } from '../../src/lib/supabase';
import { openUrl } from '../../src/utils/openUrl';
import { triggerHaptic } from '../../src/utils/haptics';
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
  if (lower.includes('t.me') || lower.includes('telegram')) return 'telegram';
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
  const [showReport, setShowReport] = useState(false);
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
      setShowReport(false);
      onClose();
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
    setShowReport(false);
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

  // Report categories
  if (showReport) {
    return (
      <Modal visible={visible} transparent animationType="none" onRequestClose={() => { setShowReport(false); handleClose(); }} statusBarTranslucent>
        <View style={{ flex: 1 }}>
          <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdropAnim }}>
            <Pressable style={{ flex: 1 }} onPress={() => { setShowReport(false); handleClose(); }} />
          </Animated.View>
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <View style={{ marginHorizontal: 8, marginBottom: insets.bottom + 20, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden' }}>
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)' }} />
              </View>
              <Text variant="body" weight="semibold" align="center" style={{ paddingVertical: 12 }}>Причина жалобы</Text>
              {REPORT_CATEGORIES.map((cat, i) => (
                <Pressable key={i} onPress={() => handleReport(cat)} style={{ paddingVertical: 14, paddingHorizontal: 20, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}>
                  <Text variant="body">{cat}</Text>
                </Pressable>
              ))}
              <View style={{ height: 12 }} />
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        {/* Backdrop */}
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={handleClose} />
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY }] }} {...panResponder.panHandlers}>
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 12 }}>
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)' }} />
              </View>

              {/* Header with avatar + QR in top-right */}
              <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Avatar emoji={profile.emoji || '😊'} size="lg" />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text variant="body" weight="bold" numberOfLines={1}>{profile.display_name}</Text>
                    <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>@{profile.username}</Text>
                  </View>
                  {/* QR mini - tap to enlarge */}
                  <Pressable onPress={() => { triggerHaptic('light'); setShowQR(true); }} style={{ backgroundColor: '#FFF', borderRadius: 8, padding: 4 }}>
                    <Image source={{ uri: qrUrl }} style={{ width: 44, height: 44 }} resizeMode="contain" />
                  </Pressable>
                </View>
              </View>

              {/* Options */}
              <MenuItem icon="link" label="Скопировать ссылку" onPress={handleCopyLink} theme={theme} />
              <MenuItem icon="share-2" label="Поделиться профилем" onPress={handleShare} theme={theme} />
              <MenuItem icon="flag" label="Пожаловаться" onPress={() => { triggerHaptic('light'); setShowReport(true); }} theme={theme} destructive />
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
  const [profile, setProfile] = useState<any>(null);
  const [profileMeta, setProfileMeta] = useState<{ banner_url?: string; links?: { type: string; url: string }[] } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFollowingState, setIsFollowingState] = useState(false);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [activeTab, setActiveTab] = useState<TabName>('posts');
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  const headerOpacity = scrollY.interpolate({ inputRange: [0, 50, 120], outputRange: [0, 0, 1], extrapolate: 'clamp' });
  const buttonsTranslateX = scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, -60], extrapolate: 'clamp' });
  const menuTranslateX = scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, 60], extrapolate: 'clamp' });
  const badgeOpacity = scrollY.interpolate({ inputRange: [180, 220], outputRange: [0, 1], extrapolate: 'clamp' });
  const badgeTranslateY = scrollY.interpolate({ inputRange: [180, 220], outputRange: [20, 0], extrapolate: 'clamp' });

  useEffect(() => { loadProfile(); }, [id]);

  const loadProfile = async () => {
    setIsLoading(true);
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
      setProfile(data);
      if (data) {
        const [metaResult, followResult, countsResult] = await Promise.all([
          loadProfileMeta(data.id),
          currentUser?.id ? checkIsFollowing(currentUser.id, data.id) : Promise.resolve(false),
          getFollowCounts(data.id),
        ]);
        if (metaResult.meta) setProfileMeta(metaResult.meta);
        setIsFollowingState(followResult);
        setFollowCounts(countsResult);
        const { posts: dbPosts } = await getPosts();
        setUserPosts(dbPosts.filter((p: any) => p.author_id === data.id).map((p: any) => ({
          id: p.id, content: p.content, imageUrl: p.image_url || undefined,
          likesCount: p.likes_count || 0, commentsCount: p.comments_count || 0, createdAt: p.created_at,
        })));
      }
    } catch (e) {}
    setIsLoading(false);
  };

  const handleFollow = async () => {
    if (!currentUser?.id || !profile?.id) return;
    triggerHaptic('medium');
    if (isFollowingState) {
      await unfollowUser(currentUser.id, profile.id);
      setIsFollowingState(false);
      setFollowCounts(c => ({ ...c, followers: Math.max(0, c.followers - 1) }));
    } else {
      await followUser(currentUser.id, profile.id);
      setIsFollowingState(true);
      setFollowCounts(c => ({ ...c, followers: c.followers + 1 }));
    }
  };

  if (isLoading) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={theme.colors.accent.primary} /></View>;
  }

  if (!profile) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="body" color={theme.colors.text.tertiary}>Пользователь не найден</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}><Text variant="body" color={theme.colors.accent.primary}>Назад</Text></Pressable>
      </View>
    );
  }

  const isOwnProfile = currentUser?.id === profile.id;
  const bannerUrl = profile.banner_url || profileMeta?.banner_url;
  const userLinks: { type: string; url: string }[] = profile.links || profileMeta?.links || [];
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
            <Avatar emoji={profile.emoji || '😊'} size="lg" />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text variant="body" weight="bold" numberOfLines={1}>{profile.display_name}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>@{profile.username}</Text>
            </View>
            {!isOwnProfile && (
              <Pressable onPress={handleFollow} style={{ paddingHorizontal: 20, paddingVertical: 8, backgroundColor: isFollowingState ? 'transparent' : theme.colors.accent.primary, borderWidth: isFollowingState ? 1 : 0, borderColor: theme.colors.border.medium, borderRadius: 8 }}>
                <Text variant="caption" weight="semibold" color={isFollowingState ? theme.colors.text.primary : '#FFFFFF'}>{isFollowingState ? 'Отписаться' : 'Подписаться'}</Text>
              </Pressable>
            )}
          </View>

          <View style={{ flexDirection: 'row', marginTop: 10, gap: 16 }}>
            <Text variant="caption"><Text variant="caption" weight="bold">{userPosts.length}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>posts</Text></Text>
            <Text variant="caption"><Text variant="caption" weight="bold">{followCounts.following}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>following</Text></Text>
            <Text variant="caption"><Text variant="caption" weight="bold">{followCounts.followers}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>followers</Text></Text>
          </View>

          {profile.bio ? <LinkedText style={{ marginTop: 8 }}>{profile.bio}</LinkedText> : null}
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
        {activeTab === 'posts' && (userPosts.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}><Text variant="caption" color={theme.colors.text.tertiary}>Ещё нет публикаций</Text></View>
        ) : (
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            {userPosts.map((post: any) => (
              <Pressable key={post.id} onPress={() => router.push({ pathname: '/comments/[id]', params: { id: post.id } })} style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 14, padding: 14, marginBottom: 10 }}>
                {post.imageUrl && <Image source={{ uri: post.imageUrl }} style={{ width: '100%', height: 160, borderRadius: 10, marginBottom: 10 }} resizeMode="cover" />}
                {post.content ? <Text variant="body" numberOfLines={3}>{post.content}</Text> : null}
                <View style={{ flexDirection: 'row', marginTop: 8, gap: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Feather name="heart" size={13} color={theme.colors.text.tertiary} /><Text variant="caption" color={theme.colors.text.tertiary}>{post.likesCount}</Text></View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Feather name="message-circle" size={13} color={theme.colors.text.tertiary} /><Text variant="caption" color={theme.colors.text.tertiary}>{post.commentsCount}</Text></View>
                </View>
              </Pressable>
            ))}
          </View>
        ))}
        {activeTab !== 'posts' && <View style={{ alignItems: 'center', paddingVertical: 40 }}><Text variant="caption" color={theme.colors.text.tertiary}>Пока пусто</Text></View>}
      </Animated.ScrollView>

      {/* Floating badge - animated */}
      {!isOwnProfile && (
        <Animated.View style={{ position: 'absolute', bottom: 108, left: 0, right: 0, alignItems: 'center', opacity: badgeOpacity, transform: [{ translateY: badgeTranslateY }] }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, gap: 8,
            borderRadius: 20,
            backgroundColor: theme.isDark ? 'rgba(22,22,22,0.95)' : 'rgba(255,255,255,0.95)',
            shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 6,
            borderWidth: 0.5, borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
          }}>
            <Avatar emoji={profile.emoji || '😊'} size="xs" />
            <Text variant="caption" weight="semibold" numberOfLines={1} style={{ maxWidth: 100 }}>{profile.display_name}</Text>
            <Pressable onPress={handleFollow} style={{ paddingHorizontal: 12, paddingVertical: 5, backgroundColor: isFollowingState ? 'transparent' : theme.colors.accent.primary, borderWidth: isFollowingState ? 1 : 0, borderColor: theme.colors.border.medium, borderRadius: 12 }}>
              <Text variant="caption" weight="semibold" color={isFollowingState ? theme.colors.text.primary : '#FFFFFF'} style={{ fontSize: 11 }}>{isFollowingState ? 'Отписаться' : 'Подписаться'}</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}

      <ProfileMenuModal visible={showMenu} profile={profile} onClose={() => setShowMenu(false)} />
    </View>
  );
}
