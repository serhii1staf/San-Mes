import React, { useState, useEffect, useMemo } from 'react';
import { View, FlatList, Pressable, ViewStyle, TextInput, StyleSheet, Text as RNText, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import ContextMenu from 'react-native-context-menu-view';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { useChatStore, useEntityStore, useAuthStore } from '../../src/store';
import { syncConversations } from '../../src/services/syncService';
import { useMiniAppsStore } from '../../src/store/miniAppsStore';
import { useChatSettingsStore } from '../../src/store/chatSettingsStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { Conversation } from '../../src/types';

function AIConversationItem() {
  const theme = useTheme();
  return (
    <Pressable onPress={() => router.push('/chat/ai' as any)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.base }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.accent.primary + '15', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
        <RNText style={{ fontSize: 22 }} allowFontScaling={false}>🤖</RNText>
      </View>
      <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text variant="body" weight="semibold">San AI</Text>
          <VerifiedBadge size={12} />
        </View>
        <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>Ассистент • темы, профиль, настройки</Text>
      </View>
      <Feather name="chevron-right" size={16} color={theme.colors.text.tertiary} />
    </Pressable>
  );
}

function MiniAppsRow() {
  const theme = useTheme();
  const { apps, loadApps } = useMiniAppsStore();

  useEffect(() => { loadApps(); }, []);

  if (apps.length === 0) return null;

  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      {apps.slice(0, 5).map(app => (
        <Pressable key={app.id} onPress={() => router.push({ pathname: '/mini-app', params: { url: encodeURIComponent(app.url), name: app.name, emoji: app.emoji } })} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.colors.accent.primary + '12', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
            <RNText style={{ fontSize: 20 }} allowFontScaling={false}>{app.emoji}</RNText>
          </View>
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text variant="body" weight="medium">{app.name}</Text>
            {app.description ? <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>{app.description}</Text> : null}
          </View>
          <Pressable onPress={() => router.push({ pathname: '/mini-app', params: { url: encodeURIComponent(app.url), name: app.name, emoji: app.emoji } })} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: theme.colors.accent.primary + '15' }}>
            <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} style={{ fontSize: 11 }}>Открыть</Text>
          </Pressable>
        </Pressable>
      ))}
    </View>
  );
}

function ConversationItem({ item, isArchived }: { item: Conversation; index: number; isArchived?: boolean }) {
  const theme = useTheme();

  const actions = isArchived
    ? [
        { title: 'Из архива', systemIcon: 'tray.and.arrow.up' },
        { title: 'Настройки чата', systemIcon: 'gearshape' },
        { title: 'Удалить', destructive: true, systemIcon: 'trash' },
      ]
    : [
        { title: 'В архив', systemIcon: 'archivebox' },
        { title: 'Настройки чата', systemIcon: 'gearshape' },
        { title: 'Заблокировать', systemIcon: 'nosign' },
        { title: 'Удалить', destructive: true, systemIcon: 'trash' },
      ];

  const handleAction = (e: any) => {
    const idx = e.nativeEvent.index;
    if (isArchived) {
      if (idx === 0) { useChatSettingsStore.getState().unarchiveChat(item.id); triggerHaptic('medium'); }
      if (idx === 1) router.push({ pathname: '/settings/chat-settings', params: { id: item.id } } as any);
      if (idx === 2) Alert.alert('Удалить чат?', item.participantName, [{ text: 'Отмена' }, { text: 'Удалить', style: 'destructive' }]);
    } else {
      if (idx === 0) { useChatSettingsStore.getState().archiveChat(item.id); triggerHaptic('medium'); }
      if (idx === 1) router.push({ pathname: '/settings/chat-settings', params: { id: item.id } } as any);
      if (idx === 2) Alert.alert('Заблокировать?', item.participantName, [{ text: 'Отмена' }, { text: 'Заблокировать', style: 'destructive' }]);
      if (idx === 3) Alert.alert('Удалить чат?', item.participantName, [{ text: 'Отмена' }, { text: 'Удалить', style: 'destructive' }]);
    }
  };

  const openChat = () => {
    router.push(`/chat/${item.id}?participantId=${item.participantId}` as any);
  };

  return (
    <ContextMenu
      actions={actions}
      onPress={handleAction}
      onPreviewPress={openChat}
      previewBackgroundColor={theme.colors.background.primary}
      preview={
        <View style={{ width: 320, backgroundColor: theme.colors.background.primary }}>
          {/* Chat preview header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: theme.colors.background.elevated }}>
            <Avatar emoji={item.participantEmoji} name={item.participantName} size="sm" />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text variant="body" weight="bold">{item.participantName}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary}>в сети</Text>
            </View>
          </View>
          {/* Message preview area */}
          <View style={{ padding: 14, minHeight: 80 }}>
            {item.lastMessage ? (
              <View style={{ alignSelf: 'flex-start', backgroundColor: theme.colors.background.tertiary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderBottomLeftRadius: 4, maxWidth: '85%' }}>
                <Text variant="body" numberOfLines={3}>{item.lastMessage}</Text>
              </View>
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="caption" color={theme.colors.text.tertiary}>Нет сообщений</Text>
              </View>
            )}
          </View>
        </View>
      }
    >
      <Pressable
        onPress={openChat}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: theme.spacing.base }}
      >
        <Avatar emoji={item.participantEmoji} name={item.participantName} size="md" />
        <View style={{ flex: 1, marginLeft: 12, justifyContent: 'center' }}>
          <Text variant="body" weight={item.unreadCount > 0 ? 'semibold' : 'regular'} numberOfLines={1}>
            {item.participantName}
          </Text>
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
    </ContextMenu>
  );
}

