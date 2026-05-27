import React, { useState, useEffect } from 'react';
import { View, Pressable, ActivityIndicator, Dimensions, Image, ScrollView, Platform } from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { getPosts, loadProfileMeta, getFollowCounts } from '../../src/lib/supabase';
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
  if (lower.includes('t.me') || lower.includes('telegram')) return 'telegram';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('linkedin.com')) return 'linkedin';
  if (lower.includes('discord.gg') || lower.includes('discord.com')) return 'discord';
  if (lower.includes('twitch.tv')) return 'twitch';
  if (lower.includes('spotify.com')) return 'spotify';
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
  const [userPosts, setUserPosts] = useState<Post[]>([]);
  const [profileMeta, setProfileMeta] = useState<{ banner_url?: string; links?: { type: string; url: string }[] } | null>(null);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });

  useEffect(() => {
    if (user?.id) {
      loadUserPosts();
      loadMeta();
      loadFollows();
    }
  }, [user?.id]);

  const loadMeta = async () => {
    if (!user?.id) return;
    const { meta } = await loadProfileMeta(user.id);
    if (meta) setProfileMeta(meta);
  };

  const loadFollows = async () => {
    if (!user?.id) return;
    const counts = await getFollowCounts(user.id);
    setFollowCounts(counts);
  };

  const loadUserPosts = async () => {
    try {
      const { posts: dbPosts } = await getPosts();
      const myPosts = dbPosts.filter((p: any) => p.author_id === user?.id).map((p: any) => ({
        id: p.id, authorId: p.author_id,
        authorName: (Array.isArray(p.profiles) ? p.profiles[0]?.display_name : p.profiles?.display_name) || user?.displayName || '',
        authorUsername: (Array.isArray(p.profiles) ? p.profiles[0]?.username : p.profiles?.username) || user?.username || '',
        authorEmoji: (Array.isArray(p.profiles) ? p.profiles[0]?.emoji : p.profiles?.emoji) || user?.emoji || '😊',
        content: p.content, imageUrl: p.image_url || undefined,
        likesCount: p.likes_count || 0, commentsCount: p.comments_count || 0,
        sharesCount: p.shares_count || 0, isLiked: false, isBookmarked: false, createdAt: p.created_at,
      }));
      setUserPosts(myPosts);
    } catch (e) {}
  };

  if (!user) return <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={theme.colors.accent.primary} /></View>;

  const userLinks: { type: string; url: string }[] = (user as any).links || profileMeta?.links || [];
  const bannerUrl = (user as any)?.bannerUrl || profileMeta?.banner_url;
  const tabs: { key: TabName; label: string }[] = [
    { key: 'posts', label: 'Посты' }, { key: 'replies', label: 'Ответы' },
    { key: 'media', label: 'Медиа' }, { key: 'likes', label: 'Лайки' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Banner - full width */}
        <View style={{ height: 150, backgroundColor: theme.colors.accent.primary + '20' }}>
          {bannerUrl ? <Image source={{ uri: bannerUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
          {/* Bottom blur gradient */}
          <LinearGradient
            colors={['transparent', theme.colors.background.primary]}
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 50 }}
          />
          {/* Overlay buttons */}
          <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Pressable onPress={() => { triggerHaptic('light'); router.push('/settings'); }} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="settings" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>

        {/* Profile info */}
        <View style={{ paddingHorizontal: 16, marginTop: -36 }}>
          {/* Avatar with glass container */}
          <View style={{ width: 72, height: 72, borderRadius: 36, overflow: 'hidden', borderWidth: 3, borderColor: theme.colors.background.primary }}>
            <BlurView intensity={80} tint={theme.isDark ? 'dark' : 'light'} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.isDark ? 'rgba(30,30,30,0.6)' : 'rgba(255,255,255,0.6)' }}>
              <Avatar emoji={user.emoji} size="lg" />
            </BlurView>
          </View>

          {/* Name row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text variant="body" weight="bold">{user.displayName}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary}>@{user.username}</Text>
            </View>
            {/* Edit button - top right */}
            <Pressable onPress={() => { triggerHaptic('light'); router.push('/profile/edit'); }} style={{ paddingHorizontal: 16, paddingVertical: 7, borderWidth: 1, borderColor: theme.colors.border.medium, borderRadius: 8 }}>
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
          {user.bio ? <Text variant="body" color={theme.colors.text.secondary} style={{ marginTop: 8 }}>{user.bio}</Text> : null}

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
                {post.imageUrl && <Image source={{ uri: post.imageUrl }} style={{ width: '100%', height: 160, borderRadius: 10, marginBottom: 10 }} resizeMode="cover" />}
                {post.content ? <Text variant="body">{post.content}</Text> : null}
                <View style={{ flexDirection: 'row', marginTop: 8, gap: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Feather name="heart" size={13} color={theme.colors.text.tertiary} /><Text variant="caption" color={theme.colors.text.tertiary}>{post.likesCount}</Text></View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Feather name="message-circle" size={13} color={theme.colors.text.tertiary} /><Text variant="caption" color={theme.colors.text.tertiary}>{post.commentsCount}</Text></View>
                </View>
              </Pressable>
            ))}
          </View>
        ))}
        {activeTab !== 'posts' && <View style={{ alignItems: 'center', paddingVertical: 40 }}><Text variant="caption" color={theme.colors.text.tertiary}>Пока пусто</Text></View>}
      </ScrollView>
    </View>
  );
}
