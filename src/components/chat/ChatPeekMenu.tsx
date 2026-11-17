/**
 * Telegram-style long-press menu for a chat-list row: the chat itself as a scrollable preview card,
 * a compact action list under it, and the list behind blurred.
 *
 * ── WHY NOT THE NATIVE CONTEXT MENU ─────────────────────────────────────────
 *
 * The rows used `react-native-context-menu-view`, whose `preview` prop is exactly this card. It cannot
 * work under the New Architecture: the library recognises its preview child by `UIView.nativeID`
 * (ios/ContextMenuView.m, `insertReactSubview`), and Fabric only sets `RCTViewComponentView.nativeId`.
 * The preview would be mounted INTO the row instead of into the menu. Fixing that is a native change,
 * so it could not ship over the air; this overlay can, and it looks the same on iOS and Android.
 *
 * ── WHY NOT A `Modal` EITHER ─────────────────────────────────────────────────
 *
 * The first version was a `Modal` inside the held row, and on some chats the long-press then did
 * nothing. See `chatPeekStore` for the mechanism. It is now a plain full-screen overlay drawn by
 * `ChatPeekHost`, which is mounted once at the app root above the navigator.
 *
 * ── COST ────────────────────────────────────────────────────────────────────
 *
 * Mounted only while open. The transcript comes from the store or the `chat_tail:<id>` cache the chat
 * screen keeps for its own first paint; a chat this device has never opened has neither, so it is
 * fetched once (one page) from the server. Every animation runs on the UI thread.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  type GestureResponderEvent,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type ListRenderItem,
} from 'react-native';
import { BlurView as ExpoBlurView } from 'expo-blur';
import Reanimated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { CachedImage } from '../ui/CachedImage';
import { useAuthStore, useChatStore } from '../../store';
import { useSettingsStore } from '../../store/settingsStore';
import { useChatSettingsStore } from '../../store/chatSettingsStore';
import { useChatPeekStore } from '../../store/chatPeekStore';
import { kvGetJSONSync } from '../../services/kvStore';
import { readableTextOn, withOpacity } from '../../constants/bubbleColors';
import { stripMarkers } from '../../utils/previewText';
import { firstImageUrlFromStoredText } from '../../utils/chatImageMarker';
import { triggerHaptic } from '../../utils/haptics';
import { useT } from '../../i18n/store';
import type { ChatMessage } from '../../types';

export type ChatPeekIcon =
  | { set: 'feather'; name: React.ComponentProps<typeof Feather>['name'] }
  | { set: 'mci'; name: React.ComponentProps<typeof MaterialCommunityIcons>['name'] };

export interface ChatPeekAction<Id extends string = string> {
  id: Id;
  title: string;
  icon: ChatPeekIcon;
  destructive?: boolean;
}

/** The held row, in window coordinates (`measureInWindow`). */
export interface ChatPeekAnchor {
  y: number;
  height: number;
}

export interface ChatPeekConversation {
  id: string;
  name: string;
  emoji?: string;
  verified?: boolean;
}

interface ChatPeekMenuProps<Id extends string> {
  anchor: ChatPeekAnchor;
  /** `null` shows the menu alone (rows that are not a real chat, e.g. a blocked user). */
  conversation: ChatPeekConversation | null;
  actions: ChatPeekAction<Id>[];
  onSelect: (id: Id) => void;
  /** Tap on the preview card. */
  onOpen?: () => void;
  /** Called once the menu is gone; the owner unmounts it here. */
  onClosed: () => void;
}

const AnimatedBlur = Reanimated.createAnimatedComponent(ExpoBlurView);

const ITEM_H = 44;
const GAP = 10;
const SIDE = 12;
const CARD_RADIUS = 16;
const MENU_RADIUS = 14;
/** The chat keeps a 60-message tail for its own first paint; the preview can scroll all of it. */
const MAX_PREVIEW_MESSAGES = 60;
/** One page from the server for a chat with no local copy. */
const REMOTE_PAGE = 40;
const OPEN_SPRING = { damping: 22, stiffness: 260, mass: 0.9 };
const IOS_RED = '#FF3B30';

