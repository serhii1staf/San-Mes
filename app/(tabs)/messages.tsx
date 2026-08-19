import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { View, FlatList, Pressable, ViewStyle, TextInput, StyleSheet, Text as RNText, Alert, Animated, Easing, InteractionManager } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing as REasing,
  type SharedValue,
} from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import ContextMenu from 'react-native-context-menu-view';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useLiquidGlassActive, NativeGlassView, GlassBg } from '../../src/components/ui/LiquidGlass';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { useChatStore, useEntityStore, useAuthStore } from '../../src/store';
import { useBlockedUsersStore } from '../../src/store/blockedUsersStore';
import { syncConversations, syncProfiles } from '../../src/services/syncService';
import { prefetchRecentChatMedia } from '../../src/services/messagesPrefetch';
import { kvGetJSONSync, kvSetJSON, kvWarm } from '../../src/services/kvStore';
import { useMiniAppsStore, type MiniApp } from '../../src/store/miniAppsStore';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY } from '../../src/store/chatSettingsStore';
import { useSettingsStore } from '../../src/store/settingsStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT, t as tStatic, useI18nStore } from '../../src/i18n/store';
import { Conversation } from '../../src/types';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useTabBarStore } from '../../src/store/tabBarStore';
import {
  ActiveTodayAvatars,
  selectActiveToday,
} from '../../src/components/messages/ActiveTodayAvatars';

// Frozen empty set reused for "nothing selected" so leaving selection mode and
// re-entering it doesn't allocate, and so the `selected` prop comparison in the
// row's memo stays cheap.
const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>();

// Width of the checkbox column that slides in during selection mode. Rows shift
// right by exactly this much, so nothing ever overlaps the avatar.
const SELECT_COLUMN_WIDTH = 34;

// Resting height of the search row (field + its vertical padding). The
// collapse-on-scroll animation interpolates the container between this and 0, so
// it has to be a constant rather than measured — measuring would need an
// onLayout round-trip before the first collapse could animate.
const SEARCH_ROW_HEIGHT = 46;

// Hoisted to module scope: these are referenced from inside memoized rows, so a
// fresh object per render would defeat their prop-equality bail-outs.
const styles = StyleSheet.create({
  selectColumn: { alignItems: 'flex-start', justifyContent: 'center', overflow: 'hidden' },
  selectCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSide: {
    // Both side slots reserve the SAME width so the centre cluster is optically
    // centred on the screen and cannot be pushed off-centre by a longer
    // localized label ("Изм." vs "Edit" vs "Bearbeiten").
    minWidth: 92,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSideRight: { justifyContent: 'flex-end' },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  headerPill: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Compact on purpose: this bar stands in for the tab bar, so it should read as
  // the same weight of chrome rather than a taller slab. 52 pt still clears
  // Apple's 44 pt minimum touch target because each button fills the full height.
  //
  // LENGTH: it no longer spans the display. Three controls stretched edge-to-edge
  // left a lot of dead space between them and read as a wide, empty slab. The bar
  // now shrink-wraps its buttons (`alignSelf: 'center'` + no `right`), so the
  // controls sit close together in a centred pill — and it stays inside
  // `maxWidth` so four controls or a long localized label can still fit without
  // overflowing on a small device.
  actionBar: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 52,
    borderRadius: 22,
    overflow: 'hidden',
    paddingHorizontal: 6,
    maxWidth: '92%',
    zIndex: 210,
  },
  // Fixed-width columns rather than `flex: 1`: with a shrink-wrapping bar, flex
  // children would collapse to their content and the spacing would drift with
  // label length. A fixed 76 pt keeps the icons evenly pitched and comfortably
  // above the 44 pt touch minimum.
  actionBtn: {
    width: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
});

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

// Stable keyExtractor + content-container style for the conversation FlatList.
// Both were previously inline (`(item) => item.id` and `{ paddingBottom: 100 }`),
// so every MessagesScreen re-render (one per search keystroke, plus store
// pushes) handed FlatList fresh identities and defeated its prop-equality
// bail-outs. Hoisting to module scope makes them referentially stable for the
// life of the screen.
const MESSAGES_KEY_EXTRACTOR = (item: Conversation) => item.id;
const MESSAGES_LIST_CONTENT_STYLE = { paddingBottom: 100 } as const;

/**
 * Only the viewer's OWN mini-apps.
 *
 * The list endpoint (`/v1/mini-apps`) returns the newest apps across ALL
 * creators, so the list must be scoped by `creator_id` — without it the launcher
 * surfaces strangers' apps, and "select all → delete" would target them.
 *
 * Shared by the launcher rows and the screen's select-all so the two can never
 * disagree about what is on screen.
 */
function selectOwnMiniApps(apps: readonly MiniApp[], userId: string | undefined): MiniApp[] {
  if (!userId) return [];
  return apps.filter((a) => a.creator_id === userId);
}

interface MiniAppsRowProps {
  /** True while the list is in selection ("Изм.") mode. */
  editMode: boolean;
  selectedIds: ReadonlySet<string>;
  /** Shared 0→1 selection-mode progress — the SAME value the chat rows read. */
  editProgress: SharedValue<number>;
  onToggleSelect: (id: string) => void;
}

function MiniAppsRow({ editMode, selectedIds, editProgress, onToggleSelect }: MiniAppsRowProps) {
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

  const myApps = useMemo(() => selectOwnMiniApps(apps, userId), [apps, userId]);

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
        <Pressable
          key={app.id}
          // In selection mode a tap ticks the app instead of launching it —
          // otherwise picking apps to delete would keep opening them.
          onPress={
            editMode
              ? () => onToggleSelect(app.id)
              : () => router.push({ pathname: '/mini-app', params: { url: encodeURIComponent(app.url), name: app.name, emoji: app.emoji } })
          }
          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}
        >
          <SelectionCheckbox
            editProgress={editProgress}
            selected={selectedIds.has(app.id)}
            accent={theme.colors.accent.primary}
            borderColor={theme.colors.border.medium}
          />
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.colors.accent.primary + '12', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
            <RNText style={{ fontSize: 20 }} allowFontScaling={false}>{app.emoji}</RNText>
          </View>
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text variant="body" weight="medium">{app.name}</Text>
            {app.description ? <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>{app.description}</Text> : null}
          </View>
          {/* "Open" button → interactive liquid glass holding the label as a
              CHILD so it morphs outward on touch (no overflow clip, own
              borderRadius). Falls back to the flat accent chip when glass off.
              Hidden in selection mode: a launch affordance inside a row whose
              tap now means "select" is a trap. */}
          {editMode ? null : (
          <Pressable onPress={() => router.push({ pathname: '/mini-app', params: { url: encodeURIComponent(app.url), name: app.name, emoji: app.emoji } })} style={glassActive ? { borderRadius: 14 } : { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: theme.colors.accent.primary + '15' }}>
            {glassActive ? (
              <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} tintColor={theme.colors.accent.primary + '38'} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} style={{ fontSize: 11 }}>{t('messages.miniapp.open')}</Text>
              </NativeGlassView>
            ) : (
              <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} style={{ fontSize: 11 }}>{t('messages.miniapp.open')}</Text>
            )}
          </Pressable>
          )}
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

