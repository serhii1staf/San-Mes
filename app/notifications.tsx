import React, { useState } from 'react';
import { View, FlatList, Pressable, ViewStyle, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../src/theme';
import { Text, Avatar } from '../src/components/ui';
import { mockUsers } from '../src/utils/mockData';

type NotificationType = 'like' | 'comment' | 'repost' | 'follow';

interface Notification {
  id: string;
  type: NotificationType;
  userId: string;
  userName: string;
  userAvatar?: string;
  isVerified: boolean;
  actionText: string;
  contentPreview?: string;
  timestamp: string;
  timeGroup: 'current' | 'today' | 'yesterday';
}

const FILTER_OPTIONS = ['All', 'Likes', 'Comments', 'Reposts'] as const;

const mockNotifications: Notification[] = [
  {
    id: 'n1',
    type: 'like',
    userId: '1',
    userName: 'Sophia Chen',
    userAvatar: mockUsers[0].avatar,
    isVerified: true,
    actionText: 'liked your post',
    contentPreview: 'Golden hour in the forest today...',
    timestamp: '2m ago',
    timeGroup: 'current',
  },
  {
    id: 'n2',
    type: 'repost',
    userId: '2',
    userName: 'Alex Woods',
    userAvatar: mockUsers[1].avatar,
    isVerified: true,
    actionText: 'reposted your post',
    contentPreview: 'New recipe alert! This sourdough took 3 days...',
    timestamp: '15m ago',
    timeGroup: 'current',
  },
  {
    id: 'n3',
    type: 'follow',
    userId: '3',
    userName: 'Mia Jackson',
    userAvatar: mockUsers[2].avatar,
    isVerified: true,
    actionText: 'subscribed to your updates',
    timestamp: '1h ago',
    timeGroup: 'today',
  },
  {
    id: 'n4',
    type: 'comment',
    userId: '4',
    userName: 'James Riley',
    userAvatar: mockUsers[3].avatar,
    isVerified: false,
    actionText: 'commented on your post',
    contentPreview: 'This is absolutely stunning!',
    timestamp: '2h ago',
    timeGroup: 'today',
  },
  {
    id: 'n5',
    type: 'like',
    userId: '5',
    userName: 'Emma Liu',
    userAvatar: mockUsers[4].avatar,
    isVerified: true,
    actionText: 'liked your post',
    contentPreview: 'Morning meditation by the lake...',
    timestamp: '3h ago',
    timeGroup: 'today',
  },
  {
    id: 'n6',
    type: 'repost',
    userId: '6',
    userName: 'Oliver Park',
    userAvatar: mockUsers[5].avatar,
    isVerified: false,
    actionText: 'reposted your post',
    contentPreview: 'Packed everything into one backpack...',
    timestamp: '5h ago',
    timeGroup: 'today',
  },
  {
    id: 'n7',
    type: 'like',
    userId: '1',
    userName: 'Sophia Chen',
    userAvatar: mockUsers[0].avatar,
    isVerified: true,
    actionText: 'liked your post',
    contentPreview: 'Redesigned my workspace this weekend...',
    timestamp: '1d ago',
    timeGroup: 'yesterday',
  },
  {
    id: 'n8',
    type: 'follow',
    userId: '4',
    userName: 'James Riley',
    userAvatar: mockUsers[3].avatar,
    isVerified: false,
    actionText: 'subscribed to your updates',
    timestamp: '1d ago',
    timeGroup: 'yesterday',
  },
  {
    id: 'n9',
    type: 'comment',
    userId: '5',
    userName: 'Emma Liu',
    userAvatar: mockUsers[4].avatar,
    isVerified: true,
    actionText: 'commented on your post',
    contentPreview: 'Nature really is the best artist.',
    timestamp: '1d ago',
    timeGroup: 'yesterday',
  },
];

function NotificationItem({ notification }: { notification: Notification }) {
  const theme = useTheme();

  const iconMap: Record<NotificationType, keyof typeof Feather.glyphMap> = {
    like: 'heart',
    comment: 'message-circle',
    repost: 'repeat',
    follow: 'user-plus',
  };

  const iconColorMap: Record<NotificationType, string> = {
    like: theme.colors.accent.primary,
    comment: theme.colors.accent.secondary,
    repost: theme.colors.accent.tertiary,
    follow: theme.colors.accent.secondary,
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.base,
      }}
    >
      <View style={{ position: 'relative' }}>
        <Avatar source={notification.userAvatar} name={notification.userName} size="sm" />
        <View
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: iconColorMap[notification.type],
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: theme.colors.background.primary,
          }}
        >
          <Feather name={iconMap[notification.type]} size={9} color="#FFFFFF" />
        </View>
      </View>
      <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
          <Text variant="body" weight="semibold">
            {notification.userName}
          </Text>
          {notification.isVerified && (
            <View
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                backgroundColor: theme.colors.accent.secondary,
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: 4,
              }}
            >
              <Feather name="check" size={8} color="#FFFFFF" />
            </View>
          )}
          <Text variant="body" color={theme.colors.text.secondary}>
            {' '}{notification.actionText}
          </Text>
        </View>
        {notification.contentPreview && (
          <Text
            variant="caption"
            color={theme.colors.text.tertiary}
            numberOfLines={1}
            style={{ marginTop: 2 }}
          >
            {notification.contentPreview}
          </Text>
        )}
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 2 }}>
          {notification.timestamp}
        </Text>
      </View>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.base,
        paddingTop: theme.spacing.lg,
        paddingBottom: theme.spacing.sm,
      }}
    >
      <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
        {title}
      </Text>
    </View>
  );
}

