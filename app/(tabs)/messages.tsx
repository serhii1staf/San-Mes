import React, { useState, useEffect, useMemo } from 'react';
import { View, FlatList, Pressable, ViewStyle, TextInput, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useChatStore, useEntityStore, useAuthStore } from '../../src/store';
import { syncConversations } from '../../src/services/syncService';
import { Conversation } from '../../src/types';

function ConversationItem({ item }: { item: Conversation; index: number }) {
  const theme = useTheme();

  return (
    <View>
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
          <Avatar emoji={item.participantEmoji} name={item.participantName} size="md" />
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
    </View>
  );
}

export default function MessagesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { conversations: chatStoreConversations } = useChatStore();
  const entityConversations = useEntityStore((s) => s.conversations);
  const user = useAuthStore((s) => s.user);
  const [searchQuery, setSearchQuery] = useState('');

  // Trigger syncConversations in background on mount
  useEffect(() => {
    if (user?.id) {
      syncConversations(user.id);
    }
  }, [user?.id]);

  // Use entityStore conversations as cache layer; fall back to chatStore if empty
  const conversations: Conversation[] = useMemo(() => {
    if (entityConversations.length > 0) {
      // Map LocalConversation to Conversation type with defaults for missing fields
      return entityConversations.map((c) => ({
        id: c.id,
        participantId: c.participantId,
        participantName: c.participantName,
        participantUsername: c.participantUsername,
        participantEmoji: c.participantEmoji,
        lastMessage: c.lastMessage || '',
        lastMessageAt: c.lastMessageAt || '',
        unreadCount: 0,
        isOnline: false,
      }));
    }
    return chatStoreConversations;
  }, [entityConversations, chatStoreConversations]);

  const filtered = searchQuery
    ? conversations.filter((c) =>
        c.participantName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations;

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const bgColor = theme.colors.background.primary;
  const bgTransparent = theme.colors.background.primary + '00';
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingTop: insets.top + 8, paddingBottom: 8 }} pointerEvents="auto">
          <Text variant="subheading" weight="bold">Messages</Text>
          <Pressable onPress={() => router.push('/settings/mini-apps' as any)}>
            <Feather name="grid" size={20} color={theme.colors.accent.primary} />
          </Pressable>
        </View>
      </View>

      <View style={{ paddingHorizontal: theme.spacing.base, marginBottom: theme.spacing.sm, marginTop: headerContentHeight }}>
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
      </View>

      {filtered.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 }}>
          <Feather name="message-circle" size={48} color={theme.colors.text.tertiary} />
          <Text
            variant="body"
            color={theme.colors.text.tertiary}
            style={{ marginTop: theme.spacing.base, textAlign: 'center' }}
          >
            Пока нет сообщений
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => <ConversationItem item={item} index={index} />}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Pressable
        style={{
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
        }}
      >
        <Feather name="edit" size={22} color={theme.colors.text.inverse} />
      </Pressable>
    </View>
  );
}
