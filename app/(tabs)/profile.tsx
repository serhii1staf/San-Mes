import React, { useState, useRef, useEffect } from 'react';
import { View, Pressable, ViewStyle, ActivityIndicator, StyleSheet, Animated, Dimensions, Image } from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { supabase } from '../../src/lib/supabase';
import { openUrl } from '../../src/utils/openUrl';

const SCREEN_WIDTH = Dimensions.get('window').width;

type TabName = 'posts' | 'saved' | 'tagged';

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

// Clickable social link icon
function SocialLinkIcon({ type, url }: { type: string; url: string }) {
  const theme = useTheme();

  // Map to FontAwesome5 brand icons (real logos)
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
      onPress={() => { openUrl(url); }}
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: icon.color + '15',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {icon.isBrand ? (
        <FontAwesome5 name={icon.name} size={17} color={icon.color} brand />
      ) : (
        <Feather name={icon.name as any} size={18} color={icon.color} />
      )}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user, updateProfile: updateLocalProfile } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabName>('posts');
  const scrollY = useRef(new Animated.Value(0)).current;

  // Sync profile from Supabase on mount
  useEffect(() => {
    if (user?.id) {
      syncProfileFromSupabase();
    }
  }, [user?.id]);

  const syncProfileFromSupabase = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (data && !error) {
        const links = data.links ? (typeof data.links === 'string' ? JSON.parse(data.links) : data.links) : [];
        updateLocalProfile({
          displayName: data.display_name,
          emoji: data.emoji,
          bio: data.bio || '',
          links,
        });
      }
    } catch (e) {
      // Silent fail — use local data
    }
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

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const bgColor = theme.colors.background.primary;
  const bgTransparent = theme.colors.background.primary + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  const headerEmojiOpacity = scrollY.interpolate({
    inputRange: [80, 140],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { useNativeDriver: false }
  );

  return (
    <View style={containerStyle}>
      {/* Header */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, height: headerGradientHeight }} pointerEvents="box-none">
        <LinearGradient
          colors={[bgColor, bgColor, bgTransparent]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingTop: insets.top + 8,
            paddingBottom: 8,
          }}
          pointerEvents="auto"
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="subheading" weight="bold">@{displayUser.username}</Text>
            <Animated.View style={{ opacity: headerEmojiOpacity, marginLeft: 8 }}>
              <Avatar emoji={displayUser.emoji} size="sm" />
            </Animated.View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Pressable onPress={() => router.push('/profile/edit')}>
              <Feather name="edit-2" size={20} color={theme.colors.text.primary} />
            </Pressable>
            <Pressable onPress={() => router.push('/settings')}>
              <Feather name="settings" size={22} color={theme.colors.text.primary} />
            </Pressable>
          </View>
        </View>
      </View>

      {/* Scrollable Content */}
      <Animated.ScrollView
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100, paddingTop: headerContentHeight }}
      >
        {/* Profile banner */}
        <Pressable onPress={() => router.push('/profile/edit')} style={{ height: 100, marginHorizontal: 20, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.colors.accent.primary + '20', marginTop: 8 }}>
          {(user as any)?.bannerUrl ? (
            <Image source={{ uri: (user as any).bannerUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 40 }}>{displayUser.emoji}</Text>
            </View>
          )}
        </Pressable>

        {/* Profile row: LEFT = stats, RIGHT = avatar */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginTop: 16 }}>
          {/* Left side: compact stats */}
          <View style={{ flex: 1, flexDirection: 'row', gap: 16 }}>
            <View style={{ alignItems: 'center' }}>
              <Text variant="body" weight="bold">0</Text>
              <Text variant="caption" color={theme.colors.text.tertiary}>Посты</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text variant="body" weight="bold">0</Text>
              <Text variant="caption" color={theme.colors.text.tertiary}>Подписчики</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text variant="body" weight="bold">0</Text>
              <Text variant="caption" color={theme.colors.text.tertiary}>Подписки</Text>
            </View>
          </View>
          {/* Right side: avatar */}
          <Avatar emoji={displayUser.emoji} size="xl" />
        </View>

        {/* Name */}
        <View style={{ paddingHorizontal: 20, marginTop: 12 }}>
          <Text variant="body" weight="bold">
            {displayUser.displayName}
          </Text>
        </View>

        {/* Bio */}
        {displayUser.bio ? (
          <View style={{ paddingHorizontal: 20, marginTop: 2 }}>
            <Text variant="caption" color={theme.colors.text.secondary}>
              {displayUser.bio}
            </Text>
          </View>
        ) : null}

        {/* Clickable social link icons */}
        {userLinks.length > 0 && (
          <View style={{ flexDirection: 'row', paddingHorizontal: 20, marginTop: 10, gap: 10 }}>
            {userLinks.map((link, idx) => (
              <SocialLinkIcon key={idx} type={link.type} url={link.url} />
            ))}
          </View>
        )}

        {/* Tabs */}
        <View style={{ marginTop: 20, borderTopWidth: 1, borderTopColor: theme.colors.border.light }}>
          <View style={{ flexDirection: 'row' }}>
            {([
              { key: 'posts' as TabName, icon: 'grid' },
              { key: 'saved' as TabName, icon: 'bookmark' },
              { key: 'tagged' as TabName, icon: 'tag' },
            ]).map((tab) => (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}
              >
                <Feather
                  name={tab.icon as any}
                  size={20}
                  color={activeTab === tab.key ? theme.colors.accent.primary : theme.colors.text.tertiary}
                />
              </Pressable>
            ))}
          </View>
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              height: 2,
              backgroundColor: theme.colors.accent.primary,
              borderRadius: 1,
              width: (SCREEN_WIDTH - 40) / 3,
              left: (['posts', 'saved', 'tagged'].indexOf(activeTab)) * ((SCREEN_WIDTH - 40) / 3),
              marginLeft: 20,
            }}
          />
        </View>

        {/* Empty state */}
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <Text style={{ fontSize: 32 }}>📷</Text>
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 8 }}>
            Ещё нет публикаций
          </Text>
        </View>
      </Animated.ScrollView>
    </View>
  );
}
