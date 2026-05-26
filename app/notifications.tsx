import React, { useState } from 'react';
import { View, FlatList, Pressable, ViewStyle, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
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

const FILTER_OPTIONS = ['Все', 'Лайки', 'Комменты', 'Репосты'] as const;

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
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 20,
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
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text variant="caption" numberOfLines={2}>
          <Text variant="caption" weight="semibold">
            {notification.userName}
          </Text>
          {'  '}
          <Text variant="caption" color={theme.colors.text.secondary}>
            {notification.actionText}
          </Text>
        </Text>
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
      </View>
      <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginLeft: 8 }}>
        {notification.timestamp}
      </Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 8,
      }}
    >
      <Text variant="caption" weight="semibold" color={theme.colors.text.tertiary}>
        {title}
      </Text>
    </View>
  );
}

export default function NotificationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [activeFilter, setActiveFilter] = useState<string>('Все');

  const filteredNotifications = mockNotifications.filter((n) => {
    if (activeFilter === 'Все') return true;
    if (activeFilter === 'Лайки') return n.type === 'like';
    if (activeFilter === 'Комменты') return n.type === 'comment';
    if (activeFilter === 'Репосты') return n.type === 'repost';
    return true;
  });

  const currentNotifs = filteredNotifications.filter((n) => n.timeGroup === 'current');
  const todayNotifs = filteredNotifications.filter((n) => n.timeGroup === 'today');
  const yesterdayNotifs = filteredNotifications.filter((n) => n.timeGroup === 'yesterday');

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const bgColor = theme.isDark ? 'rgba(26,26,26,1)' : 'rgba(255,248,240,1)';
  const bgTransparent = theme.isDark ? 'rgba(26,26,26,0)' : 'rgba(255,248,240,0)';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  return (
    <View style={containerStyle}>
      {/* Gradient fade header */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, height: headerGradientHeight }} pointerEvents="box-none">
        <LinearGradient
          colors={[bgColor, bgColor, bgTransparent]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: theme.spacing.lg,
            paddingTop: insets.top + 8,
            paddingBottom: 8,
            position: 'relative',
          }}
          pointerEvents="auto"
        >
          <Pressable
            onPress={() => router.back()}
            style={{ position: 'absolute', left: theme.spacing.lg, top: insets.top + 8 }}
          >
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="subheading" weight="bold">Уведомления</Text>
        </View>
      </View>

      {/* Filter Tabs - centered, fixed width buttons */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 20,
          paddingBottom: 12,
          paddingTop: headerContentHeight + 4,
          gap: 8,
        }}
      >
        {FILTER_OPTIONS.map((filter) => {
          const isActive = activeFilter === filter;
          return (
            <Pressable
              key={filter}
              onPress={() => setActiveFilter(filter)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 16,
                borderRadius: 20,
                backgroundColor: isActive ? theme.colors.accent.primary : theme.colors.background.elevated,
                borderWidth: isActive ? 0 : 1,
                borderColor: theme.colors.border.light,
              }}
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
      </View>

      {/* Notification List */}
      <FlatList
        data={[
          ...(currentNotifs.length > 0 ? [{ type: 'header', title: 'Сейчас', id: 'h-current' }] : []),
          ...currentNotifs.map((n) => ({ ...n, type: 'item' })),
          ...(todayNotifs.length > 0 ? [{ type: 'header', title: 'Сегодня', id: 'h-today' }] : []),
          ...todayNotifs.map((n) => ({ ...n, type: 'item' })),
          ...(yesterdayNotifs.length > 0 ? [{ type: 'header', title: 'Вчера', id: 'h-yesterday' }] : []),
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