// A worklet: the animated styles below call it on the UI thread, and so does the JS layout code.
function clamp(v: number, lo: number, hi: number): number {
  'worklet';
  return Math.max(lo, Math.min(hi, v));
}

/** Mounted once at the app root. Draws the open peek menu, if any. */
export function ChatPeekHost() {
  const request = useChatPeekStore((s) => s.request);
  const clear = useChatPeekStore((s) => s.clear);
  if (!request) return null;
  const key = request.key;
  return (
    <ChatPeekMenu
      key={key}
      anchor={request.anchor}
      conversation={request.conversation}
      actions={request.actions}
      onSelect={request.onSelect}
      onOpen={request.onOpen}
      onClosed={() => clear(key)}
    />
  );
}

export function ChatPeekMenu<Id extends string>({
  anchor,
  conversation,
  actions,
  onSelect,
  onOpen,
  onClosed,
}: ChatPeekMenuProps<Id>) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const p = useSharedValue(0);
  const closing = useRef(false);
  const after = useRef<(() => void) | null>(null);

  useEffect(() => {
    triggerHaptic('medium');
    p.value = withSpring(1, OPEN_SPRING);
  }, [p]);

  const finish = useCallback(() => {
    const fn = after.current;
    after.current = null;
    onClosed();
    fn?.();
  }, [onClosed]);

  const close = useCallback(
    (fn?: () => void) => {
      if (closing.current) return;
      closing.current = true;
      after.current = fn ?? null;
      // `finish` runs whether or not the timing completed: nothing else drives `p` once closing
      // has started, and a menu that never reports closed would leave an invisible layer on top.
      p.value = withTiming(0, { duration: 190, easing: Easing.out(Easing.cubic) }, () => {
        runOnJS(finish)();
      });
    },
    [p, finish],
  );

  // Android back closes the menu instead of leaving the screen underneath.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  // ── Geometry ──────────────────────────────────────────────────────────────
  // Preview card on top, menu under it, the pair centred in the safe area. Without a preview the
  // menu sits under the held row (or above it when there is no room below).
  const hasPreview = !!conversation;
  // Wide enough for the longest label («Выключить уведомления») on a 360 pt screen.
  const menuW = Math.min(280, W - SIDE * 2);
  const menuH = actions.length * ITEM_H;
  const top = insets.top + 8;
  const bottom = H - Math.max(insets.bottom, 10) - 8;
  const avail = bottom - top;
  const cardW = Math.min(W - SIDE * 2, 520);
  const cardH = hasPreview ? Math.max(160, Math.min(avail - menuH - GAP, Math.round(H * 0.6))) : 0;
  const cardLeft = (W - cardW) / 2;
  let cardTop = 0;
  let menuTop: number;
  if (hasPreview) {
    cardTop = top + Math.max(0, (avail - (cardH + GAP + menuH)) / 2);
    menuTop = cardTop + cardH + GAP;
  } else {
    const below = anchor.y + anchor.height + 6;
    menuTop = below + menuH <= bottom ? below : Math.max(top, anchor.y - 6 - menuH);
  }
  const menuLeft = hasPreview ? cardLeft : SIDE;
  // The card grows out of the held row: it starts over the row and travels to its place.
  const fromDY = hasPreview ? clamp(anchor.y + anchor.height / 2 - (cardTop + cardH / 2), -280, 280) : 0;

  const cardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.35], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(p.value, [0, 1], [fromDY, 0]) },
      { scale: interpolate(p.value, [0, 1], [0.84, 1]) },
    ],
  }));
  const menuStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.1, 0.55], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(p.value, [0, 1], [0.55, 1]) }],
  }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: clamp(p.value, 0, 1) }));
  // The blur's INTENSITY is animated, not its opacity: a UIVisualEffectView with alpha below 1
  // renders broken until the alpha returns to 1.
  const blurProps = useAnimatedProps(() => ({ intensity: clamp(p.value, 0, 1) * 40 }));

  const isIOS = Platform.OS === 'ios';
  const dimColor = isIOS ? (theme.isDark ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.12)') : 'rgba(0,0,0,0.55)';
  const menuBg = theme.isDark ? '#2B2B2F' : '#FFFFFF';
  const separator = theme.isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';

  // Only a TAP opens the chat. A drag that the transcript cannot turn into a scroll (a short chat
  // has nothing to scroll) still ends inside the card, and Pressable would call that a press.
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const onCardPressIn = (e: GestureResponderEvent) => {
    pressStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
  };
  const openFromPreview = (e: GestureResponderEvent) => {
    const s = pressStart.current;
    if (s && Math.hypot(e.nativeEvent.pageX - s.x, e.nativeEvent.pageY - s.y) > 12) return;
    if (closing.current) return;
    closing.current = true;
    // Unmount first, then navigate: the chat slides in with nothing over it.
    onClosed();
    onOpen?.();
  };

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      {isIOS ? (
        <AnimatedBlur
          animatedProps={blurProps}
          intensity={0}
          tint={theme.isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: dimColor }, dimStyle]} />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => close()}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      />

      {conversation ? (
        <Reanimated.View
          // Opaque fill on the shadow view lets iOS build the shadow from the rounded rect instead of
          // rendering the card offscreen to find its outline.
          style={[
            styles.cardShadow,
            { top: cardTop, left: cardLeft, width: cardW, height: cardH, backgroundColor: theme.colors.background.primary },
            cardStyle,
          ]}
        >
          {/* A tap anywhere on the card opens the chat; a drag scrolls the transcript, because the
              list takes the touch over as soon as it moves. */}
          <Pressable
            onPressIn={onCardPressIn}
            onPress={openFromPreview}
            style={[styles.card, { backgroundColor: theme.colors.background.primary }]}
            accessibilityRole="button"
            accessibilityLabel={conversation.name}
          >
            <PeekHeader conversation={conversation} />
            <PeekTranscript conversationId={conversation.id} />
          </Pressable>
        </Reanimated.View>
      ) : null}

      <Reanimated.View
        style={[styles.menuShadow, { top: menuTop, left: menuLeft, width: menuW, backgroundColor: menuBg }, menuStyle]}
      >
        <View style={[styles.menu, { backgroundColor: menuBg }]}>
          {actions.map((a, i) => (
            <PeekMenuRow
              key={a.id}
              action={a}
              separator={i > 0 ? separator : null}
              onPress={() => close(() => onSelect(a.id))}
            />
          ))}
        </View>
      </Reanimated.View>
    </View>
  );
}

