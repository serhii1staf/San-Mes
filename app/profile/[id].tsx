import React, { useEffect, useState } from 'react';
import { View, Pressable, ActivityIndicator, ScrollView, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { supabase } from '../../src/lib/supabase';
import { useAuthStore } from '../../src/store';
import { followUser, unfollowUser, isFollowing as checkIsFollowing, getFollowCounts } from '../../src/lib/supabase';
import { triggerHaptic } from '../../src/utils/haptics';

export default function UserProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user: currentUser } = useAuthStore();
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFollowingState, setIsFollowingState] = useState(false);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });

  useEffect(() => { loadProfile(); }, [id]);

  const loadProfile = async () => {
    setIsLoading(true);
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
      setProfile(data);
      if (data && currentUser?.id) {
        const following = await checkIsFollowing(currentUser.id, data.id);
        setIsFollowingState(following);
        const counts = await getFollowCounts(data.id);
        setFollowCounts(counts);
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
        {/* Banner - only if set */}
        {profile.banner_url ? (
          <View style={{ height: 100, marginHorizontal: 20, borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
            <Image source={{ uri: profile.banner_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          </View>
        ) : null}

        {/* Profile row: LEFT = stats, RIGHT = avatar */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginTop: 8 }}>
          <View style={{ flex: 1, flexDirection: 'row', gap: 16 }}>
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
          <Avatar emoji={profile.emoji} size="xl" />
        </View>

        {/* Name */}
        <View style={{ paddingHorizontal: 20, marginTop: 12 }}>
          <Text variant="body" weight="bold">{profile.display_name}</Text>
        </View>

        {/* Bio */}
        {profile.bio ? (
          <View style={{ paddingHorizontal: 20, marginTop: 2 }}>
            <Text variant="caption" color={theme.colors.text.secondary}>{profile.bio}</Text>
          </View>
        ) : null}

        {/* Follow button (only for other users) */}
        {!isOwnProfile && (
          <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
            <Pressable onPress={handleFollow} style={{
              backgroundColor: isFollowingState ? theme.colors.background.secondary : theme.colors.accent.primary,
              borderRadius: 14,
              paddingVertical: 12,
              alignItems: 'center',
              borderWidth: isFollowingState ? 1 : 0,
              borderColor: theme.colors.border.light,
            }}>
              <Text variant="body" weight="semibold" color={isFollowingState ? theme.colors.text.primary : '#FFFFFF'}>
                {isFollowingState ? 'Отписаться' : 'Подписаться'}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Empty posts */}
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <View style={{ width: 50, height: 50, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 32 }}>📷</Text>
          </View>
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 8 }}>Ещё нет публикаций</Text>
        </View>
      </ScrollView>
    </View>
  );
}