export default function MessagesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { conversations: chatStoreConversations } = useChatStore();
  const entityConversations = useEntityStore((s) => s.conversations);
  const user = useAuthStore((s) => s.user);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFabMenu, setShowFabMenu] = useState(false);
  const [activeTab, setActiveTab] = useState<'chats' | 'apps' | 'archive'>('chats');
  const archived = useChatSettingsStore((s) => s.archived);

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
    ? conversations.filter((c) => c.participantName.toLowerCase().includes(searchQuery.toLowerCase()))
    : activeTab === 'archive'
      ? conversations.filter(c => archived.includes(c.id))
      : conversations.filter(c => !archived.includes(c.id));

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
          <View style={{ width: 20 }} />
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

      {/* Category tabs */}
      <View style={{ flexDirection: 'row', paddingHorizontal: theme.spacing.base, marginBottom: 8, gap: 8 }}>
        {[{ key: 'chats', label: 'Чаты' }, { key: 'apps', label: 'Приложения' }, { key: 'archive', label: 'Архив' }].map(tab => (
          <Pressable key={tab.key} onPress={() => setActiveTab(tab.key as any)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: activeTab === tab.key ? theme.colors.accent.primary + '20' : 'transparent' }}>
            <Text variant="caption" weight={activeTab === tab.key ? 'bold' : 'regular'} color={activeTab === tab.key ? theme.colors.accent.primary : theme.colors.text.tertiary} style={{ fontSize: 12 }}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* AI Chat + Mini-apps (only in apps tab or chats tab) */}
      {activeTab === 'chats' && <AIConversationItem />}
      {activeTab === 'apps' && <MiniAppsRow />}

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
          renderItem={({ item, index }) => <ConversationItem item={item} index={index} isArchived={archived.includes(item.id)} />}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* FAB with popup menu */}
      {showFabMenu && (
        <Pressable onPress={() => setShowFabMenu(false)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200 }}>
          <View style={{ position: 'absolute', bottom: 164, right: theme.spacing.lg, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8, borderWidth: 0.5, borderColor: theme.colors.border.light }}>
            <Pressable onPress={() => { setShowFabMenu(false); router.push('/settings/mini-apps' as any); }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
              <Feather name="grid" size={16} color={theme.colors.accent.primary} />
              <Text variant="caption" weight="medium">Мини-приложения</Text>
            </Pressable>
            <View style={{ height: 0.5, backgroundColor: theme.colors.border.light }} />
            <Pressable onPress={() => { setShowFabMenu(false); router.push('/chat/ai' as any); }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
              <Feather name="cpu" size={16} color={theme.colors.accent.primary} />
              <Text variant="caption" weight="medium">San AI</Text>
            </Pressable>
            <View style={{ height: 0.5, backgroundColor: theme.colors.border.light }} />
            <Pressable onPress={() => { setShowFabMenu(false); }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
              <Feather name="settings" size={16} color={theme.colors.text.secondary} />
              <Text variant="caption" weight="medium">Настройка чатов</Text>
            </Pressable>
          </View>
        </Pressable>
      )}

      <Pressable
        onPress={() => setShowFabMenu(!showFabMenu)}
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
          zIndex: 201,
        }}
      >
        <Feather name={showFabMenu ? 'x' : 'edit'} size={22} color={theme.colors.text.inverse} />
      </Pressable>
    </View>
  );
}
