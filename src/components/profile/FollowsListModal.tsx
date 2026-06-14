import React, { memo, useCallback, useEffect, useState } from 'react';
import { View, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { UserBadge } from '../ui/UserBadge';
import { SlideUpSheet } from '../ui/SlideUpSheet';
import { useT } from '../../i18n/store';
import { getFollowers, getFollowing, FollowProfileRow } from '../../services/follow';
import { useEntityStore } from '../../services/entityStore';
import { useAuthStore } from '../../store/authStore';
import { queueMutation } from '../../services/offlineQueue';
import { triggerHaptic } from '../../utils/haptics';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';

export type FollowsListMode = 'followers' | 'following';

interface FollowsListModalProps {
  visible: boolean;
  onClose: () => void;
  /** Whose list to fetch — the profile being viewed. */
  userId: string | null;
  mode: FollowsListMode;
}

/**
 * Bottom-sheet modal listing followers or following for a profile.
 *
 * Reuses the existing SlideUpSheet (drag handle, dim backdrop, theme-aware
 * background) so the look matches PostMenuModal / ProfileMenuModal exactly.
 * Each row is a memoized component so virtualization doesn't pay
 * re-render cost on scroll.
 */
export function FollowsListModal({ visible, onClose, userId, mode }: FollowsListModalProps) {
  const theme = useTheme();
  const t = useT();
  const currentUser = useAuthStore((s) => s.user);
  // Hide rows for users the viewer has blocked locally — we don't need
  // to show them here. Stable subscription via the selector means the
  // list re-renders when the block list changes (immediate visual flip).
  const blockedIds = useBlockedUsersStore((s) => s.ids);

  const [profiles, setProfiles] = useState<FollowProfileRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch on open. Reset state on close so a re-open with a different
  // (userId, mode) doesn't briefly flash the previous list.
  useEffect(() => {
    if (!visible || !userId) {
      if (!visible) {
        setProfiles([]);
        setError(null);
      }
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const fetcher = mode === 'followers' ? getFollowers : getFollowing;
    fetcher(userId, { limit: 100 })
      .then((res) => {
        if (cancelled) return;
        if (res.error) setError(res.error);
        setProfiles(res.profiles);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, userId, mode]);

  const handleOpenProfile = useCallback(
    (profileId: string) => {
      triggerHaptic('selection');
      // Close the sheet first — pushing the route while the sheet is
      // mounted occasionally lands the navigation transition on the
      // same frame as the close-spring and judders. Defer the push by
      // a tick so the close animation gets a clean handoff.
      onClose();
      setTimeout(() => {
        router.push({ pathname: '/profile/[id]', params: { id: profileId } });
      }, 60);
    },
    [onClose],
  );

  const titleKey =
    mode === 'followers' ? 'profile.followers_modal.title' : 'profile.following_modal.title';
  const emptyKey =
    mode === 'followers' ? 'profile.followers_modal.empty' : 'profile.following_modal.empty';

  // Filter out locally-blocked users — viewer shouldn't see them in this
  // list either.
  const visibleProfiles = React.useMemo(
    () => profiles.filter((p) => !blockedIds.includes(p.id)),
    [profiles, blockedIds],
  );

  const keyExtractor = useCallback((item: FollowProfileRow) => item.id, []);
  const renderItem = useCallback(
    ({ item }: { item: FollowProfileRow }) => (
      <FollowsRow
        profile={item}
        currentUserId={currentUser?.id}
        onPress={handleOpenProfile}
      />
    ),
    [currentUser?.id, handleOpenProfile],
  );

  return (
    <SlideUpSheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 }}>
        <Text variant="body" weight="semibold" align="center">
          {t(titleKey)}
        </Text>
      </View>

      {isLoading && profiles.length === 0 ? (
        <View style={{ paddingVertical: 32, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={theme.colors.accent.primary} />
        </View>
      ) : error ? (
        <View style={{ paddingVertical: 24, paddingHorizontal: 24, alignItems: 'center' }}>
          <Feather name="wifi-off" size={20} color={theme.colors.text.tertiary} />
          <Text
            variant="caption"
            color={theme.colors.text.tertiary}
            align="center"
            style={{ marginTop: 8 }}
          >
            {t('profile.followers_modal.error')}
          </Text>
        </View>
      ) : visibleProfiles.length === 0 ? (
        <View style={{ paddingVertical: 32, alignItems: 'center' }}>
          <Text variant="caption" color={theme.colors.text.tertiary} align="center">
            {t(emptyKey)}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibleProfiles}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          // List can be hundreds of rows — keep the initial mount tiny so
          // the open-spring stays smooth. The rest of the rows mount
          // batched as the user scrolls into them.
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={5}
          removeClippedSubviews
          showsVerticalScrollIndicator={false}
          // Cap the sheet to ~60% of the screen — same convention as
          // other long-content sheets in the app.
          style={{ maxHeight: 480 }}
          contentContainerStyle={{ paddingBottom: 4 }}
        />
      )}
    </SlideUpSheet>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────────

interface FollowsRowProps {
  profile: FollowProfileRow;
  currentUserId: string | undefined;
  onPress: (id: string) => void;
}

const FollowsRow = memo(
  function FollowsRow({ profile, currentUserId, onPress }: FollowsRowProps) {
    const theme = useTheme();
    const t = useT();
    // Read this user's follow state from the entity store so the button
    // flips optimistically when the viewer toggles follow elsewhere too.
    const isFollowing = useEntityStore((s) =>
      currentUserId ? s.isFollowing(currentUserId, profile.id) : false,
    );
    const isSelf = !!currentUserId && currentUserId === profile.id;

    const handleFollowPress = useCallback(() => {
      if (!currentUserId || isSelf) return;
      triggerHaptic('medium');
      // Optimistic via the existing offline queue path — same as on
      // app/profile/[id].tsx. Toggles entity-store follow state
      // immediately and retries the API call on reconnect.
      if (isFollowing) {
        queueMutation('unfollow', { followerId: currentUserId, followingId: profile.id });
      } else {
        queueMutation('follow', { followerId: currentUserId, followingId: profile.id });
      }
    }, [currentUserId, isFollowing, isSelf, profile.id]);

    return (
      <Pressable
        onPress={() => onPress(profile.id)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 10,
          paddingHorizontal: 20,
        }}
      >
        <Avatar emoji={profile.emoji || '😊'} name={profile.display_name} size="sm" />
        <View style={{ flex: 1, marginLeft: 12, marginRight: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text variant="body" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
              {profile.display_name || profile.username}
            </Text>
            {profile.is_verified && <VerifiedBadge size={11} />}
            {profile.badge && <UserBadge badge={profile.badge} size="sm" />}
          </View>
          <Text
            variant="caption"
            color={theme.colors.text.tertiary}
            numberOfLines={1}
            style={{ fontSize: 12 }}
          >
            @{profile.username}
          </Text>
        </View>
        {!isSelf && (
          <Pressable
            onPress={handleFollowPress}
            hitSlop={6}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: 14,
              backgroundColor: isFollowing ? 'transparent' : theme.colors.accent.primary,
              borderWidth: isFollowing ? 1 : 0,
              borderColor: theme.colors.border.medium,
            }}
          >
            <Text
              variant="caption"
              weight="semibold"
              color={isFollowing ? theme.colors.text.primary : '#FFFFFF'}
              style={{ fontSize: 11 }}
            >
              {isFollowing ? t('profile.unfollow') : t('profile.follow')}
            </Text>
          </Pressable>
        )}
      </Pressable>
    );
  },
  (prev, next) =>
    prev.profile.id === next.profile.id &&
    prev.profile.display_name === next.profile.display_name &&
    prev.profile.username === next.profile.username &&
    prev.profile.emoji === next.profile.emoji &&
    prev.profile.badge === next.profile.badge &&
    prev.profile.is_verified === next.profile.is_verified &&
    prev.currentUserId === next.currentUserId &&
    prev.onPress === next.onPress,
);
