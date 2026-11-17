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
import { GlassBg, useLiquidGlassActive } from '../ui/LiquidGlass';
import { useAuthStore, useChatStore } from '../../store';
import { useSettingsStore } from '../../store/settingsStore';
import { useChatSettingsStore } from '../../store/chatSettingsStore';
import { useChatPeekStore } from '../../store/chatPeekStore';
import { kvGetJSONSync } from '../../services/kvStore';
import { readableTextOn, withOpacity } from '../../constants/bubbleColors';
import { stripMarkers } from '../../utils/previewText';
import { messageImageUrls } from '../../utils/chatImageMarker';
import { LinkPreview } from '../ui/LinkPreview';
import { extractFirstUrl } from '../../services/linkPreview';
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
  // Close progress, separate from `p`: closing fades everything out in place instead of running the
  // open in reverse. The reverse shrank the menu into its corner and slid the card back down to the
  // row, which read as the action list "flying into the avatar", with glass artifacts on the way.
  const c = useSharedValue(0);
  const [fading, setFading] = useState(false);
  const closing = useRef(false);
  const after = useRef<(() => void) | null>(null);

  // The haptic fires in `openChatPeek`, at the long-press itself, not here after the first render.
  useEffect(() => {
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
      // The glass menu swaps to the flat surface for the fade: an alpha on a glass view switches its
      // glass off anyway, so the swap is what keeps the fade clean instead of a flicker.
      setFading(true);
      // `finish` runs whether or not the timing completed: nothing else drives `c` once closing
      // has started, and a menu that never reports closed would leave an invisible layer on top.
      c.value = withTiming(1, { duration: 170, easing: Easing.out(Easing.quad) }, () => {
        runOnJS(finish)();
      });
    },
    [c, finish],
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
    opacity: interpolate(p.value, [0, 0.35], [0, 1], Extrapolation.CLAMP) * (1 - c.value),
    transform: [
      { translateY: interpolate(p.value, [0, 1], [fromDY, 0]) },
      { scale: interpolate(p.value, [0, 1], [0.84, 1]) * (1 - 0.04 * c.value) },
    ],
  }));
  // While OPEN, the glass menu never carries an alpha: a GlassView with opacity below 1 on itself
  // or an ancestor stops rendering its glass (expo/expo#41024). It grows out of its corner instead.
  // While closing it is flat (`fading`), so it can fade like everything else.
  const glassActive = useLiquidGlassActive();
  const menuGlass = glassActive && !fading;
  const menuStyle = useAnimatedStyle(() => ({
    opacity: (menuGlass ? 1 : interpolate(p.value, [0.1, 0.55], [0, 1], Extrapolation.CLAMP)) * (1 - c.value),
    transform: [{ scale: interpolate(p.value, [0, 1], [glassActive ? 0.2 : 0.55, 1]) * (1 - 0.06 * c.value) }],
  }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: clamp(p.value, 0, 1) * (1 - c.value) }));
  // The blur's INTENSITY is animated, not its opacity: a UIVisualEffectView with alpha below 1
  // renders broken until the alpha returns to 1.
  const blurProps = useAnimatedProps(() => ({ intensity: clamp(p.value, 0, 1) * (1 - c.value) * 40 }));

  const isIOS = Platform.OS === 'ios';
  const dimColor = isIOS ? (theme.isDark ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.12)') : 'rgba(0,0,0,0.55)';
  // The app's own elevated surface, so the menu belongs to the active theme instead of being a
  // neutral grey card; transparent on glass, which draws its own surface.
  const menuBg = menuGlass ? 'transparent' : theme.colors.background.elevated;
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
        style={[
          styles.menuShadow,
          { top: menuTop, left: menuLeft, width: menuW, backgroundColor: menuBg },
          // The glass draws its own edge and depth; a drop shadow under it reads as a grey halo.
          glassActive ? { shadowOpacity: 0, elevation: 0 } : null,
          menuStyle,
        ]}
      >
        <View style={[styles.menu, { backgroundColor: menuBg }, menuGlass ? { overflow: 'visible' } : null]}>
          {menuGlass ? (
            <GlassBg
              borderRadius={MENU_RADIUS}
              glassStyle="regular"
              interactive={false}
              colorScheme={theme.isDark ? 'dark' : 'light'}
            />
          ) : null}
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
  const hairline = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  // No status line: there is no presence data behind it, so "был(а) недавно" was a constant.
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

/**
 * Server pages fetched for chats with no local copy, kept for the session.
 *
 * Without it every long-press on such a chat showed the spinner again and then repainted —
 * reported as "the data reloads". A second peek now paints the cached page at once and only
 * refetches in the background when the copy is older than `REMOTE_FRESH_MS`.
 */
