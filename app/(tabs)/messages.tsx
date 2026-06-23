import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { View, FlatList, Pressable, ViewStyle, TextInput, StyleSheet, Text as RNText, Alert, Animated, Easing, InteractionManager } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import ContextMenu from 'react-native-context-menu-view';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { WeatherChip } from '../../src/components/ui/WeatherChip';
import { useLiquidGlassActive, NativeGlassView, GlassBg } from '../../src/components/ui/LiquidGlass';
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
import { useT, t as tStatic, useI18nStore } from '../../src/i18n/store';
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
  // Native iOS-26 liquid glass for the "open" button. iOS-only + opt-in;
  // everywhere else `glassActive` is false and the flat accent chip renders.
  const glassActive = useLiquidGlassActive();
  // Field-level selectors so the row doesn't re-render on every loading flag.
  const apps = useMiniAppsStore((s) => s.apps);
  const userId = useAuthStore((s) => s.user?.id);

  // Hydrate the user's mini-apps list when the Apps tab opens. Deferred past
  // the tab-switch transition (InteractionManager) so the network round-trip
  // never competes with the swipe/tap animation on weak devices — the same
  // pattern the AI chat uses to warm this exact store. `loadApps` is read via
  // getState() so the effect has no unstable deps and fires once on mount; the
  // `apps` selector above re-renders the row live when the fetch resolves.
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      try { useMiniAppsStore.getState().loadApps(); } catch { /* offline — cached apps still render */ }
    });
    return () => handle.cancel();
  }, []);

  // Only the viewer's OWN mini-apps. The list endpoint (`/v1/mini-apps`)
  // returns the newest apps across ALL creators, so we scope by creator_id —
  // identical to the AI-chat "Управление" manage list (the working reference).
  // Without this scope the launcher would surface strangers' apps.
  const myApps = useMemo(
    () => (userId ? apps.filter((a) => a.creator_id === userId) : []),
    [apps, userId],
  );

  // Genuine empty state lives HERE so the Apps tab has a single source of
  // truth. The screen's generic empty-state block skips the Apps tab, which
  // fixes the bug where the centered "no mini-apps" message rendered even
  // while apps existed (the conversation `filtered` list is always empty on
  // the Apps tab, so that block used to fire unconditionally).
  if (myApps.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 }}>
        <Feather name="grid" size={48} color={theme.colors.text.tertiary} />
        <Text variant="body" color={theme.colors.text.tertiary} style={{ marginTop: theme.spacing.base, textAlign: 'center' }}>
          {t('messages.empty.apps')}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      {myApps.slice(0, 5).map(app => (
        <Pressable key={app.id} onPress={() => router.push({ pathname: '/mini-app', params: { url: encodeURIComponent(app.url), name: app.name, emoji: app.emoji } })} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.colors.accent.primary + '12', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
            <RNText style={{ fontSize: 20 }} allowFontScaling={false}>{app.emoji}</RNText>
          </View>
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text variant="body" weight="medium">{app.name}</Text>
            {app.description ? <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>{app.description}</Text> : null}
          </View>
          {/* "Open" button → interactive liquid glass holding the label as a
              CHILD so it morphs outward on touch (no overflow clip, own
              borderRadius). Falls back to the flat accent chip when glass off. */}
          <Pressable onPress={() => router.push({ pathname: '/mini-app', params: { url: encodeURIComponent(app.url), name: app.name, emoji: app.emoji } })} style={glassActive ? { borderRadius: 14 } : { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: theme.colors.accent.primary + '15' }}>
            {glassActive ? (
              <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} tintColor={theme.colors.accent.primary + '38'} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} style={{ fontSize: 11 }}>{t('messages.miniapp.open')}</Text>
              </NativeGlassView>
            ) : (
              <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} style={{ fontSize: 11 }}>{t('messages.miniapp.open')}</Text>
            )}
          </Pressable>
        </Pressable>
      ))}
    </View>
  );
}

type ChatTab = 'chats' | 'apps' | 'archive' | 'blocked' | 'deleted';

// Left-to-right order of the category tabs — drives swipe-to-switch (a
// horizontal pan on the list area advances/retreats through this list).
const TAB_ORDER: ChatTab[] = ['chats', 'apps', 'archive', 'blocked', 'deleted'];

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

