import React, { useEffect, useState } from 'react';
import { View, Pressable, ActivityIndicator, ScrollView, Image, Dimensions } from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { supabase, getPosts, loadProfileMeta } from '../../src/lib/supabase';
import { useAuthStore } from '../../src/store';
import { followUser, unfollowUser, isFollowing as checkIsFollowing, getFollowCounts } from '../../src/lib/supabase';
import { openUrl } from '../../src/utils/openUrl';
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

  useEffect(() => { loadProfile(); }, [id]);

  const loadProfile = async () => {
    setIsLoading(true);
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
      setProfile(data);
      if (data) {
        // Load profile meta (banner, links) from Storage
        const { meta } = await loadProfileMeta(data.id);
        if (meta) setProfileMeta(meta);

        if (currentUser?.id) {
          const following = await checkIsFollowing(currentUser.id, data.id);
          setIsFollowingState(following);
          const counts = await getFollowCounts(data.id);
          setFollowCounts(counts);
        }
        // Load user posts
        try {
          const { posts: dbPosts } = await getPosts();
          const posts = dbPosts.filter((p: any) => p.author_id === data.id).map((p: any) => ({
            id: p.id, content: p.content, imageUrl: p.image_url || undefined,
            likesCount: p.likes_count || 0, commentsCount: p.comments_count || 0, createdAt: p.created_at,
          }));
          setUserPosts(posts);
        } catch (e) {}
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
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={theme.colors.accent.primary} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="body" color={theme.colors.text.tertiary}>Пользователь не найден</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text variant="body" color={theme.colors.accent.primary}>Назад</Text>
        </Pressable>
      </View>
    );
  }

  const isOwnProfile = currentUser?.id === profile.id;
  const bannerUrl = profileMeta?.banner_url;
  const userLinks: { type: string; url: string }[] = profileMeta?.links || [];
  const tabs: { key: TabName; label: string }[] = [
    { key: 'posts', label: 'Посты' }, { key: 'replies', label: 'Ответы' },
    { key: 'media', label: 'Медиа' }, { key: 'likes', label: 'Лайки' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <ScrollView showsVerticalScrollIndicator={false} scrollEnabled={userPosts.length > 0 || !!profile?.bio} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Banner - full width */}
        <View style={{ height: 150, backgroundColor: theme.colors.accent.primary + '20' }}>
          {bannerUrl ? <Image source={{ uri: bannerUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
          {/* Overlay buttons */}
          <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.back()} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="chevron-left" size={18} color="#FFFFFF" />
            </Pressable>
            <Pressable style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="more-horizontal" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>

        {/* Profile info */}
        <View style={{ paddingHorizontal: 16, marginTop: -24 }}>
          {/* Avatar */}
          <View style={{ borderWidth: 3, borderColor: theme.colors.background.primary, borderRadius: 36, width: 72, height: 72, overflow: 'visible' }}>
            <Avatar emoji={profile.emoji || '😊'} size="xl" />
          </View>

          {/* Name row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text variant="body" weight="bold">{profile.display_name}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary}>@{profile.username}</Text>
            </View>
            {/* Follow/Edit button */}
            {!isOwnProfile ? (
              <Pressable onPress={handleFollow} style={{
                paddingHorizontal: 20, paddingVertical: 8,
                backgroundColor: isFollowingState ? 'transparent' : theme.colors.accent.primary,
                borderWidth: isFollowingState ? 1 : 0,
                borderColor: theme.colors.border.medium,
                borderRadius: 8,
              }}>
                <Text variant="caption" weight="semibold" color={isFollowingState ? theme.colors.text.primary : '#FFFFFF'}>
                  {isFollowingState ? 'Отписаться' : 'Подписаться'}
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => { triggerHaptic('light'); router.push('/profile/edit'); }} style={{ paddingHorizontal: 16, paddingVertical: 7, borderWidth: 1, borderColor: theme.colors.border.medium, borderRadius: 8 }}>
                <Text variant="caption" weight="semibold">Редактировать</Text>
              </Pressable>
            )}
          </View>

          {/* Stats inline */}
          <View style={{ flexDirection: 'row', marginTop: 10, gap: 16 }}>
            <Text variant="caption"><Text variant="caption" weight="bold">{userPosts.length}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>posts</Text></Text>
            <Text variant="caption"><Text variant="caption" weight="bold">{followCounts.following}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>following</Text></Text>
            <Text variant="caption"><Text variant="caption" weight="bold">{followCounts.followers}</Text> <Text variant="caption" color={theme.colors.text.tertiary}>followers</Text></Text>
          </View>

          {/* Bio */}
          {profile.bio ? <Text variant="body" color={theme.colors.text.secondary} style={{ marginTop: 8 }}>{profile.bio}</Text> : null}

          {/* Links */}
          {userLinks.length > 0 && (
            <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>
              {userLinks.map((link: any, idx: number) => <SocialLinkIcon key={idx} type={link.type} url={link.url} />)}
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
            {userPosts.map((post: any) => (
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