function PeekMenuRow<Id extends string>({
  action,
  separator,
  onPress,
}: {
  action: ChatPeekAction<Id>;
  separator: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = action.destructive ? IOS_RED : theme.colors.text.primary;
  const pressed = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={action.title}
      style={({ pressed: isPressed }) => [
        styles.row,
        separator ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: separator } : null,
        isPressed ? { backgroundColor: pressed } : null,
      ]}
    >
      <Text variant="body" color={color} numberOfLines={1} style={styles.rowTitle}>
        {action.title}
      </Text>
      {action.icon.set === 'feather' ? (
        <Feather name={action.icon.name} size={20} color={color} />
      ) : (
        <MaterialCommunityIcons name={action.icon.name} size={21} color={color} />
      )}
    </Pressable>
  );
}

function PeekHeader({ conversation }: { conversation: ChatPeekConversation }) {
  const theme = useTheme();
  const t = useT();
  const hairline = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  return (
    <View style={[styles.header, { borderBottomColor: hairline, backgroundColor: theme.colors.background.secondary }]}>
      <View style={styles.headerSide} />
      <View style={styles.headerTitle}>
        <View style={styles.headerNameRow}>
          <Text variant="body" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {conversation.name}
          </Text>
          {conversation.verified ? <VerifiedBadge size={13} /> : null}
        </View>
        <Text variant="caption" color={theme.colors.text.secondary} numberOfLines={1} style={{ fontSize: 12 }}>
          {t('block.section.last_seen')}
        </Text>
      </View>
      <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>
        <Avatar emoji={conversation.emoji} name={conversation.name} size="sm" tint />
      </View>
    </View>
  );
}

