import React, { useState, useEffect } from 'react';
import { View, Pressable, ActivityIndicator, Dimensions, Image, ScrollView, Modal } from 'react-native';
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
      style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: icon.color + '18', alignItems: 'center', justifyContent: 'center' }}
    >
      {icon.isBrand ? (
        <FontAwesome5 name={icon.name} size={14} color={icon.color} brand />
      ) : (
        <Feather name={icon.name as any} size={14} color={icon.color} />
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
  const [showQR, setShowQR] = useState(false);

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
        // Only update from Supabase what's actually stored there
        // Don't overwrite local-only fields (links, bannerUrl) unless Supabase has them
        const updates: any = {
          displayName: data.display_name,
          emoji: data.emoji,
        };
        // Only overwrite bio if Supabase has content
        if (data.bio) updates.bio = data.bio;
        // Don't touch links/bannerUrl - those are stored locally
        updateLocalProfile(updates);
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
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: insets.top + 8, paddingBottom: 8 }}>
        {/* QR button */}
        <Pressable onPress={() => { triggerHaptic('light'); setShowQR(true); }}>
          <Feather name="maximize" size={22} color={theme.colors.text.primary} />
        </Pressable>
        {/* Settings */}
        <Pressable onPress={() => { triggerHaptic('light'); router.push('/settings'); }}>
          <Feather name="settings" size={22} color={theme.colors.text.primary} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Banner - only if set */}
        {bannerUrl ? (
          <Pressable onPress={() => router.push('/profile/edit')} style={{ height: 100, marginHorizontal: 16, borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
            <Image source={{ uri: bannerUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          </Pressable>
        ) : null}

        {/* Main profile row: avatar LEFT, stats RIGHT */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginTop: bannerUrl ? 0 : 8 }}>
          {/* Avatar */}
          <Avatar emoji={displayUser.emoji} size="xl" />
          {/* Stats */}
          <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around', marginLeft: 16 }}>
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
        </View>

        {/* Name + username */}
        <View style={{ paddingHorizontal: 20, marginTop: 12 }}>
          <Text variant="body" weight="bold">{displayUser.displayName}</Text>
          <Text variant="caption" color={theme.colors.text.tertiary}>@{displayUser.username}</Text>
        </View>

        {/* Bio */}
        {displayUser.bio ? (
          <View style={{ paddingHorizontal: 20, marginTop: 6 }}>
            <Text variant="body" color={theme.colors.text.secondary}>{displayUser.bio}</Text>
          </View>
        ) : null}

        {/* Social links */}
        {userLinks.length > 0 && (
          <View style={{ flexDirection: 'row', paddingHorizontal: 20, marginTop: 10, gap: 8 }}>
            {userLinks.map((link, idx) => (
              <SocialLinkIcon key={idx} type={link.type} url={link.url} />
            ))}
          </View>
        )}

        {/* Edit button */}
        <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
          <Pressable
            onPress={() => { triggerHaptic('light'); router.push('/profile/edit'); }}
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border.medium,
              borderRadius: 10,
              paddingVertical: 9,
              alignItems: 'center',
            }}
          >
            <Text variant="caption" weight="semibold">Редактировать профиль</Text>
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={{ marginTop: 18, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
          <View style={{ flexDirection: 'row' }}>
            {tabs.map((tab) => (
              <Pressable
                key={tab.key}
                onPress={() => { triggerHaptic('selection'); setActiveTab(tab.key); }}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 11 }}
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
          <View style={{ position: 'absolute', bottom: 0, height: 2, backgroundColor: theme.colors.accent.primary, borderRadius: 1, width: SCREEN_WIDTH / 4, left: tabs.findIndex(t => t.key === activeTab) * (SCREEN_WIDTH / 4) }} />
        </View>

        {/* Tab content */}
        {activeTab === 'posts' && (
          userPosts.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text variant="caption" color={theme.colors.text.tertiary}>Ещё нет публикаций</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              {userPosts.map(post => (
                <Pressable
                  key={post.id}
                  onPress={() => router.push({ pathname: '/comments/[id]', params: { id: post.id } })}
                  style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 14, padding: 14, marginBottom: 10 }}
                >
                  {post.imageUrl && (
                    <Image source={{ uri: post.imageUrl }} style={{ width: '100%', height: 160, borderRadius: 10, marginBottom: 10 }} resizeMode="cover" />
                  )}
                  {post.content ? <Text variant="body">{post.content}</Text> : null}
                  <View style={{ flexDirection: 'row', marginTop: 8, gap: 14 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Feather name="heart" size={13} color={theme.colors.text.tertiary} />
                      <Text variant="caption" color={theme.colors.text.tertiary}>{post.likesCount}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Feather name="message-circle" size={13} color={theme.colors.text.tertiary} />
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

      {/* QR Modal */}
      <Modal visible={showQR} transparent animationType="slide" onRequestClose={() => setShowQR(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={() => setShowQR(false)}>
          <View style={{ flex: 1 }} />
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={{ marginHorizontal: 16, marginBottom: insets.bottom + 16, backgroundColor: theme.isDark ? '#1C1C1E' : '#FFFFFF', borderRadius: 24, padding: 24, alignItems: 'center' }}>
              {/* QR placeholder */}
              <View style={{ width: 180, height: 180, borderRadius: 16, backgroundColor: theme.colors.background.secondary, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Feather name="maximize" size={60} color={theme.colors.text.tertiary} />
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 8 }}>QR-код</Text>
              </View>
              <Text variant="body" weight="bold">{displayUser.displayName}</Text>
              <Text variant="caption" color={theme.colors.text.secondary}>@{displayUser.username}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 12, textAlign: 'center' }}>
                Отсканируйте для перехода в профиль
              </Text>
              <Pressable onPress={() => setShowQR(false)} style={{ marginTop: 20, paddingVertical: 12, paddingHorizontal: 32, backgroundColor: theme.colors.accent.primary, borderRadius: 12 }}>
                <Text variant="body" weight="semibold" color="#FFFFFF">Закрыть</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