export default function NotificationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [activeFilter, setActiveFilter] = useState<string>('All');

  const filteredNotifications = mockNotifications.filter((n) => {
    if (activeFilter === 'All') return true;
    if (activeFilter === 'Likes') return n.type === 'like';
    if (activeFilter === 'Comments') return n.type === 'comment';
    if (activeFilter === 'Reposts') return n.type === 'repost';
    return true;
  });

  const currentNotifs = filteredNotifications.filter((n) => n.timeGroup === 'current');
  const todayNotifs = filteredNotifications.filter((n) => n.timeGroup === 'today');
  const yesterdayNotifs = filteredNotifications.filter((n) => n.timeGroup === 'yesterday');

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const headerStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: insets.top,
    paddingBottom: theme.spacing.md,
  };

  const filterContainerStyle: ViewStyle = {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.base,
    paddingBottom: theme.spacing.md,
  };

  return (
    <View style={containerStyle}>
      {/* Header */}
      <View style={headerStyle}>
        <Pressable onPress={() => router.back()} style={{ marginRight: theme.spacing.base }}>
          <Feather name="arrow-left" size={22} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="subheading" weight="bold">Notifications</Text>
      </View>

      {/* Filter Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={filterContainerStyle}
      >
        {FILTER_OPTIONS.map((filter) => {
          const isActive = activeFilter === filter;
          const pillStyle: ViewStyle = {
            paddingVertical: 8,
            paddingHorizontal: 16,
            borderRadius: 20,
            marginRight: theme.spacing.sm,
            backgroundColor: isActive ? theme.colors.accent.primary : theme.colors.background.elevated,
            borderWidth: isActive ? 0 : 1,
            borderColor: theme.colors.border.light,
          };
          return (
            <Pressable
              key={filter}
              onPress={() => setActiveFilter(filter)}
              style={pillStyle}
            >
              <Text
                variant="caption"
                weight={isActive ? 'semibold' : 'regular'}
                color={isActive ? '#FFFFFF' : theme.colors.text.secondary}
              >
                {filter}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Notification List */}
      <FlatList
        data={[
          ...(currentNotifs.length > 0 ? [{ type: 'header', title: 'Current', id: 'h-current' }] : []),
          ...currentNotifs.map((n) => ({ ...n, type: 'item' })),
          ...(todayNotifs.length > 0 ? [{ type: 'header', title: 'Today', id: 'h-today' }] : []),
          ...todayNotifs.map((n) => ({ ...n, type: 'item' })),
          ...(yesterdayNotifs.length > 0 ? [{ type: 'header', title: 'Yesterday', id: 'h-yesterday' }] : []),
          ...yesterdayNotifs.map((n) => ({ ...n, type: 'item' })),
        ]}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          if (item.type === 'header') {
            return <SectionHeader title={(item as { title: string }).title} />;
          }
          return <NotificationItem notification={item as Notification} />;
        }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      />
    </View>
  );
}
