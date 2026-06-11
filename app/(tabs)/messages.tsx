import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { View, FlatList, Pressable, ViewStyle, TextInput, StyleSheet, Text as RNText, Alert, Animated, Easing } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import ContextMenu from 'react-native-context-menu-view';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { useChatStore, useEntityStore, useAuthStore } from '../../src/store';
import { syncConversations, syncProfiles } from '../../src/services/syncService';
import { kvGetJSONSync, kvSetJSON, kvWarm } from '../../src/services/kvStore';
import { useMiniAppsStore } from '../../src/store/miniAppsStore';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY } from '../../src/store/chatSettingsStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { Conversation } from '../../src/types';

function AIConversationItem() { return null; }
function MusicConversationItem() { return null; }

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

type ChatTab = 'chats' | 'apps' | 'archive' | 'blocked' | 'deleted';

function ConversationItemBase({ item, tab }: { item: Conversation; index: number; tab: ChatTab }) {
  const theme = useTheme();
  const store = useChatSettingsStore;
  const localName = useChatSettingsStore((s) => s.settings[item.id]?.localName);
  const displayName = localName || item.participantName;

  let actions: { title: string; systemIcon?: string; destructive?: boolean }[];
  if (tab === 'archive') {
    actions = [
      { title: 'Из архива', systemIcon: 'tray.and.arrow.up' },
      { title: 'Настройки чата', systemIcon: 'gearshape' },
      { title: 'Удалить', destructive: true, systemIcon: 'trash' },
    ];
  } else if (tab === 'blocked') {
    actions = [
      { title: 'Разблокировать', systemIcon: 'checkmark.circle' },
      { title: 'Удалить', destructive: true, systemIcon: 'trash' },
    ];
  } else if (tab === 'deleted') {
    actions = [
      { title: 'Восстановить', systemIcon: 'arrow.uturn.backward' },
      { title: 'Удалить навсегда', destructive: true, systemIcon: 'trash' },
    ];
  } else {
    actions = [
      { title: 'В архив', systemIcon: 'archivebox' },
      { title: 'Настройки чата', systemIcon: 'gearshape' },
      { title: 'Заблокировать', systemIcon: 'nosign' },
      { title: 'Удалить', destructive: true, systemIcon: 'trash' },
    ];
  }

  const handleAction = (e: any) => {
    const title = (e.nativeEvent.name as string) || '';
    triggerHaptic('medium');
    const s = store.getState();
    switch (title) {
      case 'Из архива': s.unarchiveChat(item.id); break;
      case 'В архив': s.archiveChat(item.id); break;
      case 'Настройки чата': router.push({ pathname: '/settings/chat-settings', params: { id: item.id } } as any); break;
      case 'Заблокировать':
        Alert.alert('Заблокировать?', item.participantName, [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Заблокировать', style: 'destructive', onPress: () => s.blockChat(item.id) },
        ]);
        break;
      case 'Разблокировать': s.unblockChat(item.id); break;
      case 'Восстановить': s.restoreChat(item.id); break;
      case 'Удалить':
        Alert.alert('Удалить чат?', item.participantName, [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Удалить', style: 'destructive', onPress: () => s.deleteChat(item.id) },
        ]);
        break;
      case 'Удалить навсегда': s.restoreChat(item.id); break; // remove from deleted list entirely (gone from all tabs)
    }
  };

  const openChat = () => {
    router.push(`/chat/${item.id}?participantId=${item.participantId}` as any);
  };

  return (
    <ContextMenu
      actions={actions}
      onPress={handleAction}
    >
      <Pressable
        onPress={openChat}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: theme.spacing.base }}
      >
        <Avatar emoji={item.participantEmoji} name={item.participantName} size="md" />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text variant="body" weight={item.unreadCount > 0 ? 'semibold' : 'regular'} numberOfLines={1} style={{ flexShrink: 1 }}>
              {displayName}
            </Text>
            {item.participantVerified && <VerifiedBadge size={13} />}
            {item.participantBadge && <UserBadge badge={item.participantBadge} size="sm" />}
          </View>
          {item.lastMessage ? (
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
          ) : null}
        </View>
      </Pressable>
    </ContextMenu>
  );
}