const remoteCache = new Map<string, { at: number; rows: ChatMessage[] }>();
const REMOTE_FRESH_MS = 60_000;

function PeekTranscript({ conversationId }: { conversationId: string }) {
  const theme = useTheme();
  const t = useT();
  const myId = useAuthStore((s) => s.user?.id);
  const chatBubble = useSettingsStore((s) => s.chatBubble);
  const local = useMemo(() => readLocal(conversationId), [conversationId]);
  // `null` = not fetched (yet). Only fetched when there is nothing local to show.
  const [remote, setRemote] = useState<ChatMessage[] | null>(() => remoteCache.get(conversationId)?.rows ?? null);
  const needsFetch = local.length === 0;

  useEffect(() => {
    if (!needsFetch) return;
    const cached = remoteCache.get(conversationId);
    if (cached && Date.now() - cached.at < REMOTE_FRESH_MS) return;
    let alive = true;
    (async () => {
      try {
        const { getMessages } = await import('../../lib/supabase');
        const { messages, error } = await getMessages(conversationId, { limit: REMOTE_PAGE });
        if (!alive) return;
        if (error && cached) return; // keep showing the copy we have rather than blanking it
        const rows = (Array.isArray(messages) ? messages : [])
          .map((r) => fromServerRow(r, conversationId))
          .filter((m): m is ChatMessage => m !== null);
        if (!error) remoteCache.set(conversationId, { at: Date.now(), rows });
        setRemote(rows);
      } catch {
        if (alive && !cached) setRemote([]);
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
      // A screenful, not more: everything mounted here is mounted in the same frame the card starts
      // to grow, which is the stutter reported on chats with a lot of media.
      initialNumToRender={8}
      maxToRenderPerBatch={6}
      windowSize={5}
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
  // Same content as the chat: the GIF itself (it used to be the word "GIF"), every photo of an album
  // rather than only the first, and the link card under a message with a link.
  const raw = message.text || '';
  const gif = raw.startsWith('::gif::') ? raw.slice('::gif::'.length).trim().split(/\s+/)[0] || null : null;
  const images = gif ? [] : messageImageUrls(message).slice(0, 4);
  const body = gif ? '' : stripMarkers(raw);
  const link = !gif && images.length === 0 && body ? extractFirstUrl(body) : null;
  const inner = Math.max(6, radius - 6);
  const time = formatTime(message.createdAt);
  return (
    <View style={[styles.bubble, { alignSelf: own ? 'flex-end' : 'flex-start', backgroundColor: bg, borderRadius: radius }]}>
      {gif ? <CachedImage uri={gif} style={[styles.gif, { borderRadius: inner }]} resizeMode="cover" /> : null}
      {images.length > 0 ? <PeekAlbum urls={images} radius={inner} /> : null}
      {body ? (
        <Text variant="body" color={fg} numberOfLines={8} style={styles.bubbleText}>
          {body}
        </Text>
      ) : !gif && images.length === 0 && raw ? (
        <Text variant="body" color={fg} style={styles.bubbleText}>
          {photoLabel}
        </Text>
      ) : null}
      {link ? (
        <View style={styles.link} pointerEvents="none">
          <LinkPreview url={link} static />
        </View>
      ) : null}
      {time ? (
        <Text variant="caption" color={fg} style={styles.time}>
          {time}
        </Text>
      ) : null}
    </View>
  );
});

/** One photo large; two side by side; three or four as a 2×2 grid, like the chat's albums. */
function PeekAlbum({ urls, radius }: { urls: string[]; radius: number }) {
  if (urls.length === 1) {
    return <CachedImage uri={urls[0]} style={[styles.photo, { borderRadius: radius }]} resizeMode="cover" />;
  }
  const cellH = urls.length === 2 ? ALBUM_W * 0.68 : (ALBUM_W - 2) / 2;
  return (
    <View style={styles.album}>
      {urls.map((u) => (
        <CachedImage key={u} uri={u} style={{ width: (ALBUM_W - 2) / 2, height: cellH, borderRadius: radius }} resizeMode="cover" />
      ))}
    </View>
  );
}

const ALBUM_W = 196;

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
  photo: { width: ALBUM_W, height: ALBUM_W, marginTop: 2, marginBottom: 4 },
  gif: { width: ALBUM_W, height: Math.round(ALBUM_W * 0.75), marginTop: 2, marginBottom: 4 },
  album: { width: ALBUM_W, flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginTop: 2, marginBottom: 4 },
  link: { width: 230, marginTop: 6 },
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