/** Oldest → newest, as the store and the tail cache keep them. Empty when this device has neither. */
function readLocal(conversationId: string): ChatMessage[] {
  try {
    const mem = useChatStore.getState().messages[conversationId];
    const src = mem && mem.length > 0 ? mem : kvGetJSONSync<ChatMessage[]>(`chat_tail:${conversationId}`, []) || [];
    return Array.isArray(src) ? src.filter(Boolean).slice(-MAX_PREVIEW_MESSAGES) : [];
  } catch {
    return [];
  }
}

/** Same row → message mapping as the chat screen's history fetch. */
function fromServerRow(row: any, conversationId: string): ChatMessage | null {
  if (!row || String(row.id ?? '').length === 0) return null;
  return {
    id: String(row.id),
    conversationId,
    senderId: String(row.sender_id ?? ''),
    text: typeof row.text === 'string' ? row.text : '',
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    isRead: true,
    serverId: String(row.id),
  };
}

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function looksAnimated(u: string): boolean {
  const s = u.toLowerCase();
  return s.includes('.gif') || s.includes('giphy.com') || s.includes('tenor.com');
}

function PeekTranscript({ conversationId }: { conversationId: string }) {
  const theme = useTheme();
  const t = useT();
  const myId = useAuthStore((s) => s.user?.id);
  const chatBubble = useSettingsStore((s) => s.chatBubble);
  const local = useMemo(() => readLocal(conversationId), [conversationId]);
  // `null` = not fetched (yet). Only fetched when there is nothing local to show.
  const [remote, setRemote] = useState<ChatMessage[] | null>(null);
  const needsFetch = local.length === 0;

  useEffect(() => {
    if (!needsFetch) return;
    let alive = true;
    (async () => {
      try {
        const { getMessages } = await import('../../lib/supabase');
        const { messages } = await getMessages(conversationId, { limit: REMOTE_PAGE });
        if (!alive) return;
        const rows = (Array.isArray(messages) ? messages : [])
          .map((r) => fromServerRow(r, conversationId))
          .filter((m): m is ChatMessage => m !== null);
        setRemote(rows);
      } catch {
        if (alive) setRemote([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [conversationId, needsFetch]);

  const messages = needsFetch ? remote ?? [] : local;
  // Newest first: the list is inverted, so it opens at the latest message and scrolls up into history.
  const data = useMemo(() => messages.slice().reverse(), [messages]);

  const radius = useMemo(
    () => clamp(useChatSettingsStore.getState().getSettings(conversationId).bubbleRadius || 18, 8, 24),
    [conversationId],
  );
  const ownColors = chatBubble && chatBubble.colors.length > 0 ? chatBubble.colors : [theme.colors.accent.primary];
  const ownBg = withOpacity(ownColors[0], chatBubble?.opacity ?? 1);
  const ownText = chatBubble && chatBubble.colors.length > 0 ? readableTextOn(chatBubble.colors) : '#FFFFFF';
  const peerBg = theme.colors.background.elevated;
  const peerText = theme.colors.text.primary;
  const photoLabel = t('chat.photo');

  const renderItem = useCallback<ListRenderItem<ChatMessage>>(
    ({ item }) => {
      const own = !!myId && item.senderId === myId;
      return (
        <PeekBubble
          message={item}
          own={own}
          bg={own ? ownBg : peerBg}
          fg={own ? ownText : peerText}
          radius={radius}
          photoLabel={photoLabel}
        />
      );
    },
    [myId, ownBg, ownText, peerBg, peerText, radius, photoLabel],
  );

  if (needsFetch && remote === null) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={theme.colors.text.tertiary} />
      </View>
    );
  }
  if (data.length === 0) {
    return (
      <View style={styles.empty}>
        <Text variant="caption" color={theme.colors.text.tertiary}>
          {t('messages.peek.empty')}
        </Text>
      </View>
    );
  }
  return (
    <FlatList
      data={data}
      inverted
      keyExtractor={keyOf}
      renderItem={renderItem}
      style={styles.transcript}
      contentContainerStyle={styles.transcriptContent}
      ItemSeparatorComponent={BubbleGap}
      showsVerticalScrollIndicator={false}
      initialNumToRender={14}
      maxToRenderPerBatch={10}
      windowSize={7}
      nestedScrollEnabled
    />
  );
}

function keyOf(m: ChatMessage): string {
  return m.id;
}

function BubbleGap() {
  return <View style={{ height: 4 }} />;
}

const PeekBubble = memo(function PeekBubble({
  message,
  own,
  bg,
  fg,
  radius,
  photoLabel,
}: {
  message: ChatMessage;
  own: boolean;
  bg: string;
  fg: string;
  radius: number;
  photoLabel: string;
}) {
  const raw = message.text || '';
  const body = stripMarkers(raw);
  const img =
    (Array.isArray(message.imageUrls) ? message.imageUrls.find((u) => typeof u === 'string' && !!u) : undefined) ||
    firstImageUrlFromStoredText(raw) ||
    undefined;
  const isGif = raw.startsWith('::gif::') || (!!img && looksAnimated(img));
  const time = formatTime(message.createdAt);
  return (
    <View style={[styles.bubble, { alignSelf: own ? 'flex-end' : 'flex-start', backgroundColor: bg, borderRadius: radius }]}>
      {img && !isGif ? (
        <CachedImage uri={img} style={[styles.photo, { borderRadius: Math.max(6, radius - 6) }]} resizeMode="cover" />
      ) : null}
      {body ? (
        <Text variant="body" color={fg} numberOfLines={8} style={styles.bubbleText}>
          {body}
        </Text>
      ) : !img || isGif ? (
        <Text variant="body" color={fg} style={styles.bubbleText}>
          {isGif ? 'GIF' : photoLabel}
        </Text>
      ) : null}
      {time ? (
        <Text variant="caption" color={fg} style={styles.time}>
          {time}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  // Above the navigator and the mini bars (zIndex 200-900 at the root), below the toast.
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 1000 },
  cardShadow: {
    position: 'absolute',
    borderRadius: CARD_RADIUS,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 14,
  },
  card: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  header: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { width: 44 },
  headerTitle: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  transcript: { flex: 1 },
  // Inverted list: the visual bottom is the content's start.
  transcriptContent: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 10 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 11,
    paddingTop: 6,
    paddingBottom: 5,
  },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  photo: { width: 150, height: 150, marginTop: 2, marginBottom: 4 },
  time: { fontSize: 10.5, opacity: 0.6, alignSelf: 'flex-end', marginTop: 1 },
  // Shadow on the outer view, clipping on the inner one: iOS drops a layer's shadow when the same
  // layer clips its bounds.
  menuShadow: {
    position: 'absolute',
    borderRadius: MENU_RADIUS,
    // Scales out of its top-left corner, i.e. out of the card above it.
    transformOrigin: 'top left',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 12,
  },
  menu: {
    borderRadius: MENU_RADIUS,
    overflow: 'hidden',
  },
  row: {
    height: ITEM_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  rowTitle: { flex: 1, fontSize: 16, marginRight: 12 },
});