interface ConversationItemProps {
  item: Conversation;
  index: number;
  tab: ChatTab;
  /** True while the list is in selection ("Изм.") mode. */
  editMode: boolean;
  /** Whether THIS row is currently ticked. */
  selected: boolean;
  /** Shared 0→1 selection-mode progress, driven once by the screen. */
  editProgress: SharedValue<number>;
  onToggleSelect: (id: string) => void;
}

function ConversationItemBase({
  item,
  tab,
  editMode,
  selected,
  editProgress,
  onToggleSelect,
}: ConversationItemProps) {
  const theme = useTheme();
  const t = useT();
  const store = useChatSettingsStore;
  const localName = useChatSettingsStore((s) => s.settings[item.id]?.localName);
  const displayName = localName || item.participantName;

  // Preview line under the name. A message with no text but a real timestamp is a
  // photo/GIF message (the derived preview keeps the timestamp and leaves the text
  // empty on purpose — the store must not do i18n), so label it here rather than
  // rendering a blank line that reads as "no messages".
  const previewText = item.lastMessage || (item.lastMessageAt ? t('chat.photo') : '');

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
      // In selection mode the native context menu is suppressed entirely: a
      // long-press peek that navigates would fight the checkboxes, and iOS's
      // menu would cover the very rows the user is ticking.
      menuReady={menuReady && !editMode}
      actions={actions}
      onAction={handleAction}
      onPress={editMode ? () => onToggleSelect(item.id) : openChat}
      onLongPress={onRowLongPress}
    >
      <SelectionCheckbox
        editProgress={editProgress}
        selected={selected}
        accent={theme.colors.accent.primary}
        borderColor={theme.colors.border.medium}
      />
      <Avatar emoji={item.participantEmoji} name={item.participantName} size="md" tint />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text variant="body" weight={item.unreadCount > 0 ? 'semibold' : 'regular'} numberOfLines={1} style={{ flexShrink: 1 }}>
            {displayName}
          </Text>
          {item.participantVerified && <VerifiedBadge size={13} />}
          {item.participantBadge && <UserBadge badge={item.participantBadge} size="sm" />}
        </View>
        {previewText ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <Text
              variant="caption"
              color={item.unreadCount > 0 ? theme.colors.text.primary : theme.colors.text.secondary}
              numberOfLines={1}
              style={{ flex: 1 }}
            >
              {previewText}
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

/**
 * Hairline between rows. Reads the same shared `editProgress` as the rows so its
 * left inset slides in lock-step with them — one UI-thread animation, no JS work
 * per separator.
 */
const RowSeparator = React.memo(function RowSeparator({
  color,
  editProgress,
}: {
  color: string;
  editProgress: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({
    marginLeft: 68 + editProgress.value * SELECT_COLUMN_WIDTH,
  }));
  return <Reanimated.View style={[{ height: 0.5, backgroundColor: color }, style]} />;
});

/**
 * Header chrome buttons. Both follow the same rule the rest of the app uses for
 * liquid glass: the glass is a BACKGROUND sibling (`GlassBg`) and the label/icon
 * is painted on top, never nested inside the glass view. That keeps the content
 * from being optically warped by the material and keeps the press target with
 * the `Pressable`, not with the effect view.
 */
const HeaderPillButton = React.memo(function HeaderPillButton({
  onPress,
  glassActive,
  theme,
  children,
  accessibilityLabel,
}: {
  onPress: () => void;
  glassActive: boolean;
  theme: any;
  children: React.ReactNode;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      // Generous hit slop: the pill is only 34 pt tall, under Apple's 44 pt
      // minimum touch target, so the slop makes up the difference without
      // making the chrome look chunky.
      hitSlop={8}
      style={[
        styles.headerPill,
        glassActive
          ? null
          : {
              backgroundColor: theme.colors.background.elevated,
              borderWidth: 1,
              borderColor: theme.colors.border.light,
            },
      ]}
    >
      {glassActive ? (
        <GlassBg borderRadius={17} glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} />
      ) : null}
      {children}
    </Pressable>
  );
});

const HeaderIconButton = React.memo(function HeaderIconButton({
  onPress,
  glassActive,
  theme,
  icon,
  accessibilityLabel,
}: {
  onPress: () => void;
  glassActive: boolean;
  theme: any;
  icon: string;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={[
        styles.headerIconBtn,
        glassActive
          ? null
          : {
              backgroundColor: theme.colors.background.elevated,
              borderWidth: 1,
              borderColor: theme.colors.border.light,
            },
      ]}
    >
      {glassActive ? (
        <GlassBg borderRadius={17} glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} />
      ) : null}
      <Feather name={icon as any} size={17} color={theme.colors.text.primary} />
    </Pressable>
  );
});

