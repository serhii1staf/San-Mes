import React from 'react';
import { View, FlatList, Pressable, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { mockUsers } from '../../utils/mockData';
import { User } from '../../types';

function TrendingUserCard({ user }: { user: User }) {
  const theme = useTheme();

  const cardStyle: ViewStyle = {
    width: 140,
    paddingVertical: theme.spacing.base,
    paddingHorizontal: theme.spacing.md,
    marginRight: theme.spacing.md,
    backgroundColor: theme.colors.background.elevated,
    borderRadius: theme.borderRadius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  };

  const followButtonStyle: ViewStyle = {
    marginTop: theme.spacing.md,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: theme.borderRadius.pill,
    backgroundColor: theme.colors.accent.secondary,
  };

  return (
    <View style={cardStyle}>
      <Avatar source={user.avatar} name={user.displayName} size="md" />
      <Text
        variant="caption"
        weight="semibold"
        numberOfLines={1}
        style={{ marginTop: theme.spacing.sm, textAlign: 'center' }}
      >
        {user.displayName}
      </Text>
      <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>
        @{user.username}
      </Text>
      <Pressable style={followButtonStyle}>
        <Text variant="caption" weight="semibold" color="#FFFFFF">
          Follow
        </Text>
      </Pressable>
    </View>
  );
}

export function TrendingSection() {
  const theme = useTheme();

  return (
    <View style={{ marginBottom: theme.spacing.base }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.base,
          marginBottom: theme.spacing.md,
        }}
      >
        <Text variant="body" weight="semibold">Popular</Text>
        <Pressable>
          <Text variant="caption" color={theme.colors.accent.primary}>See all</Text>
        </Pressable>
      </View>
      <FlatList
        horizontal
        data={mockUsers.slice(0, 5)}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TrendingUserCard user={item} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.base }}
      />
    </View>
  );
}