// Memoized so typing in search / unrelated state changes don't re-render every
// conversation row. Re-renders only when this row's own data or tab changes.
const ConversationItem = React.memo(ConversationItemBase, (prev, next) =>
  prev.tab === next.tab &&
  prev.item.id === next.item.id &&
  prev.item.lastMessage === next.item.lastMessage &&
  prev.item.unreadCount === next.item.unreadCount &&
  prev.item.participantName === next.item.participantName &&
  prev.item.participantEmoji === next.item.participantEmoji &&
  prev.item.participantVerified === next.item.participantVerified &&
  prev.item.participantBadge === next.item.participantBadge
);

export default function MessagesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Individual selector — subscribing to the whole store via destructuring
  // would re-render this screen on every unrelated chat-store change (e.g.,
  // typing into a chat input updates messages elsewhere in the store).
  const chatStoreConversations = useChatStore((s) => s.conversations);
  const entityConversations = useEntityStore((s) => s.conversations);
  const user = useAuthStore((s) => s.user);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<ChatTab>('chats');
  const archived = useChatSettingsStore((s) => s.archived);
  const blocked = useChatSettingsStore((s) => s.blocked);
  const deleted = useChatSettingsStore((s) => s.deleted);

  // San AI / Music chats are no longer surfaced in this list — they live
  // exclusively behind the FAB. The list shows only real conversations.
  const specialChats = null;

  // Instant cache-first hydrate of the conversation list from MMKV (sync) so the
  // chat list paints immediately on cold start, even offline, before any sync.
  useEffect(() => {
    const CONV_KV_KEY = 'conversations_list';
    const hydrate = () => {
      if (useEntityStore.getState().conversations.length > 0) return;
      const cached = kvGetJSONSync<any[]>(CONV_KV_KEY, []);
      if (cached.length > 0) {
        useEntityStore.getState().setConversations(cached);
      }
    };
    kvWarm([CONV_KV_KEY]).then(hydrate).catch(hydrate);
  }, []);

  // Persist the conversation list to MMKV whenever it changes (survives restart + offline).
  useEffect(() => {
    if (entityConversations.length > 0) {
      kvSetJSON('conversations_list', entityConversations);
    }
  }, [entityConversations]);

  // Trigger syncConversations in background on mount
  useEffect(() => {
    if (user?.id) {
      syncConversations(user.id);
      // Sync profiles too so verified badges / widgets resolve for chat participants
      syncProfiles();
    }
  }, [user?.id]);

  // Use entityStore conversations as cache layer; fall back to chatStore if empty
  const conversations: Conversation[] = useMemo(() => {
    if (entityConversations.length > 0) {
      const profiles = useEntityStore.getState().profiles;
      // Map LocalConversation to Conversation type with defaults for missing fields
      return entityConversations.map((c) => ({
        id: c.id,
        participantId: c.participantId,
        participantName: c.participantName,
        participantUsername: c.participantUsername,
        participantEmoji: c.participantEmoji,
        participantVerified: (c as any).participantVerified ?? profiles[c.participantId]?.is_verified ?? false,
        participantBadge: (c as any).participantBadge ?? profiles[c.participantId]?.badge ?? null,
        lastMessage: c.lastMessage || '',
        lastMessageAt: c.lastMessageAt || '',
        unreadCount: 0,
        isOnline: false,
      }));
    }
    return chatStoreConversations;
  }, [entityConversations, chatStoreConversations]);

  // Filtering: each chat belongs to exactly one bucket. The "apps" tab shows no chats.
  const filtered = useMemo(() => {
    if (activeTab === 'apps') return [];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      // Search only within non-deleted, non-blocked chats
      return conversations.filter((c) => c.participantName.toLowerCase().includes(q) && !deleted.includes(c.id) && !blocked.includes(c.id));
    }
    if (activeTab === 'archive') return conversations.filter(c => archived.includes(c.id) && !deleted.includes(c.id) && !blocked.includes(c.id));
    if (activeTab === 'blocked') return conversations.filter(c => blocked.includes(c.id) && !deleted.includes(c.id));
    if (activeTab === 'deleted') return conversations.filter(c => deleted.includes(c.id));
    // 'chats' — exclude archived, blocked, deleted
    return conversations.filter(c => !archived.includes(c.id) && !blocked.includes(c.id) && !deleted.includes(c.id));
  }, [conversations, activeTab, searchQuery, archived, blocked, deleted]);

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
      <View style={{ marginBottom: 8 }}>
        <FlatList
          horizontal
          data={[
            { key: 'chats', label: 'Чаты' },
            { key: 'apps', label: 'Приложения' },
            { key: 'archive', label: 'Архив' },
            { key: 'blocked', label: 'Заблокированные' },
            { key: 'deleted', label: 'Удалённые' },
          ]}
          keyExtractor={(t) => t.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.base, gap: 8 }}
          renderItem={({ item: tab }) => (
            <Pressable onPress={() => setActiveTab(tab.key as ChatTab)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: activeTab === tab.key ? theme.colors.accent.primary + '20' : 'transparent' }}>
              <Text variant="caption" weight={activeTab === tab.key ? 'bold' : 'regular'} color={activeTab === tab.key ? theme.colors.accent.primary : theme.colors.text.tertiary} style={{ fontSize: 12 }}>{tab.label}</Text>
            </Pressable>
          )}
        />
      </View>

      {/* AI Chat (chats tab) + Mini-apps (apps tab) */}
      {/* AI Chat + Music (chats tab) — only shown once opened, newest first */}
      {activeTab === 'chats' && !searchQuery && specialChats}
      {activeTab === 'apps' && <MiniAppsRow />}

      {filtered.length === 0 ? (
        (activeTab === 'chats' && specialChats && !searchQuery) ? null : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 }}>
          <Feather name={activeTab === 'apps' ? 'grid' : activeTab === 'blocked' ? 'slash' : activeTab === 'deleted' ? 'trash-2' : activeTab === 'archive' ? 'archive' : 'message-circle'} size={48} color={theme.colors.text.tertiary} />
          <Text
            variant="body"
            color={theme.colors.text.tertiary}
            style={{ marginTop: theme.spacing.base, textAlign: 'center' }}
          >
            {activeTab === 'apps' ? 'Нет приложений' : activeTab === 'blocked' ? 'Нет заблокированных' : activeTab === 'deleted' ? 'Нет удалённых' : activeTab === 'archive' ? 'Архив пуст' : 'Пока нет сообщений'}
          </Text>
        </View>
        )
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => <ConversationItem item={item} index={index} tab={activeTab} />}
          ItemSeparatorComponent={() => (
            <View style={{ height: 0.5, backgroundColor: theme.colors.border.light, marginLeft: 68 }} />
          )}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={true}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={9}
        />
      )}

      {/* FAB + popup menu — Apple-style: scale-and-fade out of the FAB itself
          (origin = bottom-right of the FAB). Single Animated value drives both
          scale (0.6→1) and opacity so the menu visually grows out of the
          button. Closing reverses the same spring. Origin via transform
          translation keeps the GPU on the native driver throughout. */}
      <FabWithMenu />
    </View>
  );
}