// ─── Staggered ContextMenu arming scheduler ──────────────────────────────
// iOS builds a `UIContextMenuInteraction` per ContextMenu view, so arming
// every visible row in a single commit (the previous one-RAF-after-mount
// strategy) produced the dominant ~182 ms long task on the cold open of
// (tabs)/messages. This shared FIFO pump arms at most ONE row per animation
// frame, so the per-view native setup is spread across frames and never
// lands as a single long task on the navigation-transition frame. Rows
// enqueue on mount (deferred past the transition via InteractionManager) and
// cancel their slot on unmount/recycle. By the time the list settles and the
// user can reach a row, it is already armed → long-press works on the first
// try, identical to before — only the setup timing moved off the hot frame.
const __armQueue: Array<() => void> = [];
let __armPumpScheduled = false;
function __pumpArmQueue() {
  __armPumpScheduled = false;
  const fn = __armQueue.shift();
  if (fn) {
    try { fn(); } catch { /* row unmounted between schedule + pump */ }
  }
  if (__armQueue.length > 0) {
    __armPumpScheduled = true;
    requestAnimationFrame(__pumpArmQueue);
  }
}
function scheduleRowArm(fn: () => void): () => void {
  __armQueue.push(fn);
  if (!__armPumpScheduled) {
    __armPumpScheduled = true;
    requestAnimationFrame(__pumpArmQueue);
  }
  // Canceller — drop this row's slot if it unmounts before its turn.
  return () => {
    const i = __armQueue.indexOf(fn);
    if (i >= 0) __armQueue.splice(i, 1);
  };
}