/**
 * The checkbox column that slides in on the left of every row in selection mode.
 *
 * PERF: the width/opacity animation is driven by the ONE `editProgress` shared
 * value that the screen owns, so entering selection mode is a single UI-thread
 * animation that every visible row simply reads. There is no per-row timing, no
 * `setState` cascade and no JS work per frame — which is what keeps the shift
 * smooth on a long list.
 *
 * Collapsing to width 0 (rather than unmounting) means the row's flex layout
 * settles once, and the tick can animate back out instead of popping.
 *
 * `pointerEvents: 'none'` throughout: the whole row is already the press target
 * in selection mode, so the checkbox must never swallow that tap — it is purely
 * a visual indicator. This also keeps the hit area a comfortable full-row width
 * instead of a 22 px circle.
 */
const SelectionCheckbox = React.memo(function SelectionCheckbox({
  editProgress,
  selected,
  accent,
  borderColor,
}: {
  editProgress: SharedValue<number>;
  selected: boolean;
  accent: string;
  borderColor: string;
}) {
  const columnStyle = useAnimatedStyle(() => ({
    width: editProgress.value * SELECT_COLUMN_WIDTH,
    opacity: editProgress.value,
    // Nudge the circle in from the left so it eases into place rather than
    // being revealed by a hard clip.
    transform: [{ translateX: interpolate(editProgress.value, [0, 1], [-8, 0]) }],
  }));

  return (
    <Reanimated.View style={[styles.selectColumn, columnStyle]} pointerEvents="none">
      <View
        style={[
          styles.selectCircle,
          selected
            ? { backgroundColor: accent, borderColor: accent }
            : { backgroundColor: 'transparent', borderColor },
        ]}
      >
        {selected ? <Feather name="check" size={13} color="#FFFFFF" /> : null}
      </View>
    </Reanimated.View>
  );
});

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
  // Selection state: `editMode` flips for every row at once (that's the point),
  // while `selected` changes for exactly the tapped row — so ticking one chat
  // re-renders one row, not the list. `editProgress` and `onToggleSelect` are
  // stable identities from the screen, compared here so a future accidental
  // inline arrow can't silently start re-rendering every row.
  prev.editMode === next.editMode &&
  prev.selected === next.selected &&
  prev.editProgress === next.editProgress &&
  prev.onToggleSelect === next.onToggleSelect &&
  prev.item.id === next.item.id &&
  prev.item.lastMessage === next.item.lastMessage &&
  // Also compared, because the preview line falls back to a "Photo" label keyed
  // off the TIMESTAMP when the text is empty — without this a photo arriving into
  // a chat whose last text was also empty would not repaint the row.
  prev.item.lastMessageAt === next.item.lastMessageAt &&
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

  // ─── Selection ("Изм.") mode ──────────────────────────────────────────────
  //
  // Entering it slides a checkbox column in on the left of every row, swaps the
  // floating tab bar for a contextual action bar, and turns a row tap into
  // select/deselect instead of "open chat".
  //
  // `editProgress` is a SINGLE shared value handed to every row, so the shift is
  // one UI-thread animation the rows merely read — not N JS-driven animations.
  // `selectedIds` is a Set for O(1) membership from inside the row.
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const editProgress = useSharedValue(0);
  const setTabBarHidden = useTabBarStore((s) => s.setHidden);
  // ── Mirrors for stable callbacks ──────────────────────────────────────────
  //
  // Several callbacks below (`handleSelectAll`, the swipe gesture) need the
  // latest tab / rows but must keep a STABLE identity: depending on `filtered`
  // or `activeTab` directly would hand every row a fresh `onToggleSelect` on
  // each list recompute and defeat the row memo.
  //
  // `filteredRef` is assigned right after `filtered` is computed further down.
  const filteredRef = useRef<Conversation[]>([]);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  useEffect(() => {
    editProgress.value = withTiming(editMode ? 1 : 0, {
      duration: 220,
      easing: REasing.out(REasing.cubic),
    });
  }, [editMode, editProgress]);

  // The tab bar lives OUTSIDE this screen's tree, so hiding it goes through a
  // store. The cleanup is not optional: without it, navigating away (or being
  // unmounted by a tab switch) while still in selection mode would leave the
  // app with no tab bar and no way to get it back.
  useEffect(() => {
    setTabBarHidden(editMode);
    return () => setTabBarHidden(false);
  }, [editMode, setTabBarHidden]);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setSelectedIds(EMPTY_SELECTION);
  }, []);

  const toggleEditMode = useCallback(() => {
    triggerHaptic('light');
    setEditMode((on) => {
      // Leaving selection mode always clears the selection, so re-entering
      // never resurrects a stale set.
      if (on) setSelectedIds(EMPTY_SELECTION);
      return !on;
    });
  }, []);

  const toggleSelected = useCallback((id: string) => {
    triggerHaptic('selection');
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Bulk actions ──────────────────────────────────────────────────────────
  //
  // All three delegate to the SAME `chatSettingsStore` actions the per-row
  // context menu already uses, so selection mode can never drift out of sync
  // with single-row behaviour, and nothing new needs server support.
  //
  // Destructive bulk actions are confirmed first: mis-tapping "Delete" with 20
  // chats ticked is exactly the kind of thing a confirmation exists for.
  const handleBulkDelete = useCallback(() => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    // The Apps tab deletes MINI-APPS, not chats — a different store and a
    // genuinely irreversible server-side delete, so it gets its own copy and
    // its own warning rather than reusing the "moves to Deleted" wording.
    const isApps = activeTab === 'apps';

    Alert.alert(
      isApps
        ? t('messages.bulk.delete_apps_title', 'Удалить мини-приложения?')
        : t('messages.bulk.delete_title', 'Удалить чаты?'),
      isApps
        ? t('messages.bulk.delete_apps_message', 'Это действие нельзя отменить.')
        : t('messages.bulk.delete_message', 'Выбранные чаты переедут в «Удалённые».'),
      [
        { text: t('common.cancel', 'Отмена'), style: 'cancel' },
        {
          text: t('messages.action.delete', 'Удалить'),
          style: 'destructive',
          onPress: () => {
            if (isApps) {
              const store = useMiniAppsStore.getState();
              // Fire-and-forget per id: the store removes each row optimistically,
              // and one failed request must not abort the rest.
              ids.forEach((id) => { void store.deleteApp(id).catch(() => {}); });
            } else {
              const s = useChatSettingsStore.getState();
              // Synthetic "blocked user without a chat" rows have no chat record
              // to delete — skip them instead of writing junk ids to the store.
              ids.filter((id) => !isSyntheticUserBlockId(id)).forEach((id) => s.deleteChat(id));
            }
            triggerHaptic('medium');
            exitEditMode();
          },
        },
      ],
    );
  }, [selectedIds, activeTab, t, exitEditMode]);

  const handleBulkArchive = useCallback(() => {
    const ids = [...selectedIds].filter((id) => !isSyntheticUserBlockId(id));
    if (ids.length === 0) return;
    const s = useChatSettingsStore.getState();
    // On the Archive tab the same button un-archives, so the control is always
    // the inverse of the bucket the user is looking at.
    const unarchiving = activeTab === 'archive';
    ids.forEach((id) => (unarchiving ? s.unarchiveChat(id) : s.archiveChat(id)));
    triggerHaptic('light');
    exitEditMode();
  }, [selectedIds, activeTab, exitEditMode]);

  // Select-all toggles: a second tap clears, which is what "select all" controls
  // do everywhere and saves the user twenty taps to undo a mis-tap.
  //
  // Reads whatever is actually on screen for the CURRENT tab — conversations, or
  // the viewer's own mini-apps on the Apps tab — so it can never select rows the
  // user cannot see (which bulk delete would then act on).
  const handleSelectAll = useCallback(() => {
    triggerHaptic('selection');
    const visibleIds =
      activeTabRef.current === 'apps'
        ? selectOwnMiniApps(
            useMiniAppsStore.getState().apps,
            useAuthStore.getState().user?.id,
          ).map((a) => a.id)
        : filteredRef.current.map((c) => c.id);
    setSelectedIds((prev) => {
      if (visibleIds.length === 0) return EMPTY_SELECTION;
      if (prev.size >= visibleIds.length) return EMPTY_SELECTION;
      return new Set(visibleIds);
    });
  }, []);

  // ── Collapse-on-scroll for the search field ───────────────────────────────
  //
  // 0 = fully open, 1 = fully collapsed. Flipped ONLY when the scroll offset
  // crosses `SEARCH_COLLAPSE_AT`, so a long flick starts at most one animation
  // per direction instead of doing work on every scroll event.
  //
  // The threshold has hysteresis (collapse at 56, re-open at 12) so a list
  // resting near the boundary cannot oscillate.
  const searchCollapse = useSharedValue(0);
  const searchCollapsedRef = useRef(false);
  const onListScroll = useCallback((e: any) => {
    const y = e?.nativeEvent?.contentOffset?.y ?? 0;
    const shouldCollapse = searchCollapsedRef.current ? y > 12 : y > 56;
    if (shouldCollapse === searchCollapsedRef.current) return;
    searchCollapsedRef.current = shouldCollapse;
    searchCollapse.value = withTiming(shouldCollapse ? 1 : 0, {
      duration: 200,
      easing: REasing.out(REasing.cubic),
    });
  }, [searchCollapse]);

  const searchCollapseStyle = useAnimatedStyle(() => ({
    height: interpolate(searchCollapse.value, [0, 1], [SEARCH_ROW_HEIGHT, 0]),
    opacity: interpolate(searchCollapse.value, [0, 1], [1, 0]),
    marginBottom: interpolate(searchCollapse.value, [0, 1], [8, 0]),
  }));

  // Typing in the field must not let a stray scroll collapse it out from under
  // the keyboard, and clearing the query should bring it back.
  useEffect(() => {
    if (!searchQuery) return;
    searchCollapsedRef.current = false;
    searchCollapse.value = withTiming(0, { duration: 160 });
  }, [searchQuery, searchCollapse]);

  // Compose menu (mini-apps / AI / music / chat settings). State lives here
  // because its trigger is now the header button while the menu itself renders
  // as an overlay sibling — the two can no longer share a component's local
  // state the way the old FAB did.
  const [composeOpen, setComposeOpen] = useState(false);
  const openCompose = useCallback(() => {
    triggerHaptic('light');
    setComposeOpen((v) => !v);
  }, []);
  const closeCompose = useCallback(() => setComposeOpen(false), []);
  const archived = useChatSettingsStore((s) => s.archived);
  const blocked = useChatSettingsStore((s) => s.blocked);
  const deleted = useChatSettingsStore((s) => s.deleted);
  // Per-chat "last opened" timestamps — folded into the recency sort so a chat
  // the user just opened floats to the top even with no new message.
  const openedAt = useChatSettingsStore((s) => s.openedAt);
  // `openedAt` feeds ONLY the float-to-top recency sort (the `filtered` memo
  // below), never the bucket filter. The chat screen defers its markChatOpened
  // write past its own open transition, so the openedAt bump lands ~one
  // transition later (the perf snapshot's "~877 ms after nav") WHILE this
  // messages tab is still mounted behind the chat. Applying it synchronously
  // re-ran the whole filter + sort + FlatList reconcile in a single task — the
  // 159 ms `LONG @ (tabs)/messages`. Mirror openedAt into a state value that
  // updates AFTER interactions so the (now sort-only) recompute lands once the
  // transition has settled instead of on its frame. The float-to-top ordering
  // is byte-identical — only the instant it recomputes moved off the hot frame,
  // exactly like the other InteractionManager-deferred work on this screen.
  const [openedAtForSort, setOpenedAtForSort] = useState(openedAt);
  useEffect(() => {
    if (openedAtForSort === openedAt) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      setOpenedAtForSort(openedAt);
    });
    return () => handle.cancel();
  }, [openedAt, openedAtForSort]);
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

  // ── Last-message preview, derived locally ─────────────────────────────────
  //
  // `syncConversations` does not carry `lastMessage` / `lastMessageAt` at all, so
  // the line under a contact's name was permanently blank on the cached path (the
  // one that wins whenever the entity store has rows — i.e. essentially always).
  // That is why the preview "never appears, or appears and then disappears".
  //
  // Rather than wait on a server field that isn't sent, derive it from the
  // transcripts we ALREADY hold: the newest message of each conversation in the
  // chat store. This is cache-first by construction —
  //   * sending updates it instantly, because `addMessage` appends here;
  //   * a realtime message updates it for the same reason;
  //   * it survives a cold start for every chat whose tail was re-seeded from
  //     MMKV, with no request of any kind.
  //
  // Keyed on the messages map, so it recomputes only when a transcript actually
  // changes — not on every render of this screen.
  const messagesByConv = useChatStore((s) => s.messages);
  const previewByConv = useMemo(() => {
    const out = new Map<string, { text: string; at: string }>();
    for (const convId in messagesByConv) {
      const list = messagesByConv[convId];
      if (!list || list.length === 0) continue;
      // Transcripts are stored oldest → newest, so the newest is the tail.
      const last = list[list.length - 1];
      if (!last?.createdAt) continue;
      out.set(convId, { text: last.text || '', at: last.createdAt });
    }
    return out;
  }, [messagesByConv]);

  // Use entityStore conversations as cache layer; fall back to chatStore if empty
  const conversations: Conversation[] = useMemo(() => {
    if (entityConversations.length > 0) {
      const profiles = useEntityStore.getState().profiles;
      // Map LocalConversation to Conversation type with defaults for missing fields
      return entityConversations.map((c) => {
        // Prefer the locally-derived preview: it is at least as fresh as anything
        // stored on the row, and unlike the row it is never blank for a chat we
        // have messages for. Falls back to the stored value so a conversation with
        // no cached transcript still shows whatever it had.
        const local = previewByConv.get(c.id);
        const storedAt = c.lastMessageAt || '';
        const useLocal = !!local && (!storedAt || local.at >= storedAt);
        return {
          id: c.id,
          participantId: c.participantId,
          participantName: c.participantName,
          participantUsername: c.participantUsername,
          participantEmoji: c.participantEmoji,
          participantVerified: (c as any).participantVerified ?? profiles[c.participantId]?.is_verified ?? false,
          participantBadge: (c as any).participantBadge ?? profiles[c.participantId]?.badge ?? null,
          lastMessage: useLocal ? local!.text : (c.lastMessage || ''),
          lastMessageAt: useLocal ? local!.at : storedAt,
          unreadCount: 0,
          isOnline: false,
        };
      });
    }
    return chatStoreConversations;
  }, [entityConversations, chatStoreConversations, previewByConv]);

  // ─── Bucket filter (openedAt-INDEPENDENT) ─────────────────────────────────
  // Each chat belongs to exactly one bucket. The "apps" tab shows no chats.
  // This memo does ONLY the bucketing — several `.includes()` scans over the
  // whole conversation list — and its result never depends on `openedAt`.
  // Lifting the recency sort out of it (into the `filtered` memo below) is the
  // crux of the chat-open fix: returning from a chat bumps `openedAt`, which
  // used to re-run these whole-list scans on the still-mounted tab; now they
  // only re-run when the actual data/bucket inputs change. The per-branch
  // filtering is byte-identical to the previous single memo — only `.sort(...)`
  // was removed from each branch.
  const filteredBase = useMemo(() => {
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
    return conversations.filter(c => !archived.includes(c.id) && !blocked.includes(c.id) && !deleted.includes(c.id) && !blockedUserIds.includes(c.participantId));
  }, [conversations, activeTab, searchQuery, archived, blocked, deleted, blockedUserIds, locale]);

  // ─── Recency sort (the ONLY openedAt-dependent step) ──────────────────────
  // Newest activity first. `lastMessageAt`/`openedAt` are ISO strings, so a
  // lexicographic compare is also chronological. Activity is the LATER of the
  // conversation's last message and the last time the user opened it, so
  // opening a chat floats it to the top "по активности" even when no new
  // message arrived. ONLY the buckets that sorted before — search results,
  // archive and chats — sort here; blocked/deleted keep their insertion order
  // exactly as before (they never called `.sort` in the original). The sort
  // reads `openedAtForSort` (the interaction-deferred mirror of `openedAt`), so
  // this recompute lands AFTER the chat-open transition rather than on its
  // frame. Per-row activity is precomputed once (O(n)) into a Map so the
  // comparator does plain string compares instead of two lookups + a max per
  // comparison.
  const filtered = useMemo(() => {
    const shouldSort =
      activeTab !== 'apps' &&
      (searchQuery !== '' || activeTab === 'archive' || activeTab === 'chats');
    if (!shouldSort) return filteredBase;
    const activity = new Map<string, string>();
    for (const c of filteredBase) {
      const opened = openedAtForSort[c.id] || '';
      const last = c.lastMessageAt || '';
      activity.set(c.id, opened > last ? opened : last);
    }
    return [...filteredBase].sort((a, b) =>
      (activity.get(b.id) || '').localeCompare(activity.get(a.id) || ''),
    );
  }, [filteredBase, activeTab, searchQuery, openedAtForSort]);

  // Keep the select-all mirror current. Assignment during render is safe here:
  // it's a plain ref write derived from props/state in the same pass, not a
  // subscription, so it can't tear.
  filteredRef.current = filtered;

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  // Swipe-to-switch between the category tabs. A horizontal pan on the content
  // area moves to the adjacent tab. The gesture is tuned to yield to vertical
  // list scrolling (failOffsetY) and only claim clearly-horizontal swipes
  // (activeOffsetX). `activeTabRef` is declared with the other stable-callback
  // mirrors near the top of the component.
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

  // ── "Active today" cluster next to the title ───────────────────────────────
  //
  // Derived from the SAME locally-cached conversations the list already renders
  // (see `selectActiveToday` for why this needs no server and collects nothing
  // new). Excludes buckets the user has hidden — someone you archived, blocked
  // or deleted should not reappear as a face in the header.
  //
  // Recomputed only when the conversation list or those buckets change. It is
  // deliberately NOT time-ticking: re-running this on a timer would re-render
  // the header every minute for a cosmetic detail. It refreshes whenever a
  // message arrives or the screen remounts, which is exactly when it can
  // meaningfully change.
  const activeToday = useMemo(
    () =>
      selectActiveToday(
        conversations.filter(
          (c) =>
            !archived.includes(c.id) &&
            !blocked.includes(c.id) &&
            !deleted.includes(c.id) &&
            !blockedUserIds.includes(c.participantId),
        ),
      ),
    [conversations, archived, blocked, deleted, blockedUserIds],
  );

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
      <ConversationItem
        item={item}
        index={index}
        tab={activeTab}
        editMode={editMode}
        selected={selectedIds.has(item.id)}
        editProgress={editProgress}
        onToggleSelect={toggleSelected}
      />
    ),
    [activeTab, editMode, selectedIds, editProgress, toggleSelected],
  );
  // The separator is inset to line up with the start of the row's TEXT column
  // (past the avatar). In selection mode the rows shift right by the checkbox
  // column, so the inset has to travel with them or the hairlines visibly fail
  // to line up with the content above them.
  const renderSeparator = useCallback(
    () => <RowSeparator color={separatorColor} editProgress={editProgress} />,
    [separatorColor, editProgress],
  );

  // ─── Category-tab chips — memoized data + renderItem ──────────────────────
  // The horizontal category FlatList previously took an INLINE `data` literal
  // (5 fresh objects every render) and an INLINE `renderItem` arrow (fresh
  // identity every render), so it reconciled all five chip subtrees on EVERY
  // MessagesScreen re-render — including one per keystroke while searching and
  // every store push / openedAt bump. Memoizing both confines that work to
  // when the inputs actually change: `locale` for the labels (depending on the
  // unstable `t` hook would defeat the memo — same reasoning as the `filtered`
  // memo above), and active tab / glass mode / theme for the chip styling.
  const categoryTabsData = useMemo(
    () => [
      { key: 'chats' as ChatTab, label: tStatic('messages.tab.chats') },
      { key: 'apps' as ChatTab, label: tStatic('messages.tab.apps') },
      { key: 'archive' as ChatTab, label: tStatic('messages.tab.archive') },
      { key: 'blocked' as ChatTab, label: tStatic('messages.tab.blocked') },
      { key: 'deleted' as ChatTab, label: tStatic('messages.tab.deleted') },
    ],
    // `locale` (stable) drives label re-translation; tStatic reads the same
    // active locale the `t` hook would. eslint-disable to keep `locale` as the
    // intentional trigger without listing the module-level `tStatic`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );
  const categoryTabKeyExtractor = useCallback((tab: { key: ChatTab }) => tab.key, []);
  const renderCategoryTab = useCallback(
    ({ item: tab }: { item: { key: ChatTab; label: string } }) => {
      const isActive = activeTab === tab.key;
      const label = (
        <Text variant="caption" weight={isActive ? 'bold' : 'regular'} color={isActive ? theme.colors.accent.primary : theme.colors.text.tertiary} style={{ fontSize: 12 }}>{tab.label}</Text>
      );
      // Interactive liquid glass capsule holding the label as a CHILD so it
      // morphs outward on touch (gold-standard pattern). The ACTIVE chip gets a
      // subtle accent tint so selection still reads clearly over the glass;
      // inactive chips are clear glass. NO overflow clip, own borderRadius.
      // Falls back to the flat accent fill when off.
      if (glassActive) {
        return (
          <Pressable onPress={() => setActiveTab(tab.key)} style={{ borderRadius: 16 }}>
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
        <Pressable onPress={() => setActiveTab(tab.key)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: isActive ? theme.colors.accent.primary + '20' : 'transparent' }}>
          {label}
        </Pressable>
      );
    },
    [activeTab, glassActive, theme],
  );

  return (
    <View style={containerStyle}>
      {/* Gradient fade header */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, height: headerGradientHeight }} pointerEvents="box-none">
        {/* `pointerEvents="none"` is REQUIRED, not decorative.
            This header is absolutely positioned and 28 pt TALLER than its own
            content, so its bottom edge overhangs the search field below. The
            wrapper is `box-none` (it passes touches through itself) but that does
            NOT apply to children — so this gradient was swallowing every tap that
            landed in that 28 pt band, i.e. the top of the search field. That is
            why the chat search "didn't press". */}
        <LinearGradient
          colors={[bgColor, bgColor, bgTransparent]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {/* ── Top bar ────────────────────────────────────────────────────────
            Three slots: [Изм.] · [active-today avatars + title] · [actions].
            The two side slots share a `minWidth`, which is what keeps the
            centre cluster optically centred regardless of how long the
            localized "Изм." label is — a plain space-between would drift the
            title as soon as the label width changed. */}
        <View
          style={[
            styles.headerRow,
            { paddingHorizontal: theme.spacing.base, paddingTop: insets.top + 8, paddingBottom: 8 },
          ]}
          pointerEvents="auto"
        >
          <View style={styles.headerSide}>
            <HeaderPillButton
              onPress={editMode ? exitEditMode : toggleEditMode}
              glassActive={glassActive}
              theme={theme}
              accessibilityLabel={editMode ? t('common.done', 'Готово') : t('messages.edit', 'Изм.')}
            >
              <Text variant="caption" weight="semibold" style={{ fontSize: 15 }}>
                {editMode ? t('common.done', 'Готово') : t('messages.edit', 'Изм.')}
              </Text>
            </HeaderPillButton>
          </View>

          <View style={styles.headerCenter}>
            <ActiveTodayAvatars entries={activeToday} ringColor={bgColor} />
            <Text variant="subheading" weight="bold" numberOfLines={1}>
              {t('messages.title')}
            </Text>
          </View>

          <View style={[styles.headerSide, styles.headerSideRight]}>
            {/* Compose lives HERE now, not in a bottom FAB: the bottom edge is
                claimed by the tab bar (and, in selection mode, by the action
                bar), and a top-right compose button is where iOS users reach
                for it. Hidden during selection mode — "new chat" is meaningless
                while picking existing ones, and the slot is needed for Done. */}
            {!editMode && (
              <HeaderIconButton
                onPress={openCompose}
                glassActive={glassActive}
                theme={theme}
                icon="edit"
                accessibilityLabel={t('messages.new_chat', 'Новый чат')}
              />
            )}
          </View>
        </View>
      </View>

      {/* ── Search field, collapses on scroll ────────────────────────────────
          Telegram behaviour: scrolling down shrinks the field away and the
          category chips take its place; returning to the top brings it back.

          Driven by a THRESHOLD, not per frame. `searchCollapse` is a single
          shared value flipped by `withTiming` only when the scroll crosses the
          threshold, so a whole flick costs at most one animation start per
          direction — never a relayout per scroll event. Height is animated (this
          genuinely has to reflow, so the chips really do move up), but only for
          the ~200 ms of the transition.

          `overflow: 'hidden'` clips the field as the container closes instead of
          letting it spill over the chips. */}
      <Reanimated.View
        style={[
          { paddingHorizontal: theme.spacing.base, marginTop: headerContentHeight, overflow: 'hidden' },
          searchCollapseStyle,
        ]}
      >
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
      </Reanimated.View>

      {/* Category tabs */}
      <View style={{ marginBottom: 8 }}>
        <FlatList
          horizontal
          data={categoryTabsData}
          keyExtractor={categoryTabKeyExtractor}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.base, gap: 8 }}
          renderItem={renderCategoryTab}
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
            <MiniAppsRow
              editMode={editMode}
              selectedIds={selectedIds}
              editProgress={editProgress}
              onToggleSelect={toggleSelected}
            />
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
            <FlatList
              data={filtered}
              keyExtractor={MESSAGES_KEY_EXTRACTOR}
              renderItem={renderConversationItem}
              ItemSeparatorComponent={renderSeparator}
              contentContainerStyle={MESSAGES_LIST_CONTENT_STYLE}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={true}
              initialNumToRender={8}
              maxToRenderPerBatch={6}
              windowSize={9}
              updateCellsBatchingPeriod={60}
              getItemLayout={MESSAGES_ITEM_LAYOUT}
              // Drives the search-field collapse. `onListScroll` returns early
              // unless the threshold is actually crossed, so this costs a couple
              // of property reads per event and never a state update.
              onScroll={onListScroll}
              scrollEventThrottle={32}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      </GestureDetector>

      {/* Compose menu overlay. Trigger is the header's compose button. */}
      <ComposeMenu open={composeOpen} onClose={closeCompose} topOffset={headerContentHeight} />

      {/* Contextual action bar — replaces the tab bar while selecting. */}
      <SelectionActionBar
        visible={editMode}
        count={selectedIds.size}
        tab={activeTab}
        bottomInset={insets.bottom}
        glassActive={glassActive}
        theme={theme}
        t={t}
        onDelete={handleBulkDelete}
        onArchive={handleBulkArchive}
        onSelectAll={handleSelectAll}
      />
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
function ComposeMenu({
  open,
  onClose,
  topOffset,
}: {
  open: boolean;
  onClose: () => void;
  /** Y of the menu's top edge — just under the header's compose button. */
  topOffset: number;
}) {
  const theme = useTheme();
  const t = useT();
  // Native iOS-26 liquid glass for the menu. iOS-only + opt-in.
  const glassActive = useLiquidGlassActive();
  const setOpen = useCallback((next: boolean) => { if (!next) onClose(); }, [onClose]);
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
          // Anchored under the header's compose button (top-right) now that the
          // trigger moved up there. `topOffset` is computed from the real safe
          // area + header height by the screen, so it lands correctly on a
          // notched iPhone, a Dynamic Island one, and a flat-top Android alike.
          top: topOffset,
          right: theme.spacing.base,
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

      {/* NOTE: the floating action button that used to live at bottom-right and
          own this menu is gone — its trigger is now the compose button in the
          header (see `HeaderIconButton` on the screen). Reasons it moved:
            - the bottom-right corner is where the tab bar's detached profile
              capsule floats, so the FAB sat on top of it on shorter devices;
            - selection mode needs the whole bottom edge for its action bar;
            - a top-right compose button matches where iOS puts it in Messages.
          The menu itself (mini-apps / AI / music / chat settings) is unchanged —
          only its anchor and trigger moved. */}
    </>
  );
}

