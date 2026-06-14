import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { View, FlatList, Pressable, ViewStyle, TextInput, StyleSheet, Text as RNText, Alert, Animated, Easing, InteractionManager } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import ContextMenu from 'react-native-context-menu-view';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { WeatherChip } from '../../src/components/ui/WeatherChip';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { useChatStore, useEntityStore, useAuthStore } from '../../src/store';
import { useBlockedUsersStore } from '../../src/store/blockedUsersStore';
import { syncConversations, syncProfiles } from '../../src/services/syncService';
import { prefetchRecentChatMedia } from '../../src/services/messagesPrefetch';
import { kvGetJSONSync, kvSetJSON, kvWarm } from '../../src/services/kvStore';
import { useMiniAppsStore } from '../../src/store/miniAppsStore';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY } from '../../src/store/chatSettingsStore';
import { useSettingsStore } from '../../src/store/settingsStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';
import { Conversation } from '../../src/types';
import { perfMonitor } from '../../src/services/perfMonitor';

function AIConversationItem() { return null; }
function MusicConversationItem() { return null; }

// Stable getItemLayout helper for the conversation FlatList. Hoisted to
// module scope so its identity is stable across re-renders — the inline
// `(_, index) => ...` form would have allocated a fresh function on every
// MessagesScreen commit, defeating any FlatList prop-equality bail-outs.
//
// Geometry: Avatar size="md" = 44 px tall, paddingVertical 10 × 2 = 20 px,
// so each row is 64 px. The ItemSeparatorComponent renders a 0.5 px line
// between every two rows (count = N - 1), so the per-row pitch FlatList
// should advance by is 64 + 0.5 = 64.5 — except FlatList's own
// getItemLayout contract treats `length` as the row's own height and
// expects `offset` to include preceding separators. We follow the
// documented form here.
const MESSAGES_ROW_HEIGHT = 64;
const MESSAGES_SEPARATOR_HEIGHT = 0.5;
const MESSAGES_ROW_PITCH = MESSAGES_ROW_HEIGHT + MESSAGES_SEPARATOR_HEIGHT;
const MESSAGES_ITEM_LAYOUT = (_data: ArrayLike<Conversation> | null | undefined, index: number) => ({
  length: MESSAGES_ROW_HEIGHT,
  offset: MESSAGES_ROW_PITCH * index,
  index,
});

function MiniAppsRow() {
  const theme = useTheme();
  const t = useT();
  // Field-level selectors so the row doesn't re-render on every loading flag.
  const apps = useMiniAppsStore((s) => s.apps);
  const loadApps = useMiniAppsStore((s) => s.loadApps);

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
            <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} style={{ fontSize: 11 }}>{t('messages.miniapp.open')}</Text>
          </Pressable>
        </Pressable>
      ))}
    </View>
  );
}

type ChatTab = 'chats' | 'apps' | 'archive' | 'blocked' | 'deleted';

// Synthetic conversation prefix used for user-level blocked users that
// don't have an existing chat. Lets the Blocked tab list everyone the
// viewer has blocked (via `useBlockedUsersStore`) — chat or no chat —
// while keeping the rest of the screen's chat-id pipeline unchanged.
// Tapping a synthetic row routes to the user's profile (it has no chat
// to open); the long-press menu offers an "Unblock user" action that
// removes the id from the user-level block list.
const SYNTHETIC_USER_BLOCK_PREFIX = '__user_block:';
const isSyntheticUserBlockId = (id: string) => id.startsWith(SYNTHETIC_USER_BLOCK_PREFIX);
const userIdFromSyntheticId = (id: string) => id.slice(SYNTHETIC_USER_BLOCK_PREFIX.length);

