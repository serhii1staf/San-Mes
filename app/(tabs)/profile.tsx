import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Pressable, ActivityIndicator, Dimensions, Image, Animated, Modal, ScrollView as RNScrollView, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { LinkedText } from '../../src/components/ui/LinkedText';
import { useAuthStore, useEntityStore } from '../../src/store';
import { isRepost, parseImageUrls } from '../../src/lib/supabase';
import { syncMyProfile, syncFeed } from '../../src/lib/syncEngine';
import { openUrl } from '../../src/utils/openUrl';
import { Post } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';
import { LocalPost } from '../../src/lib/entityStore';
import { getDatabase } from '../../src/lib/database';

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
  if (lower.includes('spotify.com') || lower.includes('open.spotify.com')) return 'spotify';
  if (lower.includes('reddit.com')) return 'reddit';
  if (lower.includes('pinterest.com')) return 'pinterest';
  if (lower.includes('snapchat.com')) return 'snapchat';
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

  // Read from entity store (SSOT)
  const myPosts = useEntityStore((s) => user?.id ? s.getMyPosts(user.id) : []);
  const myProfile = useEntityStore((s) => user?.id ? s.getProfile(user.id) : undefined);
  const profiles = useEntityStore((s) => s.profiles);

  // Compute user posts as Post[] for display
  const userPosts: Post[] = React.useMemo(() => {
    if (!myPosts.length || !user?.id) return [];
    return myPosts.map((p) => {
      const repostInfo = isRepost(p.content || '');
      const parsedImages = parseImageUrls(p.image_url);
      const post: Post = {
        id: p.id,
        authorId: p.author_id,
        authorName: user.displayName || '',
        authorUsername: user.username || '',
        authorEmoji: user.emoji || '😊',
        content: repostInfo.isRepost ? (repostInfo.comment || '') : p.content,
        imageUrl: parsedImages[0] || undefined,
        imageUrls: parsedImages.length > 0 ? parsedImages : undefined,
        likesCount: p.likes_count || 0,
        commentsCount: p.comments_count || 0,
        sharesCount: p.shares_count || 0,
        isLiked: false,
        isBookmarked: false,
        createdAt: p.created_at,
        isRepost: repostInfo.isRepost,
      };

      // Resolve original post for reposts
      if (repostInfo.isRepost && repostInfo.originalPostId) {
        const origPost = useEntityStore.getState().getPost(repostInfo.originalPostId);
        if (origPost) {
          const origProfile = profiles[origPost.author_id];
          const origImages = parseImageUrls(origPost.image_url);
          post.originalPost = {
            id: origPost.id,
            authorName: origProfile?.display_name || 'User',
            authorUsername: origProfile?.username || 'user',
            authorEmoji: origProfile?.emoji || '😊',
            content: origPost.content,
            imageUrl: origImages[0] || undefined,
            imageUrls: origImages.length > 0 ? origImages : undefined,
          };
        }
      }
      return post;
    });
  }, [myPosts, user, profiles]);

  // Load follow counts from local DB
  const loadFollows = useCallback(() => {
    if (!user?.id) return;
    try {
      const db = getDatabase();
      const followersRow = db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) as count FROM follows WHERE following_id = ?',
        [user.id]
      );
      const followingRow = db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) as count FROM follows WHERE follower_id = ?',
        [user.id]
      );
      setFollowCounts({
        followers: followersRow?.count || 0,
        following: followingRow?.count || 0,
      });
    } catch {}
  }, [user?.id]);

  // Refresh data when tab is focused
  useFocusEffect(
    useCallback(() => {
      if (user?.id) {
        loadFollows();
        // Trigger background sync (non-blocking)
        syncMyProfile(user.id).catch(() => {});
        syncFeed(user.id).catch(() => {});
      }
    }, [user?.id])
  );

  if (!user) return <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={theme.colors.accent.primary} /></View>;

  const profileLinks = myProfile?.links ? (typeof myProfile.links === 'string' ? JSON.parse(myProfile.links) : myProfile.links) : null;
  const userLinks: { type: string; url: string }[] = (user as any).links || profileLinks || [];
  const bannerUrl = (user as any)?.bannerUrl || myProfile?.banner_url;
  const tabs: { key: TabName; label: string }[] = [
    { key: 'posts', label: 'Посты' }, { key: 'replies', label: 'Ответы' },
    { key: 'media', label: 'Медиа' }, { key: 'likes', label: 'Лайки' },
  ];

  const scrollY = useRef(new Animated.Value(0)).current;
  const headerOpacity = scrollY.interpolate({ inputRange: [0, 50, 120], outputRange: [0, 0, 1], extrapolate: 'clamp' });
  const buttonsTranslateX = scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, -60], extrapolate: 'clamp' });
  const settingsTranslateX = scrollY.interpolate({ inputRange: [0, 180, 250], outputRange: [0, 0, 60], extrapolate: 'clamp' });
  const [showQR, setShowQR] = useState(false);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://san-mes.vercel.app/profile/${user.id}`)}`;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header gradient overlay */}
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, height: insets.top + 50, opacity: headerOpacity }} pointerEvents="none">
        <LinearGradient colors={[theme.colors.background.primary, theme.colors.background.primary, theme.colors.background.primary + '00']} locations={[0, 0.6, 1]} style={{ flex: 1 }} />
      </Animated.View>

      {/* Fixed header buttons */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 100 }}>
        <Animated.View style={{ transform: [{ translateX: buttonsTranslateX }] }}>
          <Pressable onPress={() => { triggerHaptic('light'); setShowQR(true); }} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}>
            <FontAwesome5 name="qrcode" size={15} color="#FFFFFF" />
          </Pressable>
        </Animated.View>
        <Animated.View style={{ transform: [{ translateX: settingsTranslateX }] }}>
          <Pressable onPress={() => { triggerHaptic('light'); router.push('/settings'); }} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="settings" size={16} color="#FFFFFF" />
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
        {/* Banner - full width */}
        <View style={{ height: 150, backgroundColor: theme.colors.accent.primary + '20' }}>
          {bannerUrl ? <Image source={{ uri: bannerUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
          <LinearGradient
            colors={['transparent', theme.colors.background.primary]}
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 50 }}
          />
        </View>

        {/* Profile info */}
        <View style={{ paddingHorizontal: 16, marginTop: -36 }}>
          {/* Avatar with frosted container */}
          <View style={{ width: 72, height: 72, borderRadius: 36, overflow: 'hidden', borderWidth: 3, borderColor: theme.colors.background.primary, backgroundColor: theme.isDark ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' }}>
            <Avatar emoji={user.emoji} size="lg" />
          </View>

          {/* Name row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text variant="body" weight="bold" numberOfLines={1}>{user.displayName}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>@{user.username}</Text>
            </View>
            {/* Edit button - top right */}
            <Pressable onPress={() => { triggerHaptic('light'); router.push('/profile/edit'); }} style={{ paddingHorizontal: 16, paddingVertical: 7, borderWidth: 1, borderColor: theme.colors.border.medium, borderRadius: 20 }}>
              <Text variant="caption" weight="semibold">Редактировать</Text>
            </Pressable>
          </View>

          {/* Stats inline */}
          <View style={{ flexDirection: 'row', marginTop: 10, gap: 16 }}>
            <Text variant="caption"><Text variant="caption" weight="bold">{userPosts.length}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>posts</Text></Text>
            <Text variant="caption"><Text variant="caption" weight="bold">{followCounts.following}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>following</Text></Text>
            <Text variant="caption"><Text variant="caption" weight="bold">{followCounts.followers}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>followers</Text></Text>
          </View>

          {/* Bio */}
          {user.bio ? <LinkedText style={{ marginTop: 8 }}>{user.bio}</LinkedText> : null}

          {/* Links */}
          {userLinks.length > 0 && (
            <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>
              {userLinks.map((link, idx) => <SocialLinkIcon key={idx} type={link.type} url={link.url} />)}
            </View>
          )}
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
            {userPosts.map(post => (
              <Pressable key={post.id} onPress={() => router.push({ pathname: '/comments/[id]', params: { id: post.id } })} style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 14, padding: 14, marginBottom: 10 }}>
                {post.isRepost && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 4 }}>
                    <Feather name="repeat" size={12} color={theme.colors.text.tertiary} />
                    <Text variant="caption" color={theme.colors.text.tertiary}>Репост</Text>
                  </View>
                )}
                {post.isRepost && post.originalPost ? (
                  <View style={{ borderWidth: 1, borderColor: theme.colors.border.light, borderRadius: 10, padding: 10, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
                    <Text variant="caption" weight="semibold" numberOfLines={1}>{post.originalPost.authorName}</Text>
                    {post.originalPost.content ? <Text variant="body" numberOfLines={3} style={{ marginTop: 4 }}>{post.originalPost.content}</Text> : null}
                    {post.originalPost.imageUrl && <Image source={{ uri: post.originalPost.imageUrl }} style={{ width: '100%', height: 120, borderRadius: 8, marginTop: 8 }} resizeMode="cover" />}
                  </View>
                ) : (
                  <>
                    {(() => {
                      const postImages = post.imageUrls && post.imageUrls.length > 0 ? post.imageUrls : post.imageUrl ? [post.imageUrl] : [];
                      if (postImages.length === 0) return null;
                      if (postImages.length === 1) {
                        return <Image source={{ uri: postImages[0] }} style={{ width: '100%', height: 160, borderRadius: 10, marginBottom: 10 }} resizeMode="cover" />;
                      }
                      return (
                        <View style={{ marginBottom: 10 }}>
                          <RNScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={(SCREEN_WIDTH - 80) * 0.8 + 6} decelerationRate="fast" contentContainerStyle={{ gap: 6 }}>
                            {postImages.map((url: string, idx: number) => (
                              <Image key={idx} source={{ uri: url }} style={{ width: (SCREEN_WIDTH - 80) * 0.8, height: 160, borderRadius: 10 }} resizeMode="cover" />
                            ))}
                          </RNScrollView>
                          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 6, gap: 4 }}>
                            {postImages.map((_: string, idx: number) => (
                              <View key={idx} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: theme.colors.text.tertiary + '60' }} />
                            ))}
                          </View>
                        </View>
                      );
                    })()}
                    {post.content ? <Text variant="body" numberOfLines={3}>{post.content}</Text> : null}
                  </>
                )}
                {post.content && post.isRepost && <Text variant="body" color={theme.colors.text.secondary} style={{ marginTop: 6 }}>{post.content}</Text>}
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

      {/* QR Modal */}
      <Modal visible={showQR} transparent animationType="fade" onRequestClose={() => setShowQR(false)} statusBarTranslucent>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' }} onPress={() => setShowQR(false)}>
          <Text variant="body" weight="bold" color="#FFFFFF" style={{ marginBottom: 20 }}>Мой QR-код</Text>
          <View style={{ backgroundColor: '#FFF', borderRadius: 20, padding: 20 }}>
            <Image source={{ uri: qrUrl }} style={{ width: 200, height: 200 }} resizeMode="contain" />
          </View>
          <Text variant="caption" color="#FFFFFF" style={{ marginTop: 20, opacity: 0.7 }}>Нажмите чтобы закрыть</Text>
        </Pressable>
      </Modal>
    </View>
  );
}
