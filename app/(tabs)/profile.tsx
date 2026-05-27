import React, { useState, useRef, useEffect } from 'react';
import { View, Pressable, ViewStyle, ActivityIndicator, StyleSheet, Animated, Dimensions, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { supabase } from '../../src/lib/supabase';

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

  const iconMap: Record<string, { name: string; color: string }> = {
    github: { name: 'github', color: '#333333' },
    twitter: { name: 'twitter', color: '#1DA1F2' },
    instagram: { name: 'instagram', color: '#E4405F' },
    youtube: { name: 'youtube', color: '#FF0000' },
    telegram: { name: 'send', color: '#0088CC' },
    linkedin: { name: 'linkedin', color: '#0A66C2' },
    twitch: { name: 'tv', color: '#9146FF' },
    spotify: { name: 'music', color: '#1DB954' },
    tiktok: { name: 'play-circle', color: '#000000' },
    discord: { name: 'message-circle', color: '#5865F2' },
    website: { name: 'globe', color: '#2563EB' },
  };

  const detected = detectLinkType(url);
  const icon = iconMap[detected] || iconMap[type] || iconMap.website;
  const displayColor = theme.isDark && icon.color === '#333333' ? '#FFFFFF' : icon.color;

  return (
    <Pressable
      onPress={() => {
        const fullUrl = url.startsWith('http') ? url : `https://${url}`;
        Linking.openURL(fullUrl);
      }}
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: displayColor + '15',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Feather name={icon.name as any} size={18} color={displayColor} />
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
              <Avatar emoji={displayUser.emoji} size="xs" />
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