function ConversationItemBase({ item, tab }: { item: Conversation; index: number; tab: ChatTab }) {
  const theme = useTheme();
  const t = useT();
  const store = useChatSettingsStore;
  const localName = useChatSettingsStore((s) => s.settings[item.id]?.localName);
  const displayName = localName || item.participantName;

  // Defer the native ContextMenu wrapper by ONE RAF after the row first
  // commits. iOS's `UIContextMenuInteraction` is set up per-view by the
  // ContextMenu library, and on the cold mount of (tabs)/messages with
  // 4 visible rows that setup landed as the dominant cost behind the
  // residual `LONG @ (tabs)/messages 145 ms` the perf monitor flagged
  // even after the action-array memoization. Rendering the plain
  // Pressable on the first frame and upgrading to ContextMenu one RAF
  // later moves that native setup off the navigation transition frame
  // — long-press still works (after the same single RAF the user is
  // physically in the middle of holding their finger down for >250 ms),
  // and the visible UI is byte-identical because the wrapper itself is
  // transparent.
  const [menuReady, setMenuReady] = useState(false);
  useEffect(() => {
    const handle = requestAnimationFrame(() => setMenuReady(true));
    return () => cancelAnimationFrame(handle);
  }, []);

  // Each action has a stable `id` we dispatch on, plus a localized `title`
  // shown by the native context menu. Matching by id (or index) keeps logic
  // independent of the user's interface language.
  type ActionDef = { id: 'unarchive' | 'archive' | 'chat_settings' | 'block' | 'unblock' | 'unblock_user' | 'restore' | 'delete' | 'delete_forever'; title: string; systemIcon?: string; destructive?: boolean };
  // Memoized so the native ContextMenu doesn't re-register its actions
  // on every parent re-render. The previous unmemoized build allocated
  // a new array + closures every render, which on iOS forced
  // UIContextMenuInteraction to flush + re-bind its action set per
  // ConversationItem commit. With 6 visible rows that was the dominant
  // cost behind the 127 ms long task users saw 47 ms after navigating
  // into (tabs)/messages.
  const actionDefs = useMemo<ActionDef[]>(() => {
    if (tab === 'archive') {
      return [
        { id: 'unarchive', title: t('messages.action.unarchive'), systemIcon: 'tray.and.arrow.up' },
        { id: 'chat_settings', title: t('messages.action.chat_settings'), systemIcon: 'gearshape' },
        { id: 'delete', title: t('messages.action.delete'), destructive: true, systemIcon: 'trash' },
      ];
    }
    if (tab === 'blocked') {
      // User-level blocked rows expose a different unblock that targets
      // the user's id rather than the chatId. Same visible label but a
      // distinct dispatch id keeps both code paths cleanly separated.
      if (isSyntheticUserBlockId(item.id)) {
        return [
          { id: 'unblock_user', title: t('block.menu.unblock'), systemIcon: 'checkmark.circle' },
        ];
      }
      return [
        { id: 'unblock', title: t('messages.action.unblock'), systemIcon: 'checkmark.circle' },
        { id: 'delete', title: t('messages.action.delete'), destructive: true, systemIcon: 'trash' },
      ];
    }
    if (tab === 'deleted') {
      return [
        { id: 'restore', title: t('messages.action.restore'), systemIcon: 'arrow.uturn.backward' },
        { id: 'delete_forever', title: t('messages.action.delete_forever'), destructive: true, systemIcon: 'trash' },
      ];
    }
    return [
      { id: 'archive', title: t('messages.action.archive'), systemIcon: 'archivebox' },
      { id: 'chat_settings', title: t('messages.action.chat_settings'), systemIcon: 'gearshape' },
      { id: 'block', title: t('messages.action.block'), systemIcon: 'nosign' },
      { id: 'delete', title: t('messages.action.delete'), destructive: true, systemIcon: 'trash' },
    ];
  }, [tab, t]);
  // Bridge-friendly action descriptor for the native ContextMenu. Memoized
  // so the array reference is stable across re-renders — without this the
  // native side sees a "new" actions prop each render and re-creates its
  // UIMenu, which on a 6-row mount accounts for the bulk of the long task.
  const actions = useMemo(() => actionDefs.map(({ id: _id, ...rest }) => rest), [actionDefs]);

  const handleAction = (e: any) => {
    const idx = typeof e.nativeEvent.index === 'number' ? e.nativeEvent.index : -1;
    const title = (e.nativeEvent.name as string) || '';
    const def = actionDefs[idx] || actionDefs.find(d => d.title === title);
    if (!def) return;
    triggerHaptic('medium');
    const s = store.getState();
    switch (def.id) {
      case 'unarchive': s.unarchiveChat(item.id); break;
      case 'archive': s.archiveChat(item.id); break;
      case 'chat_settings': router.push({ pathname: '/settings/chat-settings', params: { id: item.id } } as any); break;
      case 'block':
        Alert.alert(t('messages.confirm.block_title'), item.participantName, [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('messages.action.block'), style: 'destructive', onPress: () => s.blockChat(item.id) },
        ]);
        break;
      case 'unblock': s.unblockChat(item.id); break;
      case 'unblock_user': {
        // User-level unblock — remove from `useBlockedUsersStore`. Confirm
        // first so the user can't accidentally unblock by long-pressing a
        // row in the Blocked tab. After unblock, posts/comments by this
        // user reappear in feed/profile/comments via the wrapper checks.
        const userId = userIdFromSyntheticId(item.id);
        const username = item.participantUsername || item.participantName || '';
        Alert.alert(
          t('block.unblock_confirm_title', undefined, { username }),
          t('block.unblock_confirm_msg'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('block.menu.unblock'),
              onPress: () => useBlockedUsersStore.getState().unblock(userId),
            },
          ],
        );
        break;
      }
      case 'restore': s.restoreChat(item.id); break;
      case 'delete':
        Alert.alert(t('messages.confirm.delete_title'), item.participantName, [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.delete'), style: 'destructive', onPress: () => s.deleteChat(item.id) },
        ]);
        break;
      case 'delete_forever': s.restoreChat(item.id); break; // remove from deleted list entirely (gone from all tabs)
    }
  };

  const openChat = () => {
    // Synthetic user-block rows have no real chat — tapping them opens
    // the user's profile instead. From there the user can navigate
    // through the unblock affordance on the profile menu.
    if (isSyntheticUserBlockId(item.id)) {
      router.push({ pathname: '/profile/[id]', params: { id: userIdFromSyntheticId(item.id) } });
      return;
    }
    router.push(`/chat/${item.id}?participantId=${item.participantId}` as any);
  };

  // Long-press is a strong signal the user is about to open this chat (the
  // native ContextMenu peek-and-pop also fires on long-press). Use that
  // moment to warm the disk cache for THIS chat's last few message thumbs,
  // independent of the bulk top-12 prefetch the screen already runs. Cheap,
  // idempotent (expo-image dedupes by URL).
  const onRowLongPress = () => {
    void prefetchRecentChatMedia({ conversationIds: [item.id], budgetUris: 8 });
  };

  return (
    <ConditionalContextMenuRow
      menuReady={menuReady}
      actions={actions}
      onAction={handleAction}
      onPress={openChat}
      onLongPress={onRowLongPress}
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
    </ConditionalContextMenuRow>
  );
}

