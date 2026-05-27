import React, { useState, useRef, useEffect } from 'react';
import { View, Pressable, ViewStyle, ActivityIndicator, Animated, Dimensions, Image, ScrollView } from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { supabase, getPosts } from '../../src/lib/supabase';
import { openUrl } from '../../src/utils/openUrl';
import { Post } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';

const SCREEN_WIDTH = Dimensions.get('window').width;

type TabName = 'posts' | 'replies' | 'media' | 'likes';

// Auto-detect link type from URL
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
    <Pressable
      onPress={() => { triggerHaptic('light'); openUrl(url); }}
      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: icon.color + '18', alignItems: 'center', justifyContent: 'center' }}
    >
      {icon.isBrand ? (
        <FontAwesome5 name={icon.name} size={15} color={icon.color} brand />
      ) : (
        <Feather name={icon.name as any} size={16} color={icon.color} />
      )}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user, updateProfile: updateLocalProfile } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabName>('posts');
  const [userPosts, setUserPosts] = useState<Post[]>([]);

  useEffect(() => {
    if (user?.id) {
      syncProfileFromSupabase();
      loadUserPosts();
    }
  }, [user?.id]);

  const loadUserPosts = async () => {
    try {
      const { posts: dbPosts } = await getPosts();
      const myPosts = dbPosts.filter((p: any) => p.author_id === user?.id).map((p: any) => ({
        id: p.id,
        authorId: p.author_id,
        authorName: p.profiles?.display_name || user?.displayName || '',
        authorUsername: p.profiles?.username || user?.username || '',
        authorEmoji: p.profiles?.emoji || user?.emoji || '😊',
        content: p.content,
        imageUrl: p.image_url || undefined,
        likesCount: p.likes_count || 0,
        commentsCount: p.comments_count || 0,
        sharesCount: p.shares_count || 0,
        isLiked: false,
        isBookmarked: false,
        createdAt: p.created_at,
      }));
      setUserPosts(myPosts);
    } catch (e) {}
  };

  const syncProfileFromSupabase = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (data && !error) {
        const links = data.links ? (typeof data.links === 'string' ? JSON.parse(data.links) : data.links) : [];
        updateLocalProfile({ displayName: data.display_name, emoji: data.emoji, bio: data.bio || '', links });
      }
    } catch (e) {}
  };

  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={theme.colors.accent.primary} />
      </View>
    );
  }

  const displayUser = user;
  const userLinks: { type: string; url: string }[] = (user as any).links || [];
  const bannerUrl = (user as any)?.bannerUrl;

  const tabs: { key: TabName; label: string }[] = [
    { key: 'posts', label: 'Посты' },
    { key: 'replies', label: 'Ответы' },
    { key: 'media', label: 'Медиа' },
    { key: 'likes', label: 'Лайки' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Banner */}
        <Pressable onPress={() => router.push('/profile/edit')}>
          <View style={{ height: 140, backgroundColor: bannerUrl ? undefined : theme.colors.accent.primary + '30' }}>
            {bannerUrl ? (
              <Image source={{ uri: bannerUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <View style={{ flex: 1, backgroundColor: theme.colors.accent.primary + '20' }} />
            )}
          </View>
        </Pressable>

        {/* Avatar overlapping banner */}
        <View style={{ alignItems: 'center', marginTop: -40 }}>
          <View style={{ borderWidth: 4, borderColor: theme.colors.background.primary, borderRadius: 44, overflow: 'hidden' }}>
            <Avatar emoji={displayUser.emoji} size="xl" />
          </View>
        </View>

        {/* Name & username */}
        <View style={{ alignItems: 'center', marginTop: 10 }}>
          <Text variant="subheading" weight="bold">{displayUser.displayName}</Text>
          <Text variant="caption" color={theme.colors.text.secondary} style={{ marginTop: 2 }}>@{displayUser.username}</Text>
        </View>

        {/* Stats row */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 14 }}>
          <View style={{ alignItems: 'center' }}>
            <Text variant="body" weight="bold">{userPosts.length}</Text>
            <Text variant="caption" color={theme.colors.text.tertiary}>посты</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text variant="body" weight="bold">0</Text>
            <Text variant="caption" color={theme.colors.text.tertiary}>подписки</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text variant="body" weight="bold">0</Text>
            <Text variant="caption" color={theme.colors.text.tertiary}>подписчики</Text>
          </View>
        </View>

        {/* Bio */}
        {displayUser.bio ? (
          <View style={{ paddingHorizontal: 24, marginTop: 12 }}>
            <Text variant="body" color={theme.colors.text.secondary} align="center">{displayUser.bio}</Text>
          </View>
        ) : null}

        {/* Social links */}
        {userLinks.length > 0 && (
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 10, gap: 10 }}>
            {userLinks.map((link, idx) => (
              <SocialLinkIcon key={idx} type={link.type} url={link.url} />
            ))}
          </View>
        )}

        {/* Edit profile button */}
        <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
          <Pressable
            onPress={() => { triggerHaptic('light'); router.push('/profile/edit'); }}
            style={{
              borderWidth: 1.5,
              borderColor: theme.colors.border.medium,
              borderRadius: 12,
              paddingVertical: 10,
              alignItems: 'center',
            }}
          >
            <Text variant="body" weight="semibold">Редактировать</Text>
          </Pressable>
        </View>

        {/* Settings row */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 12, gap: 12 }}>
          <Pressable onPress={() => { triggerHaptic('light'); router.push('/settings'); }} style={{ padding: 8 }}>
            <Feather name="settings" size={20} color={theme.colors.text.secondary} />
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={{ marginTop: 16, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
          <View style={{ flexDirection: 'row' }}>
            {tabs.map((tab) => (
              <Pressable
                key={tab.key}
                onPress={() => { triggerHaptic('selection'); setActiveTab(tab.key); }}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}
              >
                <Text
                  variant="caption"
                  weight={activeTab === tab.key ? 'bold' : 'regular'}
                  color={activeTab === tab.key ? theme.colors.text.primary : theme.colors.text.tertiary}
                >
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {/* Indicator */}
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              height: 2,
              backgroundColor: theme.colors.accent.primary,
              borderRadius: 1,
              width: SCREEN_WIDTH / 4,
              left: tabs.findIndex(t => t.key === activeTab) * (SCREEN_WIDTH / 4),
            }}
          />
        </View>

        {/* Content */}
        {activeTab === 'posts' && (
          userPosts.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <View style={{ width: 50, height: 50, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 32 }}>📷</Text>
              </View>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 8 }}>Ещё нет публикаций</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              {userPosts.map(post => (
                <Pressable
                  key={post.id}
                  onPress={() => router.push({ pathname: '/comments/[id]', params: { id: post.id } })}
                  style={{
                    backgroundColor: theme.colors.background.elevated,
                    borderRadius: 14,
                    padding: 14,
                    marginBottom: 10,
                  }}
                >
                  {post.imageUrl && (
                    <Image source={{ uri: post.imageUrl }} style={{ width: '100%', height: 160, borderRadius: 10, marginBottom: 10 }} resizeMode="cover" />
                  )}
                  {post.content ? <Text variant="body">{post.content}</Text> : null}
                  <View style={{ flexDirection: 'row', marginTop: 8, gap: 14 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Feather name="heart" size={14} color={theme.colors.text.tertiary} />
                      <Text variant="caption" color={theme.colors.text.tertiary}>{post.likesCount}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Feather name="message-circle" size={14} color={theme.colors.text.tertiary} />
                      <Text variant="caption" color={theme.colors.text.tertiary}>{post.commentsCount}</Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          )
        )}

        {activeTab !== 'posts' && (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Text variant="caption" color={theme.colors.text.tertiary}>Пока пусто</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
