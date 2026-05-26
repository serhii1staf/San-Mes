import React, { useEffect, useState } from 'react';
import { View, FlatList, Pressable, ViewStyle, TextInput } from 'react-native';
import Animated, { FadeInDown, FadeIn, useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useChatStore } from '../../src/store';
import { mockConversations, formatTimeAgo } from '../../src/utils/mockData';
import { Conversation } from '../../src/types';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function ConversationItem({ item, index }: { item: Conversation; index: number }) {
  const theme = useTheme();

  return (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(300)}>
      <Pressable
        onPress={() => router.push(`/chat/${item.id}`)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.base,
        }}
      >
        <View style={{ position: 'relative' }}>
          <Avatar source={item.participantAvatar} name={item.participantName} size="md" />
          {item.isOnline && (
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: theme.colors.status.success,
                borderWidth: 2,
                borderColor: theme.colors.background.elevated,
              }}
            />
          )}
        </View>

        <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="body" weight={item.unreadCount > 0 ? 'semibold' : 'regular'}>
              {item.participantName}
            </Text>
            <Text variant="caption" color={theme.colors.text.tertiary}>
              {item.lastMessageAt ? formatTimeAgo(item.lastMessageAt) : ''}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <Text
              variant="caption"
              color={item.unreadCount > 0 ? theme.colors.text.primary : theme.colors.text.secondary}
              numberOfLines={1}
              style={{ flex: 1 }}
            >
              {item.lastMessage}
            </Text>
            {item.unreadCount > 0 && (
              <View
                style={{
                  backgroundColor: theme.colors.accent.primary,
                  borderRadius: 10,
                  minWidth: 20,
                  height: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 6,
                  marginLeft: theme.spacing.sm,
                }}
              >
                <Text variant="caption" weight="bold" color={theme.colors.text.inverse}>
                  {item.unreadCount}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function MessagesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { conversations, setConversations } = useChatStore();
  const [searchQuery, setSearchQuery] = useState('');
  const fabScale = useSharedValue(1);

  const fabAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fabScale.value }],
  }));

  useEffect(() => {
    setConversations(mockConversations);
  }, []);

  const filtered = searchQuery
    ? conversations.filter((c) =>
        c.participantName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations;

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
    paddingTop: insets.top,
  };

  return (
    <View style={containerStyle}>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.base, paddingBottom: theme.spacing.sm }}>
        <Text variant="subheading" weight="bold">Messages</Text>
      </View>

      <Animated.View entering={FadeIn.duration(300)} style={{ paddingHorizontal: theme.spacing.base, marginBottom: theme.spacing.sm }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: theme.colors.background.elevated,
            borderRadius: theme.borderRadius.pill,
            paddingHorizontal: theme.spacing.base,
            paddingVertical: theme.spacing.sm,
            borderWidth: 1,
            borderColor: theme.colors.border.light,
          }}
        >
          <Feather name="search" size={16} color={theme.colors.text.tertiary} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search conversations..."
            placeholderTextColor={theme.colors.text.tertiary}
            style={{
              flex: 1,
              marginLeft: theme.spacing.sm,
              fontSize: theme.typography.sizes.base,
              fontFamily: theme.fontFamily.regular,
              color: theme.colors.text.primary,
              paddingVertical: theme.spacing.xs,
            }}
          />
        </View>
      </Animated.View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => <ConversationItem item={item} index={index} />}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      />

      <AnimatedPressable
        onPressIn={() => { fabScale.value = withSpring(0.9, { damping: 15, stiffness: 300 }); }}
        onPressOut={() => { fabScale.value = withSpring(1, { damping: 15, stiffness: 300 }); }}
        style={[
          fabAnimatedStyle,
          {
            position: 'absolute',
            bottom: 100,
            right: theme.spacing.lg,
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: theme.colors.accent.primary,
            alignItems: 'center',
            justifyContent: 'center',
            elevation: 4,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.2,
            shadowRadius: 4,
          },
        ]}
      >
        <Feather name="edit" size={22} color={theme.colors.text.inverse} />
      </AnimatedPressable>
    </View>
  );
}