function ConversationItemBase({ item, tab }: { item: Conversation; index: number; tab: ChatTab }) {
  const theme = useTheme();
  const t = useT();
  const store = useChatSettingsStore;
  const localName = useChatSettingsStore((s) => s.settings[item.id]?.localName);
  const displayName = localName || item.participantName;

  // Defer the native ContextMenu wrapper off the cold-mount frame. iOS's
  // `UIContextMenuInteraction` is set up per-view by the ContextMenu library;
  // arming all visible rows in one commit (the previous one-RAF-after-mount
  // approach) landed as the dominant ~182 ms long task behind the residual
  // `LONG @ (tabs)/messages` the perf monitor flagged on cold open. Instead we
  // enqueue into a shared scheduler (see `scheduleRowArm`) that arms at most
  // ONE row per animation frame, AFTER the navigation transition completes
  // (InteractionManager). The plain Pressable renders on the first frame and
  // each row upgrades to ContextMenu on its staggered turn — the visible UI is
  // byte-identical (the wrapper is transparent) and long-press still works
  // because arming finishes within a few frames of the list settling, well
  // before the user can physically reach + hold a row for >250 ms.
  const [menuReady, setMenuReady] = useState(false);
  useEffect(() => {
    if (menuReady) return;
    let cancelArm: (() => void) | undefined;
    const handle = InteractionManager.runAfterInteractions(() => {
      cancelArm = scheduleRowArm(() => setMenuReady(true));
    });
    return () => {
      handle.cancel();
      cancelArm?.();
    };
  }, [menuReady]);

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
  // Native iOS-26 liquid glass for the category tab chips. iOS-only + opt-in.
  const glassActive = useLiquidGlassActive();
  const [activeTab, setActiveTab] = useState<ChatTab>('chats');
  const archived = useChatSettingsStore((s) => s.archived);
  const blocked = useChatSettingsStore((s) => s.blocked);
  const deleted = useChatSettingsStore((s) => s.deleted);
  // Per-chat "last opened" timestamps — folded into the recency sort so a chat
  // the user just opened floats to the top even with no new message.
  const openedAt = useChatSettingsStore((s) => s.openedAt);
  // User-level blocked ids (post-menu / profile-menu block flow). The
  // Blocked tab merges synthetic rows for these into the existing
  // chat-level blocked list so both kinds of blocks live in one place.
  const blockedUserIds = useBlockedUsersStore((s) => s.ids);
  // Locale value (not the unstable `t` hook) drives the `filtered` memo's
  // dependency. `useT()` allocates a NEW function every render, so listing
  // `t` as a memo dep forced the O(n log n) filter+sort to re-run on EVERY
  // re-render (each store push, each openedAt update on returning from a
  // chat) — the recurring long task the perf monitor flagged. The memo only
  // needs a translated string for the synthetic Blocked rows, so we depend on
  // the stable `locale` value and call the module-level `tStatic` inside.
  const locale = useI18nStore((s) => s.locale);

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

  // Background-refresh conversations whenever the tab regains focus, so a
  // conversation created since the last view (e.g. a brand-new chat started
  // by an incoming message while we were on another tab) shows up without a
  // manual pull-to-refresh. Cache-first: `syncConversations` reconciles into
  // the entity store and only repaints changed rows, so there's no flash.
  // `syncConversations` is gated by a 3-minute `shouldSync` throttle, so
  // rapid tab-switching collapses to at most one network round-trip — the
  // bridge's live `notif.message` upsert is the instant path, this is the
  // backstop. Deferred past the focus transition so the throttle read +
  // request never compete with the tab-switch animation.
  useFocusEffect(
    useCallback(() => {
      const uid = useAuthStore.getState().user?.id;
      if (!uid) return;
      const handle = InteractionManager.runAfterInteractions(() => {
        syncConversations(uid);
      });
      return () => handle.cancel();
    }, []),
  );

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
  // Recency comparator — newest activity first. `lastMessageAt` is an ISO
  // string, so a lexicographic compare is also chronological. Activity is the
  // LATER of the conversation's last message and the last time the user opened
  // it (openedAt), so opening a chat floats it to the top "по активности" even
  // when no new message arrived. Items with neither sort last.
  const activityOf = (c: Conversation) => {
    const opened = openedAt[c.id] || '';
    const last = c.lastMessageAt || '';
    return opened > last ? opened : last;
  };
  const byRecency = (a: Conversation, b: Conversation) =>
    activityOf(b).localeCompare(activityOf(a));
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
      ).sort(byRecency);
    }
    if (activeTab === 'archive') return conversations.filter(c => archived.includes(c.id) && !deleted.includes(c.id) && !blocked.includes(c.id) && !blockedUserIds.includes(c.participantId)).sort(byRecency);
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
            lastMessage: tStatic('block.section.last_seen'),
            lastMessageAt: '',
            unreadCount: 0,
            isOnline: false,
          };
        });
      return [...chatBlocked, ...userBlocked];
    }
    if (activeTab === 'deleted') return conversations.filter(c => deleted.includes(c.id));
    // 'chats' — exclude archived, blocked (chat or user), deleted.
    return conversations.filter(c => !archived.includes(c.id) && !blocked.includes(c.id) && !deleted.includes(c.id) && !blockedUserIds.includes(c.participantId)).sort(byRecency);
  }, [conversations, activeTab, searchQuery, archived, blocked, deleted, blockedUserIds, openedAt, locale]);

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  // Swipe-to-switch between the category tabs. A horizontal pan on the content
  // area moves to the adjacent tab. `activeTabRef` keeps the gesture's JS
  // callback reading the latest tab without re-creating the gesture each
  // render. The gesture is tuned to yield to vertical list scrolling
  // (failOffsetY) and only claim clearly-horizontal swipes (activeOffsetX).
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const goAdjacentTab = useCallback((dir: 1 | -1) => {
    const i = TAB_ORDER.indexOf(activeTabRef.current);
    const next = i + dir;
    if (next < 0 || next >= TAB_ORDER.length) return;
    triggerHaptic('selection');
    setActiveTab(TAB_ORDER[next]);
  }, []);
  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-20, 20])
        .failOffsetY([-18, 18])
        .onEnd((e) => {
          'worklet';
          // Require a decent horizontal throw so a lazy diagonal scroll never
          // flips tabs. Swipe LEFT → next tab, swipe RIGHT → previous.
          if (e.translationX <= -55) runOnJS(goAdjacentTab)(1);
          else if (e.translationX >= 55) runOnJS(goAdjacentTab)(-1);
        }),
    [goAdjacentTab],
  );

  const bgColor = theme.colors.background.primary;
  const bgTransparent = theme.colors.background.primary + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  // Stable FlatList callbacks. Both `renderItem` and `ItemSeparatorComponent`
  // were previously inline arrows, so every MessagesScreen re-render (search
  // typing, tab switch, store push) handed FlatList fresh function identities.
  // For `ItemSeparatorComponent` that's the costly one: React treats a new
  // function identity as a NEW component type and unmounts+remounts EVERY
  // separator in the list on each re-render. Hoisting both to stable
  // identities confines re-renders to the rows whose data actually changed
  // (the memoized ConversationItem already bails out on equal props).
  const separatorColor = theme.colors.border.light;
  const renderConversationItem = useCallback(
    ({ item, index }: { item: Conversation; index: number }) => (
      <ConversationItem item={item} index={index} tab={activeTab} />
    ),
    [activeTab],
  );
  const renderSeparator = useCallback(
    () => <View style={{ height: 0.5, backgroundColor: separatorColor, marginLeft: 68 }} />,
    [separatorColor],
  );

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
          renderItem={({ item: tab }) => {
            const isActive = activeTab === tab.key;
            const label = (
              <Text variant="caption" weight={isActive ? 'bold' : 'regular'} color={isActive ? theme.colors.accent.primary : theme.colors.text.tertiary} style={{ fontSize: 12 }}>{tab.label}</Text>
            );
            // Interactive liquid glass capsule holding the label as a CHILD so
            // it morphs outward on touch (gold-standard pattern). The ACTIVE
            // chip gets a subtle accent tint so selection still reads clearly
            // over the glass; inactive chips are clear glass. NO overflow clip,
            // own borderRadius. Falls back to the flat accent fill when off.
            if (glassActive) {
              return (
                <Pressable onPress={() => setActiveTab(tab.key as ChatTab)} style={{ borderRadius: 16 }}>
                  <NativeGlassView
                    glassStyle="regular"
                    isInteractive
                    colorScheme={theme.isDark ? 'dark' : 'light'}
                    tintColor={isActive ? theme.colors.accent.primary + '38' : undefined}
                    style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
                  >
                    {label}
                  </NativeGlassView>
                </Pressable>
              );
            }
            return (
              <Pressable onPress={() => setActiveTab(tab.key as ChatTab)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: isActive ? theme.colors.accent.primary + '20' : 'transparent' }}>
                {label}
              </Pressable>
            );
          }}
        />
      </View>

      {/* AI Chat (chats tab) + Mini-apps (apps tab) */}
      {/* Swipe horizontally anywhere on the content area to switch tabs. */}
      <GestureDetector gesture={swipeGesture}>
        <View style={{ flex: 1 }}>
          {/* AI Chat + Music (chats tab) — only shown once opened, newest first */}
          {activeTab === 'chats' && !searchQuery && specialChats}

          {activeTab === 'apps' ? (
            /* The Apps tab owns its full content (launcher list OR empty
               state) via MiniAppsRow, so it must NOT fall through to the
               conversation empty-state / FlatList block below — `filtered`
               is always empty on this tab, which previously rendered the
               "no mini-apps" message on top of an existing apps list. */
            <MiniAppsRow />
          ) : filtered.length === 0 ? (
            (activeTab === 'chats' && specialChats && !searchQuery) ? null : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 }}>
              <Feather name={activeTab === 'blocked' ? 'slash' : activeTab === 'deleted' ? 'trash-2' : activeTab === 'archive' ? 'archive' : 'message-circle'} size={48} color={theme.colors.text.tertiary} />
              <Text
                variant="body"
                color={theme.colors.text.tertiary}
                style={{ marginTop: theme.spacing.base, textAlign: 'center' }}
              >
                {activeTab === 'blocked' ? t('messages.empty.blocked') : activeTab === 'deleted' ? t('messages.empty.deleted') : activeTab === 'archive' ? t('messages.empty.archive') : t('messages.empty.chats')}
              </Text>
            </View>
            )
          ) : (
            <FlashList
              data={filtered}
              keyExtractor={(item) => item.id}
              renderItem={renderConversationItem}
              ItemSeparatorComponent={renderSeparator}
              contentContainerStyle={{ paddingBottom: 100 }}
              showsVerticalScrollIndicator={false}
              // FlashList v2 cell recycling — replaces the FlatList
              // virtualization knobs (initialNumToRender/maxToRenderPerBatch/
              // windowSize/updateCellsBatchingPeriod/removeClippedSubviews) and
              // getItemLayout. The per-row native ContextMenu cost that drove
              // the ~178 ms cold-mount long task is now amortized by recycling:
              // only the visible rows mount, off-screen rows are recycled from
              // the pool instead of mounted fresh.
            />
          )}
        </View>
      </GestureDetector>

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
  // Native iOS-26 liquid glass for the FAB + its menu. iOS-only + opt-in.
  const glassActive = useLiquidGlassActive();
  const [open, setOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current; // 0 = closed, 1 = open

  useEffect(() => {
    // Plain appear/disappear — a simple opacity (+ subtle scale) fade, per the
    // user's request to drop the rubbery "grow out of the FAB" spring. Quick
    // timing, native-driven so it stays smooth even while navigating away.
    Animated.timing(anim, {
      toValue: open ? 1 : 0,
      duration: open ? 160 : 130,
      useNativeDriver: true,
    }).start();
  }, [open]);

  const toggle = useCallback(() => { triggerHaptic('light'); setOpen((v) => !v); }, []);
  const navigate = useCallback((action: () => void) => {
    setOpen(false);
    // Defer the route push until React commits the closed state and the fade
    // has flushed its first native frame, so the new screen's mount work never
    // blocks the JS thread mid-animation.
    InteractionManager.runAfterInteractions(action);
  }, []);

  // Simple appear: fade + a barely-there scale/translate so it doesn't pop in
  // harshly. No transform-origin gymnastics.
  const menuOpacity = anim;
  const menuScale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  const menuTranslateY = anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  const backdropOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  // FAB icon rotates 45° to morph "edit"→"x" without swapping the icon mid-frame.
  const fabIconRotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });

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

      {/* Menu — always mounted; opacity + a subtle scale/translate fade it
          in/out. When glass is on, the solid card background is replaced by a
          GlassBg layer (content renders on top); border/solid fill drop so the
          glass supplies the surface. */}
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          bottom: 164,
          right: 24,
          opacity: menuOpacity,
          transform: [
            { translateY: menuTranslateY },
            { scale: menuScale },
          ],
          backgroundColor: glassActive ? 'transparent' : menuBg,
          borderRadius: 18,
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.18,
          shadowRadius: 20,
          elevation: 14,
          borderWidth: glassActive ? 0 : 0.5,
          borderColor,
          zIndex: 201,
          minWidth: 220,
        }}
      >
        {/* Glass surface behind the menu rows (static, non-interactive so it
            doesn't morph as the finger moves between items). */}
        {glassActive ? <GlassBg borderRadius={18} glassStyle="regular" interactive={false} colorScheme={theme.isDark ? 'dark' : 'light'} /> : null}
        <FabMenuItem icon="grid" label={t('messages.fab.mini_apps')} tint={accent} onPress={() => navigate(() => router.push('/settings/mini-apps' as any))} />
        <FabSeparator color={borderColor} />
        <FabMenuItem icon="cpu" label={t('messages.fab.ai')} tint={accent} onPress={() => navigate(() => router.push('/chat/ai' as any))} />
        <FabSeparator color={borderColor} />
        <FabMenuItem icon="music" label={t('messages.fab.music')} tint={accent} onPress={() => navigate(() => router.push('/chat/music' as any))} />
        <FabSeparator color={borderColor} />
        <FabMenuItem icon="settings" label={t('messages.fab.chat_settings')} tint={secondary} onPress={() => navigate(() => router.push({ pathname: '/settings/chat-settings', params: { id: GLOBAL_CHAT_SETTINGS_KEY } } as any))} />
      </Animated.View>

      {/* FAB → interactive liquid glass with a strong accent tint so it keeps
          its accent identity while morphing on touch. Falls back to the solid
          accent circle when glass is off. */}
      <Pressable
        onPress={toggle}
        style={{
          position: 'absolute',
          bottom: 100,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: glassActive ? 'transparent' : accent,
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
        {glassActive ? (
          <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} tintColor={accent} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 28 }} />
        ) : null}
        <Animated.View style={{ transform: [{ rotate: fabIconRotate }] }}>
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