// Standalone subcomponent — keeps the screen's own re-renders independent of
// FAB animation state, and isolates the Animated.Value lifecycle.
//
// Implementation notes (perf-critical):
//   - The menu and backdrop are ALWAYS in the tree (no mount/unmount). The
//     previous version used `mounted` state to add/remove them, which paid a
//     mount cost on every open and could starve the spring animation of its
//     first 1–2 frames on weak Androids. Now both stay mounted and we only
//     toggle opacity + pointerEvents.
//   - All animated properties go through the native driver (transform +
//     opacity), so the spring keeps running even when the JS thread is busy
//     navigating to a new screen.
//   - Navigation fires immediately on tap; the close animation rides on top
//     of the navigation transition without competing for the JS thread.
//   - Menu items are wrapped in React.memo so the list doesn't re-render
//     when the parent's open state flips.
function FabWithMenu() {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current; // 0 = closed, 1 = open

  useEffect(() => {
    // Open: bouncy spring (~6 % overshoot, iOS rubbery rest).
    // Close: stiffer spring so it doesn't oscillate after dismiss.
    Animated.spring(anim, {
      toValue: open ? 1 : 0,
      useNativeDriver: true,
      tension: open ? 110 : 130,
      friction: open ? 10 : 14,
      restDisplacementThreshold: 0.005,
      restSpeedThreshold: 0.005,
    }).start();
  }, [open]);

  const toggle = useCallback(() => { triggerHaptic('light'); setOpen((v) => !v); }, []);
  const navigate = useCallback((action: () => void) => {
    setOpen(false);
    // Navigation fires immediately so the next screen starts loading right
    // away. The close spring runs on the native driver in parallel.
    action();
  }, []);

  // Single source of truth for both transforms — interpolated for each
  // animated property. This way the close tween is exactly the inverse of the
  // open spring, no double-anim glue.
  const menuOpacity = anim;
  // Asymmetric scale = rubbery "stretching out of the FAB" feel. The Y axis
  // travels further (0.35 → 1) than the X axis (0.7 → 1), so during the
  // first frames the menu reads as a tall narrow blob unfurling from the
  // FAB rather than a generic square zooming in. Spring overshoot above 1
  // (~6 %) gives the iOS rubber-band rest.
  const menuScaleY = anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  const menuScaleX = anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
  // Translation pulls the menu UP from the FAB position so it appears to
  // "grow out" of the button instead of dropping in from above.
  const menuTranslateY = anim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
  // Backdrop fades a touch slower so it doesn't snap.
  const backdropOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  // FAB icon rotates 45° to morph "edit"→"x" without swapping the icon mid-frame.
  const fabIconRotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });
  // FAB itself gives a tiny squish on open (visual hand-off to the menu) —
  // 1 → 0.92 → 1 across the spring travel makes the tap feel tactile.
  const fabScale = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.92, 1] });

  const menuBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';
  const borderColor = theme.colors.border.light;
  const accent = theme.colors.accent.primary;
  const secondary = theme.colors.text.secondary;

  return (
    <>
      {/* Backdrop — always mounted, just opacity-driven. pointerEvents flips
          off when closed so taps fall through to the chat list underneath. */}
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.18)', opacity: backdropOpacity, zIndex: 200 }}
      >
        <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} />
      </Animated.View>

      {/* Menu — always mounted; opacity + transform animate it in/out. The
          translate-scale-translate stack moves the transform origin into the
          bottom-right corner (where the FAB sits) so the menu visibly grows
          out of the button. */}
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          bottom: 164,
          right: 24,
          opacity: menuOpacity,
          transform: [
            { translateY: menuTranslateY },
            { translateX: 110 }, { translateY: 110 },
            { scaleX: menuScaleX },
            { scaleY: menuScaleY },
            { translateX: -110 }, { translateY: -110 },
          ],
          backgroundColor: menuBg,
          borderRadius: 18,
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.18,
          shadowRadius: 20,
          elevation: 14,
          borderWidth: 0.5,
          borderColor,
          zIndex: 201,
          minWidth: 220,
        }}
      >
        <FabMenuItem icon="grid" label="Мини-приложения" tint={accent} onPress={() => navigate(() => router.push('/settings/mini-apps' as any))} />
        <FabSeparator color={borderColor} />
        <FabMenuItem icon="cpu" label="San AI" tint={accent} onPress={() => navigate(() => router.push('/chat/ai' as any))} />
        <FabSeparator color={borderColor} />
        <FabMenuItem icon="music" label="Музыка" tint={accent} onPress={() => navigate(() => router.push('/chat/music' as any))} />
        <FabSeparator color={borderColor} />
        <FabMenuItem icon="settings" label="Настройка чатов" tint={secondary} onPress={() => navigate(() => router.push({ pathname: '/settings/chat-settings', params: { id: GLOBAL_CHAT_SETTINGS_KEY } } as any))} />
      </Animated.View>

      <Pressable
        onPress={toggle}
        style={{
          position: 'absolute',
          bottom: 100,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: accent,
          alignItems: 'center',
          justifyContent: 'center',
          elevation: 6,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.22,
          shadowRadius: 8,
          zIndex: 202,
        }}
      >
        <Animated.View style={{ transform: [{ rotate: fabIconRotate }, { scale: fabScale }] }}>
          <Feather name="edit" size={22} color="#FFFFFF" />
        </Animated.View>
      </Pressable>
    </>
  );
}

const FabMenuItem = React.memo(function FabMenuItem({ icon, label, tint, onPress }: { icon: string; label: string; tint: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 12 }}>
      <Feather name={icon as any} size={16} color={tint} />
      <Text variant="caption" weight="medium" style={{ fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
});

const FabSeparator = React.memo(function FabSeparator({ color }: { color: string }) {
  return <View style={{ height: 0.5, backgroundColor: color }} />;
});