/**
 * Contextual bottom bar shown while selecting conversations. It occupies the
 * space the tab bar vacates (see `tabBarStore`), so the two are never on screen
 * together.
 *
 * ANIMATION: slides up on `translateY` and is NOT faded with `opacity`. When
 * liquid glass is on, this bar's background is a `GlassBg` — and
 * `expo-glass-effect` documents that opacity 0 on a GlassView or any parent
 * stops the glass rendering entirely (expo/expo#41024). Fading it would make the
 * bar return as a flat rectangle. Same reason the tab bar hides by translating.
 *
 * LAYOUT: bottom offset is built from the real `bottomInset`, so on a device with
 * a home indicator the bar clears it, and on a flat-bottomed Android it doesn't
 * float with a pointless gap. Buttons are `flex: 1` in a row, so three or four
 * of them share the width evenly at any text size and can't overlap.
 */
/**
 * One control in the selection action bar. Icon and label always share a single
 * `color`, so an "active" action lights up as a whole rather than having a blue
 * icon over a grey caption.
 *
 * `disabled` is passed to `Pressable` (not just used to drop `onPress`) so the
 * platform also excludes it from the accessibility focus order and announces it
 * as unavailable.
 */
const ActionBarButton = React.memo(function ActionBarButton({
  icon,
  label,
  color,
  disabled,
  onPress,
}: {
  icon: string;
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={styles.actionBtn}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Feather name={icon as any} size={18} color={color} />
      <Text variant="caption" style={{ fontSize: 10.5 }} color={color} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
});

const SelectionActionBar = React.memo(function SelectionActionBar({
  visible,
  count,
  tab,
  bottomInset,
  glassActive,
  theme,
  t,
  onDelete,
  onArchive,
  onSelectAll,
}: {
  visible: boolean;
  count: number;
  tab: ChatTab;
  bottomInset: number;
  glassActive: boolean;
  theme: any;
  t: (k: string, d?: string) => string;
  onDelete: () => void;
  onArchive: () => void;
  onSelectAll: () => void;
}) {
  const progress = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, {
      duration: 220,
      easing: REasing.out(REasing.cubic),
    });
  }, [visible, progress]);

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(progress.value, [0, 1], [140, 0]) }],
  }));

  // ── Active state = accent ────────────────────────────────────────────────
  //
  // At rest the controls are neutral (plain foreground). As soon as at least one
  // chat is ticked they light up in the accent colour, so "this action will now
  // do something" is readable at a glance instead of having to notice a dimmed
  // label. Nothing ticked → tertiary, which reads as unavailable.
  //
  // Delete keeps the system destructive red rather than the accent: colour is the
  // only warning a bulk delete gets before the confirmation dialog, and turning
  // it the same blue as Archive would remove that distinction.
  const enabled = count > 0;
  const actionColor = enabled ? theme.colors.accent.primary : theme.colors.text.tertiary;
  const destructiveColor = enabled ? '#FF453A' : theme.colors.text.tertiary;
  // Select-all is always available (there is always something to select), so it
  // is accent whenever the list is non-empty.
  const selectAllColor = theme.colors.accent.primary;

  return (
    <Reanimated.View
      style={[
        styles.actionBar,
        { bottom: 14 + bottomInset },
        glassActive
          ? null
          : {
              backgroundColor: theme.colors.background.elevated,
              borderWidth: 1,
              borderColor: theme.colors.border.light,
            },
        barStyle,
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      {glassActive ? (
        <GlassBg borderRadius={26} glassStyle="regular" interactive={false} colorScheme={theme.isDark ? 'dark' : 'light'} />
      ) : null}

      <ActionBarButton
        icon="check-square"
        label={t('messages.bulk.select_all', 'Все')}
        color={selectAllColor}
        onPress={onSelectAll}
      />
      {/* Archive is meaningless for mini-apps — the Apps tab gets Select-all +
          Delete only, and the bar shrink-wraps to two controls. */}
      {tab === 'apps' ? null : (
        <ActionBarButton
          icon={tab === 'archive' ? 'corner-up-left' : 'archive'}
          label={
            tab === 'archive'
              ? t('messages.action.unarchive', 'Из архива')
              : t('messages.action.archive', 'В архив')
          }
          color={actionColor}
          disabled={!enabled}
          onPress={onArchive}
        />
      )}
      <ActionBarButton
        icon="trash-2"
        label={
          count > 0
            ? `${t('messages.action.delete', 'Удалить')} (${count})`
            : t('messages.action.delete', 'Удалить')
        }
        color={destructiveColor}
        disabled={!enabled}
        onPress={onDelete}
      />
    </Reanimated.View>
  );
});

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
