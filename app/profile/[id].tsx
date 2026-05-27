import React, { useEffect, useState } from 'react';
import { View, Pressable, ActivityIndicator, ScrollView, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { supabase, followUser, unfollowUser, isFollowing as checkIsFollowing, getFollowCounts } from '../../src/lib/supabase';
import { useAuthStore } from '../../src/store';
import { triggerHaptic } from '../../src/utils/haptics';

export default function UserProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { user: currentUser } = useAuthStore();
  const [isFollowingState, setIsFollowingState] = useState(false);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });

  useEffect(() => {
    loadProfile();
  }, [id]);

  const loadProfile = async () => {
    setIsLoading(true);
    const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
    setProfile(data);
    if (data && currentUser?.id) {
      const following = await checkIsFollowing(currentUser.id, data.id);
      setIsFollowingState(following);
      const counts = await getFollowCounts(data.id);
      setFollowCounts(counts);
    }
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
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: insets.top + 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="subheading" weight="bold" style={{ marginLeft: 12 }}>@{profile.username}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Banner placeholder */}
        <View style={{ height: 120, marginHorizontal: 20, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.colors.accent.primary + '20' }}>
          {profile.banner_url ? (
            <Image source={{ uri: profile.banner_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 48 }}>{profile.emoji}</Text>
            </View>
          )}
        </View>

        {/* Avatar */}
        <View style={{ alignItems: 'center', marginTop: -30 }}>
          <View style={{ borderWidth: 4, borderColor: theme.colors.background.primary, borderRadius: 40 }}>
            <Avatar emoji={profile.emoji} size="xl" />
          </View>
        </View>

        {/* Info */}
        <View style={{ alignItems: 'center', marginTop: 12, paddingHorizontal: 20 }}>
          <Text variant="subheading" weight="bold">{profile.display_name}</Text>
          <Text variant="caption" color={theme.colors.text.secondary}>@{profile.username}</Text>
          {profile.bio ? (
            <Text variant="body" color={theme.colors.text.secondary} align="center" style={{ marginTop: 8 }}>
              {profile.bio}
            </Text>
          ) : null}
        </View>

        {/* Stats row */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32, marginTop: 20 }}>
          <View style={{ alignItems: 'center' }}>
            <Text variant="body" weight="bold">0</Text>
            <Text variant="caption" color={theme.colors.text.tertiary}>Посты</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text variant="body" weight="bold">{followCounts.followers}</Text>
            <Text variant="caption" color={theme.colors.text.tertiary}>Подписчики</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text variant="body" weight="bold">{followCounts.following}</Text>
            <Text variant="caption" color={theme.colors.text.tertiary}>Подписки</Text>
          </View>
        </View>

        {/* Follow button */}
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          <Pressable onPress={handleFollow} style={{ backgroundColor: isFollowingState ? theme.colors.background.secondary : theme.colors.accent.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: isFollowingState ? 1 : 0, borderColor: theme.colors.border.light }}>
            <Text variant="body" weight="semibold" color={isFollowingState ? theme.colors.text.primary : '#FFFFFF'}>
              {isFollowingState ? 'Отписаться' : 'Подписаться'}
            </Text>
          </Pressable>
        </View>

        {/* Empty posts */}
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <Text style={{ fontSize: 32 }}>📷</Text>
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 8 }}>Ещё нет публикаций</Text>
        </View>
      </ScrollView>
    </View>
  );
}