// Wraps a row's pressable content in a ContextMenu only once `menuReady`
// flips true (one RAF after first mount). Hoisted out of ConversationItem
// so the conditional wrapper logic doesn't re-allocate the Pressable JSX
// twice — the children are passed through whichever wrapper is active.
function ConditionalContextMenuRow({
  menuReady,
  actions,
  onAction,
  onPress,
  onLongPress,
  children,
}: {
  menuReady: boolean;
  actions: any[];
  onAction: (e: any) => void;
  onPress: () => void;
  onLongPress: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const rowStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: theme.spacing.base,
  };
  const inner = (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={250}
      style={rowStyle}
    >
      {children}
    </Pressable>
  );
  if (!menuReady) return inner;
  return (
    <ContextMenu actions={actions} onPress={onAction}>
      {inner}
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
  const t = useT();
  // Mount-time marker — surfaces in the perf-monitor panel as
  // `MOUNT (tabs)/messages <ms>` so a slow tab switch into Messages can be
  // attributed to the screen's own first render vs. tab-bar transition.
  // Skipped at the call site when the monitor is off so we don't pay
  // Date.now() + the function hop on every tab focus.
  const mountStart = useRef(Date.now()).current;
  // Fire ONCE on first mount. See (tabs)/index.tsx for the same fix
  // rationale — store-read at effect-time avoids stale-mountStart re-fires.
  useEffect(() => {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    perfMonitor.markScreenMount('(tabs)/messages', Date.now() - mountStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  // User-level blocked ids (post-menu / profile-menu block flow). The
  // Blocked tab merges synthetic rows for these into the existing
  // chat-level blocked list so both kinds of blocks live in one place.
  const blockedUserIds = useBlockedUsersStore((s) => s.ids);

  // San AI / Music chats are no longer surfaced in this list — they live
  // exclusively behind the FAB. The list shows only real conversations.
  const specialChats = null;

  // Cache-first hydrate of the conversation list from MMKV. The synchronous
  // JSON.parse of a large conversations blob on mount was the source of
  // `SLOW long task @ (tabs)/messages` (~150 ms) — one big task held the JS
  // thread across the navigation transition. Defer past the transition with
  // InteractionManager so first paint carries only the already-in-store
  // snapshot (or the empty state) and the parse runs one frame later, exactly
  // like app/(tabs)/profile.tsx and app/chat/[id].tsx.
  useEffect(() => {
    const CONV_KV_KEY = 'conversations_list';
    const handle = InteractionManager.runAfterInteractions(() => {
      const hydrate = () => {
        if (useEntityStore.getState().conversations.length > 0) return;
        const cached = kvGetJSONSync<any[]>(CONV_KV_KEY, []);
        if (cached.length > 0) {
          useEntityStore.getState().setConversations(cached);
        }
      };
      kvWarm([CONV_KV_KEY]).then(hydrate).catch(hydrate);
    });
    return () => handle.cancel();
  }, []);

  // Persist the conversation list to MMKV whenever it changes (survives
  // restart + offline). The JSON.stringify is cheap for typical sizes, but we
  // still queue it after interactions so it never piles up on the same RAF as
  // a navigation transition or a sync-driven update burst.
  useEffect(() => {
    if (entityConversations.length === 0) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      kvSetJSON('conversations_list', entityConversations);
    });
    return () => handle.cancel();
  }, [entityConversations]);

  // Trigger syncConversations in background on mount. Deferred past the
  // navigation transition so the AsyncStorage throttle read + network request
  // never compete with the open animation on weak devices.
  useEffect(() => {
    if (!user?.id) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      syncConversations(user.id);
      // Sync profiles too so verified badges / widgets resolve for chat participants.
      syncProfiles();
    });
    return () => handle.cancel();
  }, [user?.id]);

  // Pre-warm expo-image's disk cache for the most likely next chat opens.
  // The user is almost always parked on this list for a beat or two before
  // tapping a row — that idle time is enough to fetch the thumbs of the last
  // few messages in each top conversation, so the chat opens with images
  // already on disk instead of paying a 0.5–1.5 s cold weserv round-trip.
  // Gated on `entityConversations` so we only prefetch what's locally
  // visible, and chunked past `runAfterInteractions` so it never competes
  // with the navigation transition. The signature ref keys on a stable hash
  // of the top-8 IDs + their lastMessageAt so we re-run only when the
  // ordering actually shifts (new message arrives, sync brings in new chats)
  // rather than on every render.
  const prefetchSigRef = useRef<string>('');
  useEffect(() => {
    if (entityConversations.length === 0) return;
    // Sort a shallow copy so we don't mutate store state, then take the top 8
    // by recency — matches `MAX_CONVERSATIONS` in `messagesPrefetch.ts` so
    // the sig only churns when something inside the prefetch window moves.
    // `lastMessageAt` is an ISO string, so lex compare = chrono.
    const top = [...entityConversations]
      .sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''))
      .slice(0, 8);
    const sig = top.map((c) => `${c.id}:${c.lastMessageAt || ''}`).join('|');
    if (sig === prefetchSigRef.current) return;
    prefetchSigRef.current = sig;
    const ids = top.map((c) => c.id);
    const handle = InteractionManager.runAfterInteractions(() => {
      // Smaller budget (12 URIs) keeps the total wall-clock work this
      // function does after the chat-opens transition under control on
      // weak devices — combined with the per-chat `setTimeout(0)` yield
      // inside `prefetchRecentChatMedia`, no individual JS task crosses
      // the 60 ms long-task threshold.
      void prefetchRecentChatMedia({ conversationIds: ids, budgetUris: 12 });
    });
    return () => handle.cancel();
  }, [entityConversations]);

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
      // Search only within non-deleted, non-blocked chats. User-level
      // blocked authors are also excluded here — they wouldn't show up
      // in normal search results in any case (they appear in the Blocked
      // tab only).
      return conversations.filter(
        (c) =>
          c.participantName.toLowerCase().includes(q) &&
          !deleted.includes(c.id) &&
          !blocked.includes(c.id) &&
          !blockedUserIds.includes(c.participantId),
      );
    }
    if (activeTab === 'archive') return conversations.filter(c => archived.includes(c.id) && !deleted.includes(c.id) && !blocked.includes(c.id) && !blockedUserIds.includes(c.participantId));
    if (activeTab === 'blocked') {
      // Chat-level blocked conversations come straight from
      // `chatSettingsStore.blocked` (existing behaviour).
      const chatBlocked = conversations.filter(c => blocked.includes(c.id) && !deleted.includes(c.id));
      // User-level blocked users get synthetic Conversation rows so
      // they show up next to chat-level blocks. We hydrate the row
      // visuals from `entityStore.profiles` when available so the
      // avatar/badge/name match what the user sees elsewhere; if a
      // profile isn't cached locally, fall back to a generic row.
      // Skip ids that already have a chat-level blocked row (avoids
      // duplicate listing of the same person under two buckets).
      const profiles = useEntityStore.getState().profiles;
      const chatBlockedUserIds = new Set(chatBlocked.map((c) => c.participantId));
      const userBlocked: Conversation[] = blockedUserIds
        .filter((uid) => !chatBlockedUserIds.has(uid))
        .map((uid) => {
          const p: any = profiles[uid] || {};
          return {
            id: `${SYNTHETIC_USER_BLOCK_PREFIX}${uid}`,
            participantId: uid,
            participantName: p.display_name || p.username || 'User',
            participantUsername: p.username || '',
            participantEmoji: p.emoji || '😊',
            participantVerified: !!p.is_verified,
            participantBadge: p.badge || null,
            // Telegram-style hint that this is a blocked user — keeps the
            // row layout identical (last-message line) without a misleading
            // history. Localised via the same key the placeholder uses.
            lastMessage: t('block.section.last_seen'),
            lastMessageAt: '',
            unreadCount: 0,
            isOnline: false,
          };
        });
      return [...chatBlocked, ...userBlocked];
    }
    if (activeTab === 'deleted') return conversations.filter(c => deleted.includes(c.id));
    // 'chats' — exclude archived, blocked (chat or user), deleted.
    return conversations.filter(c => !archived.includes(c.id) && !blocked.includes(c.id) && !deleted.includes(c.id) && !blockedUserIds.includes(c.participantId));
  }, [conversations, activeTab, searchQuery, archived, blocked, deleted, blockedUserIds, t]);

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
          <Text variant="subheading" weight="bold">{t('messages.title')}</Text>
          <WeatherChip />
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
            placeholder={t('messages.search_placeholder')}
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
            { key: 'chats', label: t('messages.tab.chats') },
            { key: 'apps', label: t('messages.tab.apps') },
            { key: 'archive', label: t('messages.tab.archive') },
            { key: 'blocked', label: t('messages.tab.blocked') },
            { key: 'deleted', label: t('messages.tab.deleted') },
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
            {activeTab === 'apps' ? t('messages.empty.apps') : activeTab === 'blocked' ? t('messages.empty.blocked') : activeTab === 'deleted' ? t('messages.empty.deleted') : activeTab === 'archive' ? t('messages.empty.archive') : t('messages.empty.chats')}
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
          // Tightened on weak devices: ContextMenu (the native wrapper
          // around each row) creates a UIContextMenuInteraction per view
          // on iOS, which is the dominant cost when this list mounts. 12
          // rows × ~12 ms = the 178 ms long task users were seeing on
          // the first open of (tabs)/messages. Even at 6 rows the burst
          // landed as a 127 ms task right after navigation. Going to
          // 4 rows means the visible viewport (≈ 5 rows on most phones)
          // still feels populated on first paint, and the 5th+ row
          // batches in over the next two RAF ticks instead of all at
          // once on the navigation transition frame.
          initialNumToRender={4}
          maxToRenderPerBatch={3}
          windowSize={5}
          updateCellsBatchingPeriod={100}
          // Fixed row geometry: Avatar size="md" is 44 px tall + 10 px
          // top + 10 px bottom padding = 64 px per row; the 0.5 px
          // separator is rendered as a sibling. Providing getItemLayout
          // lets FlatList skip the per-row onLayout measurement pass on
          // the cold-mount frame, shaving the residual mount cost left
          // after the ContextMenu lazy-mount fix and helping
          // scroll-to-index work without an intermediate measurement.
          getItemLayout={MESSAGES_ITEM_LAYOUT}
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
  const t = useT();
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
    // Defer the route push until React has a chance to commit the closed
    // state and the close-spring has flushed at least its first native
    // frame. Without this, the new screen's mount work blocks the JS
    // thread mid-animation and the user sees a stutter at the tail of
    // the close. InteractionManager runs the callback after current
    // interactions/animations are done, so the menu finishes closing
    // cleanly before navigation kicks off.
    InteractionManager.runAfterInteractions(action);
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
        <FabMenuItem icon="grid" label={t('messages.fab.mini_apps')} tint={accent} onPress={() => navigate(() => router.push('/settings/mini-apps' as any))} />
        <FabSeparator color={borderColor} />
        <FabMenuItem icon="cpu" label={t('messages.fab.ai')} tint={accent} onPress={() => navigate(() => router.push('/chat/ai' as any))} />
        <FabSeparator color={borderColor} />
        <FabMenuItem icon="music" label={t('messages.fab.music')} tint={accent} onPress={() => navigate(() => router.push('/chat/music' as any))} />
        <FabSeparator color={borderColor} />
        <FabMenuItem icon="settings" label={t('messages.fab.chat_settings')} tint={secondary} onPress={() => navigate(() => router.push({ pathname: '/settings/chat-settings', params: { id: GLOBAL_CHAT_SETTINGS_KEY } } as any))} />
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
