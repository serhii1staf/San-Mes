import React, { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { View, FlatList, TextInput, Pressable, Platform, StyleSheet, Alert, Animated, Dimensions, Keyboard, InteractionManager, AppState, type ViewToken } from 'react-native';
import { useReanimatedKeyboardAnimation, useKeyboardHandler } from 'react-native-keyboard-controller';
import { FlashList, useRecyclingState, type FlashListRef } from '@shopify/flash-list';
import Reanimated, { useAnimatedStyle, interpolate, Extrapolation, useSharedValue, withSpring, withTiming, withSequence, withDelay, runOnJS, useAnimatedRef, measure, Easing, type SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { proxiedImageUrl } from '../../src/components/ui/CachedImage';
import Skeleton from '../../src/components/ui/Skeleton';
import { FormattedText, hasCodeBlock } from '../../src/components/ui/FormattedText';
import { LinkPreview } from '../../src/components/ui/LinkPreview';
import { extractFirstUrl } from '../../src/services/linkPreview';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { MessageContextMenu, MessageAction, type ActionZone, type MessageContextMenuHandle } from '../../src/components/ui/MessageContextMenu';
import { TranslationSheet } from '../../src/components/ui/TranslationSheet';
import { ChatInputBar, ChatInputBarHandle } from '../../src/components/chat/ChatInputBar';
import { MediaPanel } from '../../src/components/chat/MediaPanel';
import { PhotoPickerPanel } from '../../src/components/chat/PhotoPickerPanel';
import { ImageViewerModal } from '../../src/components/chat/ImageViewerModal';
import { EmojiDeleteBurst, EmojiBurstHandle } from '../../src/components/chat/EmojiDeleteBurst';
import { getRealtime, chatChannelName } from '../../src/services/realtime/ably';
import { useContextMenuGuard } from '../../src/hooks/useContextMenuGuard';
import { useChatStore, useEntityStore, useConnectivityStore, useAuthStore } from '../../src/store';
import { usePinnedMessagesStore, selectPinnedIds, resolvePinned } from '../../src/store/pinnedMessagesStore';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY, DEFAULT_CHAT_SETTINGS } from '../../src/store/chatSettingsStore';
import { readableTextOn, withOpacity } from '../../src/constants/bubbleColors';
import { useMessageGestures } from '../../src/hooks/useMessageGestures';
import { useChatKeyboardMode } from '../../src/hooks/useChatKeyboardMode';
import { useStaggeredReveal, useStaggeredGifReveal, setRevealScrollPaused } from '../../src/hooks/useStaggeredReveal';
import { useBrowserStore } from '../../src/store/browserStore';
import { ChatBackgroundLayer } from '../../src/components/ui/ChatBackgroundLayer';
import { PixelIcon } from '../../src/components/pixel-icons/PixelIcon';
import { uploadChatImage } from '../../src/lib/supabase';
import { getImageDims, setImageDims } from '../../src/services/imageDimsCache';
import { useRenderBudget } from '../../src/hooks/useRenderBudget';
import { useEffectiveBrowserWidgetPosition } from '../../src/lib/browserWidget';
import { bottomScrimColorsStrong, composerScrimHeight, headerScrimHeights, SCRIM_LOCATIONS, topScrimColors } from '../../src/theme/scrim';
import { kvGetJSONSync, kvSetJSON, kvWarm } from '../../src/services/kvStore';
import { addTombstones, filterTombstoned } from '../../src/services/messageTombstones';
import { TypingIndicator } from '../../src/components/ui/TypingIndicator';
import { typingChatChannelName, useTypingPublisher } from '../../src/services/realtime/typing';
import { clearActiveThread, setActiveThread } from '../../src/services/activeThread';
import { mockMessages, mockConversations, formatMessageTime } from '../../src/utils/mockData';
import { showToast } from '../../src/store/toastStore';
import { ChatMessage } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';
import { sanitizeUserText } from '../../src/utils/sanitizeText';
import { getRecentEmoji, pushRecentEmoji } from '../../src/services/recentEmoji';
import { getRecentGif, pushRecentGif } from '../../src/services/recentGif';
import { playSendSound } from '../../src/utils/sounds';
import { GiphyItem } from '../../src/services/giphy';
import { useT, useI18nStore } from '../../src/i18n/store';
import { buildDaySeparators, formatDaySeparator } from '../../src/utils/chatDaySeparators';
import { mergeHistory } from '../../src/utils/mergeHistory';

import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useLiquidGlassActive, NativeGlassView, GlassBg } from '../../src/components/ui/LiquidGlass';
import { useScreenCaptureGuard } from '../../src/hooks/useScreenCaptureGuard';
import { ScreenshotShield } from '../../src/components/ui/ScreenshotShield';

const REPLY_THRESHOLD = 60;
const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;

// Stable FlashList prop objects. The chat screen re-renders frequently
// (reply/edit banner, keyboard frames, scroll-to-bottom toggle, store
// message updates), and passing FRESH inline object literals for these props
// on every one of those renders handed FlashList a new identity each time —
// forcing its internal prop-diff/effect work to re-run needlessly. Both values
// are compile-time constants, so hoisting them to module scope makes the
// references stable across every render without changing any behaviour.
// ── DO NOT ADD `autoscrollToTopThreshold` HERE ──────────────────────────────────────
//
// Worth writing down, because it looks like the obvious fix for "loading older messages
// throws me to the top" and it is the exact opposite.
//
// From the installed package's own typings (`dist/FlashListProps.d.ts`):
//
//   maintainVisibleContentPosition is enabled by default.        (there is a `disabled` flag)
//   autoscrollToTopThreshold — "When content is added at the top, automatically scroll to
//                               maintain position if the user is within this threshold"
//   autoscrollToBottomThreshold — same, for content added at the bottom
//
// So position maintenance is NOT what the thresholds switch on; it is on already. The
// thresholds control AUTO-SCROLLING — actively following newly added content. Setting a top
// threshold would make the list chase older messages toward the top as they are prepended,
// i.e. it would CAUSE the teleport rather than cure it.
//
// `autoscrollToBottomThreshold: 0.1` is deliberate and correct: when a new message arrives at
// the bottom and the user is already near the newest message, follow it. That is the
// stick-to-newest behaviour a chat wants.
const MVCP_FROM_BOTTOM = { startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.1 } as const;
const LIST_CONTENT_CONTAINER_STYLE = { paddingBottom: 8 } as const;

/**
 * How many of the newest messages the SYNCHRONOUS first-paint parse reads.
 *
 * This is the only bound on opening a chat, and it is the one that matters: it caps the
 * JSON parse + sender-heal on the navigation frame at O(60) no matter how long the
 * conversation is. The rest of the history is hydrated lazily, once, when the user actually
 * scrolls to the top.
 *
 * There used to be a SECOND bound here, `INITIAL_WINDOW` (40) plus `WINDOW_CHUNK` (30) plus
 * an `OLDER_LOAD_COOLDOWN_MS` (400), feeding a `renderWindow` that sliced `data` down
 * further and grew on scroll. It is gone. FlashList v2 is a recycler — it mounts what fits
 * on screen plus overscan regardless of how long `data` is — so slicing on top of it added
 * no virtualisation, only a front edge that moved during scroll gestures. Every move was a
 * prepend, and the prepends were the "BAM, thrown to the very top" report that survived six
 * attempts to compensate them.
 */
const SEED_CAP = 60;

/**
 * Does `m` answer to `candidate` under either of its two identities?
 *
 * A message can be held under a local `m-<ts>` id with the server uuid in `serverId` (an
 * optimistic send) or under the server uuid directly (anything fetched or received). So any
 * "is this the row I mean" test has to consider both, in both directions.
 *
 * Module scope on purpose: the realtime `onEdit`/`onDelete` handlers and the delete menu
 * action all need it, and the delete action previously matched on `id` alone — which silently
 * failed to remove a row the caller identified by its server uuid.
 */
function matchesEitherId(m: { id: string; serverId?: string }, candidate: string | undefined | null): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  return m.id === candidate || (!!m.serverId && m.serverId === candidate);
}

// Hard cap on how many messages we keep in the durable `chat_messages:<id>`
// blob. Without this, every send/receive grows the MMKV blob unbounded, and
// each persist re-serializes the whole thing. 1000 is generous enough for
// reply-jump / search into old history while stopping unbounded MMKV growth.
// `writeTailCache` already bounds its own (much smaller) key independently.
const MAX_PERSISTED_MESSAGES = 1000;

// Slice an authoritative (oldest→newest) array down to the newest
// MAX_PERSISTED_MESSAGES before it is written to disk.
function capPersisted<T>(arr: T[]): T[] {
  return arr.length > MAX_PERSISTED_MESSAGES ? arr.slice(arr.length - MAX_PERSISTED_MESSAGES) : arr;
}

// ── Bounded recent-tail cache ──────────────────────────────────────────────
// First paint only needs the most-recent `SEED_CAP` messages, yet the full
// `chat_messages:<id>` blob can hold hundreds/thousands of messages. Parsing
// that whole blob synchronously on the open frame is the dominant chat-open
// stall and scales with chat length. To make first-paint seeding cheap and
// O(SEED_CAP) regardless of total history, we keep a SEPARATE, tiny cache key
// holding ONLY the last `SEED_CAP` messages. `seedMessages` reads this (a small
// parse); the full blob stays the authoritative store for lazy hydration.
const tailKey = (conversationId: string) => `chat_tail:${conversationId}`;

// Write the bounded recent-tail cache from an authoritative (oldest→newest)
// array. Called right next to every full `chat_messages:<id>` write so the seed
// stays correct on every send/receive/edit/delete, and once off-frame after
// open (via hydrateFullHistory) so pre-existing chats warm their tail too.
function writeTailCache(conversationId: string, full: ChatMessage[]): void {
  try {
    const tail = full.length > SEED_CAP ? full.slice(full.length - SEED_CAP) : full;
    kvSetJSON(tailKey(conversationId), tail);
  } catch {
    // ignore — the full blob remains the durable source of truth
  }
}

// ── Coalesced (debounced) message-persist machinery ────────────────────────
// Sending one photo fires setMessages/addMessage ~3 times (optimistic add →
// server-id reconcile → upload-URL swap). Persisting SYNCHRONOUSLY on every
// `myMessages` change therefore stacks ~3 full-array JSON.stringify writes per
// photo onto the frame budget; a rapid photo burst stacks dozens and blows the
// frame budget (the FPS crash). We instead coalesce writes behind a trailing
// debounce: a burst of N sends collapses into ONE disk write ~450 ms after the
// burst settles.
//
// Durability is preserved WITHOUT a synchronous-per-change write because this
// state is MODULE-LEVEL (it outlives the component): the pending write closure
// captures everything it needs, so even on unmount the timer still fires and
// the write lands. On top of that we (a) flush on AppState 'background' (covers
// app kill within the debounce window), (b) flush when the conversation id
// changes, and (c) flush on a real teardown (deferred a microtask so a mere
// `myMessages` re-render — which also tears the effect down — does NOT defeat
// coalescing; an immediately-following re-run for the same conversation cancels
// the deferred flush).
const PERSIST_DEBOUNCE_MS = 450;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersistWrite: (() => void) | null = null;
let pendingPersistConv: string | null = null;
let persistTeardownPending = false;

function runPendingPersist(): void {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  const fn = pendingPersistWrite;
  pendingPersistWrite = null;
  pendingPersistConv = null;
  if (fn) { try { fn(); } catch {} }
}

function schedulePersist(conversationId: string, write: () => void): void {
  // A pending write for a DIFFERENT conversation must land before we start
  // accumulating writes for the new one — never drop a write on chat switch.
  if (pendingPersistConv && pendingPersistConv !== conversationId) runPendingPersist();
  pendingPersistWrite = write;
  pendingPersistConv = conversationId;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(runPendingPersist, PERSIST_DEBOUNCE_MS);
}

// How many of the most-recent messages the chat-open warm prefetches. Bounded
// low (the first screen is only a handful of bubbles) so opening a chat never
// front-loads a burst of image fetches onto the navigation frame. The rest
// stream in lazily on scroll. Was 20 — too many, and a measurable contributor
// to the open-the-chat decode burst.
const WARM_RECENT = 6;

// Detect an animated GIF by URL. Mirrors the `hasGif` test used by the
// visibility tracker so the warm path and the off-screen-pause path agree on
// what counts as a "heavy animated decode". Animated GIFs are excluded from the
// chat-open warm (they should only ever decode when actually visible).
function isAnimatedImageUrl(u: string): boolean {
  if (!u) return false;
  const low = u.toLowerCase();
  const q = low.indexOf('?');
  const path = q >= 0 ? low.slice(0, q) : low;
  return path.endsWith('.gif') || low.indexOf('giphy') !== -1;
}

// ── Legacy relative-sender healing ────────────────────────────────────────
// Older builds stored chat messages with a RELATIVE sentinel senderId:
// 'current' (whoever was logged in when the message was cached) or 'peer'
// (the other side). That made ownership ambiguous the moment the user
// switched accounts on the same device — a message authored by account A
// could render on account B's "own" side. We now persist the REAL author
// uuid on every message and compute ownership at render time.
//
// This heals any legacy-tagged message read from cache. It is reliable
// because the chat-message cache is ACCOUNT-SCOPED (keyed via accountKey):
// within the active account's namespace, 'current' is unambiguously the
// current user and 'peer' is the conversation's other participant. A message
// whose senderId is already a real uuid is returned untouched.
function healLegacySender(
  m: ChatMessage,
  currentUserId?: string,
  participantId?: string,
): ChatMessage {
  if (m.senderId === 'current') {
    return currentUserId ? { ...m, senderId: currentUserId } : m;
  }
  if (m.senderId === 'peer') {
    return participantId ? { ...m, senderId: participantId } : m;
  }
  return m;
}

// Hoisted static atoms for the message bubble. Each visible bubble was
// previously allocating ~10 fresh inline objects per render — for the
// `initialNumToRender: 8` first batch that's ~80 throwaway objects on the
// open-the-chat frame. The remaining truly-dynamic bits (theme colors,
// alignSelf, margins) are still applied as small override objects, which
// React happily diffs without re-walking the whole tree.
const bubbleStyles = StyleSheet.create({
  row: { justifyContent: 'center' },
  // Full-width swipe target. `width: '100%'` rather than `flex: 1` because the parent is not
  // a flex row — it is the message row, and the child must span it so a two-character bubble
  // is as easy to swipe as a long one. No padding or background: the bubble's own margins
  // still position it, so this adds a hit area and nothing visual.
  gestureRow: { width: '100%' },
  swipeIcon: { position: 'absolute', right: 16 },
  swipeIconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bubbleBase: { paddingHorizontal: 14, paddingVertical: 10 },
  replyBlock: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, borderLeftWidth: 2, marginBottom: 6 },
  // `flexShrink:1 + minWidth:0` (NOT `flex:1`) so the reply preview contributes
  // its INTRINSIC width to the bubble's column: a short message replying to a
  // long one expands the bubble to fit the preview (capped by the bubble's 78%
  // maxWidth), and the one-line reply texts ellipsize at that max width instead
  // of being cut to the narrow message-content width. `minWidth:0` lets the
  // child shrink below its content size so the ellipsis kicks in cleanly.
  replyTextWrap: { flexShrink: 1, minWidth: 0 },
  replyAvatar: { width: 30, height: 30, borderRadius: 6 },
  replyPixel: { borderRadius: 6 },
  replyHeading: { fontSize: 11 },
  replyBody: { fontSize: 11 },
  imagesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  imageSingle: { width: 200, height: 200, borderRadius: 12 },
  // Placeholder box shown for a single-image bubble until `imagesReady` flips
  // (just after the open transition). Sized to `SingleChatImage`'s OWN initial
  // square (220×220) so when the real image mounts it occupies the exact same
  // box — the list never jumps. Once loaded, `SingleChatImage` snaps to the
  // photo's aspect ratio exactly as before.
  imageSinglePlaceholder: { width: 220, height: 220, borderRadius: 12 },
  imageMulti: { width: 120, height: 120, borderRadius: 12 },
  linkPreviewWrap: { marginTop: 6, width: 280, maxWidth: '100%' },
  timestamp: { marginTop: 3, alignSelf: 'flex-end', fontSize: 10 },
  // Metadata line: [expand] [time], right-aligned inside the bubble. `gap` keeps the
  // two apart without padding that would widen the bubble on a short message.
  metaRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 5, marginTop: 3 },
  // The icon's own box is small, but `hitSlop={10}` on the Pressable takes the touch
  // target well past Apple's 44 pt guidance without affecting layout.
  expandInline: { paddingVertical: 1 },
  timestampInline: { fontSize: 10 },
});

// Soft glowing "loading older messages" indicator shown at the TOP of the chat
// (oldest end) while the next older chunk is being revealed from cache. Pure
// cosmetic pulse — the data is already local, so this just gives the
// Telegram-style "more is loading above" affordance instead of messages
// silently popping in. Animated with the native driver (opacity only) so it
// never touches the JS thread during scroll.
function OlderMessagesLoader({ visible, color }: { visible: boolean; color: string }) {
  const pulse = useRef(new Animated.Value(0.25)).current;
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.25, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  // ── CONSTANT height, always ────────────────────────────────────────────────
  //
  // This used to `return null` when hidden, so mounting and unmounting it changed
  // the list header's HEIGHT — and it does so precisely when the user has scrolled
  // to the top, which is the one moment the content above the viewport must not
  // move. maintainVisibleContentPosition anchors on ITEMS, not on the header, so it
  // cannot compensate: the whole transcript shifted by 24 pt as the indicator
  // appeared and again as it went away.
  //
  // The container is now always present at a fixed height and only the bar's
  // opacity changes, which is compositor-only and cannot affect layout. The
  // reserved strip sits under the header gradient, so it is not visible as empty
  // space when idle.
  return (
    <View style={styles.olderLoader} pointerEvents="none">
      <Animated.View
        style={{
          width: 84,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
          // `visible` gates the opacity rather than the mount. Safe to fade here:
          // this is a plain View, not a glass surface.
          opacity: visible ? pulse : 0,
        }}
      />
    </View>
  );
}

// Max bounds for a single sent photo. The container is sized to the image's
// natural aspect ratio (capped to these bounds) so the WHOLE image is visible
// in the bubble — no crop — instead of being squeezed into a fixed square.
const CHAT_IMG_MAX_W = Math.min(Math.round(SCREEN_WIDTH * 0.66), 270);
const CHAT_IMG_MAX_H = 340;

// Fit a photo's natural pixel size into the bubble's max bounds, preserving
// aspect ratio (no crop). Shared by the live onLoad handler and the
// remembered-dimensions path so both compute the SAME box.
function fitChatImageBox(natW: number, natH: number): { w: number; h: number } {
  const ar = natW / natH;
  let w = CHAT_IMG_MAX_W;
  let h = Math.round(w / ar);
  if (h > CHAT_IMG_MAX_H) { h = CHAT_IMG_MAX_H; w = Math.round(h * ar); }
  return { w, h };
}

// Single-image bubble that fits its container to the photo's aspect ratio.
// If we've seen this photo before, we OPEN at its remembered size immediately
// (no jump). Otherwise we start at a neutral square and snap to the real
// dimensions once expo-image reports the decoded source size (onLoad) — and
// remember them so every future open of this chat is jump-free. Own tiny
// state → the memoized MessageBubble around it is untouched.
function SingleChatImage({ uri, isVisible, onPress }: { uri: string; isVisible?: boolean; onPress: () => void }) {
  const theme = useTheme();
  // Seed from the persisted dimension cache so a previously-seen photo mounts
  // at the correct aspect-ratio box on the very first frame — this removes the
  // "container changes size / photo reloads every time I open the chat" jump.
  // `useRecyclingState`, NOT `useState`.
  //
  // A lazy `useState` initialiser runs on MOUNT ONLY. FlashList recycles a row by
  // re-rendering it with a different message rather than unmounting it, so when a
  // photo bubble was reused for a different photo the initialiser never re-ran:
  // the new image kept the PREVIOUS photo's box size, and `loading` kept the
  // previous photo's state. In a long chat every image row recycles as you scroll,
  // so each one mis-sized itself and forced a relayout on a scroll frame — which is
  // a large part of why chats with a lot of media stutter.
  //
  // `useRecyclingState` re-evaluates during render when `uri` changes, so the box is
  // correct on the first frame the new photo is shown.
  const [size, setSize] = useRecyclingState<{ w: number; h: number }>(() => {
    const d = getImageDims(uri);
    return d ? fitChatImageBox(d.w, d.h) : { w: 220, h: 220 };
  }, [uri]);
  // Skip the spinner when we already know the size AND the bytes are almost
  // certainly disk-cached (we've decoded this exact URL before) — a known
  // photo should just appear, not flash a loader.
  const [loading, setLoading] = useRecyclingState(() => !getImageDims(uri), [uri]);
  // `setSize` / `setLoading` come from `useRecyclingState` and are stable
  // (useCallback'd on a stable counter setter inside the hook), so listing them
  // does not widen the callback's identity churn.
  const handleLoad = useCallback((e: any) => {
    setLoading(false);
    const s = e?.source;
    if (!s?.width || !s?.height) return;
    setImageDims(uri, s.width, s.height);
    setSize(fitChatImageBox(s.width, s.height));
  }, [uri, setLoading, setSize]);
  const handleError = useCallback(() => setLoading(false), [setLoading]);
  return (
    <Pressable onPress={onPress}>
      {/* Fixed-size rounded container holds the image AND a centered loading
          spinner overlay. The image fills the container (100%×100%) so while it
          uploads/decodes the user sees a spinner over a neutral tile instead of
          a blank box, and there is no second "reload" flash. The container
          still snaps from the neutral square to the photo's real aspect ratio
          once dimensions are known — but the spinner makes that read as
          "loading", which is exactly the affordance requested. */}
      <View style={{ width: size.w, height: size.h, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.background.tertiary }}>
        <CachedImage
          uri={uri}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          proxyWidth={CHAT_IMG_MAX_W}
          priority="low"
          autoplay={isVisible}
          onLoad={handleLoad}
          onError={handleError}
        />
        {loading ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Skeleton width={'100%'} height={'100%'} radius={0} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function MessageBubble({ message, isOwn, fontSize, bubbleRadius, fontFamily, linkEmoji, bubbleColors, bubbleOpacity, bubbleTextColor, inColors, inOpacity, inTextColor, highlighted, isVisible, imagesReady, onReply, onReplyJump, onLongPress, onMeasured, onSwipeActive, onImagePress, dragActive, dragFingerY, hoveredAction, actionZones, onFireDragAction, onOpenFullscreen }: { message: ChatMessage; isOwn: boolean; fontSize: number; bubbleRadius: number; fontFamily: string; linkEmoji?: string; bubbleColors: string[]; bubbleOpacity: number; bubbleTextColor: string; inColors: string[]; inOpacity: number; inTextColor: string; highlighted?: boolean; isVisible?: boolean; imagesReady?: boolean; onReply: (m: ChatMessage) => void; onReplyJump?: (messageId?: string) => void; onLongPress: (m: ChatMessage) => void; onMeasured?: (id: string, x: number, y: number, w: number, h: number) => void; onSwipeActive: (active: boolean) => void; onImagePress: (images: string[], index: number) => void; dragActive: SharedValue<boolean>; dragFingerY: SharedValue<number>; hoveredAction: SharedValue<string>; actionZones: SharedValue<ActionZone[]>; onFireDragAction: (m: ChatMessage, action: string) => void; onOpenFullscreen: (m: ChatMessage) => void }) {
  const theme = useTheme();
  const t = useT();
  // Resolve THIS bubble's fill from the per-side style. Outgoing always has a
  // colored fill (custom or theme accent). Incoming is the neutral tertiary
  // surface UNLESS the user set a custom incoming color/gradient. A gradient
  // renders as an absolutely-positioned LinearGradient behind the content
  // (opt-in — solid bubbles never mount one). `coloredBubble` gates whether
  // text/reply/timestamp use the contrast-picked tint vs. the theme defaults.
  let fillColors: string[];
  let fillOpacity: number;
  let sideTextColor: string;
  let coloredBubble: boolean;
  if (isOwn) {
    fillColors = bubbleColors.length ? bubbleColors : [theme.colors.accent.primary];
    fillOpacity = bubbleOpacity;
    sideTextColor = bubbleTextColor;
    coloredBubble = true;
  } else if (inColors.length > 0) {
    fillColors = inColors;
    fillOpacity = inOpacity;
    sideTextColor = inTextColor;
    coloredBubble = true;
  } else {
    fillColors = [theme.colors.background.tertiary];
    fillOpacity = 1;
    sideTextColor = theme.colors.text.primary;
    coloredBubble = false;
  }
  const isGradient = fillColors.length > 1;
  const solidBg = withOpacity(fillColors[0], fillOpacity);
  const gradFill = isGradient ? fillColors.map((c) => withOpacity(c, fillOpacity)) : null;
  const sideTextStrong = sideTextColor === '#FFFFFF' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)';
  const sideTextDim = sideTextColor === '#FFFFFF' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';
  const sideTextFaint = sideTextColor === '#FFFFFF' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)';
  // Reply/heading/body/link/timestamp colors: contrast tint on a colored
  // bubble, theme defaults on the neutral incoming surface.
  const replyBorderColor = coloredBubble ? sideTextDim : theme.colors.accent.primary;
  const replyHeadingColor = coloredBubble ? sideTextStrong : theme.colors.accent.primary;
  const replyBodyColor = coloredBubble ? sideTextDim : theme.colors.text.tertiary;
  const bodyTextColor = coloredBubble ? sideTextColor : theme.colors.text.primary;
  const linkTextColor = coloredBubble ? sideTextColor : theme.colors.accent.primary;
  const timeColor = coloredBubble ? sideTextFaint : theme.colors.text.tertiary;
  // Native iOS-26 liquid glass for the swipe-to-reply pill. iOS-only + opt-in.
  const glassActive = useLiquidGlassActive();
  const fontFamilyStyle = fontFamily === 'mono' ? 'monospace' : fontFamily === 'serif' ? 'serif' : undefined;

  // Swipe-to-reply + press-drag-select gestures and the reply-jump glow are
  // wired by useMessageGestures (extracted for maintainability + testing).
  // Behaviour is identical to the previous inline implementation.
  const { bubbleRef, composedGesture, glowStyle, bubbleAnimStyle, replyIconAnimStyle } = useMessageGestures({
    message,
    highlighted,
    onReply,
    onSwipeActive,
    onLongPress,
    onMeasured,
    onFireDragAction,
    dragActive,
    dragFingerY,
    hoveredAction,
    actionZones,
  });

  // Frame-paced reveal of this bubble's image(s): once the screen flips
  // `imagesReady`, image bubbles no longer all decode on the SAME frame —
  // each waits its turn in a shared one-per-frame queue, so a GIF-heavy chat
  // opening no longer lands ~10 simultaneous decodes as one long task.
  //
  // Animated GIFs additionally go through a WIDER-spaced reveal pump
  // (`useStaggeredGifReveal`): a static photo decodes once and cheaply, but an
  // animated GIF's first decode is ~100-180 ms on weak Android, so spacing GIF
  // reveals only one frame apart still stacks 5-8 overlapping decodes into the
  // recurring ~500 ms long task the perf monitor flagged. The GIF pump spaces
  // decode STARTS wider than one decode takes (≈2 concurrent max) while photos
  // keep the unchanged 1/frame pump. GIFs are always single-image bubbles
  // (sent as `imageUrls:[url]`), but we test every url so a mixed bubble still
  // takes the heavier-gated path. Both hooks are always called (rules of hooks).
  const hasImages = !!(message.imageUrls && message.imageUrls.length > 0);
  const isGifBubble = hasImages && message.imageUrls!.some(isAnimatedImageUrl);
  const photoReveal = useStaggeredReveal(!!imagesReady && hasImages && !isGifBubble);
  const gifReveal = useStaggeredGifReveal(!!imagesReady && hasImages && isGifBubble);
  const imgReveal = isGifBubble ? gifReveal : photoReveal;
  // Photos we've already seen are on disk (their dimensions are remembered):
  // render them IMMEDIATELY instead of routing through the placeholder →
  // staggered-reveal path. That deferral exists ONLY to avoid a decode STORM
  // when a chat full of FRESH images opens; for an already-cached image it just
  // produced a dark placeholder → spinner → image flash on every single open
  // (the "photos reload as black images every time I reopen the chat" report).
  // First-time images keep the staggered path so a fresh GIF-heavy chat still
  // doesn't decode-storm the open frame.
  //
  // GIFs are DELIBERATELY excluded from this fast path (`!isGifBubble`). A
  // static photo's bytes+bitmap are cached after the first decode, so a known
  // photo is genuinely cheap to re-mount. An animated GIF is NOT: expo-image
  // re-decodes the first frame (~40-74 ms each on a weak device) on every fresh
  // mount even when the bytes are on disk and the dimensions are remembered.
  // `getImageDims` persists across launches (MMKV), so on RE-open of a GIF-heavy
  // chat every GIF satisfied `singleImgKnown` and mounted its CachedImage on the
  // SAME frame — exactly the ~10-11 simultaneous Giphy decodes / 125-134 ms long
  // task the perf monitor caught right after navigation. Forcing GIFs to always
  // honour `gifReveal` routes them through the wider-spaced GIF reveal pump
  // (≈90 ms apart, ~2 concurrent) so the first-frame decodes cascade across
  // frames instead of bursting. The placeholder skeleton below is sized to the
  // remembered dims, so the Skeleton → CachedImage swap is layout-identical
  // (no jump). This mirrors the comments screen, which always gates GIF reveal.
  //
  // LOCAL (`file://`) images are ALSO excluded from this fast path (the
  // `.startsWith('http')` test below): pickImages stamps their dimensions the
  // moment they're picked, so a rapid photo-send burst would otherwise have
  // every fresh local bubble satisfy `singleImgKnown` and decode its full
  // bitmap on the SAME mount frame — the decode storm behind the FPS crash.
  // Forcing local images through `imgReveal` (the one-per-frame photo pump)
  // spreads those decodes across frames; they still appear promptly (correctly-
  // sized skeleton → photo, no jump), just not all on one frame. Once uploaded,
  // the bubble's url becomes http and re-mounts cached → instant, as before.
  const singleImgKnown = hasImages && message.imageUrls!.length === 1 && !isGifBubble && message.imageUrls![0].startsWith('http') && !!getImageDims(message.imageUrls![0]);

  // `Pressable.onPress` receives a gesture event, not the message — bind it here
  // so the button can stay a plain onPress while the screen's handler keeps
  // taking the message it acts on.
  const handleOpenFullscreen = useCallback(
    () => onOpenFullscreen(message),
    [onOpenFullscreen, message],
  );

  // ── Derived-from-text work, memoized per message ────────────────────────────
  //
  // Both of these ran on EVERY render of every mounted bubble. Neither is expensive alone,
  // but they are the kind of cost that scales the wrong way: `renderItem`'s identity changes
  // whenever chat settings, bubble colours, search state or the highlight id move, and each
  // time FlashList re-runs it for every mounted cell. So a search keystroke re-formatted a
  // date and ran two regexes over the text of a dozen bubbles, none of which had changed.
  //
  // `createdAt` and `text` are immutable for a given message, so the results are cacheable
  // for the lifetime of that message — and because `parseMessage` hands out a stable object
  // per message id (WeakMap-cached), these memos survive re-renders and only recompute when
  // the message itself actually changes.
  const timeLabel = useMemo(() => formatMessageTime(message.createdAt), [message.createdAt]);

  // Link preview target. `hasCodeBlock` guards against unfurling a URL that is part of a
  // fenced code block, so both regexes belong to the same decision and are memoized together.
  // Reuses the `hasImages` computed further up rather than recomputing the same test.
  const previewLink = useMemo(
    () => (!hasImages && !hasCodeBlock(message.text) ? extractFirstUrl(message.text) : null),
    [hasImages, message.text],
  );

  return (
    <View style={bubbleStyles.row}>
      <Reanimated.View style={[bubbleStyles.swipeIcon, replyIconAnimStyle]}>
        {/* Swipe-to-reply icon. Intentionally NOT a NativeGlassView: a glass
            view is a UIVisualEffectView, one of the most expensive native views
            to instantiate, and mounting one PER BUBBLE (this icon exists on
            every message row, just hidden until a swipe) made every row that
            scrolled into view pay that cost on the scroll frame — a primary
            cause of the per-message scroll freeze. The icon is a tiny circle
            shown only mid-swipe, so a flat tinted circle is visually
            indistinguishable and costs ~nothing to mount. */}
        <View style={[bubbleStyles.swipeIconCircle, { backgroundColor: theme.colors.accent.primary + '20' }]}>
          <Feather name="corner-up-left" size={16} color={theme.colors.accent.primary} />
        </View>
      </Reanimated.View>

      {/* ── THE GESTURE TARGET IS THE ROW, NOT THE BUBBLE ─────────────────────────
          Reported as: a peer sends a message of a few characters and it is very hard to
          swipe it to reply.

          The GestureDetector used to wrap the bubble itself, and the bubble is sized to its
          content (`alignSelf` + `maxWidth: 78%`). So for "ok" the grabbable area was about
          forty points wide, sitting at one edge of the screen — the gesture worked exactly
          as designed and was simply almost impossible to hit.

          Wrapping the full-width row instead makes the whole line swipeable regardless of
          how short the message is, which is what every messenger does. What MOVES is still
          only the bubble: `bubbleAnimStyle` stays on the inner view, so the visual is
          unchanged. The pan already yields to vertical motion (`failOffsetY([-10, 10])`), so
          a wider target cannot start competing with list scrolling, and the long-press still
          measures the bubble's own rect through `bubbleRef` for the delete burst. */}
      <GestureDetector gesture={composedGesture}>
        <View style={bubbleStyles.gestureRow} collapsable={false}>
        <Reanimated.View ref={bubbleRef} style={[bubbleAnimStyle, { alignSelf: isOwn ? 'flex-end' : 'flex-start', maxWidth: '78%', marginLeft: isOwn ? 0 : 16, marginRight: isOwn ? 16 : 0, marginBottom: 4 }]}>
        {/* Long-press + drag-select is handled by `composedGesture` on the
            GestureDetector above (UI thread). This wrapper used to be a
            `Pressable onLongPress`; it's now a plain View so the gesture owns
            the hold. A quick tap still falls through to inner Pressables
            (image → viewer), and the menu's own buttons keep tap-to-select. */}
        <View>
          {/* Reply-jump glow — absolute sibling BEHIND the bubble. Negative
              inset + position:absolute means it adds zero layout, so the bubble
              never moves/resizes when highlighted.

              ── MOUNTED ONLY WHILE HIGHLIGHTED ─────────────────────────────────
              This used to mount on EVERY row, permanently, at opacity 0. It carries an
              iOS shadow (`shadowRadius: 10`, `shadowOpacity: 0.9`), and a shadow with a
              radius forces the layer to be rasterized offscreen — so every bubble within
              `drawDistance` was paying for an offscreen pass to render something invisible,
              and paying it again each time a recycled cell scrolled into view. That is
              per-row cost on the scroll frame, which is the same class of problem the swipe
              icon's comment describes for `UIVisualEffectView`.

              Gating the mount is visually identical rather than a trade-off, because the
              glow's own timeline finishes BEFORE the flag clears: the sequence runs
              240 + 900 + 440 = 1580 ms and the screen clears `jumpHighlightId` at 1600 ms
              (see `scrollToMessageId`). So opacity is already 0 by the time `highlighted`
              flips false and this unmounts — there is no fade-out to lose. Keep those two
              numbers in that order if either is ever changed. */}
          {highlighted ? (
          <Reanimated.View
            pointerEvents="none"
            style={[
              glowStyle,
              {
                position: 'absolute',
                top: -3, left: -3, right: -3, bottom: -3,
                borderRadius: bubbleRadius + 3,
                borderBottomRightRadius: (isOwn ? 4 : bubbleRadius) + 3,
                borderBottomLeftRadius: (isOwn ? bubbleRadius : 4) + 3,
                backgroundColor: theme.colors.accent.primary + (theme.isDark ? '40' : '33'),
                // iOS soft colored glow (Android ignores colored shadows; the
                // tinted halo above carries the effect there instead).
                shadowColor: theme.colors.accent.primary,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.9,
                shadowRadius: 10,
              },
            ]}
          />
          ) : null}
          {/* The expand-to-fullscreen affordance now lives inline next to the
              timestamp, further down — see `bubbleStyles.metaRow`. */}

          <View style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: bubbleRadius,
            backgroundColor: isGradient ? 'transparent' : solidBg,
            borderBottomRightRadius: isOwn ? 4 : bubbleRadius,
            borderBottomLeftRadius: isOwn ? bubbleRadius : 4,
            overflow: isGradient ? 'hidden' : undefined,
          }}>
            {isGradient && gradFill ? (
              <LinearGradient
                colors={gradFill as any}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
            ) : null}
            {message.replyToText || message.replyToImage || message.replyPixelIconId ? (
              <Pressable
                onPress={() => onReplyJump?.(message.replyToId)}
                style={[bubbleStyles.replyBlock, { borderLeftColor: replyBorderColor }]}
              >
                {message.replyToImage ? (
                  <CachedImage uri={message.replyToImage} style={bubbleStyles.replyAvatar} resizeMode="cover" />
                ) : null}
                {/* Pixel icon attached to the reply via the chat-level
                    setting. Renders alongside the text/image preview —
                    additive, never replaces the existing avatar. Small
                    so it reads as a decoration rather than the primary
                    affordance. */}
                {message.replyPixelIconId ? (
                  <PixelIcon id={message.replyPixelIconId} size={22} style={bubbleStyles.replyPixel} />
                ) : null}
                <View style={bubbleStyles.replyTextWrap}>
                  <Text variant="caption" weight="semibold" color={replyHeadingColor} numberOfLines={1} style={bubbleStyles.replyHeading}>
                    {message.replyToIsOwn ? t('chat.you') : t('chat.peer')}
                  </Text>
                  <Text variant="caption" color={replyBodyColor} numberOfLines={1} style={bubbleStyles.replyBody}>
                    {message.replyToText || (message.replyToImage ? t('chat.photo') : '')}
                  </Text>
                </View>
              </Pressable>
            ) : null}
            {message.imageUrls && message.imageUrls.length > 0 ? (
              <View style={[bubbleStyles.imagesRow, { marginBottom: message.text ? 6 : 0 }]}>
                {message.imageUrls.length === 1 ? (
                  // Telegram-style deferred decode: until `imagesReady` flips
                  // (one beat AFTER the open transition), render a correctly-
                  // sized placeholder box instead of the real image, so the
                  // navigation frame mounts only text/layout — never a burst of
                  // synchronous image decodes. The placeholder matches
                  // `SingleChatImage`'s initial square so the list doesn't jump
                  // when the real image swaps in. `imgReveal` adds a frame-paced
                  // stagger so multiple image bubbles don't all decode at once.
                  imgReveal || singleImgKnown ? (
                    <SingleChatImage
                      uri={message.imageUrls[0]}
                      isVisible={isVisible}
                      onPress={() => onImagePress(message.imageUrls!, 0)}
                    />
                  ) : (
                    <Pressable onPress={() => onImagePress(message.imageUrls!, 0)}>
                      {(() => {
                        // Size the placeholder to the remembered photo box when
                        // known, so the swap placeholder → real image never
                        // changes the bubble height (no layout jump on open).
                        const d = getImageDims(message.imageUrls![0]);
                        const box = d ? fitChatImageBox(d.w, d.h) : { w: 220, h: 220 };
                        return (
                          <Skeleton width={box.w} height={box.h} radius={12} />
                        );
                      })()}
                    </Pressable>
                  )
                ) : (
                  message.imageUrls.map((uri, idx) => (
                    <Pressable key={idx} onPress={() => onImagePress(message.imageUrls!, idx)}>
                      {imgReveal || (!isGifBubble && uri.startsWith('http') && getImageDims(uri)) ? (
                        <CachedImage
                          uri={uri}
                          style={bubbleStyles.imageMulti}
                          resizeMode="cover"
                          // Decode at low priority so a heavy GIF/photo never
                          // competes with the chat-open transition or scroll
                          // frames on weak devices.
                          priority="low"
                          // Pause GIF animation while this bubble is scrolled
                          // off-screen — no UI-thread frame decoding for content
                          // the user can't see.
                          autoplay={isVisible}
                        />
                      ) : (
                        // Same-sized placeholder until the open transition
                        // settles — keeps the multi-image grid layout identical
                        // while deferring the decode storm off the nav frame.
                        <Skeleton width={120} height={120} radius={12} />
                      )}
                    </Pressable>
                  ))
                )}
              </View>
            ) : null}
            {message.text ? (
              <FormattedText color={bodyTextColor} linkColor={linkTextColor} style={{ fontSize, fontFamily: fontFamilyStyle }}>{message.text}</FormattedText>
            ) : null}
            {previewLink ? (
              <View style={bubbleStyles.linkPreviewWrap}>
                <LinkPreview
                  url={previewLink}
                  textColor={coloredBubble ? sideTextColor : undefined}
                  emoji={linkEmoji}
                />
              </View>
            ) : null}
            {/* Timestamp row, with the full-screen button immediately to its LEFT.
                The button used to be an absolute badge floating on the bubble's
                outer top corner; that read as a sticker pasted over the message.
                Sitting inline next to the time it becomes part of the bubble's own
                metadata line — compact, always in the same place, and it no longer
                overlaps the first line of text on a short message. */}
            <View style={bubbleStyles.metaRow}>
              <Pressable
                onPress={handleOpenFullscreen}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('chat.open_fullscreen', 'Открыть на весь экран')}
                style={bubbleStyles.expandInline}
              >
                <Feather name="maximize-2" size={11} color={timeColor} />
              </Pressable>
              <Text variant="caption" color={timeColor} style={bubbleStyles.timestampInline}>
                {timeLabel}
              </Text>
            </View>
          </View>
        </View>
        </Reanimated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

const MemoMessageBubble = React.memo(MessageBubble, (prev, next) => {
  // Callbacks are stabilized with useCallback in the screen, so we compare only
  // the data that actually affects this bubble's output. This stops the whole
  // list from re-rendering when unrelated state (typing, scroll, search) changes.
  const pm = prev.message;
  const nm = next.message;
  return (
    pm.id === nm.id &&
    pm.text === nm.text &&
    pm.createdAt === nm.createdAt &&
    pm.replyToText === nm.replyToText &&
    pm.replyToImage === nm.replyToImage &&
    pm.replyToIsOwn === nm.replyToIsOwn &&
    pm.replyPixelIconId === nm.replyPixelIconId &&
    (pm.imageUrls === nm.imageUrls ||
      (pm.imageUrls?.length === nm.imageUrls?.length &&
        (pm.imageUrls || []).every((u, i) => u === nm.imageUrls?.[i]))) &&
    prev.isOwn === next.isOwn &&
    prev.fontSize === next.fontSize &&
    prev.bubbleRadius === next.bubbleRadius &&
    prev.fontFamily === next.fontFamily &&
    prev.linkEmoji === next.linkEmoji &&
    prev.bubbleColors.join(',') === next.bubbleColors.join(',') &&
    prev.bubbleOpacity === next.bubbleOpacity &&
    prev.bubbleTextColor === next.bubbleTextColor &&
    prev.inColors.join(',') === next.inColors.join(',') &&
    prev.inOpacity === next.inOpacity &&
    prev.inTextColor === next.inTextColor &&
    prev.highlighted === next.highlighted &&
    prev.isVisible === next.isVisible &&
    prev.imagesReady === next.imagesReady
  );
});

// Per-row visibility tracker — a tiny external store that replaces the
// `visibleIds`/`viewabilityReady` component state. See `visTrackerRef` in
// ChatScreen for construction.
type VisibilityTracker = {
  // Per-ROW subscription (keyed by message id) so a scroll-pause toggle can
  // notify ONLY the affected rows and, crucially, resume GIFs ONE AT A TIME
  // when the list settles (see the staggered-resume pump in ChatScreen).
  subscribeRow: (id: string, listener: () => void) => () => void;
  isVisible: (id: string) => boolean;
  update: (next: Set<string>) => void;
  // Pause/resume animation globally while the list is actively scrolling — a
  // screenful of animated GIFs decoding every frame DURING a scroll/fling is
  // what tanked UI fps on weak devices.
  setScrolling: (b: boolean) => void;
  // Register/unregister a row as containing an animated image (GIF). The
  // scroll-pause gate ONLY affects registered rows, so toggling `scrolling`
  // re-renders just the GIF bubbles — text/photo bubbles keep a stable
  // `isVisible` snapshot and `useSyncExternalStore` bails them out (no
  // re-render), which is what removes the scroll-start hitch.
  setHasGif: (id: string, hasGif: boolean) => void;
};

// Thin wrapper that subscribes ONLY this row to the visibility tracker, so a
// viewability change re-renders just the bubbles whose on-screen state flips
// instead of churning `renderItem`'s identity (which previously listed
// `visibleIds`/`viewabilityReady` in its deps and forced FlatList to re-run
// for every mounted cell on every viewability event mid-scroll).
// `useSyncExternalStore` returns a boolean snapshot, so it bails out for rows
// whose visibility is unchanged. Behaviour is identical to the old
// `isVisible={!viewabilityReady || visibleIds.has(id)}`: the tracker reports
// everything visible until the first viewable set lands.
type VisibilityBubbleProps = Omit<React.ComponentProps<typeof MemoMessageBubble>, 'isVisible'> & {
  tracker: VisibilityTracker;
};
const VisibilityBubble = React.memo(function VisibilityBubble({ tracker, ...rest }: VisibilityBubbleProps) {
  const id = rest.message.id;
  // Per-row subscription: bind this row's id to the tracker so scroll-pause /
  // staggered-resume can notify just this row. Stable per id so the store
  // subscription isn't torn down on every render.
  const subscribeRow = useCallback((cb: () => void) => tracker.subscribeRow(id, cb), [tracker, id]);
  const isVisible = useSyncExternalStore(subscribeRow, () => tracker.isVisible(id));
  // Does this row contain an animated image (GIF)? Only such rows need to
  // react to the scroll-pause gate, so we register them with the tracker. A
  // text/photo bubble registers `false` and is therefore never re-rendered
  // when scrolling toggles (its `isVisible` snapshot is unaffected) — this is
  // what keeps scroll-start hitch-free on content-heavy chats.
  const hasGif = useMemo(() => {
    const urls = rest.message.imageUrls;
    if (!urls || urls.length === 0) return false;
    return urls.some((u) => {
      const low = u.toLowerCase();
      const q = low.indexOf('?');
      const path = q >= 0 ? low.slice(0, q) : low;
      return path.endsWith('.gif') || low.indexOf('giphy') !== -1;
    });
  }, [rest.message.imageUrls]);
  useEffect(() => {
    tracker.setHasGif(id, hasGif);
    return () => tracker.setHasGif(id, false);
  }, [id, hasGif, tracker]);
  return <MemoMessageBubble isVisible={isVisible} {...rest} />;
});

export default function ChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Active locale drives the day-separator chips' absolute dates through
  // `Intl.DateTimeFormat`, so month names and day/month order follow the user's
  // region instead of being hardcoded.
  const locale = useI18nStore((s) => s.locale);
  // Android: while focused, stop the OS window resize so ONLY this screen's
  // existing JS-driven lift moves content (kills the first-focus jump).
  // Purely additive — does not touch the input-bar lift/swallow, liftSV/
  // panelSlide, MediaPanel slide, or message-bubble gestures. No-op on iOS.
  useChatKeyboardMode();
  // Native iOS-26 liquid glass for the chat chrome (header / search / scroll
  // button). iOS-only and gated on the user toggle; false everywhere else, so
  // all the fallback paths below render exactly as before. Read once, reused.
  const glassActive = useLiquidGlassActive();
  const { id, participantId: paramParticipantId } = useLocalSearchParams<{ id: string; participantId?: string }>();
  // ── Canonical conversation id (peers-on-different-channels fix) ────────
  // The route `id` is EITHER a real conversation id (messages-list
  // navigation, which also passes `participantId`) OR a peer USER id
  // (profile navigation, which passes only `id`). We must resolve it to the
  // canonical conversation id BEFORE subscribing to Ably so both peers
  // converge on `chat:<convId>` from the first frame — otherwise A (who
  // opened the chat from B's profile) subscribes to `chat:<B-userId>` while
  // B (who opened from their messages list) subscribes to `chat:<convId>`,
  // and live messages exchanged between two open screens never meet.
  //
  // `conversationId` defaults to the route id and updates once the
  // idempotent create-or-get (`POST /v1/conversations`) returns. The whole
  // message-data pipeline keys off it (selector, optimistic sends,
  // persistence, realtime channel + publishes), while `participantId` (the
  // OTHER user's id) stays separate for display + notification routing.
  const [conversationId, setConversationId] = useState<string>(() => id || '');
  // Float this chat to the top of the messages list when opened. We stamp the
  // open time in the persisted chat-settings store (kept separate from the
  // conversation's lastMessageAt so a sync can't clobber it); the messages
  // list sorts by max(lastMessageAt, openedAt). Stamps on mount (route id) and
  // again once the canonical conversationId resolves (profile-entry path), so
  // whichever id the list row uses gets bumped.
  //
  // Deferred past the navigation transition. `markChatOpened` writes
  // `openedAt[conversationId]` into the persisted chat-settings store, and the
  // STILL-MOUNTED (tabs)/messages tab subscribes to `openedAt` (it's a
  // dependency of the conversation-list `filtered`/sort memo). Firing this
  // synchronously on chat mount re-filtered + re-sorted the whole conversation
  // list, re-rendered its FlatList and ran the MMKV persist write — all on the
  // chat-open slide-in frame, which is the dominant `LONG ~150 ms @
  // (tabs)/messages` the perf monitor flagged on every chat open. Pushing it
  // behind `runAfterInteractions` lands the bump (and the resulting list
  // re-sort) one beat AFTER the transition completes — imperceptible to the
  // user, the chat still floats to the top exactly as before, and it matches
  // the deferral chat/ai.tsx + chat/music.tsx already apply to their
  // `markOpened` writes for the same reason.
  useEffect(() => {
    if (!conversationId) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      try { useChatSettingsStore.getState().markChatOpened(conversationId); } catch {}
    });
    return () => handle.cancel();
  }, [conversationId]);

  // ── Tell the push handler this chat is on screen ──────────────────────────
  //
  // So a message for THIS conversation does not raise a banner the user does not need — it is
  // already arriving over Ably and rendering in the transcript. Other chats still notify.
  //
  // BOTH ids are registered because they can differ: the route id is a peer USER id when the
  // chat was opened from a profile, while the push always carries the canonical
  // `conversation_id`. Registering only one would leave banners firing for the conversation
  // the user is literally looking at, until the async resolve landed.
  //
  // Re-registers on foreground because the root drops the register on background (a push that
  // arrives while the app is away must always be shown).
  useEffect(() => {
    if (!conversationId && !id) return;
    // The route id and the resolved conversation id, which differ when the chat was opened
    // from a profile. NOT the peer's user id: a push carries `conversation_id`, never a user
    // id, so registering the peer's id could only ever produce a false match.
    const ids = [conversationId, id];
    setActiveThread('chat', ids);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setActiveThread('chat', ids);
    });
    return () => {
      try { sub.remove(); } catch {}
      clearActiveThread('chat', ids);
    };
  }, [conversationId, id]);
  // Mount-time marker — captures how long the chat screen took to commit
  // its first render so the perf-monitor panel can attribute open-the-chat
  // freezes. Reads `Date.now()` once at first render via useRef so the
  // measurement starts at the start of the render, not at commit time.
  // Skipped at the call site when the monitor is off.
  const mountStart = useRef(Date.now()).current;
  const perfEnabled = useSettingsStore((s) => s.perfMonitorEnabled);
  useEffect(() => {
    if (!perfEnabled) return;
    perfMonitor.markScreenMount('chat/[id]', Date.now() - mountStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfEnabled]);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  // Long-press menu opener — see useContextMenuGuard for the rate-limit/raf
  // semantics that prevent rapid long-press storms from freezing the JS thread.
  const { target: actionMessage, open: openMenu, close: closeMenu } = useContextMenuGuard<ChatMessage>({ lockMs: 500, closeLockMs: 350 });

  // Long-pressing a message should dismiss the keyboard so the slide-up
  // action menu doesn't end up half-covered by it. iOS's
  // `keyboardDismissMode="interactive"` only handles the drag gesture, not
  // a programmatic open of an overlay, so we wrap the open with an
  // explicit dismiss here.
  const onMessageLongPress = useCallback(
    (m: ChatMessage) => {
      Keyboard.dismiss();
      openMenu(m);
    },
    [openMenu],
  );

  // ── Press-drag-release coordination (all UI-thread) ────────────────────
  // Created once and shared with BOTH the message bubbles' LongPress gesture
  // (writes finger Y + hovered row) and the MessageContextMenu (writes the
  // measured row hit-zones, reads hovered row to highlight). Stable identities,
  // so passing them through memoized bubbles never breaks memoization.
  const dragActiveSV = useSharedValue(false);
  const dragFingerYSV = useSharedValue(-1);
  const hoveredActionSV = useSharedValue('');
  const actionZonesSV = useSharedValue<ActionZone[]>([]);
  // Imperative handle to replay the menu's slide-down when a drag fires an action.
  const menuRef = useRef<MessageContextMenuHandle>(null);
  // Emoji "dissolve" burst overlay + the per-message window rect captured on
  // long-press (so a delete can spawn the burst exactly where the bubble was).
  const burstRef = useRef<EmojiBurstHandle>(null);
  const deleteRectsRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());
  const stashBubbleRect = useCallback((id: string, x: number, y: number, w: number, h: number) => {
    const map = deleteRectsRef.current;
    map.set(id, { x, y, w, h });
    // Bound the map — only the most-recently long-pressed bubbles matter.
    if (map.size > 12) {
      const firstKey = map.keys().next().value;
      if (firstKey !== undefined) map.delete(firstKey);
    }
  }, []);
  const [pendingImages, setPendingImages] = useState<string[]>([]);  const [uploading, setUploading] = useState(false);

  // Defer the ChatBackgroundLayer mount past the navigation slide-in. When a
  // user has set a custom chat wallpaper, the layer mounts a CachedImage that
  // synchronously decodes a full-bleed bitmap on the open-chat frame — that
  // landed on the same RAF as the slide-in transition and contributed to the
  // ~120 ms long task users were seeing the moment they tapped a conversation.
  // Showing a flat bgColor for the first ~300 ms is identical to what users
  // see with no wallpaper set, so the visual delta is imperceptible.
  const [chromeReady, setChromeReady] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setChromeReady(true));
    return () => handle.cancel();
  }, []);
  // Defer the message-list mount by exactly ONE FRAME.
  //
  // Mounting the list plus its first batch of heavy bubbles (each carries
  // gestures and several Reanimated layers) in the same commit as the screen's
  // chrome is a ~150-190 ms JS task, so it must not be on the first commit.
  //
  // It used to be deferred with `InteractionManager.runAfterInteractions`, and
  // that is what produced "I open a chat, there are no messages, then bam, they
  // appear — as if they reload every time". `runAfterInteractions` does not mean
  // "next frame": it waits for every registered interaction handle to clear, so
  // with any JS-driven `Animated` timing or pan responder in flight the scrollback
  // could stay unmounted for hundreds of milliseconds — long enough to read as an
  // empty chat that then re-populates.
  //
  // A single `requestAnimationFrame` keeps the ONLY property that mattered — the
  // heavy mount is not in the first commit — while bounding the blank window to
  // one frame, which is imperceptible. It is also safe for the transition itself:
  // this is expo-router's native stack, so the push animation runs on the UI
  // thread in UIKit and is not affected by JS work at all. The remaining
  // decode-heavy part (real images instead of sized placeholders) is still gated
  // separately by `imagesReady` below.
  // ── THE GATE IS GONE — it was the "flash" ───────────────────────────────────
  //
  // `listReady` held the FlashList back for one `requestAnimationFrame` and rendered a blank
  // `View` in its place. The note above argues one frame is imperceptible. It is not, and the
  // reason is what happens on the frame AFTER: the list mounts with a full window of rows in
  // a single commit, straight after a frame that was empty. Blank → fully populated in two
  // consecutive frames is exactly the "content loads with some kind of flash" report, and it
  // is worse than the thing the gate was protecting against.
  //
  // The gate's stated purpose — keeping the heavy mount off the first commit — is already
  // served by `imagesReady`, which is the gate that matters: it is the image DECODES, not the
  // text layout, that cost real time. Text-only bubbles are cheap enough to mount on the open
  // commit, and mounting them there means the first frame the user sees already has content.
  //
  // If a measurement ever shows the text-only mount is itself too heavy, the fix is a
  // skeleton in place of the blank View — never a blank frame.
  const listReady = true;

  // ── Telegram-style deferred image decode (open-frame protection) ───────
  // On open, message bubbles render TEXT + correctly-sized placeholder boxes
  // only — no `CachedImage`, so the navigation transition frame never fires a
  // burst of concurrent image decodes (the i.ytimg / r2.dev / giphy / file
  // cluster the perf snapshot caught landing right after `NAV chat/[id]`).
  // Once the open transition has settled we flip `imagesReady`, and the
  // mounted bubbles swap their placeholders for the real images a beat later —
  // off the critical frame. The extra RAF after `runAfterInteractions`
  // guarantees the first text-only layout has committed before we mount the
  // decode-heavy images, so the work can never share the transition frame.
  const [imagesReady, setImagesReady] = useState(false);
  useEffect(() => {
    let raf = 0;
    const handle = InteractionManager.runAfterInteractions(() => {
      raf = requestAnimationFrame(() => setImagesReady(true));
    });
    return () => { handle.cancel(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  const [viewerImages, setViewerImages] = useState<{ images: string[]; index: number } | null>(null);
  // ── Inline emoji / GIF panels ─────────────────────────────────────────────
  // `emojiOpen` / `gifOpen` drive the two docked panels (mutually exclusive),
  // and the composer's GIF↔keyboard icon swap. `keepLifted` keeps the input bar
  // lifted while the keyboard rises BACK after a panel closes, so the bar never
  // drops to the bottom and snaps up. The panel height tracks the last real
  // keyboard height (captured below). Both panels share the SAME lift mechanism.
  const [panelTab, setPanelTab] = useState<'emoji' | 'gif' | null>(null);
  // Derived booleans so all existing references keep working unchanged.
  const emojiOpen = panelTab === 'emoji';
  const gifOpen = panelTab === 'gif';
  const [recentEmoji, setRecentEmoji] = useState<string[]>(() => getRecentEmoji());
  const [recentGif, setRecentGif] = useState<GiphyItem[]>(() => getRecentGif());
  const [keepLifted, setKeepLifted] = useState(false);
  const [emojiPanelHeight, setEmojiPanelHeight] = useState(300);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [searchActiveIdx, setSearchActiveIdx] = useState(0);
  // Individual selectors — destructuring `useChatStore()` subscribes to the
  // whole store and re-renders this (already heavy) chat on any unrelated
  // store change. Selecting each field independently keeps re-renders tied
  // to the data this screen actually reads.
  // Narrow the messages selector to ONLY this chat's array — the previous
  // `s.messages` selector exposed the whole `chatId -> messages[]` map, so
  // every unrelated chat's background sync re-rendered this entire screen
  // (including its 5–8 mounted bubbles). Subscribing to the slice for `id`
  // means a background sync to another chat becomes a no-op for this screen.
  const myStoreMessages = useChatStore((s) => (conversationId ? s.messages[conversationId] : undefined));
  const setMessages = useChatStore((s) => s.setMessages);
  const addMessage = useChatStore((s) => s.addMessage);
  // The REAL uuid of the logged-in account. Message ownership (which side a
  // bubble sits on, whether the action menu shows "edit/delete") is computed
  // at RENDER time against this — never from a value baked into the message at
  // receive time. This is what makes a single device with several accounts
  // render the same conversation correctly after switching accounts: the
  // messages keep their real `senderId` (the author's uuid) and only the
  // comparison target (`currentUserId`) changes per account.
  const currentUserId = useAuthStore((s) => s.user?.id);
  const flatListRef = useRef<FlashListRef<ChatMessage>>(null);
  const inputRef = useRef<ChatInputBarHandle>(null);
  // Retry counter shared by every programmatic scroll-to-index path (reply
  // jump + search jump). `onScrollToIndexFailed` backs off with an increasing
  // delay using this, and each jump resets it to 0 before issuing the scroll.
  const jumpAttemptRef = useRef(0);

  const { progress, height: keyboardHeight } = useReanimatedKeyboardAnimation();

  // Last real keyboard height — captured at the end of each keyboard-open
  // settle (see `useKeyboardHandler.onEnd` below) so the emoji panel can match
  // the exact space the keyboard vacated. Falls back to ~300 if the keyboard
  // never opened in this session.
  const lastKbHeightRef = useRef(0);
  const captureKbHeight = useCallback((h: number) => {
    if (h > 1) lastKbHeightRef.current = h;
  }, []);
  // UI-thread mirrors of the panel state used by the animated styles below.
  // `liftSV` = 1 while the input bar must stay lifted above the panel (panel
  // open OR keyboard re-rising after a close). `emojiPanelSV` carries the
  // panel height so the list shift can match it on the UI thread.
  const liftSV = useSharedValue(0);
  const emojiPanelSV = useSharedValue(300);

  // Memoize the conversation lookup so the linear scan over `mockConversations`
  // doesn't run on every parent render — typing in the input bar (when local
  // state was hoisted) and every keyboard frame would otherwise re-walk this.
  const conversation = useMemo(() => mockConversations.find((c) => c.id === id), [id]);
  const [profileData, setProfileData] = useState<any>(null);

  const entityConversations = useEntityStore((s) => s.conversations);
  const entityConv = useMemo(
    () => entityConversations.find((c) => c.id === id),
    [entityConversations, id],
  );
  const participantId = paramParticipantId || entityConv?.participantId || (conversation as any)?.participantId || id;

  // Synchronously read this chat's cached messages ONCE so the very first render
  // already has content (no blank frame). Memoized per id so it's a single MMKV
  // read, not on every render.
  const seedMessages = useMemo<ChatMessage[]>(() => {
    if (!conversationId) return [];
    // One-shot read at chat-open time. We deliberately use getState() instead
    // of subscribing — the seed only matters for the first render frame, and
    // the live `myStoreMessages` selector below feeds subsequent updates.
    const fromStore = useChatStore.getState().messages[conversationId];
    if (fromStore && fromStore.length > 0) return fromStore as ChatMessage[];
    try {
      // Cheap first-paint path: read the bounded recent-tail cache (only the
      // last ~SEED_CAP messages), NOT the full history blob. This keeps the
      // open-frame parse O(SEED_CAP) regardless of how long the chat is.
      const tail = kvGetJSONSync<ChatMessage[]>(tailKey(conversationId), []);
      if (tail.length > 0) {
        return tail.map((m) => healLegacySender(m, currentUserId, participantId));
      }
      // Fallback (existing chats that predate the tail cache, or the very first
      // open after this change before any write warms the tail): read the full
      // blob ONCE so existing chats still seed with no blank flash. Still bound
      // first paint to the SEED_CAP newest (the cache is oldest→newest, so the
      // tail is newest). The tail key is then warmed off the critical path by
      // hydrateFullHistory, so subsequent opens take the cheap path above. The
      // FULL history is hydrated into the store off the critical path (see the
      // deferred effect below), so scroll-up and reply-jump to older messages
      // still work — we just don't parse/hold all of it on the open frame.
      const cached = kvGetJSONSync<ChatMessage[]>(`chat_messages:${conversationId}`, []);
      if (cached.length > 0) {
        const tailFromFull = cached.length > SEED_CAP ? cached.slice(cached.length - SEED_CAP) : cached;
        return tailFromFull.map((m) => healLegacySender(m, currentUserId, participantId));
      }
      if (mockMessages[conversationId]) return mockMessages[conversationId] as ChatMessage[];
    } catch {}
    return [];
  }, [conversationId, currentUserId, participantId]);

  // Use the store value when present, else the synchronous seed — so the list is
  // never empty on the first frame if a cache exists.
  const storeChat = (myStoreMessages || []) as ChatMessage[];
  const chatMessages = storeChat.length > 0 ? storeChat : seedMessages;

  // Frame budget for this device and power state (see src/utils/renderBudget.ts).
  const chatBudget = useRenderBudget();

  /**
   * Set when `conversationId` changes because the SAME chat got its canonical id
   * (a profile-initiated chat is opened under the peer's user id, and the first
   * send resolves the real conversation row). That is an id MIGRATION, not a
   * different conversation, so nothing about the view should reset.
   *
   * There used to be a render-window reset keyed on this, and getting the migration case
   * wrong collapsed the rendered data from N rows to 30 and back immediately after the
   * user's first message. With the window gone the only thing left to carry across is the
   * hydration flag, so the full history is not re-read and re-healed under the new id.
   */
  const migratedFromRef = useRef<{ from: string; to: string } | null>(null);

  useEffect(() => {
    const migration = migratedFromRef.current;
    if (migration && migration.to === conversationId) {
      migratedFromRef.current = null;
      if (historyHydratedRef.current === migration.from) {
        historyHydratedRef.current = conversationId;
      }
    }
  }, [conversationId]);

  // The monotonic front edge, the id-based window anchor and its lookup cache all used to
  // live here, with a long note about how an append must never splice the oldest rendered
  // row off the front. All of it existed to make a MOVING front edge safe. The front edge is
  // gone (see the note where `windowedMessages` is now defined), so the machinery that
  // protected it is gone with it.

  // ── Lazy full-history hydration ────────────────────────────────────────
  // The open path deliberately holds only the bounded `SEED_CAP` tail (see
  // `seedMessages`) so a very long chat never parses + heals + reverses its
  // ENTIRE history on the navigation frame (the ~571 ms long task). The full
  // history is pulled from cache ON DEMAND the first time the user actually
  // needs it: scrolling toward the top (`onEndReached`), a reply-jump or
  // search-jump that targets a message older than the loaded window, or the
  // first mutation that must be persisted safely. Once hydrated it stays
  // hydrated for the session.
  //
  // `historyHydratedRef` records the conversation whose full history is in the
  // store. `seededArrayRef` records the exact bounded-seed array we pushed, so
  // the persistence effect can tell "untouched seed" (already on disk — skip)
  // from "store diverged" (a real change — hydrate the full array so the
  // mirror can't truncate the older history still on disk).
  const historyHydratedRef = useRef<string | null>(null);
  const seededArrayRef = useRef<ChatMessage[] | null>(null);

  /**
   * How many older messages one scroll-to-top hands to the list.
   *
   * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
   *
   * Reported as: "I open a chat and it feels like the app is dragging everything in, it
   * loads all the messages, then it lags and throws me up and down."
   *
   * That was literally what happened. Reaching the top called `hydrateFullHistory`, which
   * puts the ENTIRE cached conversation — up to `MAX_PERSISTED_MESSAGES` = 1000 rows — into
   * the store in ONE commit. On a long chat that is a ~940-row PREPEND handed to FlashList
   * in a single update.
   *
   * FlashList can compensate a prepend (`applyOffsetCorrection` records the first visible
   * item's layout, re-finds it after the update, and scrolls by the delta), but that is a
   * correction, not free: it has to lay out the new rows to know the delta, and 940 chat
   * bubbles is a large amount of layout to do inside one frame. The visible result is a
   * stall followed by the viewport being dragged — the up-and-down.
   *
   * FlashList's own documentation names the right shape for this. From the `inverted` prop
   * docs: it exists for "chat-like interfaces where the newest content appears at the
   * bottom", and `maintainVisibleContentPosition` is documented as "Configuration for
   * maintaining scroll position when content changes... enabled by default to reduce visible
   * glitches". Both are built around content arriving in the increments a user actually
   * scrolls through, not a whole history at once.
   *
   * So the parse stays a one-off (reading the blob is one JSON parse and it is already
   * deferred off the gesture) but the COMMIT is now bounded: the parsed history lives in a
   * ref, and each trip to the top hands the list the next `OLDER_CHUNK` rows. 60 rows is
   * roughly two screens on a phone, so the user can keep scrolling without ever waiting, and
   * no single commit is large enough to stall.
   *
   * `hydrateFullHistory` is NOT deleted — search and reply-jump genuinely need the whole
   * array in the store, and both are explicit user actions where one beat is acceptable.
   * Scrolling is not, and scrolling is what was calling it.
   */
  const OLDER_CHUNK = 60;

  /**
   * The parsed, healed, tombstone-filtered cache for this conversation — oldest→newest.
   *
   * Parsed at most once per conversation. Held in a ref rather than state because handing
   * chunks to the store is the only thing that should cause a render; having the source array
   * in state would render on parse too, for no visible change.
   */
  const cachedHistoryRef = useRef<{ convId: string; rows: ChatMessage[] } | null>(null);
  /** False once a chunk load finds nothing older left to give. Drives the top loading glow. */
  const moreOlderRef = useRef(true);
  const hydrateFullHistory = useCallback((): ChatMessage[] | null => {
    if (!conversationId) return null;
    if (historyHydratedRef.current === conversationId) return null;
    let full: ChatMessage[];
    try {
      full = kvGetJSONSync<ChatMessage[]>(`chat_messages:${conversationId}`, []);
    } catch {
      return null;
    }
    historyHydratedRef.current = conversationId;
    if (full.length === 0) return null;
    let healed = full.map((m) => healLegacySender(m, currentUserId, participantId));
    // Merge any in-store messages the cache doesn't have yet (optimistic
    // sends / realtime appends / edits that happened since open) so hydration
    // never DROPS them: existing ids are overwritten in place (keep the latest
    // edit), unknown ids are appended (they're always newer → correct order on
    // an oldest→newest array).
    const store = useChatStore.getState().messages[conversationId] || [];
    if (store.length > 0) {
      const idx = new Map(healed.map((m, i) => [m.id, i] as const));
      for (const sm of store as ChatMessage[]) {
        const at = idx.get(sm.id);
        if (at === undefined) { healed.push(sm); idx.set(sm.id, healed.length - 1); }
        else { healed[at] = sm; }
      }
    }
    // Deleted messages must not come back out of the cache either. The delete path hydrates
    // before it filters, so the blob it writes is already clean — but a delete that races a
    // hydration in flight, or a peer delete that arrived while the full history was being
    // read, would otherwise reintroduce the row from disk. Same-reference on the common path.
    healed = filterTombstoned(conversationId, healed) as ChatMessage[];
    setMessages(conversationId, healed as any);
    // Warm the bounded recent-tail cache off the critical path so a chat that
    // predates this cache (or was just opened the first time) takes the cheap
    // tail path on its NEXT open instead of re-parsing the full blob. Runs once
    // per conversation (guarded by historyHydratedRef above).
    writeTailCache(conversationId, healed);
    return healed;
  }, [conversationId, currentUserId, participantId, setMessages]);
  // Always-current ref so handlers living in long-lived subscription effects
  // (e.g. the Ably `msg.delete` listener) can invoke the latest hydrator
  // without being added to those effects' dep arrays (which would churn the
  // channel subscription).
  const hydrateFullHistoryRef = useRef(hydrateFullHistory);
  hydrateFullHistoryRef.current = hydrateFullHistory;

  /**
   * Read (once) and cache the full on-disk history for this conversation.
   *
   * Same read, heal and tombstone-filter as `hydrateFullHistory`, minus the store write —
   * this only fills `cachedHistoryRef` so chunks can be served from it.
   */
  const ensureCachedHistory = useCallback((): ChatMessage[] => {
    if (!conversationId) return [];
    const held = cachedHistoryRef.current;
    if (held && held.convId === conversationId) return held.rows;
    let full: ChatMessage[] = [];
    try {
      full = kvGetJSONSync<ChatMessage[]>(`chat_messages:${conversationId}`, []);
    } catch {
      full = [];
    }
    const healed = full.map((m) => healLegacySender(m, currentUserId, participantId));
    const rows = filterTombstoned(conversationId, healed) as ChatMessage[];
    cachedHistoryRef.current = { convId: conversationId, rows };
    return rows;
  }, [conversationId, currentUserId, participantId]);

  /**
   * Prepend the next `OLDER_CHUNK` older messages from the cached history.
   *
   * Selection is by ID, walking the cached array from newest to oldest and taking rows the
   * store does not already hold under either identity. Deliberately not `slice` by count:
   * the store is not guaranteed to be the exact tail of the cache — realtime arrivals and
   * optimistic sends land in the store without being on disk yet — so counting would skip or
   * duplicate rows at the boundary. Walking by id is correct regardless of how the two
   * diverge.
   *
   * Returns true when it added something, so the caller can tell "more to come" from
   * "that was everything".
   */
  const loadOlderChunk = useCallback((): boolean => {
    if (!conversationId) return false;
    const rows = ensureCachedHistory();
    if (rows.length === 0) { moreOlderRef.current = false; return false; }
    const store = (useChatStore.getState().messages[conversationId] || []) as ChatMessage[];
    const known = new Set<string>();
    for (const m of store) {
      if (m?.id) known.add(m.id);
      if (m?.serverId) known.add(m.serverId);
    }
    const chunk: ChatMessage[] = [];
    for (let i = rows.length - 1; i >= 0 && chunk.length < OLDER_CHUNK; i--) {
      const row = rows[i];
      if (!row?.id) continue;
      if (known.has(row.id) || (row.serverId && known.has(row.serverId))) continue;
      chunk.push(row);
    }
    if (chunk.length === 0) { moreOlderRef.current = false; return false; }
    // Collected newest-first while walking backwards; the array is oldest→newest.
    chunk.reverse();
    // Whether anything remains is answered by the NEXT call rather than guessed here — a
    // count comparison would be wrong for the same reason slicing would be.
    moreOlderRef.current = chunk.length === OLDER_CHUNK;
    setMessages(conversationId, [...chunk, ...store] as any);
    return true;
  }, [conversationId, ensureCachedHistory, setMessages]);
  const loadOlderChunkRef = useRef(loadOlderChunk);
  loadOlderChunkRef.current = loadOlderChunk;

  // ── Post-open: hydrate the STORE, do NOT expand the render window ──────────
  //
  // This effect used to also do `setRenderWindow(Math.max(cur, total))`, i.e. one tick after
  // the open transition it expanded the rendered data from the 30-row window to the ENTIRE
  // conversation. That is the cause of the reported "I scroll a bit, then BAM, I'm at the
  // very top and every message appears at once".
  //
  // WHY IT LOOKS LIKE A TELEPORT
  //   `windowedMessages` is `chatMessages.slice(windowStart)`. On open the seed is ~60
  //   messages and the window is 30, so the list renders 30 rows. This effect then hydrates
  //   the full blob (up to `MAX_PERSISTED_MESSAGES` = 1000) AND set the window to 1000, so in
  //   ONE commit the data went from 30 rows to 1000 and `windowStart` collapsed to 0.
  //
  //   `maintainVisibleContentPosition` can absorb a prepend. It cannot absorb the data array
  //   growing 33× in a single commit while `startRenderingFromBottom` re-anchors — the
  //   content height above the viewport changes by thousands of points at once. The user is
  //   thrown to one end, and because every row materialises on that same commit it reads as
  //   "the messages were not there, then they all appeared".
  //
  //   It also fired unconditionally a beat after EVERY open, so it hit users who had already
  //   started scrolling — which is exactly when it is most violent.
  //
  // WHY THE EXPANSION WAS ADDED, AND WHY THAT REASONING WAS BACKWARDS
  //   The comment it replaced said the expansion removed `onStartReached`-driven prepends,
  //   which "yanked the view down when the user scrolled up fast". Those prepends are 30 rows
  //   — one `WINDOW_CHUNK` — and mvcp handles that. Trading a bounded, user-initiated,
  //   30-row prepend for an unbounded 970-row one that fires on its own is strictly worse.
  //
  // ── AND THE HYDRATION ITSELF IS NOW LAZY TOO ──────────────────────────────
  //
  // There was an effect here that called `hydrateFullHistory()` behind
  // `runAfterInteractions` on every open, described as "invisible" because growing
  // `chatMessages` does not change what is rendered. Invisible in LAYOUT terms, yes. Not
  // free, and it is the "the chat opens heavily, with micro-freezes" report:
  //
  //   `hydrateFullHistory` reads up to MAX_PERSISTED_MESSAGES (1000) out of MMKV, JSON-parses
  //   them, maps every one through `healLegacySender`, merges the result against the store
  //   and re-serialises the tail cache. All synchronous, all on the JS thread. `runAfterInteractions`
  //   only decides WHICH frame pays for it -- it still lands a few hundred milliseconds after the
  //   chat appears, which is exactly when the user is starting to scroll.
  //
  // And it ran on EVERY open, for every chat, whether or not anything ever needed the full
  // array. That is the definition of unnecessary work: the reason the chat feels heavy even
  // when, as reported, there is very little content in it.
  //
  // Nothing needs it eagerly. Every consumer already hydrates on demand, synchronously, at
  // the point of use:
  //
  //   scroll-up      `onStartReached`            hydrates before growing the window
  //   reply-jump     `scrollToIndex`             hydrates to resolve the target index
  //   search         the search-open effect      hydrates when the field opens
  //   delete         the Ably `msg.delete` path  hydrates via `hydrateFullHistoryRef`
  //   persistence    the mutation effect         hydrates after a real send/edit
  //
  // Durability does not depend on it either: when the history is NOT hydrated, the persist
  // path id-merges the store delta into the full cached array on disk rather than mirroring
  // the store wholesale, so older history is never truncated by a chat that was opened and
  // closed without hydrating.
  //
  // Net effect: opening a chat now costs the bounded `SEED_CAP` tail parse and nothing else.

  // Push the bounded SEED into the store once (after paint) so edits/sends
  // work normally. We deliberately seed ONLY the `SEED_CAP` tail here — NOT
  // the full history — so opening a long chat never parses/heals/holds the
  // whole conversation on (or just after) the navigation frame. The full
  // history is hydrated lazily on demand (scroll-up / reply-jump / search /
  // first persist) via `hydrateFullHistory`. First-paint content is already
  // provided by `seedMessages` (read directly into `chatMessages` above when
  // the store is empty), so this store push is invisible.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId) return;
    if (seededRef.current === conversationId) return;
    seededRef.current = conversationId;
    const handle = InteractionManager.runAfterInteractions(() => {
      if ((useChatStore.getState().messages[conversationId] || []).length === 0) {
        if (seedMessages.length > 0) {
          // Remember the exact seed array reference so the persistence effect
          // can distinguish "untouched seed" (skip — already on disk) from a
          // genuine divergence that must trigger a safe full-history mirror.
          seededArrayRef.current = seedMessages;
          setMessages(conversationId, seedMessages as any);
        }
      }
    });
    return () => handle.cancel();
  }, [conversationId, seedMessages, setMessages]);

  // Narrow the chat-settings subscription to only the two slices this chat
  // actually reads — global defaults and this chat's own overrides. The
  // previous selector (`s => s.settings`) returned the entire chatId→settings
  // map, which meant any other chat's settings change re-rendered THIS chat
  // (and its 5 mounted message bubbles). Two atomic selectors with shallow
  // equality keep references stable across unrelated updates.
  const globalSettings = useChatSettingsStore((s) => s.settings[GLOBAL_CHAT_SETTINGS_KEY]);
  const specificSettings = useChatSettingsStore((s) => s.settings[id || '']);
  const chatSettings = useMemo(() => {
    return { ...DEFAULT_CHAT_SETTINGS, ...globalSettings, ...specificSettings };
  }, [globalSettings, specificSettings]);

  // Outgoing-message style: a user-chosen solid/gradient + opacity (app-wide)
  // or the theme accent when unset (default). Memoized into stable arrays so
  // MemoMessageBubble re-renders only when the style actually changes.
  const chatBubble = useSettingsStore((s) => s.chatBubble);
  const chatBubbleIn = useSettingsStore((s) => s.chatBubbleIn);
  const bubbleColors = useMemo<string[]>(
    () => (chatBubble && chatBubble.colors.length > 0 ? chatBubble.colors : [theme.colors.accent.primary]),
    [chatBubble, theme.colors.accent.primary],
  );
  const bubbleOpacity = chatBubble?.opacity ?? 1;
  const bubbleTextColor = chatBubble && chatBubble.colors.length > 0 ? readableTextOn(chatBubble.colors) : '#FFFFFF';
  const bubbleColorsKey = bubbleColors.join(',');
  // Incoming side: empty array = neutral default surface (no custom color).
  const inColors = useMemo<string[]>(
    () => (chatBubbleIn && chatBubbleIn.colors.length > 0 ? chatBubbleIn.colors : []),
    [chatBubbleIn],
  );
  const inOpacity = chatBubbleIn?.opacity ?? 1;
  const inTextColor = inColors.length > 0 ? readableTextOn(inColors) : theme.colors.text.primary;
  const inColorsKey = inColors.join(',');

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  // `8` extra: the chat header carries the back pill plus the peer's name, and the ramp was
  // finishing level with the pill rather than a little past it. Both the gradient AND the
  // transcript's top spacer move together — see `headerScrimHeights`.
  const { content: headerContentHeight, gradient: headerGradientHeight } = headerScrimHeights(insets.top, 8);
  const inputBarBottomPad = Math.max(insets.bottom, 12);

  // Gradient backdrop is now rendered as a STATIC absolute-positioned
  // element pinned to the bottom of the screen (see the JSX further down)
  // — it no longer rides up with the keyboard. Removing the
  // keyboard-driven opacity animation here means the fade always reads as
  // a fixed chrome element behind the input bar; previously it was
  // wrapped in a `KeyboardStickyView` and faded out as the keyboard rose,
  // which felt like the gradient was "sticking" to the input bar.

  // Input row bottom padding: safe-area when keyboard closed → small gap when open (UI thread)
  const inputRowStyle = useAnimatedStyle(() => {
    const base = interpolate(progress.value, [0, 1], [inputBarBottomPad, 8], Extrapolation.CLAMP);
    // While the emoji panel holds the bar lifted (keyboard down), keep the
    // small open-state padding so the bar doesn't gain the safe-area padding
    // back and visually shift. Purely additive — no effect when liftSV === 0.
    return { paddingBottom: liftSV.value > 0.5 ? 8 : base };
  });

  // Compensate the KeyboardStickyView's `offset.opened` for the bottom-
  // docked browser widget. When the band is active it lives INSIDE the
  // root flex column as a 56-px-tall sibling of the Stack wrapper, which
  // squeezes every screen (including this chat) so its bottom edge is
  // 56 px above the actual screen bottom. The chat input sticks to the
  // chat-screen bottom, and KSV translates the sticky surface upward by
  // the keyboard height when the keyboard appears — but because the
  // chat screen is already 56 px above the screen bottom, the input
  // ends up 56 px ABOVE the keyboard top instead of right on it. The
  // user perceives this as an unexpectedly large gap between the input
  // bar and the keyboard whenever a browser widget is docked at the
  // bottom. Adding `BAND_HEIGHT` to KSV's `translateY` when the
  // keyboard is open pushes the input back down into the band's
  // overlapped region (the keyboard hides the band anyway), so the
  // input lands flush against the keyboard top in both states.
  const minimizedUrl = useBrowserStore((s) => s.minimizedUrl);
  const browserWidgetPosition = useEffectiveBrowserWidgetPosition();
  const stickyOpenedOffset = !!minimizedUrl && browserWidgetPosition === 'bottom' ? 56 : 0;

  // ── Input-bar lift: robust max() of keyboard height and panel height ──
  // The bar's distance from the screen bottom = max(liveKeyboardHeight,
  // panelLiftHeight). Because it's a MAX of the two, the bar position is
  // MONOTONIC across the keyboard↔panel handoff — it can never dip and snap
  // back, which is exactly the "jump to the top / settle" the spacer approach
  // suffered from (that relied on two animations cancelling frame-for-frame).
  //   • Typing:        kb≈300, panelLift=0      → lift=300 (sits on keyboard)
  //   • Open emoji:    kb 300→0, panelLift=300  → lift stays 300 (no move)
  //   • Back to kb:    kb 0→300, panelLift=300  → lift stays 300 (no move)
  // `keyboardHeight` from useReanimatedKeyboardAnimation animates smoothly on
  // the UI thread (same source KeyboardStickyView used), so the follow is just
  // as smooth — we simply read it ourselves to fold in the max().
  const barWrapStyle = useAnimatedStyle(() => {
    const raw = keyboardHeight.value;
    const kb = raw < 0 ? -raw : raw; // library reports height as 0 → -kbHeight
    const panelLift = liftSV.value * emojiPanelSV.value;
    const lift = Math.max(kb, panelLift);
    // Browser-band compensation: historically the sticky view pushed the bar
    // DOWN by the band height while the keyboard was open (the chat screen
    // bottom sits `band` px above the real screen bottom). Preserve that.
    const band = kb > 1 ? stickyOpenedOffset : 0;
    return { transform: [{ translateY: -(lift - band) }] };
  });

  // Shift the entire message list upward by exactly the keyboard height when
  // it rises. We drive the translation from `useKeyboardHandler.onMove`
  // — the same lowest-level event source `KeyboardStickyView` uses for the
  // input bar — so the list lifts in lock-step with the input bar instead
  // of occasionally desyncing into a snap when the JS thread is briefly
  // busy on the first chat open. `e.height` is the live keyboard height in
  // pixels, fed to translateY as a negative offset.
  //
  // `onInteractive` mirrors the same height during an iOS interactive
  // dismiss gesture (when the user drags the keyboard down with a finger):
  // without it the list stayed pinned at the keyboard-up position while
  // the input bar followed the finger, leaving a phantom strip where the
  // last message used to sit. Now both follow the finger together.
  const listShiftY = useSharedValue(0);
  useKeyboardHandler(
    {
      onMove: (e) => {
        'worklet';
        listShiftY.value = -e.height;
      },
      onInteractive: (e) => {
        'worklet';
        listShiftY.value = -e.height;
      },
      onEnd: (e) => {
        'worklet';
        listShiftY.value = -e.height;
        // Capture the settled keyboard height (once per transition) so the
        // emoji panel can match it. Guarded to ignore the close (height 0).
        runOnJS(captureKbHeight)(e.height);
      },
    },
    [],
  );
  const listShiftStyle = useAnimatedStyle(() => ({
    // While the emoji panel is up (or the keyboard is rising back after a
    // close), shift the list by the panel height instead of the live keyboard
    // height so the newest messages stay visible above the panel. We blend the
    // two with min() (both are ≤ 0) so the list rises in lock-step with the bar
    // during the animated open (keyboard-down case) instead of snapping at a
    // 0.5 threshold. Additive: when liftSV === 0 this is exactly the original
    // keyboard-driven shift.
    transform: [{ translateY: Math.min(listShiftY.value, -liftSV.value * emojiPanelSV.value) }],
  }));

  // Slide the media panel itself up/down in sync with the bar lift. At
  // liftSV === 0 it is pushed fully below the screen (translateY = +panelH);
  // at liftSV === 1 it rests in place (translateY = 0). In the keyboard-down
  // open case liftSV animates 0→1 so the panel rises smoothly with the bar; in
  // the keyboard-up case liftSV is set to 1 instantly so the panel already
  // sits in place and the keyboard's descent reveals it (no double-animation).
  const panelSlideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - liftSV.value) * emojiPanelSV.value }],
  }));

  // List bottom spacer matches the input bar's real height so the newest
  // message keeps a comfortable gap above the input. We deliberately keep
  // this STATIC (no keyboardHeight in the layout) — animating the spacer's
  // height on every keyboard frame caused the FlatList to relayout mid-
  // scroll, which manifested as the content jumping up/down when the user
  // tapped the input field while the list was still in motion. The input
  // bar itself rides KeyboardStickyView, so it always stays above the
  // keyboard regardless of this constant.
  const INPUT_BAR_HEIGHT = 60;
  const LIST_FOOTER_HEIGHT = INPUT_BAR_HEIGHT + inputBarBottomPad + 12;

  // ── Emoji panel control ───────────────────────────────────────────────
  // Visible gap (px) between the input bar and the top of the emoji panel.
  const EMOJI_GAP = 8;

  // Keep the UI-thread lift mirror in sync with the JS panel state.
  // IMPORTANT: when a panel is OPENING, the rise is owned by openEmoji/openGif
  // (they may animate liftSV 0→1 for a smooth rise when the keyboard is down).
  // This effect must NOT clobber that animation by force-setting liftSV = 1.
  // It only (a) re-arms the lift while returning to the keyboard (keepLifted)
  // and (b) animates the lift back down on a full close.
  useEffect(() => {
    if (emojiOpen || gifOpen || keepLifted) {
      if (keepLifted) liftSV.value = 1;
    } else {
      liftSV.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
    }
  }, [emojiOpen, gifOpen, keepLifted, liftSV]);
  // While returning to the keyboard, hold the bar lifted until the keyboard
  // has actually risen — then release the lift with no jump (at that point the
  // sticky view is fully keyboard-driven). Safety timeout in case the show
  // event never fires (e.g. focus race).
  useEffect(() => {
    if (!keepLifted) return;
    const sub = Keyboard.addListener('keyboardDidShow', () => setKeepLifted(false));
    const tid = setTimeout(() => setKeepLifted(false), 650);
    return () => { sub.remove(); clearTimeout(tid); };
  }, [keepLifted]);

  // Open the panel: snapshot the panel height from the last real keyboard
  // height, lift the bar (via stickyOffset/liftSV), then dismiss the keyboard.
  // The keyboard slides down to REVEAL the panel already sitting beneath it.
  const openEmoji = useCallback(() => {
    const h = lastKbHeightRef.current > 0 ? lastKbHeightRef.current : 300;
    emojiPanelSV.value = h;
    setEmojiPanelHeight(h);
    setKeepLifted(false);
    // Mount the panel NOW. While liftSV is still 0 it is parked fully below the
    // screen (panelSlideStyle translateY = +panelH), so the heavy emoji/GIF
    // grid mounts + lays out OFF-SCREEN — the user sees nothing move yet.
    setPanelTab('emoji');
    const kbUp = Math.abs(keyboardHeight.value) > 1;
    if (kbUp) {
      // CRITICAL (keyboard UP): arm the lift mirror SYNCHRONOUSLY so the
      // keyboard's descent REVEALS the panel with zero bar movement (the spacer
      // grows frame-for-frame as `progress` falls 1→0). No translate animation.
      liftSV.value = 1;
      requestAnimationFrame(() => Keyboard.dismiss());
    } else {
      // Keyboard already DOWN: nothing animates the reveal for us. Wait two
      // frames so the panel mount + first layout pass have committed, THEN run
      // the lift on the UI thread. Deferring past the mount keeps the rise a
      // pure compositor transform — no concurrent JS/layout work stalling it
      // (the "freezes then jerks up" jank on weak Android).
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          liftSV.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
        }),
      );
    }
  }, [emojiPanelSV, liftSV, keyboardHeight]);

  // Open the GIF panel — twin of openEmoji. Mutually exclusive with emoji.
  const openGif = useCallback(() => {
    const h = lastKbHeightRef.current > 0 ? lastKbHeightRef.current : 300;
    emojiPanelSV.value = h;
    setEmojiPanelHeight(h);
    setKeepLifted(false);
    setPanelTab('gif');
    const kbUp = Math.abs(keyboardHeight.value) > 1;
    if (kbUp) {
      liftSV.value = 1;
      requestAnimationFrame(() => Keyboard.dismiss());
    } else {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          liftSV.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
        }),
      );
    }
  }, [emojiPanelSV, liftSV, keyboardHeight]);

  // Switch tab WITHOUT touching the keyboard/lift — the panel is already open
  // and the keyboard is already down, so this is a pure horizontal slide.
  const switchPanel = useCallback((tab: 'emoji' | 'gif') => {
    setPanelTab(tab);
  }, []);

  // Return to the keyboard: hide the panel, keep the bar lifted, and focus the
  // field so the keyboard rises back into the same space.
  const closeEmojiToKeyboard = useCallback(() => {
    // Keep the lift armed synchronously so the bar doesn't drop for a frame
    // between hiding the panel and the keyboard rising back.
    liftSV.value = 1;
    setPanelTab(null);
    setKeepLifted(true);
    inputRef.current?.focus();
  }, [liftSV]);

  // Dismiss the panel ENTIRELY (no keyboard) — the panel + bar slide back down.
  // Fired by a tap on the message-list region while a panel is open, mirroring
  // the way a tap outside dismisses the keyboard. The lift mirror effect
  // animates liftSV → 0 (bar + panel descend together) once the state clears.
  const dismissPanel = useCallback(() => {
    setPanelTab(null);
    setKeepLifted(false);
  }, []);

  // Tap-to-dismiss for the media panel that does NOT block scrolling. A Tap
  // gesture is recognised only when the finger stays put — the instant it
  // moves (a scroll), the tap FAILS and the FlatList scroll wins. Enabled only
  // while a panel is open, so normal chat gestures are untouched otherwise.
  // This lets the list scroll freely with the panel open (Telegram-style) and
  // a plain tap on the messages still dismisses the panel.
  const panelDismissTap = useMemo(
    () =>
      Gesture.Tap()
        .enabled(!!panelTab)
        .maxDuration(250)
        .maxDistance(10)
        .onEnd((_e, success) => {
          'worklet';
          if (success) runOnJS(dismissPanel)();
        }),
    [panelTab, dismissPanel],
  );

  // Insert a picked emoji into the composer; panel stays open for multi-pick.
  // Also record it in the recently-used list (shown at the top of the panel).
  const onPickEmoji = useCallback((e: string) => {
    inputRef.current?.insert(e);
    setRecentEmoji(pushRecentEmoji(e));
  }, []);

  // ── Recents hydration (emoji + GIF) ───────────────────────────────────────
  // `recentEmoji`/`recentGif` are seeded ONCE via the useState initializers
  // (`getRecentEmoji()`/`getRecentGif()`), which read synchronously. In the
  // AsyncStorage-fallback path (MMKV native module unavailable) those keys are
  // never warmed into the in-memory mirror — `kvWarm` is called for
  // `chat_messages:*` but NOT for the recents — so that first sync read misses
  // persisted data and recents never reappear after an app restart. Warm the
  // two keys once on mount, then re-read so the lists hydrate. (No-op when MMKV
  // is available — the initializer read already had the data.)
  useEffect(() => {
    let cancelled = false;
    kvWarm(['recent_emoji', 'recent_gif'])
      .then(() => {
        if (cancelled) return;
        setRecentEmoji(getRecentEmoji());
        setRecentGif(getRecentGif());
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Whenever the media panel opens, refresh the recents from storage so the
  // grid always reflects the latest persisted MRU (e.g. GIFs sent earlier this
  // session, or items that hydrated after the initial mount read). Additive —
  // does not touch the lift/slide/switch mechanics.
  useEffect(() => {
    if (!panelTab) return;
    setRecentEmoji(getRecentEmoji());
    setRecentGif(getRecentGif());
  }, [panelTab]);

  // Entering search mode tears down the input bar, so drop any panel state to
  // keep the lift offsets sane.
  useEffect(() => {
    if (searchMode && (emojiOpen || gifOpen || keepLifted)) {
      setPanelTab(null);
      setKeepLifted(false);
    }
  }, [searchMode, emojiOpen, gifOpen, keepLifted]);

  const cachedProfile = useEntityStore((s) => (participantId ? s.profiles[participantId] : undefined));

  useEffect(() => {
    if (conversation) return;
    if (cachedProfile) { setProfileData(cachedProfile); return; }
    if (!participantId) return;
    // Skip the network call when offline so it can't hang and congest the JS thread
    if (!useConnectivityStore.getState().isOnline) return;
    // Defer the profile fetch past the navigation transition — the network
    // request setup (URL build, fetch dispatch, response parse) was landing
    // on the same frame as first paint and contributing to the 60→40 fps
    // drop when opening a chat with no cached profile.
    const handle = InteractionManager.runAfterInteractions(() => {
      // Phase 5: profile fetch goes through the Worker.
      import('../../src/services/apiClient').then(({ apiGet }) =>
        apiGet<any>(`/v1/profiles/${encodeURIComponent(participantId)}`).then(({ data }) => {
          if (data) setProfileData(data);
        }).catch(() => {})
      );
    });
    return () => handle.cancel();
  }, [participantId, conversation, cachedProfile]);

  // Per-account screenshot lock for the CHAT PARTNER. The flag rides along on
  // the partner's profile (cached entity store or the fetched profileData), so
  // there's no polling — we read it once with the profile. When the partner
  // turned screenshots off, protect this chat (Android blocks capture incl.
  // over the long-press message menu; iOS blocks recording + flashes 🙈).
  const partnerScreenshotsOff = !!(
    (cachedProfile as any)?.screenshots_disabled ?? (profileData as any)?.screenshots_disabled
  );
  const { screenshotDetected } = useScreenCaptureGuard(
    partnerScreenshotsOff,
    `chat-${participantId || conversationId}`,
  );

  // Fallback for devices without MMKV: warm the AsyncStorage mirror, then hydrate
  // if the synchronous seed above found nothing.
  useEffect(() => {
    if (!conversationId) return;
    if ((useChatStore.getState().messages[conversationId] || []).length > 0) return;
    // Deferred past the open-chat transition because `kvWarm` (which
    // touches the AsyncStorage MMKV mirror) plus the subsequent
    // `kvGetJSONSync` + `setMessages` cascade was firing on the mount
    // frame and re-rendering the FlatList while the navigation slide-in
    // was still in flight. The synchronous `seedMessages` already covers
    // first-paint when MMKV is available; this effect only matters on
    // devices where MMKV is unavailable and we need the AsyncStorage
    // fallback. One tick of latency is invisible there too.
    const cacheKey = `chat_messages:${conversationId}`;
    const tKey = tailKey(conversationId);
    const handle = InteractionManager.runAfterInteractions(() => {
      kvWarm([tKey, cacheKey]).then(() => {
        // Prefer the bounded tail (small parse); fall back to the full blob if
        // the tail key hasn't been written yet (existing chats).
        let tail = kvGetJSONSync<ChatMessage[]>(tKey, []);
        if (tail.length === 0) {
          const cached = kvGetJSONSync<ChatMessage[]>(cacheKey, []);
          tail = cached.length > SEED_CAP ? cached.slice(cached.length - SEED_CAP) : cached;
        }
        if (tail.length > 0 && (useChatStore.getState().messages[conversationId] || []).length === 0) {
          // Seed only the bounded `SEED_CAP` tail (newest), mirroring the
          // synchronous `seedMessages` path — the full history loads lazily on
          // demand. Record the seed reference for the persistence guard.
          const healedTail = tail.map((m) => healLegacySender(m, currentUserId, participantId));
          seededArrayRef.current = healedTail;
          setMessages(conversationId, healedTail as any);
        } else if (tail.length === 0 && mockMessages[conversationId] && (useChatStore.getState().messages[conversationId] || []).length === 0) {
          setMessages(conversationId, mockMessages[conversationId]);
        }
      }).catch(() => {});
    });
    return () => handle.cancel();
  }, [conversationId]);

  // ── SERVER HISTORY. THIS IS THE DM READ PATH, AND IT DID NOT EXIST. ─────────
  //
  // Reported as: "I send messages, he sends messages, I get the push, I open the chat and
  // it is EMPTY — he does not see mine and I do not see his."
  //
  // Everything above this point reads LOCAL storage only: the chat store, the bounded tail
  // cache, the `chat_messages:<id>` blob. Live messages arrive over Ably. That is the whole
  // read path, and it has a hole big enough to lose every message:
  //
  //   - Ably delivers only while the app is subscribed. `channel.subscribe('msg', ...)` is
  //     issued with NO `rewind`, so anything published while the app was closed, backgrounded
  //     or between token refreshes is never seen by this client. The push notification still
  //     fires, because the Worker fans that out server-side — which is exactly why the push
  //     arrives and the transcript is empty.
  //   - A fresh install has no local cache at all, so its chats start blank and stay blank.
  //     The new Android APK is precisely this case.
  //
  // The data was never lost. `GET /v1/conversations/:id/messages` has existed all along and
  // the Worker persists every message (workers/api/src/routes/messages.ts). Nothing on the
  // client called it:
  //
  //   `syncMessages()` in src/services/syncService.ts did call it — and was never invoked
  //   from anywhere in src/ or app/. It also wrote its result to `KEYS.messages(convId)` via
  //   `cacheMessages`, a key this screen does not read and `getCachedMessages` never reads
  //   back. Dead code writing to a dead key. It has been deleted rather than left as a trap.
  //
  // So: fetch the server's copy on open and merge it in.
  //
  // MERGE RULES, deliberately conservative — this only ever ADDS.
  //   - A message is "already known" if its uuid matches a local `id` OR a local `serverId`.
  //     Both are required: our own optimistic sends live under a local `m-<ts>` id with the
  //     server uuid in `serverId`, so matching on `id` alone would duplicate every message
  //     this device sent.
  //   - Local rows are never overwritten or removed. Pending/failed sends, local-only edits
  //     and anything the server has not caught up on all survive untouched.
  //   - Re-sorted by `createdAt`, which is an ISO-8601 string and therefore sorts correctly
  //     as a string (fixed-width, big-endian, zero-padded) — no Date allocation per compare.
  //
  // All three rules live in `src/utils/mergeHistory.ts`, property-tested, NOT inline here.
  // Group chats will have the identical problem the moment they exist, and a merge that is
  // subtly different per surface is how you get "my messages are duplicated in groups but
  // missing in DMs". See that file for why the comments screen deliberately uses the OPPOSITE
  // policy (server-wins membership) and why the two must not be unified.
  //
  // The write to disk is NOT done here. `setMessages` makes the store diverge from
  // `seededArrayRef`, which the persistence effect below already treats as a real mutation
  // and mirrors into `chat_messages:<id>` plus the tail cache through its coalesced writer.
  //
  // Known follow-up, NOT fixed here because it needs a Worker deploy rather than an OTA: the
  // route is `ORDER BY created_at ASC LIMIT ?`, so it returns the OLDEST N, not the newest.
  // Under 200 messages that is the whole conversation and this is correct; above 200 the
  // recent end would be the part that is missing. The fix is `DESC` + reverse server-side.
  // ── AND IT REPEATS WHILE THE CHAT IS OPEN ───────────────────────────────────
  //
  // The fetch started as open-time only, on the assumption that Ably would carry anything
  // that arrived afterwards. It does not. Reported, with both users sitting in the chat: the
  // peer sends, nothing appears, and the message only shows up after leaving and re-entering
  // — i.e. only when this fetch runs again.
  //
  // Realtime has now survived several rounds of diagnosis (channel names match, the token
  // grants `chat:*` publish+subscribe, the token endpoint answers, the Worker's
  // `user:<peer>:notifications` fan-out and its bridge handler both exist and both feed the
  // same store). Two independent live paths failing together points at the receiver's Ably
  // connection, most likely `/api/ably-token` rejecting the Worker JWT because Vercel's
  // `JWT_SECRET` differs — a fail-closed verifier, exactly the failure
  // `api/admin/auth-fingerprint.ts` was written to diagnose. That is a configuration fact I
  // cannot read from here.
  //
  // So the design changes rather than the diagnosis continuing: CORRECTNESS NO LONGER DEPENDS
  // ON REALTIME. This poll is the floor — messages arrive within one interval no matter what
  // Ably is doing. Realtime, when it works, is what makes them arrive instantly instead.
  // A messenger that loses messages when a socket dies is broken; one that is a few seconds
  // slower without it is merely not optimal.
  //
  // Cost, deliberately bounded:
  //   - only while the app is ACTIVE. Backgrounded delivery is push's job, and polling from
  //     the background is what drains a battery.
  //   - `mergeHistory` returns the same array reference when nothing is new, so an idle poll
  //     costs one request and NO store write, NO re-render, NO disk write.
  //   - the request is one indexed query capped at 200 rows.
  //
  // The obvious follow-up is a `?since=<iso>` parameter so an idle poll transfers nothing at
  // all. That is a Worker change; the same deploy should also fix `ORDER BY created_at ASC
  // LIMIT ?` returning the OLDEST N instead of the newest.
  const HISTORY_POLL_MS = 6000;
  useEffect(() => {
    if (!conversationId) return;
    if (!useConnectivityStore.getState().isOnline) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    // Off the open frame: this is a network round trip plus a store write, and first paint is
    // already served from cache.
    const handle = InteractionManager.runAfterInteractions(() => {
      const runFetch = async () => {
        try {
          const { getMessages } = await import('../../src/lib/supabase');
          const { messages, error } = await getMessages(conversationId, { limit: 200 });
          if (cancelled || error || !Array.isArray(messages) || messages.length === 0) return;

          const remote: ChatMessage[] = (messages as any[])
            .filter((row) => row && String(row.id ?? '').length > 0)
            .map((row) => ({
              id: String(row.id),
              conversationId,
              // The server column is the author's real uuid, which is exactly what
              // `senderId` is contracted to hold — ownership is computed at render time as
              // `senderId === currentUserId`.
              senderId: String(row.sender_id ?? ''),
              text: typeof row.text === 'string' ? row.text : '',
              createdAt: row.created_at || new Date().toISOString(),
              // Anything already on the server and not in our local copy was received while
              // this device was not listening; there is no unread state to reconstruct.
              isRead: true,
              serverId: String(row.id),
            }));

          const local = (useChatStore.getState().messages[conversationId] || []) as ChatMessage[];

          // ── NEVER PREPEND OLDER HISTORY FROM A POLL ─────────────────────────
          //
          // Reported as: open a chat and the messages vanish, come back, and the view is
          // yanked up and then down.
          //
          // The Worker's read is `ORDER BY created_at ASC LIMIT ?` — it returns the OLDEST
          // rows, not the newest. The local seed is the NEWEST 60. So roughly a second after
          // the chat painted, this merge inserted up to 200 messages IN FRONT of everything
          // on screen. FlashList's offset correction then did its job on a 200-row prepend,
          // which is a large, sudden, unrequested scroll — the "teleport".
          //
          // Older history is not this poll's job. It already exists on disk and is hydrated,
          // once, when the user actually scrolls to the top. What the poll is for is catching
          // up on what arrived while this device was not listening, and everything in that
          // category is at or after our oldest loaded message.
          //
          // So: drop remote rows strictly older than the oldest row we hold. Appends and
          // gap-fills still land; surprise prepends cannot. An empty local array (fresh
          // install, first ever open) keeps everything, because there is nothing on screen to
          // yank and that is the case where the server's copy IS the transcript.
          //
          // The server-side half of this belongs in the Worker (`DESC` + reverse, plus a
          // `?since=` filter so an idle poll transfers nothing at all). That needs a Worker
          // deploy; this does not, and it is correct on its own.
          const oldestLocal = local.length > 0 ? local[0].createdAt : null;
          const inRange = oldestLocal ? remote.filter((r) => r.createdAt >= oldestLocal) : remote;

          // Suppress anything the user deleted. Without this the poll re-adds it within six
          // seconds — for the deleter and, because both devices poll, for the peer too.
          const admissible = filterTombstoned(conversationId, inRange) as ChatMessage[];

          const merged = mergeHistory(local, admissible);
          // `mergeHistory` hands back the SAME array reference when nothing was new, so this
          // is the cheap way to skip a store write and the re-render it would cause.
          if (cancelled || merged === local) return;
          setMessages(conversationId, merged as any);

          // ── THE CHAT LIST HAS TO LEARN ABOUT IT TOO ─────────────────────────
          //
          // Reported: the message shows up in the transcript but the conversations list still
          // shows the old preview. Two different stores hold the two views — `chatStore`
          // holds transcripts, `entityStore.conversations` holds the rows with their preview
          // text and timestamp — and this fetch was only writing the first one.
          //
          // Realtime hid the gap: the Worker's `user:<peer>:notifications` fan-out is handled
          // by `RealtimeAccountBridge`, which updates BOTH. With realtime down, the poll was
          // the only thing running and it only did half the job.
          const newest = merged[merged.length - 1];
          if (newest) {
            const store = useEntityStore.getState();
            const rows = store.conversations || [];
            const idx = rows.findIndex((c: any) => c.id === conversationId);
            if (idx >= 0) {
              const row: any = rows[idx];
              // Only write when the preview actually moved on. An unconditional write would
              // re-render the whole list on every poll tick, which is exactly the kind of
              // idle cost the `merged === local` bail-out above exists to avoid.
              if (row.lastMessage !== newest.text || row.lastMessageAt !== newest.createdAt) {
                const next = rows.slice();
                next[idx] = { ...row, lastMessage: newest.text, lastMessageAt: newest.createdAt };
                store.setConversations(next);
              }
            }
          }
        } catch {
          // Offline, 403 (opened under a peer user id before the conversation row exists),
          // or a transport failure. The cached transcript stays on screen either way.
        }
      };

      void runFetch();
      timer = setInterval(() => {
        if (cancelled) return;
        // Foreground only — see the cost note above.
        if (AppState.currentState !== 'active') return;
        if (!useConnectivityStore.getState().isOnline) return;
        void runFetch();
      }, HISTORY_POLL_MS);
    });
    return () => {
      cancelled = true;
      handle.cancel();
      if (timer) clearInterval(timer);
    };
  }, [conversationId, setMessages]);

  // Persist messages to KV cache whenever THIS chat's messages change.
  // `myStoreMessages` (above) already narrows the subscription to this chat,
  // so the array reference is stable across other chats' background syncs.
  const myMessages = myStoreMessages;

  // Warm the image cache for the most recent messages so they appear instantly
  // (no black flash) when the chat opens — Telegram-style. Deferred past the
  // navigation transition: the dynamic `import('CachedImage')` + Image.prefetch
  // dispatch was landing on the same frame as the FlatList's initial bubble
  // mount and was a measurable contributor to the open-the-chat fps drop.
  //
  // Two deliberate bounds keep this off the open-frame critical path:
  //   • Only the few MOST-RECENT messages (`WARM_RECENT`) are warmed. The old
  //     `slice(-20)` front-loaded up to 20 fetches the instant the chat
  //     opened; the user only ever sees the last handful first, so warming 6
  //     covers the first screen and the rest stream in lazily on scroll.
  //   • Animated GIFs are EXCLUDED. GIFs are the heaviest decodes and warming
  //     them (even disk-only) wastes the budget on content that should only
  //     ever decode when actually visible. They load on render via the normal
  //     `autoplay={isVisible}` path.
  //   • Warm policy is `'disk'` (network round-trip only, NO decode) so the
  //     warm never kicks off an off-screen decode storm — the decode happens
  //     lazily when a visible bubble mounts the real `CachedImage`.
  useEffect(() => {
    if (!myMessages || myMessages.length === 0) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      const recent = myMessages.slice(-WARM_RECENT);
      const uris: string[] = [];
      for (const m of recent) {
        if ((m as any).imageUrls) for (const u of (m as any).imageUrls) {
          if (isAnimatedImageUrl(u)) continue; // skip GIFs — decode on render
          uris.push(u);
        }
      }
      if (uris.length) {
        import('../../src/components/ui/CachedImage')
          .then(({ prefetchImages }) => prefetchImages(uris, CHAT_IMG_MAX_W, 'disk'))
          .catch(() => {});
      }
    });
    return () => handle.cancel();
  }, [conversationId]);

  // Persist messages to KV cache whenever THIS chat's messages change.
  // CRITICAL: the store now holds only the bounded SEED on open (full history
  // loads lazily), so a naive `kvSetJSON(store)` would TRUNCATE the older
  // history still on disk. Guarded:
  //   • Full history hydrated → the store IS the complete authoritative array
  //     → safe to mirror wholesale.
  //   • Store is still the untouched seed we pushed (reference-equal) → those
  //     messages are already on disk → nothing to persist.
  //   • Store diverged from the seed (a send / edit / delete) → hydrate the
  //     full history FIRST (it MERGES the divergent store in), so the resulting
  //     store change re-runs this effect on the hydrated branch and mirrors the
  //     COMPLETE array. Deferred so it never blocks the input frame. With no
  //     cached history (brand-new chat) the store is the whole truth → write it.
  useEffect(() => {
    if (!conversationId) return;
    if (!myMessages || myMessages.length === 0) return;

    // A still-pending write for a PREVIOUS conversation must land before we
    // start coalescing writes for this one (never drop a write on chat switch).
    if (pendingPersistConv && pendingPersistConv !== conversationId) runPendingPersist();
    // This effect also tears down on a mere `myMessages` re-render; a re-run
    // for the (same) conversation cancels any deferred teardown flush so the
    // debounce keeps coalescing the burst.
    persistTeardownPending = false;

    const convId = conversationId;
    const snapshot = myMessages;

    // Shared durability wiring: flush the pending coalesced write immediately
    // when the app is backgrounded (covers an app kill within the debounce
    // window) and on a real teardown (unmount / conversation change). The
    // teardown flush is deferred one microtask so a same-conversation re-render
    // — which tears the effect down too — can cancel it (preserving coalescing);
    // a TRUE teardown has no such re-run, so the write flushes promptly. Even
    // absent any flush, the module-level debounce timer outlives the component
    // and still lands the write, so nothing is lost.
    const wireDurability = (handle?: { cancel: () => void }) => {
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'background' || s === 'inactive') runPendingPersist();
      });
      return () => {
        sub.remove();
        handle?.cancel();
        persistTeardownPending = true;
        Promise.resolve().then(() => {
          if (persistTeardownPending) { persistTeardownPending = false; runPendingPersist(); }
        });
      };
    };

    if (historyHydratedRef.current === convId) {
      // Full history hydrated → the store IS the complete authoritative array
      // → safe to mirror wholesale (capped to the newest MAX_PERSISTED_MESSAGES).
      schedulePersist(convId, () => {
        kvSetJSON(`chat_messages:${convId}`, capPersisted(snapshot));
        writeTailCache(convId, snapshot);
      });
      return wireDurability();
    }

    if (snapshot === seededArrayRef.current) return; // untouched seed — already on disk

    // Store diverged from the seed = a real mutation (send / receive / edit).
    // DURABLY persist it by merging the store delta into the full cached array
    // on disk (id-keyed; never truncates the older history that isn't in the
    // bounded store window). The write is now COALESCED behind a trailing
    // debounce: sending one photo fires setMessages ~3 times and a rapid burst
    // would otherwise stack dozens of synchronous full-array serializations
    // into the frame budget (the FPS crash). Durability is preserved by the
    // module-level timer (survives unmount), the AppState 'background' flush,
    // and the teardown flush wired above.
    schedulePersist(convId, () => {
      try {
        const cached = kvGetJSONSync<ChatMessage[]>(`chat_messages:${convId}`, []);
        if (cached.length > 0) {
          const pos = new Map(cached.map((m, i) => [m.id, i] as const));
          const merged = cached.slice();
          for (const sm of snapshot as ChatMessage[]) {
            const at = pos.get(sm.id);
            if (at === undefined) { merged.push(sm); pos.set(sm.id, merged.length - 1); }
            else { merged[at] = sm; }
          }
          kvSetJSON(`chat_messages:${convId}`, capPersisted(merged));
          writeTailCache(convId, merged);
        } else {
          // Brand-new chat (no cached history yet) → the store is the whole truth.
          kvSetJSON(`chat_messages:${convId}`, capPersisted(snapshot));
          writeTailCache(convId, snapshot);
        }
      } catch {}
    });

    // Hydrate the full history into the STORE (off the input frame) so
    // scroll-up / reply-jump / search have the complete array in memory. Safe
    // to defer — the coalesced durable write above will land regardless.
    const handle = InteractionManager.runAfterInteractions(() => {
      hydrateFullHistory();
    });
    return wireDurability(handle);
  }, [conversationId, myMessages, hydrateFullHistory]);

  // ── Heal stuck local images (root-cause fix for "one chat lags, an
  // identical-looking one doesn't") ────────────────────────────────────────
  // Some of OUR OWN messages can end up permanently referencing a local
  // `file://` image instead of the uploaded remote URL:
  //   • the message was sent while OFFLINE (handleSend returns before upload),
  //   • the upload threw (a network blip) and the catch swallowed it,
  //   • the app was killed mid-upload before the local→remote swap persisted.
  // Such a message keeps a FULL-resolution local JPEG (~1600 px) in imageUrls.
  // On every open, expo-image decodes that full bitmap for a ~270 px bubble —
  // a 200-260 ms UI-thread stall PER photo (the perf monitor's `file` /
  // `s3.amazonaws.com` 247-260 ms decodes). A chat holding a few of these is
  // exactly the one that "freezes on scroll", while a visually identical chat
  // whose photos round-tripped to r2.dev (4-24 ms proxied WebP decodes) stays
  // smooth. The stuck local refs are also invisible on every OTHER device.
  //
  // Heal them: re-upload any own-message local images and swap imageUrls to the
  // remote URL. The persist effect mirrors the swap to disk, so the heavy local
  // decode never happens again and the photo finally syncs to peers. Deferred
  // past interactions + sequential so the re-uploads never touch the open/
  // scroll frames; online-only; failures leave the message untouched and retry
  // on the next open. Deduped by message id so a history-hydration re-render
  // never double-uploads an in-flight heal.
  const healingIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!conversationId || !currentUserId) return;
    if (!myMessages || myMessages.length === 0) return;
    if (!useConnectivityStore.getState().isOnline) return;
    const stuck = myMessages.filter(
      (m) =>
        (m.senderId === currentUserId || m.senderId === 'current') &&
        Array.isArray(m.imageUrls) &&
        m.imageUrls.some((u) => typeof u === 'string' && !u.startsWith('http')) &&
        !healingIdsRef.current.has(m.id),
    );
    if (stuck.length === 0) return;
    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        // Collect every successful swap first, then commit ONE batched
        // setMessages at the end. Previously this wrote a full-array
        // replacement PER stuck photo (N writes), which churned renders and
        // disturbed FlashList's scroll anchoring (perceived as being yanked to
        // the bottom while reading history). A single write yields an identical
        // final state with at most one array replacement per heal pass.
        const healed: Record<string, string[]> = {};
        for (const m of stuck) {
          if (cancelled) return;
          healingIdsRef.current.add(m.id);
          try {
            const original = m.imageUrls || [];
            const swapped = await Promise.all(
              original.map(async (u) => {
                if (typeof u !== 'string' || u.startsWith('http')) return u;
                const { url } = await uploadChatImage(u);
                if (url) {
                  // Carry the remembered dimensions from the local key onto the
                  // new remote key so the photo keeps its correct box (no jump)
                  // after the heal swaps file:// → https://.
                  const d = getImageDims(u);
                  if (d) setImageDims(url, d.w, d.h);
                }
                return url || u; // keep the local ref if the upload failed
              }),
            );
            const changed = swapped.some((u, i) => u !== original[i]);
            if (!changed) {
              // Upload failed (e.g. the cached file is gone) — allow a retry
              // on the next open rather than pinning the id forever.
              healingIdsRef.current.delete(m.id);
              continue;
            }
            // Record the swap; the single batched write below applies them all.
            healed[m.id] = swapped;
          } catch {
            healingIdsRef.current.delete(m.id);
          }
        }
        // One array replacement for the whole heal pass, reading the freshest
        // store array once so concurrent updates aren't clobbered.
        if (!cancelled && Object.keys(healed).length > 0) {
          const current = useChatStore.getState().messages[conversationId] || [];
          setMessages(
            conversationId,
            current.map((mm) => (healed[mm.id] ? { ...mm, imageUrls: healed[mm.id] } : mm)) as any,
          );
        }
      })();
    });
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [conversationId, currentUserId, myMessages, setMessages]);

  const chatLocalName = specificSettings?.localName;
  const displayName = chatLocalName || conversation?.participantName || profileData?.display_name || entityConv?.participantName || t('chat.fallback_name');
  const displayEmoji = (conversation as any)?.participantEmoji || profileData?.emoji || entityConv?.participantEmoji || '😊';
  const displayVerified = profileData?.is_verified || cachedProfile?.is_verified || (entityConv as any)?.participantVerified || false;
  const displayBadge = profileData?.badge || cachedProfile?.badge || (entityConv as any)?.participantBadge || null;
  const profileId = participantId;

  // ── Canonical conversation reconciliation (Bug 3) ─────────────────────
  // A chat opened from a profile carries the OTHER user's id as the route
  // `id`, not a conversation id. The conversation is created lazily on the
  // first send (POST /v1/conversations is idempotent — create-or-get). Once
  // the server hands back the canonical conversation id we must converge the
  // whole local picture onto it, otherwise the messages tab (keyed by the
  // real conversation id from the server) and this screen (keyed by the user
  // id) drift apart — the conversation then either duplicates or goes missing
  // from the list. This helper:
  //   1) upserts the conversation row in the entity store, deduped by the
  //      stable participant user id (matching RealtimeAccountBridge);
  //   2) migrates any optimistic messages from the user-id bucket into the
  //      canonical conversation-id bucket;
  //   3) rewrites the route param so `id` becomes the canonical id, which
  //      re-keys the realtime channel, the message selector and the reopen
  //      path with zero extra plumbing.
  const reconcileConversation = useCallback(
    (convId: string | null, lastMessage: string) => {
      if (!convId) return;
      try {
        const store = useEntityStore.getState();
        const existing = store.conversations || [];
        const idx = existing.findIndex(
          (c) => c.id === convId || (!!participantId && c.participantId === participantId),
        );
        const row = {
          id: convId,
          participantId: participantId || '',
          participantName: displayName || t('chat.fallback_name'),
          participantUsername: '',
          participantEmoji: displayEmoji,
          lastMessage,
          lastMessageAt: new Date().toISOString(),
        };
        if (idx >= 0) {
          const merged = [...existing];
          merged[idx] = { ...existing[idx], ...row };
          store.setConversations(merged as any);
        } else {
          store.setConversations([row as any, ...existing]);
        }
      } catch {}

      if (convId !== id) {
        try {
          const cs = useChatStore.getState();
          const fromOld = cs.messages[id] || [];
          if (fromOld.length > 0) {
            const intoNew = cs.messages[convId] || [];
            const seen = new Set(intoNew.map((m: any) => m.id));
            const mergedMsgs = [...intoNew, ...fromOld.filter((m: any) => !seen.has(m.id))];
            setMessages(convId, mergedMsgs as any);
          }
        } catch {}
        try {
          router.setParams({ id: convId, participantId: participantId || '' } as any);
        } catch {}
      }
    },
    [id, participantId, displayName, displayEmoji, setMessages, t],
  );

  // Open the full-screen viewer on a specific message. A route (not a modal) so
  // the platform owns the transition and back-gesture, and so this screen's
  // message list is not left mounted underneath doing layout work.
  const openFullscreen = useCallback((m: ChatMessage) => {
    if (!conversationId) return;
    triggerHaptic('light');
    router.push({
      pathname: '/chat/fullscreen',
      params: { id: conversationId, messageId: m.id },
    } as any);
  }, [conversationId]);

  // ── Reveal the message you just sent ──────────────────────────────────────
  //
  // This used to be an unconditional `requestAnimationFrame(() => scrollToEnd())`
  // fired immediately after `addMessage`. Two problems, and together they are the
  // "I hit send and it lags as the message lands / scrolls up" report:
  //
  //   1. It ran BEFORE the new bubble had been laid out, so it animated toward the
  //      OLD content height; the cell then measured and the target moved.
  //   2. The list already has `maintainVisibleContentPosition.autoscrollToBottom
  //      Threshold: 0.1`, i.e. FlashList v2 ALREADY scrolls to the bottom itself
  //      when content is appended and the user is near it — after layout, which is
  //      the correct moment. So two mechanisms were racing for the same offset.
  //
  // Now the native behaviour owns the common case (you are at the bottom, which is
  // where you are whenever you are typing) and this does nothing at all. It only
  // steps in when the user is scrolled far enough up that the native threshold
  // will NOT fire — and then it uses the same measured `scrollToIndex` path as the
  // scroll-to-bottom button rather than an unmeasured animated jump.
  // Generation counter shared by every programmatic scroll chain. Incremented when
  // a new chain starts; each chain abandons its follow-up command if the counter
  // has moved on. See the note inside `revealNewest`.
  const scrollGenRef = useRef(0);

  const revealNewest = useCallback(() => {
    const m = scrollMetricsRef.current;
    // Unknown metrics (nothing scrolled yet) means we are at the bottom on a
    // freshly-opened chat — the native autoscroll has it.
    if (!m || m.layoutH <= 0) return;
    const distanceFromBottom = m.contentH - (m.y + m.layoutH);
    // Comfortably inside the native threshold → let FlashList do it.
    if (distanceFromBottom <= m.layoutH * 0.25) return;

    // ── Serialise against any other in-flight scroll ────────────────────────
    //
    // Three independent two-step chains could previously be in flight at once —
    // this one, the scroll-to-bottom button's, and a reply/search jump — each
    // ending in a follow-up command issued after an `await`. Nothing cancelled
    // anything, so a chain that started before the user did something else would
    // still fire its second command afterwards and drag the viewport somewhere
    // unrelated. That is the "it taps me somewhere strange".
    //
    // A generation counter makes every chain abandon its follow-up if another
    // scroll started in the meantime. Deferred by one frame as well, so the
    // append that triggered this has committed and `windowedMessagesRef` holds the
    // NEW last row rather than the previous one (which used to make this scroll to
    // the second-to-last message and then jump to the end — two visible moves).
    const gen = ++scrollGenRef.current;
    requestAnimationFrame(() => {
      if (gen !== scrollGenRef.current) return;
      const lastIndex = windowedMessagesRef.current.length - 1;
      if (lastIndex < 0) return;
      void (async () => {
        try {
          await flatListRef.current?.scrollToIndex({ index: lastIndex, animated: true, viewPosition: 1 });
          if (gen !== scrollGenRef.current) return;
          flatListRef.current?.scrollToEnd({ animated: false });
        } catch {
          if (gen !== scrollGenRef.current) return;
          try { flatListRef.current?.scrollToEnd({ animated: true }); } catch {}
        }
      })();
    });
  }, []);

  // ── Resolve the canonical conversation id up front ────────────────────
  // Runs on mount (and if the route id changes). Decides whether the route
  // `id` is already a conversation id or a peer user id, and in the latter
  // case calls the idempotent create-or-get so our realtime subscription
  // lands on `chat:<convId>` from the first frame — converging with a peer
  // who opened the same chat from their messages list. We only fall back to
  // the raw route id when offline (so the screen still works locally).
  useEffect(() => {
    if (!id) return;

    // (a) Messages-list navigation passes an explicit `participantId` that
    //     differs from the route id → the route id is already canonical.
    if (paramParticipantId && paramParticipantId !== id) {
      setConversationId((prev) => (prev === id ? prev : id));
      return;
    }
    // (b) The route id matches a known conversation row → already canonical.
    if (useEntityStore.getState().conversations.some((c) => c.id === id)) {
      setConversationId((prev) => (prev === id ? prev : id));
      return;
    }
    // (c) Otherwise the route id is a peer USER id (opened from a profile).
    //     Resolve the canonical 1:1 conversation. Offline → keep the raw id
    //     as a best-effort local fallback.
    if (!useConnectivityStore.getState().isOnline) return;

    let cancelled = false;
    import('../../src/services/apiClient')
      .then(({ apiPost }) =>
        apiPost<{ conversation_id: string }>('/v1/conversations', { otherUserId: id }),
      )
      .then(({ data }) => {
        const convId = data?.conversation_id;
        if (cancelled || !convId || convId === id) return;
        // Deferred past the open-chat transition because the migration
        // here writes through `cs.setMessages(convId, ...)` and
        // `setConversationId(convId)`, both of which cascade re-renders
        // through the chat-message selector and the channel-subscription
        // effect's dep array. On weak Android the navigation slide-in
        // can still be in flight when this `.then` fires, so dropping
        // the work past `runAfterInteractions` keeps the open frame
        // clean. Cancellation is double-checked inside since the
        // unmount path may have run while we were waiting.
        InteractionManager.runAfterInteractions(() => {
          if (cancelled) return;
          // Migrate any optimistic/seed messages parked under the user-id
          // bucket into the canonical bucket so nothing is orphaned when the
          // selector re-keys onto `convId`.
          try {
            const cs = useChatStore.getState();
            const fromOld = cs.messages[id] || [];
            if (fromOld.length > 0) {
              const intoNew = cs.messages[convId] || [];
              const seen = new Set(intoNew.map((m: any) => m.id));
              cs.setMessages(convId, [...intoNew, ...fromOld.filter((m: any) => !seen.has(m.id))] as any);
            }
          } catch {}
          // Mark this as an ID MIGRATION, not a chat switch, BEFORE the state
          // change so the effects that key on `conversationId` can tell them
          // apart — see `migratedFromRef`. Without this the window reset below
          // collapsed the transcript from N rows to 30 and back, right after the
          // user's first send.
          migratedFromRef.current = { from: id, to: convId };
          setConversationId(convId);
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id, paramParticipantId]);

  // ── Realtime channel: incoming messages from the other participant ─────────
  //
  // Both sides of a chat use the same `id` route param when navigating to the
  // chat screen, so they end up subscribed to the same Ably channel. When the
  // peer publishes a new message we add it to the local store; we deliberately
  // skip publishes from our own user id because the optimistic addMessage in
  // handleSend / sendGif already put the message on screen.
  //
  // The connection itself is opened lazily via getRealtime() — the wrapper
  // pulls a 1-hour token from /api/ably-token and reuses one client across
  // every chat the user opens. We only subscribe / unsubscribe to the
  // per-chat channel here, not the connection.
  //
  // Three event types:
  //   - 'msg'        → new message from peer
  //   - 'msg.edit'   → peer edited a message they sent earlier
  //   - 'msg.delete' → peer deleted a message
  // ── The subscription must not give up permanently ───────────────────────────
  //
  // This effect's dependencies are `[conversationId, addMessage, setMessages]`, all of them
  // stable, so it runs ONCE per conversation. Combined with the `if (!realtime) return`
  // below, that meant: if `getRealtime()` happened to return null at the moment the screen
  // mounted — auth store not hydrated yet, token not minted yet — the chat had NO live
  // subscription for its entire lifetime, with nothing logged and nothing retried.
  //
  // `realtimeTick` re-arms it. It increments while the client is unavailable and on every
  // connection state change, so the effect re-runs and subscribes as soon as a client
  // exists. Ably's own channel objects survive reconnects, so this is only about the
  // window where there is no client at all.
  const [realtimeTick, setRealtimeTick] = useState(0);
  useEffect(() => {
    if (!conversationId) return;
    // Already have a client: nothing to poll for.
    if (getRealtime()) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (getRealtime()) {
        setRealtimeTick((n) => n + 1);
        clearInterval(timer);
        return;
      }
      // Bounded. If there is still no client after ~30s the problem is not a race — it is
      // that the user is signed out or the token endpoint is unreachable, and spinning a
      // timer forever would not fix either.
      if (tries >= 15) clearInterval(timer);
    }, 2000);
    return () => clearInterval(timer);
  }, [conversationId, realtimeTick]);

  useEffect(() => {
    if (!conversationId) return;
    const realtime = getRealtime();
    if (!realtime) return; // No client yet — the poll above re-arms this effect.
    const channel = realtime.channels.get(chatChannelName(conversationId));
    const ownUserId = useAuthStore.getState().user?.id;

    const onNewMessage = (msg: { data?: any }) => {
      const payload = msg?.data;
      if (!payload || typeof payload !== 'object') return;
      // Skip our own publishes — the optimistic addMessage already showed
      // the message; receiving it again would dupe it.
      if (payload.senderId && ownUserId && payload.senderId === ownUserId) return;
      // Dedupe by id against the current store snapshot. Messages from the
      // peer are tagged with a stable client-side id by the publisher, so
      // a quick subscribe-after-publish race won't add the same row twice.
      const existing = useChatStore.getState().messages[conversationId] || [];
      if (existing.some((m) => m.id === payload.id)) return;
      // Translate the wire payload into our ChatMessage shape. We persist the
      // REAL author uuid (`payload.senderId`, published as the sender's
      // `user.id`) so ownership is computed correctly at render time on any
      // account — never the relative 'peer' sentinel. An incoming message is
      // by definition not ours, so a missing senderId still renders left.
      const incoming: ChatMessage = {
        id: payload.id,
        conversationId,
        senderId: String(payload.senderId || ''),
        text: payload.text || '',
        createdAt: payload.createdAt || new Date().toISOString(),
        isRead: false,
        replyToId: payload.replyToId,
        replyToText: payload.replyToText,
        replyToIsOwn: payload.replyToIsOwn === true ? false : payload.replyToIsOwn === false ? true : undefined,
        replyToImage: payload.replyToImage,
        replyPixelIconId: payload.replyPixelIconId,
        imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls : undefined,
      };
      addMessage(conversationId, incoming);
    };

    // Edit — peer changed text / images of a message we already have.
    //
    // Matches on EITHER identity. A message may be held locally under its stable
    // local id with the server uuid in `serverId` (an optimistic send of ours) or
    // under the server uuid directly (received via realtime, or loaded from history),
    // and the incoming payload carries whichever id the sender published. Comparing
    // only `m.id` silently missed half the cases.
    const matchesPayload = (m: ChatMessage, payloadId: string) =>
      m.id === payloadId || (!!m.serverId && m.serverId === payloadId);

    const onEdit = (msg: { data?: any }) => {
      const payload = msg?.data;
      if (!payload || typeof payload !== 'object' || !payload.id) return;
      const current = useChatStore.getState().messages[conversationId] || [];
      const next = current.map((m) =>
        matchesPayload(m, payload.id)
          ? { ...m, text: typeof payload.text === 'string' ? payload.text : m.text, imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls : m.imageUrls }
          : m,
      );
      setMessages(conversationId, next as any);
    };

    // Delete — peer removed a message. We just filter it out of the local
    // list; no Supabase round-trip required because the peer already did
    // (or will, when DB-side delete lands).
    const onDelete = (msg: { data?: any }) => {
      const payload = msg?.data;
      if (!payload || typeof payload !== 'object' || !payload.id) return;
      // The full-history hydrate that used to run here is gone for the same reason it is gone
      // from the delete menu action: the tombstone makes the delete durable at every layer,
      // and loading up to 1000 rows into the list in response to a PEER's delete was a large
      // commit nobody asked for — arriving at an arbitrary moment, mid-scroll.
      // Record it here too, for the same reason the deleter does: this device polls the
      // server independently, and without a tombstone its own poll resurrects a message the
      // peer deleted. That is why the message came back for BOTH users.
      addTombstones(conversationId, [String(payload.id)]);
      const current = useChatStore.getState().messages[conversationId] || [];
      // Same either-identity match as `onEdit` — a delete published with the server
      // uuid has to find a row we hold under a local id.
      setMessages(conversationId, current.filter((m) => !matchesPayload(m, payload.id)) as any);
    };

    // ── STOP SWALLOWING THE FAILURES ──────────────────────────────────────────
    //
    // These three were `void channel.subscribe(...)`, and the publishes in `handleSend` are
    // still fire-and-forget. Every one of them returns a promise that rejects when the
    // channel cannot attach — wrong capability, connection failed, token rejected — and
    // discarding it makes "realtime is completely dead" look exactly like "nobody sent
    // anything". That is precisely the state this chat was in: messages only appeared after
    // leaving and re-entering, i.e. only via the HTTP history fetch.
    //
    // The most likely cause of a rejection here is NOT this file. `/api/ably-token` verifies
    // the Worker-issued JWT with `verifyWorkerToken`, which is fail-closed: if Vercel's
    // `JWT_SECRET` is missing or differs from the Worker's, it 401s every client, the
    // `authCallback` errors, and realtime is dead app-wide while plain HTTP keeps working
    // (HTTP talks to the Worker, which signs and verifies with its own copy). There is
    // already a purpose-built diagnostic for exactly this: compare
    // `GET /api/admin/auth-fingerprint` (Vercel) with `GET /v1/admin/auth-fingerprint`
    // (Worker) — see the long note in api/admin/auth-fingerprint.ts.
    //
    // So: log it. A silent realtime outage is the single most expensive failure mode this
    // app has, because every symptom it produces points somewhere else.
    const onSubscribeError = (event: string) => (err: unknown) => {
      if (__DEV__) {
        console.warn(
          `[chat] realtime subscribe failed for "${event}" on ${chatChannelName(conversationId)}. ` +
            'Live messages will not arrive; the chat will only update via the HTTP history ' +
            'fetch on re-entry. Check /api/ably-token and the JWT_SECRET fingerprints.',
          err,
        );
      }
    };
    channel.subscribe('msg', onNewMessage).catch(onSubscribeError('msg'));
    channel.subscribe('msg.edit', onEdit).catch(onSubscribeError('msg.edit'));
    channel.subscribe('msg.delete', onDelete).catch(onSubscribeError('msg.delete'));
    return () => {
      try { channel.unsubscribe('msg', onNewMessage); } catch {}
      try { channel.unsubscribe('msg.edit', onEdit); } catch {}
      try { channel.unsubscribe('msg.delete', onDelete); } catch {}
    };
  }, [conversationId, addMessage, setMessages, realtimeTick]);

  // ── Message search ──────────────────────────────────────────────────────────
  const openSearch = useCallback(() => {
    triggerHaptic('light');
    // Search must cover the WHOLE conversation, not just the loaded seed
    // window — hydrate the full history (once) when the user opens search.
    // Deferred so opening the search bar stays snappy; the match recompute
    // re-runs when `chatMessages` grows.
    if (historyHydratedRef.current !== conversationId) {
      InteractionManager.runAfterInteractions(() => { hydrateFullHistory(); });
    }
    setSearchMode(true);
  }, [conversationId, hydrateFullHistory]);

  const closeSearch = useCallback(() => {
    // Dismiss the keyboard first so the bottom input bar doesn't get stuck at the
    // keyboard's last position when it re-mounts (KeyboardStickyView).
    Keyboard.dismiss();
    setSearchQuery('');
    setSearchMatches([]);
    setSearchActiveIdx(0);
    // Exit search after the keyboard has had a frame to start closing.
    setTimeout(() => setSearchMode(false), 50);
  }, []);

  // Non-inverted list: data IS `chatMessages` (oldest→newest), so a search-match
  // index maps DIRECTLY to the list index — no inversion, no window remap.
  // ── Jumps target a MESSAGE, resolved against COMMITTED data ────────────────
  //
  // The old version computed the windowed index up front:
  //
  //   const win   = Math.max(renderWindow, total - index + 4);
  //   const start = Math.max(0, total - win);
  //   const winIdx = index - start;          // then scrolled to winIdx after 2 rAFs
  //
  // `total` came from the LIVE store while the rendered `data` came from the
  // render-time snapshot and the OLD `renderWindow`. Callers hydrate the full
  // history synchronously first, so `total` could be 800 while the list still held
  // 30 rows — `winIdx` was then an index into an array that did not exist yet, and
  // two rAFs are nowhere near enough to commit a 770-row expansion on a real
  // device. The scroll landed on an unrelated row: the reported teleport.
  //
  // Now the target is recorded as an ID, and a separate effect issues the scroll
  // once that id is actually present in the rendered window. No index arithmetic
  // across an uncommitted render, and it self-heals if the expansion takes several
  // frames.
  //
  // `viewPosition` / `animated` are per-request because this mechanism now serves two
  // callers with opposite needs. A reply/search jump wants the target CENTRED and animated,
  // so the movement is visible and the user can see where they landed. Restoring position
  // after older history is prepended wants the anchor row put back at the viewport TOP with
  // NO animation — the whole point is that nothing appears to move.
  const pendingJumpRef = useRef<{ id: string; tries: number; viewPosition: number; animated: boolean } | null>(null);

  // Bumped on every jump REQUEST so the consuming effect below runs even when the
  // render window did not have to change.
  //
  // THE BUG THIS FIXES: that effect depended only on `[windowedMessages]`, and
  // `scrollToIndex` only calls `setRenderWindow` when the target is OUTSIDE the
  // current window. So for a target already inside the window — which is the normal
  // case for a pinned message, and for replies to anything recent — nothing changed,
  // the effect never re-ran, and the queued jump was silently dropped. Tapping a
  // pinned message did nothing at all.
  const [jumpNonce, setJumpNonce] = useState(0);

  const scrollToIndex = useCallback((index: number) => {
    // Read the freshest total from the store (the closure's `chatMessages` can
    // be the stale bounded seed right after a lazy hydrate).
    const live = useChatStore.getState().messages[conversationId || ''] as ChatMessage[] | undefined;
    const source = live && live.length > 0 ? live : chatMessages;
    if (index < 0 || index >= source.length) return;
    const target = source[index];
    if (!target?.id) return;
    jumpAttemptRef.current = 0;
    // No window to grow any more. This used to compute `source.length - index + 4` and
    // raise `renderWindow` to it so the target row was inside the rendered slice; with the
    // whole array rendered, any index that exists is already reachable.
    pendingJumpRef.current = { id: target.id, tries: 0, viewPosition: 0.5, animated: true };
    // Guarantee the consuming effect runs for THIS request. It is keyed on the data as well,
    // so a jump requested before a lazy hydrate lands still completes on the commit where
    // the row appears.
    setJumpNonce((n) => n + 1);
  }, [chatMessages, conversationId]);

  // Recompute matches when the query changes; jump to the most recent match
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) { setSearchMatches([]); setSearchActiveIdx(0); return; }
    const matches: number[] = [];
    chatMessages.forEach((m, i) => {
      if (m.text && m.text.toLowerCase().includes(q)) matches.push(i);
    });
    setSearchMatches(matches);
    if (matches.length > 0) {
      const last = matches.length - 1;
      setSearchActiveIdx(last);
      scrollToIndex(matches[last]);
    }
  }, [searchQuery, chatMessages, scrollToIndex]);

  const goToPrevMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const next = (searchActiveIdx - 1 + searchMatches.length) % searchMatches.length;
    setSearchActiveIdx(next);
    scrollToIndex(searchMatches[next]);
    triggerHaptic('light');
  }, [searchMatches, searchActiveIdx, scrollToIndex]);

  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const next = (searchActiveIdx + 1) % searchMatches.length;
    setSearchActiveIdx(next);
    scrollToIndex(searchMatches[next]);
    triggerHaptic('light');
  }, [searchMatches, searchActiveIdx, scrollToIndex]);

  const startReply = useCallback((message: ChatMessage) => {
    setEditing(null);
    setReplyTo(message);
    triggerHaptic('light');
  }, []);

  // ── Attach flow ─────────────────────────────────────────────────────────────
  //
  // The attach button opens the app's own `PhotoPickerPanel` (docked where the
  // keyboard was, expandable by dragging its grabber) instead of the OS sheet. The
  // system sheet is still reachable — from the folder button in the panel's header,
  // and automatically when library permission is denied — so a user who never
  // grants library access loses nothing: iOS's own picker returns only the photos
  // they explicitly choose, without any permission at all.
  const [photoPanelOpen, setPhotoPanelOpen] = useState(false);

  const openPhotoPanel = useCallback(() => {
    triggerHaptic('light');
    // Close the emoji/GIF panel first so two docked surfaces never overlap.
    setPanelTab(null);
    Keyboard.dismiss();
    setPhotoPanelOpen(true);
  }, []);

  const closePhotoPanel = useCallback(() => setPhotoPanelOpen(false), []);

  const pickImages = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 6,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    triggerHaptic('light');

    // Downscale picked images immediately to a display-friendly size so rendering
    // (thumbnails, context-menu preview, viewer) stays smooth even offline, and the
    // eventual upload is light. GIFs are left untouched to preserve animation.
    //
    // Resize width is 1080 (was 1600): the chat bubble renders at ≤CHAT_IMG_MAX_W
    // (≤270pt → ~810px at DPR 3) and the remote copy is additionally weserv-
    // proxied down to CHAT_IMG_MAX_W, so 1600px was pure waste that the OPTIMISTIC
    // LOCAL bubble paid in full (a local file:// bypasses the proxy and decodes
    // the whole bitmap). 1080px keeps the bubble (and the full-screen viewer)
    // visually identical while cutting the local decode cost ~55% (pixel area
    // (1080/1600)² ≈ 0.46) — a big chunk of the rapid-send decode storm.
    const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
    const processed = await Promise.all(result.assets.map(async (a) => {
      const isGif = (a.uri.split('.').pop() || '').toLowerCase() === 'gif';
      if (isGif) return a.uri;
      try {
        const r = await manipulateAsync(a.uri, [{ resize: { width: 1080 } }], { compress: 0.85, format: SaveFormat.JPEG });
        // Remember the processed dimensions so the optimistic bubble (and every
        // future open) mounts at the correct aspect-ratio box — no size jump.
        if (r.width && r.height) setImageDims(r.uri, r.width, r.height);
        return r.uri;
      } catch {
        return a.uri;
      }
    }));
    setPendingImages((prev) => [...prev, ...processed].slice(0, 6));
  }, []);

  // Paste an image from the system clipboard into the composer (Telegram-style:
  // copy a photo anywhere → long-press the attach button here → it's pasted in,
  // ready to send). Re-encodes the clipboard data URI to a local JPEG file so
  // the existing upload path works. Fully guarded — failures just toast.
  const pasteImageFromClipboard = useCallback(async () => {
    try {
      const has = await Clipboard.hasImageAsync();
      if (!has) { showToast(t('toast.no_clipboard_image'), 'image'); return; }
      const img = await Clipboard.getImageAsync({ format: 'png' });
      if (!img?.data) return;
      const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
      const out = await manipulateAsync(img.data, [{ resize: { width: 1280 } }], { compress: 0.8, format: SaveFormat.JPEG });
      if (out.uri) {
        triggerHaptic('light');
        setPendingImages((prev) => [...prev, out.uri].slice(0, 6));
      }
    } catch {
      showToast(t('toast.error_generic'), 'alert-circle');
    }
  }, [t]);

  // Add already-resolved local image URIs (from the native paste handler) to
  // the composer. Resizes non-GIFs the same way pickImages does. Capped at 6.
  const addPastedImages = useCallback(async (uris: string[]) => {
    if (!uris?.length) return;
    try {
      const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
      const processed = await Promise.all(uris.slice(0, 6).map(async (u) => {
        const isGif = (u.split('?')[0].split('.').pop() || '').toLowerCase() === 'gif';
        if (isGif) return u;
        try {
          const r = await manipulateAsync(u, [{ resize: { width: 1280 } }], { compress: 0.8, format: SaveFormat.JPEG });
          return r.uri;
        } catch { return u; }
      }));
      triggerHaptic('light');
      setPendingImages((prev) => [...prev, ...processed].slice(0, 6));
    } catch {
      showToast(t('toast.error_generic'), 'alert-circle');
    }
  }, [t]);

  // Stable so the memoized viewer never re-renders because of this screen.
  const closeImageViewer = useCallback(() => setViewerImages(null), []);

  const openImageViewer = useCallback((images: string[], index: number) => {
    setViewerImages({ images, index });
  }, []);

  // Send a GIF (from GIPHY) as a message. We store the remote GIF URL directly in
  // imageUrls — no upload to our storage (zero server load), and it renders +
  // animates through the existing image path (expo-image animates GIFs).
  const sendGif = useCallback((url: string) => {
    if (!id || !url) return;
    playSendSound();
    const currentReply = replyTo;
    setReplyTo(null);
    const newMessage: ChatMessage = {
      id: 'm-' + Date.now(),
      conversationId,
      senderId: currentUserId || 'current',
      text: '',
      createdAt: new Date().toISOString(),
      isRead: true,
      replyToId: currentReply?.id,
      replyToText: currentReply?.text || (currentReply?.imageUrls && currentReply.imageUrls.length > 0 ? t('chat.photo') : undefined),
      replyToIsOwn: currentReply ? (currentReply.senderId === currentUserId || currentReply.senderId === 'current') : undefined,
      replyToImage: currentReply?.imageUrls?.[0],
      // Per-chat decorative pixel icon stamped onto reply messages.
      // Only set when this message is actually a reply — otherwise
      // there's no reply-block to render the icon in. Read directly
      // off the merged settings object so it picks up the latest
      // pick from the picker without a re-render dependency.
      replyPixelIconId: currentReply ? chatSettings.replyPixelIcon : undefined,
      imageUrls: [url],
    };
    addMessage(conversationId, newMessage);
    revealNewest();

    // Persist to the DB (best-effort) using the same image marker scheme.
    if (!useConnectivityStore.getState().isOnline) return;
    (async () => {
      try {
        const { useAuthStore } = await import('../../src/store');
        const user = useAuthStore.getState().user;
        if (!user) return;
        const { apiPost } = await import('../../src/services/apiClient');
        // Idempotent: returns existing 1:1 conversation if one already
        // exists between this pair, otherwise creates and returns the new id.
        const { data: convData } = await apiPost<{ conversation_id: string }>(
          '/v1/conversations',
          { otherUserId: participantId },
        );
        const convId = convData?.conversation_id || null;
        if (convId) {
          const { data: sentGifData } = await apiPost<{ id: string }>(
            `/v1/conversations/${encodeURIComponent(convId)}/messages`,
            { text: `::img::${url}::` },
          );
          // Record the server uuid alongside the stable local id so a later history
          // fetch dedupes instead of duplicating the GIF. Deliberately NOT an
          // overwrite of `id` — that would change a mounted row's key and remount the
          // cell mid-scroll (same reasoning as `handleSend`).
          const serverGifId = sentGifData?.id || newMessage.id;
          if (serverGifId !== newMessage.id) {
            setMessages(
              conversationId,
              (useChatStore.getState().messages[conversationId] || []).map((m) =>
                m.id === newMessage.id ? { ...m, serverId: serverGifId } : m,
              ) as any,
            );
          }
          // Realtime publish — same pattern as handleSend. The peer sees
          // the GIF instantly via subscribe-on-mount. Publish on the
          // canonical conversation channel so a profile-initiated chat
          // reaches a peer who opened the chat from their messages tab.
          try {
            const realtime = getRealtime();
            if (realtime && id) {
              const channel = realtime.channels.get(chatChannelName(convId));
              void channel.publish('msg', {
                id: serverGifId,
                senderId: user.id,
                text: '',
                createdAt: newMessage.createdAt,
                imageUrls: [url],
                replyToId: newMessage.replyToId,
                replyToText: newMessage.replyToText,
                replyToIsOwn: newMessage.replyToIsOwn,
                replyToImage: newMessage.replyToImage,
                replyPixelIconId: newMessage.replyPixelIconId,
              });
            }
            // Peer notification (conversation row + preview on the
            // recipient's messages tab) is published SERVER-SIDE by the
            // Worker after POST /messages — it holds the Ably root key and
            // can write to `user:<peer>:notifications`. The client token is
            // scoped to `chat:*` + `user:<self>:*` only, so a client-side
            // publish here just throws a 40160 capability error. Removed.
          } catch {}

          // Converge local state onto the canonical conversation id (Bug 3)
          // so a GIF-first chat started from a profile shows up in the
          // messages list and reopens to the same thread.
          reconcileConversation(convId, '📷');
        }
      } catch {}
    })();
  }, [id, conversationId, replyTo, addMessage, revealNewest, participantId, t, reconcileConversation]);

  // Pick a GIF from the inline panel: send it, then close the panel and let the
  // input bar settle back down (GIFs are one-and-done, not multi-pick).
  const onPickGif = useCallback((item: GiphyItem) => {
    sendGif(item.sendUrl);
    setRecentGif(pushRecentGif(item));
    setPanelTab(null);
    setKeepLifted(false);
    // liftSV is animated back to 0 by the lift mirror effect (smooth descent)
    // now that panelTab/keepLifted are cleared — no instant snap here.
  }, [sendGif]);
  // up. Reset to '' when closed so the next open re-fetches (the service
  // hits its 7-day MMKV cache so this is essentially free).
  const [translateText, setTranslateText] = useState<string>('');

  const handleMenuAction = useCallback((action: MessageAction, message: ChatMessage) => {
    if (action === 'copy') {
      Clipboard.setStringAsync(message.text);
      showToast(t('toast.copied'), 'check');
    } else if (action === 'copyImage') {
      // Copy the (first) photo to the system clipboard so it can be pasted into
      // any other app. Images are served via the weserv proxy (WebP) and cached
      // by expo-image under the PROXIED url — so we resolve that, prefer the
      // already-downloaded local cache file, then re-encode to a clipboard-safe
      // JPEG. Resized + compressed so the base64 payload stays small enough for
      // the Android clipboard. Fully guarded — failures just toast.
      const raw = message.imageUrls?.[0];
      if (raw) {
        (async () => {
          try {
            const isGif = (raw.split('?')[0].split('.').pop() || '').toLowerCase() === 'gif';
            const proxied = isGif ? raw : proxiedImageUrl(raw, 1080);
            let srcUri = proxied;
            // Prefer the local cache file expo-image already downloaded.
            try {
              const { Image: ExpoImage } = await import('expo-image');
              const cached = await ExpoImage.getCachePathAsync(proxied);
              if (cached) srcUri = cached.startsWith('file') ? cached : 'file://' + cached;
            } catch {}
            const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
            const out = await manipulateAsync(srcUri, [{ resize: { width: 1080 } }], { base64: true, compress: 0.85, format: SaveFormat.JPEG });
            if (out.base64) {
              await Clipboard.setImageAsync(out.base64);
              showToast(t('toast.image_copied'), 'check');
            } else {
              showToast(t('toast.error_generic'), 'alert-circle');
            }
          } catch {
            showToast(t('toast.error_generic'), 'alert-circle');
          }
        })();
      }
    } else if (action === 'reply') {
      startReply(message);
    } else if (action === 'translate') {
      // Open the translation sheet with the source message text. The sheet
      // does the LibreTranslate fetch + result UI itself.
      if (message.text && message.text.trim()) setTranslateText(message.text);
    } else if (action === 'edit') {
      setReplyTo(null);
      setEditing(message);
      // Use `?? ''` so attachment-only messages (GIF / photo, where
      // `text` is empty or undefined) don't propagate undefined into the
      // TextInput — they should open the editor with a blank text field
      // and the existing media pre-loaded for replace/remove.
      inputRef.current?.setText(message.text ?? '');
      // Load existing photos / GIF URLs so they can be removed or replaced
      // via the existing pendingImages flow (× to remove, image picker to
      // add a new photo, GIF button to swap to a new GIF).
      setPendingImages(message.imageUrls || []);
    } else if (action === 'delete') {
      Alert.alert(t('chat.delete_message_title'), '', [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'), style: 'destructive', onPress: () => {
            if (!conversationId) return;
            // Emoji "dissolve" burst at the bubble's last-measured position
            // (captured on the long-press that opened this menu). Fire BEFORE
            // removing the row so it visually erupts from where the message was.
            const rect = deleteRectsRef.current.get(message.id);
            if (rect) {
              // Clamp the spawn rect to the visible viewport so the burst is
              // ALWAYS on screen. A VERY LONG message has a tall bubble whose
              // measured window rect can start above the screen (negative y)
              // and/or extend far below it — feeding that raw rect spawned the
              // particles off-screen (the bug). We take the visible vertical
              // slice of the bubble, cap its height so the particle spread
              // stays tight, and center the spawn band inside that slice; width
              // is clamped to the screen. This only changes WHERE the burst
              // originates — EmojiDeleteBurst's pooled, native-driver perf
              // model is untouched.
              const top = Math.max(rect.y, 0);
              const bottom = Math.min(rect.y + rect.h, SCREEN_HEIGHT);
              const visibleH = Math.max(bottom - top, 24);
              const spawnH = Math.min(visibleH, 200);
              const spawnY = top + (visibleH - spawnH) / 2;
              const spawnX = Math.max(Math.min(rect.x, SCREEN_WIDTH - 24), 0);
              const spawnW = Math.min(rect.w, SCREEN_WIDTH);
              burstRef.current?.burst(spawnX, spawnY, spawnW, spawnH);
              deleteRectsRef.current.delete(message.id);
            }
            // Read the latest snapshot from getState() rather than from the
            // closed-over selector — avoids the callback being recreated on
            // every store update (and rebuilding all bubbles' onLongPress).
            // Ensure the FULL history is loaded first so the delete persists
            // correctly (the lazy hydrate-merge would otherwise resurrect a
            // message removed only from the bounded seed window).
            // NOTE: this used to call `hydrateFullHistoryRef.current()` first, so the row
            // was guaranteed to be in the store before being filtered out — otherwise the
            // lazy hydrate would later reintroduce a message deleted from the bounded seed.
            // The tombstone below solves that properly and at every layer, so the hydrate is
            // gone: pulling up to 1000 rows into the list as a side effect of a delete was a
            // large unrequested commit, and it fired on the same frame as the delete
            // animation.
            // ── REMEMBER THE DELETION BEFORE PERFORMING IT ────────────────────
            //
            // Without this the row comes back within six seconds, because the history poll
            // refetches it from the server and the merge has no way to know the user removed
            // it on purpose. Both identities are recorded: this device may hold the message
            // under a local `m-<ts>` id while the server (and therefore the poll response)
            // knows it by its uuid. See src/services/messageTombstones.ts.
            addTombstones(conversationId, [message.id, message.serverId]);
            const current = useChatStore.getState().messages[conversationId] || [];
            // Match on EITHER identity, like the realtime handler does. Filtering on `id`
            // alone left a row held under a server uuid in place when the tapped object
            // carried a local id.
            setMessages(
              conversationId,
              current.filter((m) => !matchesEitherId(m, message.id) && !matchesEitherId(m, message.serverId)) as any,
            );
            triggerHaptic('medium');
            // ── AND DELETE IT ON THE SERVER ───────────────────────────────────
            //
            // The step that never existed. Everything above is local; the row stayed in D1
            // for ever, which is what made the poll able to resurrect it at all.
            //
            // Tolerates a 404/405: the Worker route ships separately from this bundle (OTA
            // cannot deploy a Worker), so until it is deployed this is a no-op and the
            // tombstone above is what holds the delete. Once deployed, deletion becomes real
            // and even a fresh install stops seeing the message.
            void (async () => {
              try {
                const serverId = message.serverId || message.id;
                // Local-only ids were never on the server; nothing to delete.
                if (serverId.startsWith('m-')) return;
                const { apiDelete } = await import('../../src/services/apiClient');
                await apiDelete(`/v1/messages/${encodeURIComponent(serverId)}`);
              } catch {
                // Offline or route not deployed yet. The tombstone keeps the row hidden on
                // this device, and the peer's tombstone does the same on theirs.
              }
            })();
            // Sync delete to the peer in realtime — so when this user
            // deletes a message on their side, it disappears from the
            // peer's open chat too. Telegram-style "delete for both".
            try {
              const realtime = getRealtime();
              if (realtime && conversationId) {
                const channel = realtime.channels.get(chatChannelName(conversationId));
                // Publish the SERVER id when we have one: that is the id the peer
                // stored the message under (it is what `handleSend` published), so a
                // local `m-<ts>` id would never match on their side.
                void channel.publish('msg.delete', { id: message.serverId || message.id });
              }
            } catch {}
          },
        },
      ]);
    }
  }, [conversationId, setMessages, startReply, t]);

  // Fired (once) when the user RELEASES a press-drag over a highlighted action
  // row. Routes through the SAME path as tap-to-select (`handleMenuAction`),
  // replaying the menu's slide-down dismiss first so it doesn't snap away.
  const fireDragAction = useCallback((message: ChatMessage, action: string) => {
    const run = () => handleMenuAction(action as MessageAction, message);
    if (menuRef.current) {
      menuRef.current.dismiss(run); // dismiss() also calls onClose → closeMenu
    } else {
      run();
      closeMenu();
    }
  }, [handleMenuAction, closeMenu]);

  // ── Search-result actions ───────────────────────────────────────────────────
  //
  // While search is open with at least one hit, a small action row appears above
  // the input bar and operates on the ACTIVE match (the one the ↑/↓ chevrons and
  // the "3/17" counter refer to) — so there is never any ambiguity about which
  // message a tap will affect.
  //
  // Delete routes through `handleMenuAction('delete', …)` rather than duplicating
  // the removal: that path already owns the confirmation alert, the full-history
  // hydrate (without which a delete inside the bounded seed window gets
  // resurrected), the delete-burst animation and the realtime `msg.delete`
  // publish. Duplicating any of that would be a second place to keep in step.
  //
  // These are declared AFTER `handleMenuAction` on purpose: `const` bindings in a
  // component body are not hoisted, so capturing it from a callback declared
  // above would throw a TDZ ReferenceError on the first render.
  const activeMatchMessage = useMemo<ChatMessage | null>(() => {
    if (searchMatches.length === 0) return null;
    const idx = searchMatches[searchActiveIdx];
    return chatMessages[idx] ?? null;
  }, [searchMatches, searchActiveIdx, chatMessages]);

  const togglePinnedMessage = usePinnedMessagesStore((s) => s.toggle);
  const unpinMessage = usePinnedMessagesStore((s) => s.unpin);
  const pinnedIds = usePinnedMessagesStore(selectPinnedIds(conversationId));

  // Resolved against the live transcript, so an edited pinned message shows its
  // CURRENT text and a deleted one simply drops out of the list.
  const pinnedResolved = useMemo(
    () => resolvePinned(chatMessages, pinnedIds),
    [chatMessages, pinnedIds],
  );

  // Which pin the bar is showing. A conversation can have several, and tapping the
  // bar advances through them (Telegram's behaviour) — clamped rather than stored
  // absolutely so deleting a pin can never leave the cursor out of range.
  const [pinCursor, setPinCursor] = useState(0);
  const activePin =
    pinnedResolved.length > 0 ? pinnedResolved[pinCursor % pinnedResolved.length] : null;

  const onPinSearchResult = useCallback(() => {
    if (!activeMatchMessage || !conversationId) return;
    triggerHaptic('medium');
    togglePinnedMessage(conversationId, activeMatchMessage.id);
  }, [activeMatchMessage, conversationId, togglePinnedMessage]);

  const onDeleteSearchResult = useCallback(() => {
    if (!activeMatchMessage) return;
    // A pinned message that gets deleted must not leave a dangling pin.
    if (conversationId && pinnedIds.includes(activeMatchMessage.id)) {
      unpinMessage(conversationId, activeMatchMessage.id);
    }
    handleMenuAction('delete', activeMatchMessage);
  }, [activeMatchMessage, conversationId, pinnedIds, unpinMessage, handleMenuAction]);

  const onUnpin = useCallback(() => {
    if (!conversationId || !activePin) return;
    triggerHaptic('light');
    unpinMessage(conversationId, activePin.message.id);
  }, [conversationId, activePin, unpinMessage]);

  // Tap the bar: jump to the pin it is showing, then advance the cursor so the next
  // tap goes to the following pin.
  const onJumpToPinned = useCallback(() => {
    if (!activePin) return;
    triggerHaptic('light');
    // Jump BY MESSAGE ID, not by the raw index from `resolvePinned`.
    //
    // `activePin.index` is an index into `chatMessages` — the full history — while
    // the list renders `windowedMessages`, a tail window of it. Passing the full
    // history index straight to `scrollToIndex` therefore aimed at the wrong row
    // whenever the window did not start at 0, which is the normal case: tapping a
    // pinned message appeared to do nothing.
    //
    // `scrollToMessageIdRef` resolves the target against the data actually being
    // rendered, lazily hydrates the full history when the pin is older than the
    // loaded seed, and flashes the jump highlight so the jump is visible. All of
    // that already existed for reply-jumps; the pinned bar just was not using it.
    scrollToMessageIdRef.current(activePin.message.id);
    if (pinnedResolved.length > 1) {
      setPinCursor((prev) => (prev + 1) % pinnedResolved.length);
    }
  }, [activePin, pinnedResolved.length]);

  // ── Typing indicator ────────────────────────────────────────────────────────
  //
  // `typingChannel` is null until the canonical conversation id is resolved, which is what
  // keeps typing off the transient peer-user-id bucket a chat opened from a profile starts in.
  // The publisher holds no state and returns stable callbacks, so handing `notifyTyping` to
  // the memoized composer does not cost a re-render per keystroke.
  const typingChannel = conversationId ? typingChatChannelName(conversationId) : null;
  const { notifyTyping, notifyStopped } = useTypingPublisher(typingChannel);

  const handleSend = useCallback(async (rawText: string) => {
    const hasImages = pendingImages.length > 0;
    if ((!rawText.trim() && !hasImages) || !conversationId) return;
    // Clear the peer's "is typing" immediately rather than letting it lapse — the message
    // itself is about to arrive, so leaving the indicator up for another few seconds would
    // read as a second message on the way.
    notifyStopped();
    triggerHaptic('medium');
    playSendSound();
    // Strip dangerous invisible / control / bidi-override chars; keep
    // decorative Unicode + emoji. sanitizeUserText also trims.
    const text = sanitizeUserText(rawText);

    if (editing) {
      // Re-upload any newly added local images (those that aren't already remote URLs)
      let finalImages: string[] | undefined = pendingImages.length > 0 ? pendingImages : undefined;
      const localOnes = pendingImages.filter((u) => !u.startsWith('http'));
      setEditing(null);
      setPendingImages([]);
      setMessages(conversationId, (useChatStore.getState().messages[conversationId] || []).map((m) => (m.id === editing.id ? { ...m, text, imageUrls: finalImages } : m)) as any);
      if (localOnes.length > 0) {
        const results = await Promise.all(pendingImages.map((u) => u.startsWith('http') ? Promise.resolve({ url: u, error: null }) : uploadChatImage(u)));
        const urls = results.map((r) => r.url).filter(Boolean) as string[];
        setMessages(conversationId, (useChatStore.getState().messages[conversationId] || []).map((m) => (m.id === editing.id ? { ...m, imageUrls: urls.length ? urls : undefined } : m)) as any);
        finalImages = urls.length ? urls : undefined;
      }
      // Sync the edit to the peer's open chat. The receiver's subscription
      // handler updates the message in place by id. Same caveats as
      // realtime delete — only matches by message.id, so peers viewing
      // history loaded from Supabase (which has its own UUIDs) won't see
      // the edit; but anyone who received the message via the live Ably
      // stream WILL.
      try {
        const realtime = getRealtime();
        if (realtime && conversationId) {
          const channel = realtime.channels.get(chatChannelName(conversationId));
          void channel.publish('msg.edit', {
            // Prefer the server uuid — that is the id the peer stored the message
            // under, so a local `m-<ts>` id would never match on their side.
            id: editing.serverId || editing.id,
            text,
            imageUrls: finalImages,
          });
        }
      } catch {}
      return;
    }

    const currentReply = replyTo;
    setReplyTo(null);

    const localImages = pendingImages;
    setPendingImages([]);

    const newMessage: ChatMessage = {
      id: 'm-' + Date.now(),
      conversationId,
      senderId: currentUserId || 'current',
      text,
      createdAt: new Date().toISOString(),
      isRead: true,
      replyToId: currentReply?.id,
      replyToText: currentReply?.text || (currentReply?.imageUrls && currentReply.imageUrls.length > 0 ? (currentReply.imageUrls.length > 1 ? t('chat.photos_count', undefined, { n: currentReply.imageUrls.length }) : t('chat.photo')) : undefined),
      replyToIsOwn: currentReply ? (currentReply.senderId === currentUserId || currentReply.senderId === 'current') : undefined,
      replyToImage: currentReply?.imageUrls?.[0],
      // See sendGif — same per-chat pixel-icon stamp on outgoing
      // replies. Stays out of non-reply messages so memoized
      // bubbles don't re-render unnecessarily.
      replyPixelIconId: currentReply ? chatSettings.replyPixelIcon : undefined,
      imageUrls: localImages.length > 0 ? localImages : undefined,
    };
    addMessage(conversationId, newMessage);
    revealNewest();

    // Upload images in the background, then swap local URIs for remote URLs.
    // Skip all network work when offline so the JS thread / keyboard stay smooth.
    if (!useConnectivityStore.getState().isOnline) return;

    let uploadedUrls: string[] = [];
    if (localImages.length > 0) {
      setUploading(true);
      try {
        const results = await Promise.all(localImages.map((uri) => uploadChatImage(uri)));
        uploadedUrls = results.map((r) => r.url).filter(Boolean) as string[];
        if (uploadedUrls.length > 0) {
          setMessages(conversationId, (useChatStore.getState().messages[conversationId] || []).map((m) =>
            m.id === newMessage.id ? { ...m, imageUrls: uploadedUrls } : m
          ) as any);
        }
      } catch {}
      setUploading(false);
    }

    try {
      const { useAuthStore } = await import('../../src/store');
      const user = useAuthStore.getState().user;
      if (!user) return;

      const { apiPost } = await import('../../src/services/apiClient');
      const { data: convData } = await apiPost<{ conversation_id: string }>(
        '/v1/conversations',
        { otherUserId: participantId },
      );
      const convId = convData?.conversation_id || null;

      if (convId) {
        // Encode attached images into the stored text with a marker so it
        // round-trips without schema changes.
        const imageMarker = uploadedUrls.length > 0 ? `::img::${uploadedUrls.join('|')}::` : '';
        const { data: sentData } = await apiPost<{ id: string }>(
          `/v1/conversations/${encodeURIComponent(convId)}/messages`,
          { text: imageMarker + text },
        );
        // Reconcile the optimistic row's id with the server's canonical id.
        // The optimistic message was added with a client id (`m-<ts>`), but
        // the Worker stores it under a fresh uuid. Without recording that uuid, a
        // later history fetch (which carries it) fails to dedupe against the
        // optimistic row and renders a SECOND copy — the chat message-duplication
        // bug.
        //
        // We RECORD the server uuid in `serverId` rather than overwriting `id`.
        // Overwriting it changed a mounted row's React key, which forces FlashList to
        // unmount and remount that cell; remounting the newest (often tallest,
        // image-bearing) bubble re-measures it with `autoscrollToBottomThreshold`
        // armed, so the list re-autoscrolled — a visible nudge on every single send.
        // `chatStore.addMessage` dedupes on EITHER identity (see `isSameMessage`), so
        // keeping the local id stable loses nothing.
        const serverMessageId = sentData?.id || newMessage.id;
        if (serverMessageId !== newMessage.id) {
          setMessages(
            conversationId,
            (useChatStore.getState().messages[conversationId] || []).map((m) =>
              m.id === newMessage.id ? { ...m, serverId: serverMessageId } : m,
            ) as any,
          );
        }

        // Publish to the realtime channel so the peer's chat screen picks
        // up this message instantly. The channel name is `chat:<id>` (the
        // route param), so both sides see the same channel as long as they
        // navigated through the same conversation entry. We deliberately
        // publish AFTER the Supabase insert resolved — that guarantees the
        // peer's optimistic addMessage maps to a real DB row, so when they
        // re-open the chat the message persists.
        //
        // We ALSO publish to the peer's personal `user:<peerId>:notifications`
        // channel so the message + the conversation entry appear in their
        // messages-tab list before they open the chat at all (Telegram-style
        // "new chat appears with first message"). RealtimeAccountBridge
        // subscribes to this channel app-wide.
        try {
          const realtime = getRealtime();
          if (realtime) {
            const messageBody = {
              id: serverMessageId,
              senderId: user.id,
              text,
              createdAt: newMessage.createdAt,
              imageUrls: uploadedUrls.length > 0 ? uploadedUrls : undefined,
              replyToId: newMessage.replyToId,
              replyToText: newMessage.replyToText,
              replyToIsOwn: newMessage.replyToIsOwn,
              replyToImage: newMessage.replyToImage,
              replyPixelIconId: newMessage.replyPixelIconId,
            };
            if (id) {
              const chatChan = realtime.channels.get(chatChannelName(convId));
              void chatChan.publish('msg', messageBody);
            }
            // Peer notification (messages-tab row + preview) is published
            // SERVER-SIDE by the Worker after POST /messages using the Ably
            // root key. The client token is scoped to `chat:*` + `user:<self>:*`
            // only, so publishing to `user:<peer>:notifications` from here just
            // throws a 40160 capability error. Removed — see messages.ts.
          }
        } catch {}
      }

      // Converge the local picture onto the canonical conversation id the
      // server just handed back (Bug 3) — upserts the list row deduped by
      // participant, migrates optimistic messages, and re-keys the route.
      reconcileConversation(convId, text || (uploadedUrls.length > 0 ? '📷' : ''));
    } catch {}
  }, [pendingImages, conversationId, editing, replyTo, currentUserId, chatSettings.replyPixelIcon, participantId, id, t, addMessage, revealNewest, setMessages, reconcileConversation, notifyStopped]);

  // ── Media-panel long-press actions (Task B) ───────────────────────────────
  // Additive callbacks wired down through MediaPanel → Emoji/Gif panels. A
  // normal tap keeps its existing behavior (insert emoji / send GIF); a
  // long-press opens a small preview popup whose buttons call these.
  //
  // Send an emoji as its own chat message (reuses the full send pipeline,
  // including reply context). Distinct from onPickEmoji, which only inserts
  // into the composer for multi-pick.
  const onSendEmojiMessage = useCallback((emoji: string) => {
    if (!emoji) return;
    void handleSend(emoji);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Copy a single emoji to the system clipboard.
  const onCopyEmoji = useCallback((emoji: string) => {
    if (!emoji) return;
    Clipboard.setStringAsync(emoji);
    showToast(t('toast.copied'), 'check');
  }, [t]);

  // Copy a GIF. The GIF lives as a remote URL (we never re-host it), so the
  // cheap, reliable action is to copy that URL string — pasteable into any
  // chat/app that resolves GIPHY links.
  const onCopyGif = useCallback((item: GiphyItem) => {
    if (!item?.sendUrl) return;
    Clipboard.setStringAsync(item.sendUrl);
    showToast(t('toast.copied'), 'check');
  }, [t]);

  const handleSwipeActive = useCallback((active: boolean) => {
    // Ref-based scroll lock — replaces the old `setScrollEnabled` state
    // toggle. The state-driven version was a contributor to the swipe
    // jitter the user reported: every grant/release re-rendered this
    // entire screen (it's the parent of the FlatList), the FlatList
    // re-evaluated its `scrollEnabled` prop, and on weak Android that
    // re-evaluation could briefly take the responder back from the
    // bubble's swipe gesture mid-stream. `setNativeProps` writes the
    // flag straight to the underlying ScrollView with zero React work,
    // so the bubble keeps the gesture for the whole interaction. Now
    // that the swipe gesture itself runs on the UI thread (RNGH), this
    // is also the only JS-thread work per swipe — fired ONCE on
    // activate and ONCE on end, never per frame.
    try { (flatListRef.current as any)?.setNativeProps?.({ scrollEnabled: !active }); } catch {}
  }, []);

  // Parse the ::img::url1|url2:: marker for messages coming from the DB, and
  // heal any legacy relative senderId ('current'/'peer') to a real uuid so
  // ownership compares correctly at render time.
  //
  // Memoized by RAW item ref via a WeakMap so a given message is parsed at
  // most once (re-parsing only when the store hands us a NEW object for that
  // id — i.e. the message actually changed). This keeps the parsed `m` object
  // identity stable across renders, so `MemoMessageBubble`'s `imageUrls` ref
  // check and the FlatList cell bail-outs hold during scroll instead of
  // allocating a fresh object on every `renderItem` call. The cache is rebuilt
  // (cleared) whenever the identity inputs (`currentUserId`/`participantId`)
  // change, so healed ownership can never go stale.
  const parseCache = useMemo(() => new WeakMap<ChatMessage, ChatMessage>(), [currentUserId, participantId]);
  const parseMessage = useCallback((m: ChatMessage): ChatMessage => {
    const cached = parseCache.get(m);
    if (cached) return cached;
    const healed = healLegacySender(m, currentUserId, participantId);
    let result: ChatMessage;
    if (healed.imageUrls || !healed.text?.startsWith('::img::')) {
      result = healed;
    } else {
      const end = healed.text.indexOf('::', 7);
      if (end === -1) {
        result = healed;
      } else {
        const urls = healed.text.slice(7, end).split('|').filter(Boolean);
        result = { ...healed, imageUrls: urls.length ? urls : undefined, text: healed.text.slice(end + 2) };
      }
    }
    parseCache.set(m, result);
    return result;
  }, [currentUserId, participantId, parseCache]);

  const activeMatchIndex = searchMatches.length > 0 ? searchMatches[searchActiveIdx] : -1;
  const activeMatchId = activeMatchIndex >= 0 && activeMatchIndex < chatMessages.length ? chatMessages[activeMatchIndex]?.id : null;

  // ── THE RENDER WINDOW IS GONE. FlashList GETS THE WHOLE ARRAY. ─────────────
  //
  // What used to be here: a second, dynamic front edge on top of the seed. `data` was
  // `chatMessages.slice(windowStart)` where `windowStart` came from `computeWindowStart`
  // (a monotonic front edge remembered by message id), `renderWindow` started at 40 and
  // grew by 30 whenever `onStartReached` fired, and an anchor id plus a lookup cache kept
  // the edge stable across appends, prepends, deletes and window growth.
  //
  // It was careful, property-tested machinery, and it was the source of the bug. Growing
  // the window PREPENDS rows, once per upward scroll chunk. Six separate attempts to make
  // those prepends invisible all failed:
  //
  //   1. shrink the growth step               2. remove the post-open full expansion
  //   3. restore position via scrollToIndex   4. change the anchor to the visible row
  //   5. arm growth only after a real scroll  6. delete the restore, trust mvcp
  //
  // Attempt 6 was correct about mvcp -- FlashList v2 does compensate a prepend, from
  // measured layouts -- and the teleport still survived, which settles the question: the
  // problem is not HOW the prepends are compensated, it is that a scroll gesture triggers
  // repeated front-edge growth at all. Every chunk is another content-height change above
  // the viewport, another correction, another chance for the correction to land while row
  // heights are still converging. Removing the prepends removes the whole class.
  //
  // WHY THIS IS SAFE, i.e. why the window was not buying what its comment claimed
  //   The old comment said the cap stops a huge chat "building a giant element tree at
  //   once". FlashList v2 is a recycler: it mounts what fits on screen plus a small
  //   overscan, and the length of `data` does not change that. Capping `data` on top of
  //   that is not a second layer of virtualisation, it is just a moving front edge -- all
  //   of the cost, none of the benefit.
  //
  // WHAT STILL KEEPS THE OPEN FRAME CHEAP
  //   The SEED, which is untouched. Opening a chat parses only the `SEED_CAP` (60) newest
  //   messages out of a dedicated tail cache, so first paint is O(60) no matter how long
  //   the conversation is. The full history is hydrated lazily, on demand, and now that is
  //   the ONLY event that ever grows the array at the front -- once per screen, instead of
  //   once per 400 ms of upward scrolling.
  const windowedMessages = chatMessages;
  // Mirror of the rendered rows, so `onScrollBtnTap` can address the last
  // message by index while staying a STABLE callback (depending on
  // `windowedMessages` directly would re-create it on every message change, and
  // FlashList re-reads its props when a callback identity changes).
  //
  // A plain ref write derived from the same render pass — no subscription, so it
  // cannot tear.
  const windowedMessagesRef = useRef<ChatMessage[]>([]);
  windowedMessagesRef.current = windowedMessages;

  // Resolve a pending jump against the data FlashList is ACTUALLY rendering (see
  // the note on `pendingJumpRef`). Re-runs on every window change, so a jump
  // requested before an expansion lands simply completes on the commit where the
  // row appears. Bounded retries so a target deleted in the meantime cannot latch
  // this forever.
  useEffect(() => {
    const pending = pendingJumpRef.current;
    if (!pending) return;
    const idx = windowedMessages.findIndex((m) => m.id === pending.id);
    if (idx === -1) {
      pending.tries += 1;
      if (pending.tries > 10) pendingJumpRef.current = null;
      return;
    }
    const { viewPosition, animated } = pending;
    pendingJumpRef.current = null;
    // Claim the scroll generation so a `revealNewest` / scroll-to-bottom chain that
    // is mid-flight abandons its follow-up rather than yanking us off the target.
    const gen = ++scrollGenRef.current;
    // One frame so the row has been laid out before we ask to scroll to it.
    const raf = requestAnimationFrame(() => {
      if (gen !== scrollGenRef.current) return;
      try {
        flatListRef.current?.scrollToIndex({ index: idx, animated, viewPosition });
      } catch {}
    });
    return () => cancelAnimationFrame(raf);
    // `jumpNonce` makes every jump request run this at least once; `windowedMessages`
    // makes a request that needed a bigger window complete on the commit where the
    // row finally appears. Both are required — see the note on `jumpNonce`.
  }, [windowedMessages, jumpNonce]);

  // Are there older messages above what is rendered? Now exactly one condition: the
  // bounded seed hit its cap, so the tail cache has more history behind it that has not
  // been hydrated yet. There is no `windowStart > 0` case any more -- once hydrated, the
  // array IS the whole history. Drives the top "loading older" glow.
  // Older messages exist above what is rendered until a chunk load comes back empty. The old
  // condition (`not hydrated && seed hit its cap`) could only ever be true once, because
  // hydration was all-or-nothing; with paged loading the answer changes per page.
  const hasMoreOlder = moreOlderRef.current && chatMessages.length > 0;

  // Reaching the TOP hydrates the rest of the history from the local cache — once, ever.
  // Never the network, and no window to grow any more.
  const loadingOlderRef = useRef(false);
  const olderHandleRef = useRef<{ cancel: () => void } | null>(null);
  // False until the user's first scroll. See the note at the top of `onStartReached`.
  const startReachedArmedRef = useRef(false);

  // Cancel a pending hydrate on unmount / conversation change. It used to be a bare
  // `setTimeout` that was never cleared, so leaving the chat mid-load left work to fire
  // into a screen that had already moved on.
  useEffect(
    () => () => {
      olderHandleRef.current?.cancel();
      olderHandleRef.current = null;
      loadingOlderRef.current = false;
      // Paging state is per conversation. Without this reset a chat opened after one that had
      // been scrolled to its oldest message would start with `moreOlderRef` false and refuse
      // to load any history at all.
      moreOlderRef.current = true;
      cachedHistoryRef.current = null;
    },
    [conversationId],
  );

  const onStartReached = useCallback(() => {
    // ── Ignore this until the user has actually scrolled ──────────────────────
    //
    // `startRenderingFromBottom` means the list lays out and THEN positions itself at the
    // bottom. During that initial layout it is momentarily at offset 0 — the start — so
    // FlashList fires `onStartReached` on mount, before the user has touched anything.
    //
    // That is the other half of "as if all the messages load immediately". The chat opened,
    // immediately asked for older history, grew the window, and (with the cooldown) kept
    // asking as the layout settled. Nothing the user did caused it.
    //
    // The latch is armed by the first real scroll event (see `onChatScroll`), so loading
    // older history is now strictly user-initiated, which is what it was always meant to be.
    if (!startReachedArmedRef.current) return;
    // ONE-WAY LATCH, not a cooldown. There is exactly one thing left to do here — hydrate
    // the rest of the history — and it can only happen once per conversation, so the latch
    // is never released. The old 400 ms cooldown existed to rate-limit repeated window
    // growth; with no window there is nothing to rate-limit, and a latch that never opens
    // is strictly safer than a timer that re-arms mid-gesture.
    // ── NOT A ONE-WAY LATCH ANY MORE ─────────────────────────────────────────
    //
    // It used to be, because there was exactly one thing to do here (hydrate everything) and
    // it could only happen once. Now the top loads ONE CHUNK, so it has to be re-armed: the
    // guard exists to stop overlapping loads within a single gesture, not to stop the second
    // page from ever loading. `moreOlderRef` is what ends the sequence, when a load finds
    // nothing older left.
    if (loadingOlderRef.current) return;
    if (!moreOlderRef.current) return;
    loadingOlderRef.current = true;

    // ── Hydration must NOT run on the scroll frame ──────────────────────────
    //
    // This used to call `hydrateFullHistory()` synchronously, straight from the native
    // scroll callback. That function reads up to 1000 messages out of MMKV, maps every one
    // through `healLegacySender`, merges them against the store and then re-serialises the
    // tail cache — all synchronous, all on the JS thread, in the middle of a gesture. That
    // IS the "I scroll up and it's loading and lagging".
    //
    // Deferred behind `runAfterInteractions` the parse lands after the gesture rather than
    // inside it, and it is now a SINGLE data change at the front of the array for the whole
    // lifetime of the screen. FlashList's own offset correction handles exactly this case
    // (`applyOffsetCorrection` in src/recyclerview/hooks/useRecyclerViewController.tsx: it
    // records the first VISIBLE item's measured layout before the update, re-finds that key
    // afterwards — searching the full array, explicitly to survive prepends — and applies
    // `scrollBy(newY - oldY)`). It is gated only on `hasStableDataKeys()`, i.e.
    // `Boolean(keyExtractor)`, and `keyExtractor={chatKeyExtractor}` is passed below.
    //
    // So: one prepend, compensated by measured layouts, and nothing of ours competing with
    // it. Both hand-rolled restores that used to live here are gone.
    const handle = InteractionManager.runAfterInteractions(() => {
      olderHandleRef.current = null;
      loadOlderChunkRef.current();
      // Released only after the chunk has been committed, so a fling that keeps the list at
      // the top loads page after page instead of firing several loads at the same offset.
      loadingOlderRef.current = false;
    });
    olderHandleRef.current = handle;
  }, [conversationId]);

  // Tap-a-reply-to-jump: scroll to the message a reply is quoting and flash it.
  // `replyToId` is stored on every reply message (see sendText/sendGif). The
  // FlatList data IS `invertedMessages`, so the found index maps 1:1 to the row.
  const [jumpHighlightId, setJumpHighlightId] = useState<string | null>(null);
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollToMessageId = useCallback((messageId?: string) => {
    if (!messageId) return;
    let idx = chatMessages.findIndex((mm) => mm.id === messageId);
    if (idx < 0) {
      // Reply target is older than the loaded seed. Lazily hydrate the FULL
      // history from cache, then find it in the (oldest→newest) array — the
      // list data IS that array, so the index maps directly.
      const healed = historyHydratedRef.current === conversationId ? null : hydrateFullHistory();
      if (healed && healed.length > 0) {
        idx = healed.findIndex((mm) => mm.id === messageId);
        if (idx < 0) return;
      } else {
        return; // genuinely not in this conversation
      }
    }
    triggerHaptic('selection');
    setJumpHighlightId(messageId);
    if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current);
    jumpTimerRef.current = setTimeout(() => setJumpHighlightId(null), 1600);
    // Window-aware scroll: grows the visible window to include the target if
    // it's older than what's currently rendered, then maps to the row.
    scrollToIndex(idx);
  }, [chatMessages, conversationId, hydrateFullHistory, scrollToIndex]);
  useEffect(() => () => { if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current); }, []);

  // ── Stable indirection for `renderItem` ────────────────────────────────────
  //
  // `scrollToMessageId` depends on `chatMessages` and (through `scrollToIndex`) on
  // `renderWindow`, so it gets a NEW identity on every message change and every
  // window change. It was passed straight into `renderItem`'s dependency array,
  // which meant `renderItem` also churned on exactly those commits — so FlashList
  // re-rendered EVERY mounted cell on the same frame the data changed. That is the
  // multiplier that turned each of the scroll bugs above into visible jank.
  //
  // A ref-backed wrapper is stable for the component's whole lifetime while always
  // calling the latest implementation, so `renderItem` can be excluded from that
  // churn without going stale. Same trick the file already uses for
  // `hydrateFullHistoryRef`.
  const scrollToMessageIdRef = useRef(scrollToMessageId);
  scrollToMessageIdRef.current = scrollToMessageId;
  const stableJumpToMessage = useCallback((messageId?: string) => {
    scrollToMessageIdRef.current(messageId);
  }, []);

  // Guard against the freeze caused by rapid long-presses / taps while a menu is
  // opening or closing — see `useContextMenuGuard` (declared above with the
  // other hooks) for the time-lock + requestAnimationFrame defer.

  // ── GIF off-screen pause (viewability tracking) ───────────────────────
  // Track which message rows are actually on screen so animated images
  // (GIFs) only decode frames while visible. The visible set lives in a tiny
  // external store (`visTracker`) rather than component state: each bubble
  // subscribes to it individually (via `VisibilityBubble`), so a viewability
  // change re-renders ONLY the rows whose on-screen state flips — `renderItem`
  // no longer depends on the visible set, so its identity stays stable across
  // scroll and FlatList isn't forced to re-run for every mounted cell on each
  // viewability event. `ready` guards the window before FlatList reports its
  // first viewable set — until then everything is treated as visible so
  // nothing is paused incorrectly on open. Both config + handler are
  // ref-stable: FlatList warns (and can crash on some RN versions) if either
  // identity changes between renders.
  const visTrackerRef = useRef<VisibilityTracker | null>(null);
  if (!visTrackerRef.current) {
    let visibleSet = new Set<string>();
    let ready = false;
    let scrolling = false;
    // Ids of rows that contain an animated image (GIF). Only these rows are
    // affected by the scroll-pause gate.
    const gifIds = new Set<string>();
    // Per-row listeners keyed by message id. Keying by id (instead of one flat
    // Set) lets us notify ONLY the rows that change AND release GIFs one at a
    // time on scroll-settle (see `held` + the staggered pump below).
    const rowListeners = new Map<string, Set<() => void>>();
    const notify = (itemId: string) => {
      const set = rowListeners.get(itemId);
      if (set) set.forEach((fn) => fn());
    };
    const notifyAll = () => { rowListeners.forEach((set) => set.forEach((fn) => fn())); };

    // ── Staggered GIF resume ────────────────────────────────────────────
    // Pausing GIFs while scrolling is cheap and correct. The problem was the
    // RESUME: when the list settled we flipped EVERY visible GIF back to
    // autoplay on one frame, so expo-image kicked off ~10+ fresh decodes at
    // once → a ~500 ms long task / fps→0 on weak devices (perf monitor caught
    // ~14 giphy decodes inside a 19 ms window). Fix, per the same proven
    // one-per-interval pattern already used for first-reveal: hold all visible
    // GIFs paused when scrolling stops, then release ONE every
    // RESUME_INTERVAL_MS so at most ~2 decode concurrently. A generation
    // counter + clearResume() abort an in-flight stagger the instant a new
    // scroll begins.
    const RESUME_INTERVAL_MS = 90;
    // Hard cap on how many GIFs ANIMATE at once, even when the list is still.
    // A GIF-spam chat had 5-6 visible GIFs all decoding frames continuously →
    // fps 18. Telegram-style: only the first N visible GIFs play; the rest show
    // their static first frame (autoplay off) until they become one of the
    // first N (which changes as the user scrolls). This is the decisive fix for
    // the "GIF-heavy chat freezes" case.
    const GIF_ANIM_CAP = 2;
    const held = new Set<string>();
    let resumeGen = 0;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const clearResume = () => { if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; } };

    visTrackerRef.current = {
      subscribeRow(itemId, l) {
        let set = rowListeners.get(itemId);
        if (!set) { set = new Set(); rowListeners.set(itemId, set); }
        set.add(l);
        return () => {
          const s = rowListeners.get(itemId);
          if (s) { s.delete(l); if (s.size === 0) rowListeners.delete(itemId); }
        };
      },
      // A row's media animates only when it's on-screen. GIF rows are
      // additionally gated: paused for the whole active scroll, then held
      // paused until their staggered resume turn after the scroll settles.
      // Text/photo rows ignore both gates (their snapshot never changes when
      // scrolling toggles) so `useSyncExternalStore` bails them out.
      isVisible(itemId) {
        const onScreen = !ready || visibleSet.has(itemId);
        if (!onScreen) return false;
        if (gifIds.has(itemId)) {
          if (scrolling || held.has(itemId)) return false;
          // Concurrency cap: only the first GIF_ANIM_CAP visible GIFs animate.
          // visibleSet preserves viewable order (onViewableItemsChanged inserts
          // top→bottom), so we count GIF rows until we hit this one.
          let rank = 0;
          for (const vid of visibleSet) {
            if (!gifIds.has(vid)) continue;
            if (vid === itemId) return rank < GIF_ANIM_CAP;
            rank++;
            if (rank >= GIF_ANIM_CAP) break;
          }
          // Not located within the cap window (or visibleSet not ready) → if we
          // broke out past the cap, this GIF is beyond it → freeze.
          if (rank >= GIF_ANIM_CAP) return false;
        }
        return true;
      },
      update(next) {
        // Skip the listener fan-out when the viewable set is unchanged —
        // mirrors the old `setVisibleIds` dedupe so tiny scroll jitter is free.
        if (ready && next.size === visibleSet.size) {
          let same = true;
          for (const itemId of next) if (!visibleSet.has(itemId)) { same = false; break; }
          if (same) return;
        }
        visibleSet = next;
        ready = true;
        notifyAll();
      },
      setScrolling(b) {
        if (b === scrolling) return;
        scrolling = b;
        if (gifIds.size === 0) { clearResume(); held.clear(); return; }
        if (b) {
          // Scroll started → pause GIFs immediately (the `scrolling` flag does
          // it). Drop any pending resume + hold marks, and notify only the
          // VISIBLE GIF rows so just they re-render to stopAnimating(). Non-GIF
          // and off-screen rows have an unchanged snapshot → no re-render →
          // hitch-free scroll start.
          clearResume();
          held.clear();
          gifIds.forEach((gid) => { if (!ready || visibleSet.has(gid)) notify(gid); });
        } else {
          // Scroll settled → hold every currently-visible GIF, then release one
          // per RESUME_INTERVAL_MS. No notify on hold: the snapshot is already
          // `false` from the scroll, so nothing re-renders until its release.
          clearResume();
          const pending = [...gifIds].filter((gid) => (!ready || visibleSet.has(gid)));
          pending.forEach((gid) => held.add(gid));
          const gen = ++resumeGen;
          const step = () => {
            if (gen !== resumeGen) return; // a new scroll superseded this stagger
            const nextId = pending.shift();
            if (nextId === undefined) { resumeTimer = null; return; }
            held.delete(nextId);
            notify(nextId);
            resumeTimer = setTimeout(step, RESUME_INTERVAL_MS);
          };
          step();
        }
      },
      setHasGif(itemId, hasGif) {
        if (hasGif) gifIds.add(itemId); else { gifIds.delete(itemId); held.delete(itemId); }
      },
    };
  }
  const visTracker = visTrackerRef.current;
  // Deferred past the open-chat transition: FlatList fires its first
  // viewability callback the instant the initial cells lay out, which
  // landed on the same frame as the navigation slide-in and triggered an
  // immediate re-render of all five mounted bubbles. The 250 ms gate skips
  // that first burst — the list is already rendering everything visible
  // (initialNumToRender=5), so nothing is paused incorrectly during the gate.
  const viewabilityArmedRef = useRef(false);
  useEffect(() => {
    const handle = setTimeout(() => { viewabilityArmedRef.current = true; }, 250);
    return () => clearTimeout(handle);
  }, []);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 35 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    // Skip viewability-driven updates until the open-chat transition has
    // settled. See `viewabilityArmedRef` declaration above.
    if (!viewabilityArmedRef.current) return;
    const next = new Set<string>();
    for (const v of viewableItems) {
      if (v.isViewable && v.item?.id) next.add(v.item.id as string);
    }
    visTrackerRef.current?.update(next);
  }).current;

  // ── Day separators ────────────────────────────────────────────────────────
  //
  // Map of "message id → timestamp to label", holding ONLY the messages that
  // begin a new local calendar day. Rendered as a centred chip above the bubble.
  //
  // Why inside the row rather than as its own list item: the search / reply-jump
  // logic addresses messages by their INDEX into this array. Splicing separator
  // entries into the data would shift every index and silently break those jumps.
  // Drawing the chip as part of the first row of each day keeps indices identical.
  // Map of "message id → FULLY FORMATTED label", holding only the messages that
  // begin a new local calendar day.
  //
  // The formatting happens HERE, not inside `renderItem`. That is deliberate and
  // load-bearing: `useT()` allocates a brand-new function on every render, so
  // listing `t` (or `locale`, or `theme`) among `renderItem`'s dependencies makes
  // `renderItem` a fresh identity on EVERY render of this screen — and FlashList
  // then re-renders every mounted cell each time. Formatting up-front means
  // `renderItem` only closes over this Map, whose identity changes just once per
  // messages/locale change.
  //
  // `Date.now()` is read once per recompute rather than per row: it decides
  // "Today"/"Yesterday", and reading a fresh clock per row would let two chips
  // disagree if the list happened to render across midnight.
  const dayLabels = useMemo(() => {
    const separators = buildDaySeparators(windowedMessages);
    const now = Date.now();
    const out = new Map<string, string>();
    for (const [id, iso] of separators) {
      const label = formatDaySeparator(iso, now, locale, t);
      if (label) out.set(id, label);
    }
    return out;
    // `t` is intentionally NOT a dependency — it is a fresh function every
    // render, and `locale` is the value that actually changes the output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowedMessages, locale]);

  // `dayLabels` is rebuilt on every data change, so depending on it directly gave
  // `renderItem` a new identity on those exact commits — and FlashList re-renders
  // every mounted cell when `renderItem`'s identity changes. Read through a ref
  // instead: the map contents are still current, but the callback is not invalidated.
  // The rows that actually need a NEW label re-render anyway, because their item
  // object changed.
  const dayLabelsRef = useRef(dayLabels);
  dayLabelsRef.current = dayLabels;

  const renderItem = useCallback(({ item }: { item: ChatMessage; index: number }) => {
    const m = parseMessage(item);
    const dayLabel = dayLabelsRef.current.get(item.id);
    return (
      <>
      {dayLabel ? <DaySeparatorChip label={dayLabel} glassActive={glassActive} theme={theme} /> : null}
      <VisibilityBubble
        tracker={visTracker}
        message={m}
        isOwn={m.senderId === currentUserId}
        fontSize={chatSettings.fontSize}
        bubbleRadius={chatSettings.bubbleRadius}
        fontFamily={chatSettings.fontFamily}
        linkEmoji={chatSettings.linkEmoji}
        bubbleColors={bubbleColors}
        bubbleOpacity={bubbleOpacity}
        bubbleTextColor={bubbleTextColor}
        inColors={inColors}
        inOpacity={inOpacity}
        inTextColor={inTextColor}
        highlighted={item.id === activeMatchId || item.id === jumpHighlightId}
        imagesReady={imagesReady}
        onReply={startReply}
        onReplyJump={stableJumpToMessage}
        onLongPress={onMessageLongPress}
        onMeasured={stashBubbleRect}
        onSwipeActive={handleSwipeActive}
        onImagePress={openImageViewer}
        dragActive={dragActiveSV}
        dragFingerY={dragFingerYSV}
        hoveredAction={hoveredActionSV}
        actionZones={actionZonesSV}
        onFireDragAction={fireDragAction}
        onOpenFullscreen={openFullscreen}
      />
      </>
    );
    // NOTE: `t` and `locale` are deliberately absent — see `dayLabels` above.
    // Adding either (or anything else allocated fresh per render) re-creates
    // `renderItem` on every render and makes FlashList re-render every cell.
    // NOTE: `scrollToMessageId` and `dayLabels` are deliberately absent too — both
    // change identity on every data/window change and are reached through refs
    // (`stableJumpToMessage`, `dayLabelsRef`) for exactly that reason.
  }, [chatSettings.fontSize, chatSettings.bubbleRadius, chatSettings.fontFamily, chatSettings.linkEmoji, bubbleColorsKey, bubbleColors, bubbleOpacity, bubbleTextColor, inColorsKey, inColors, inOpacity, inTextColor, startReply, stableJumpToMessage, handleSwipeActive, openImageViewer, parseMessage, activeMatchId, jumpHighlightId, onMessageLongPress, currentUserId, dragActiveSV, dragFingerYSV, hoveredActionSV, actionZonesSV, fireDragAction, visTracker, imagesReady, glassActive, theme, openFullscreen]);

  // Stable list header / footer elements. Passing INLINE JSX to FlashList's
  // ListHeaderComponent / ListFooterComponent handed it a fresh element
  // identity on every ChatScreen re-render (reply / edit / keyboard /
  // scroll-button state all re-render this screen), forcing FlashList to
  // reconcile the header subtree — which holds the animated
  // OlderMessagesLoader — and the footer spacer each time. Memoizing them
  // keeps the element identities stable except when their real inputs change
  // (header height, the "more older" flag, accent color, footer height).
  const listHeaderEl = useMemo(
    () => (
      <View>
        {/* Exactly `headerContentHeight`, with NO extra padding. The top scrim's gradient is
            `headerContentHeight` tall (headerScrimHeights → gradient, overhang 0), so any
            spacer taller than that pushes the first message below where the ramp ends and
            leaves a lit strip between them — "the dimming ends higher than the content".
            Home does `paddingTop: headerContentHeight` and the edges coincide; this used to
            be `+ 8` and they did not. */}
        <View style={{ height: headerContentHeight }} />
        <OlderMessagesLoader visible={hasMoreOlder} color={theme.colors.accent.primary} />
      </View>
    ),
    [headerContentHeight, hasMoreOlder, theme.colors.accent.primary],
  );
  const listFooterEl = useMemo(
    () => <View style={{ height: LIST_FOOTER_HEIGHT }} />,
    [LIST_FOOTER_HEIGHT],
  );

  // Stable callback refs for FlatList — without these, every parent render
  // hands FlatList fresh function identities and breaks its row recycling
  // shortcuts. Both functions only close over `flatListRef.current`, so they
  // never need to change.
  const chatKeyExtractor = useCallback((item: ChatMessage) => item.id, []);
  // Recycle pools by bubble SHAPE so FlashList reuses a text cell only as
  // another text cell, an image cell as another image cell, etc. Without this,
  // scrolling reshapes a recycled text bubble into an image bubble (and back),
  // which forces a full re-layout of that cell on the scroll frame — a real
  // contributor to scroll jank in image/GIF-mixed histories.
  const chatGetItemType = useCallback((item: ChatMessage) => {
    const n = item.imageUrls?.length || 0;
    if (n === 0) return 'text';
    return n === 1 ? 'media1' : 'mediaN';
  }, []);
  // NOTE: the old `onScrollToIndexFailed` retry ladder lived here. FlashList v2
  // has no such prop — it resolves unmeasured targets internally — so the
  // callback was dead code being handed to a list that never calls it. Kept the
  // `jumpAttemptRef` reset at the jump sites (harmless, and still useful if we
  // ever need to reinstate a bounded retry on top of scrollToIndex).

  // ── Scroll-to-bottom button ────────────────────────────────────────────
  // Telegram-style floating affordance that appears when the user has
  // scrolled away from the newest message. The chat list is INVERTED, so
  // newest = offset 0 and "scrolled up = away from newest" maps to
  // `contentOffset.y > THRESHOLD`. Visibility is throttled state +
  // native-driver opacity tween so the show/hide is free on the JS thread.
  // Per-chat toggle in `chatSettings.scrollToBottomButton` (default true)
  // gates rendering at the JSX level, so an opted-out user pays nothing.
  const SCROLL_BTN_THRESHOLD = 120;
  const [scrollBtnVisible, setScrollBtnVisible] = useState(false);
  const scrollBtnOpacity = useRef(new Animated.Value(0)).current;
  // Last-event throttle. RN's `scrollEventThrottle={32}` already caps the
  // call rate at ~30 Hz on iOS; the JS-side guard here is belt-and-suspenders
  // so a chatty Android scroll listener can't churn `setState` either.
  const lastScrollEventAt = useRef(0);
  // Latch mirroring `revealScrollPaused`, so the pause is dispatched to React
  // once per gesture instead of once per scroll event. See `onChatScroll`.
  const scrollPausedRef = useRef(false);
  // Latest scroll metrics (offset / viewport height / content height) captured
  // on each scroll event. `onScrollBtnTap` reads these to decide whether to do
  // an instant pre-jump before the animated settle (see below).
  const scrollMetricsRef = useRef<{ y: number; layoutH: number; contentH: number } | null>(null);
  // Idle timer that releases the GIF-animation pause shortly after the last
  // scroll event (covers both drag and momentum/fling uniformly).
  const scrollIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChatScroll = useCallback((e: any) => {
    // Arm "load older" on the first real scroll event. Before this, `onStartReached` is
    // ignored — see the note there for why the list fires it on mount.
    startReachedArmedRef.current = true;
    // Pause GIF animation for the duration of the scroll: arm on every scroll
    // event (no-op once already paused), and release 180 ms after the last
    // one. Cheap — `setScrolling` only fans out to the bubbles on a true
    // change (scroll start / scroll settle).
    visTrackerRef.current?.setScrolling(true);
    // Halt ALL media decode (photos + GIFs) while scrolling so no bitmap decode
    // lands on a scroll frame — the per-image "freeze when it scrolls into view".
    //
    // SCROLL-JANK FIX: this used to call `setRevealScrollPaused(true)` on EVERY
    // native scroll event, and it sat ABOVE the 32 ms throttle below — so a fast
    // flick dispatched a React state update per event (60+/s). Each dispatch
    // re-renders this screen, and this screen owns the message list, so the very
    // gesture the pause was meant to protect was paying for a render storm.
    //
    // A ref latch makes the state flip exactly TWICE per gesture (scroll start,
    // scroll settle) instead of once per event. The pause semantics are
    // unchanged — only the dispatch count is.
    if (!scrollPausedRef.current) {
      scrollPausedRef.current = true;
      setRevealScrollPaused(true);
    }
    if (scrollIdleRef.current) clearTimeout(scrollIdleRef.current);
    scrollIdleRef.current = setTimeout(() => {
      visTrackerRef.current?.setScrolling(false);
      scrollPausedRef.current = false;
      setRevealScrollPaused(false);
    }, 180);
    const now = Date.now();
    if (now - lastScrollEventAt.current < 32) return;
    lastScrollEventAt.current = now;
    const ne = e?.nativeEvent;
    const y = ne?.contentOffset?.y ?? 0;
    const layoutH = ne?.layoutMeasurement?.height ?? 0;
    const contentH = ne?.contentSize?.height ?? 0;
    // Non-inverted list: the newest message is at the BOTTOM. Show the
    // scroll-to-bottom button when the user has scrolled UP away from it.
    const distanceFromBottom = contentH - (y + layoutH);
    scrollMetricsRef.current = { y, layoutH, contentH };
    const next = distanceFromBottom > SCROLL_BTN_THRESHOLD;
    setScrollBtnVisible((prev) => (prev === next ? prev : next));
  }, []);
  useEffect(() => () => { if (scrollIdleRef.current) clearTimeout(scrollIdleRef.current); scrollPausedRef.current = false; setRevealScrollPaused(false); }, []);
  useEffect(() => {
    Animated.timing(scrollBtnOpacity, {
      toValue: scrollBtnVisible ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [scrollBtnVisible, scrollBtnOpacity]);
  const onScrollBtnTap = useCallback(() => {
    triggerHaptic('light');
    const fl = flatListRef.current;
    if (!fl) return;

    // ── One move, not three ────────────────────────────────────────────────
    //
    // This used to be a hand-rolled three-stage sequence: an INSTANT
    // `scrollToOffset` to ~1.2 viewports from the bottom, then an animated
    // `scrollToEnd` on the next frame, then a 250 ms timer that fired a THIRD
    // un-animated `scrollToEnd` if the content height had changed meanwhile.
    // That is precisely the reported "it teleports me, then twitches up/down,
    // and only then finishes" — the pre-jump is visible as one jump, the
    // animated settle as another, and on a history whose cells measure late the
    // timer adds a third snap.
    //
    // It was written that way because an animated `scrollToEnd` from far up the
    // list animates across not-yet-measured variable-height bubbles, so the
    // target offset keeps moving. FlashList v2 has a first-class answer for
    // exactly that: `scrollToIndex` returns a PROMISE that resolves once the
    // target is actually reached, resolving cell measurement internally. (That
    // is also why v2 removed `onScrollToIndexFailed` — the retry ladder it used
    // to need is now the library's job.)
    //
    // So: ask for the last message and await it. The single follow-up
    // `scrollToEnd` is ordered by the promise rather than by a guessed timer,
    // and only covers the footer spacer below the final bubble — a few points,
    // un-animated, therefore invisible. One gesture, one move.
    const lastIndex = windowedMessagesRef.current.length - 1;
    if (lastIndex < 0) return;

    // Claim the scroll generation so any other chain already in flight
    // (`revealNewest`, a reply jump) abandons its follow-up instead of fighting
    // this one for the viewport.
    const gen = ++scrollGenRef.current;

    void (async () => {
      try {
        await fl.scrollToIndex({ index: lastIndex, animated: true, viewPosition: 1 });
        // Land past the footer spacer. Guarded because the user may have started
        // scrolling again, or navigated away, while the animation ran.
        if (gen !== scrollGenRef.current) return;
        flatListRef.current?.scrollToEnd({ animated: false });
      } catch {
        // Any rejection (index out of range after a concurrent data change,
        // list unmounted) falls back to the plain call, which is still correct
        // — just without the measured animation.
        if (gen !== scrollGenRef.current) return;
        try { flatListRef.current?.scrollToEnd({ animated: true }); } catch {}
      }
    })();
  }, []);

  const banner = editing || replyTo;
  const menuIsOwn = actionMessage ? (actionMessage.senderId === currentUserId || actionMessage.senderId === 'current') : false;

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {chromeReady && chatSettings.backgroundImage && (
        <ChatBackgroundLayer uri={chatSettings.backgroundImage} style={StyleSheet.absoluteFill} />
      )}

      {/* Inverted list — newest message sits at the bottom with NO scrolling
          needed (exactly like the AI chat). This removes the open-at-top-then-
          jump-to-bottom behaviour entirely and makes keyboard handling trivial.
          The whole list is wrapped in a Reanimated.View whose translateY is
          driven by the keyboard frame on the UI thread, so when the keyboard
          rises every message rides up with it (last message stays visible
          above the input bar) without triggering FlatList layout. */}
      <Reanimated.View style={[StyleSheet.absoluteFill, listShiftStyle]} pointerEvents="box-none">
      <GestureDetector gesture={panelDismissTap}>
      {listReady ? (
      <FlashList
        ref={flatListRef}
        data={windowedMessages}
        keyExtractor={chatKeyExtractor}
        getItemType={chatGetItemType}
        renderItem={renderItem}
        // FlashList v2 (cell recycling). No `inverted` (removed in v2): instead
        // maintainVisibleContentPosition.startRenderingFromBottom puts the
        // NEWEST message at the bottom, and prepending OLDER messages at the top
        // keeps the viewport pinned. Recycling replaces every FlatList
        // virtualization knob — and it's exactly what removes the heavy
        // per-bubble mount-on-scroll cost (gestures + Reanimated layers) that
        // FlatList re-paid on every row scrolling into view.
        maintainVisibleContentPosition={MVCP_FROM_BOTTOM}
        // Bound how far ahead rows are built. Chat bubbles are expensive — each
        // carries gesture handlers and Reanimated layers — so an unbounded
        // pre-render window turns a fling through a media-heavy chat into a burst
        // of row construction plus image decodes landing on the same frames.
        // Halved again on weak hardware and in Low Power Mode.
        drawDistance={chatBudget.drawDistance}
        contentContainerStyle={LIST_CONTENT_CONTAINER_STYLE}
        // Non-inverted: ListHeaderComponent is the TOP (oldest) spacer under the
        // header gradient; ListFooterComponent is the BOTTOM spacer above the
        // input bar. (Swapped from the old inverted layout.)
        ListHeaderComponent={listHeaderEl}
        ListFooterComponent={listFooterEl}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        // Load OLDER history when the user nears the TOP (oldest) of the list.
        onStartReached={onStartReached}
        // 0.05, not 0.15. The threshold is a FRACTION of the content length, so on a short
        // window 0.15 is satisfied while the user is still nowhere near the top — the list
        // asked for older history unprompted. Combined with the cooldown in `onStartReached`,
        // loading now begins when the user is genuinely approaching the oldest loaded message.
        onStartReachedThreshold={0.05}
        // Scroll-to-bottom button visibility — onChatScroll computes distance
        // from the bottom (newest) from the scroll event.
        onScroll={onChatScroll}
        scrollEventThrottle={32}
      />
      ) : (
        <View style={StyleSheet.absoluteFill} />
      )}
      </GestureDetector>
      </Reanimated.View>

      {/* Static under-input gradient. Pinned to the bottom of the screen
          and intentionally OUTSIDE `KeyboardStickyView` so it does NOT
          ride up with the keyboard — when the user types, the input bar
          animates above the keyboard while this fade stays anchored at
          the screen bottom, reading as a fixed chrome element. Z-order
          here matters: rendered after the FlatList wrapper (so it paints
          over the message list) but before the `KeyboardStickyView`
          below (so the input bar paints over it). Three-stop fade
          mirrors the top-header gradient so messages scrolling past
          ghost into the chrome rather than being hard-clipped. Static
          height, no animation — it simply sits there. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: composerScrimHeight(insets.bottom, 12) }}
      >
        {/* Shared scrim ramp (src/theme/scrim.ts). These stops used to be local
            (`[bgTransparent, bgColor + 'B3', bgColor]`, midpoint 0.45) — a
            background-coloured fade rather than the black ramp used behind the tab
            bar, which is why the chat's scrim looked like a different effect from
            every other screen's.

            Height is the COMPOSER's footprint, not `LIST_FOOTER_HEIGHT` and not the tab
            bar's `BOTTOM_CHROME_SCRIM_HEIGHT`. All three are different measurements:

              LIST_FOOTER_HEIGHT        44 + pad + 12   clears the composer AND leaves room
              BOTTOM_CHROME_SCRIM_HEIGHT           84   the TAB BAR's footprint
              composerScrimHeight(...)  8 + 44 + pad    THIS composer's footprint

            Both wrong answers have now been tried. `LIST_FOOTER_HEIGHT` put 20 pt of ramp
            over the messages; the tab bar's 84 fell 2 pt SHORT of the field, leaving an
            un-dimmed strip right above it. Only the composer's own footprint makes the ramp
            finish level with the top of the input, which is the property that makes the tab
            bar's scrim read the way it does. Same rule, different chrome. */}
        <LinearGradient
          colors={bottomScrimColorsStrong(theme.isDark, bgColor)}
          locations={SCRIM_LOCATIONS}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Scroll-to-bottom button. Rendered ABOVE the gradient (so the
          chevron is fully readable, not ghosted into the fade) but BELOW
          the input bar in z-order. Anchored to the bottom of the screen
          with a static offset (`LIST_FOOTER_HEIGHT - 36` parks it just
          barely above the input bar's top edge, so it visually anchors
          to the input rather than floating in the chat area), and the
          entire wrapper is a Reanimated.View driven by `listShiftStyle`
          so it rides up with the input bar when the keyboard rises —
          `listShiftY` already tracks the live keyboard height (driven
          by `useKeyboardHandler.onMove`), so reusing the same shared
          value keeps the button perfectly in lockstep with the input
          bar across both keyboard-up and interactive-dismiss frames.

          Gated entirely on `chatSettings.scrollToBottomButton`: when off,
          nothing mounts (no scroll listener cost, no opacity animator). */}
      {chatSettings.scrollToBottomButton && (
        <Reanimated.View
          pointerEvents="box-none"
          style={[
            // Offset chosen so the button sits noticeably above the input
            // bar with a small visible gap (~28 px between bottom of button
            // and top of input bar). `LIST_FOOTER_HEIGHT - 8` puts the
            // button BOTTOM 8 px below the input bar's top, and the button
            // is 36 px tall, so the top edge sits ~28 px above the input
            // bar — easy to reach without crowding the bar itself.
            { position: 'absolute', right: 16, bottom: LIST_FOOTER_HEIGHT - 8 },
            listShiftStyle,
          ]}
        >
          <Animated.View
            // Reveal animation. `pointerEvents` follows the visibility flag so
            // the button is non-interactive while hidden — prevents a "hidden
            // but tappable" footgun where a mis-targeted tap near the input bar
            // fires `scrollToOffset` unexpectedly.
            //
            // GLASS-SAFE: when liquid glass is on we must NOT animate `opacity`
            // on this wrapper — an animated/non-1 opacity on a parent stops the
            // native UIVisualEffectView from drawing, which is exactly why the
            // glass capsule below was rendering as just a dark bordered circle.
            // So we drive a `scale` transform (0→1) instead, which the native
            // driver supports and which leaves glass intact. Non-glass keeps
            // the lighter opacity fade.
            pointerEvents={scrollBtnVisible ? 'auto' : 'none'}
            style={glassActive ? { transform: [{ scale: scrollBtnOpacity }] } : { opacity: scrollBtnOpacity }}
          >
            {glassActive ? (
              // SAME proven glass pattern as the chat header circles
              // (`headerCircleGlass`): the icon lives INSIDE an interactive
              // NativeGlassView with NO backgroundColor / border / overflow so
              // the real liquid surface renders and morphs on touch. The
              // previous GlassBg-background version sat behind a semi-opaque
              // dark fill, so the glass sampled that dark fill and just looked
              // like a flat dark circle — which is what showed up as "no glass".
              // The wrapper above animates `scale` (not opacity), so the native
              // UIVisualEffectView keeps drawing.
              <Pressable onPress={onScrollBtnTap} hitSlop={6} style={{ borderRadius: 18 }}>
                <NativeGlassView
                  glassStyle="regular"
                  isInteractive
                  colorScheme={theme.isDark ? 'dark' : 'light'}
                  style={styles.headerCircleGlass}
                >
                  <Feather name="chevron-down" size={20} color={theme.colors.text.primary} />
                </NativeGlassView>
              </Pressable>
            ) : (
              <Pressable
                onPress={onScrollBtnTap}
                hitSlop={6}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: theme.colors.background.elevated,
                  borderWidth: 1,
                  borderColor: theme.colors.border.light,
                  alignItems: 'center',
                  justifyContent: 'center',
                  // Soft elevation so the button reads as floating chrome
                  // rather than blending into the fade beneath it. Same
                  // shadow recipe as the existing header pills.
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.15,
                  shadowRadius: 4,
                  elevation: 3,
                }}
              >
                <Feather name="chevron-down" size={20} color={theme.colors.text.primary} />
              </Pressable>
            )}
          </Animated.View>
        </Reanimated.View>
      )}

      {/* Input bar — manually keyboard-stuck via `barWrapStyle` (translateY =
          -max(keyboardHeight, panelHeight)). Replaces KeyboardStickyView so we
          can fold in the emoji-panel lift as a MONOTONIC max(), eliminating the
          handoff jump. Hidden while searching. */}
      {!searchMode && (
      <Reanimated.View style={[{ position: 'absolute', left: 0, right: 0, bottom: 0 }, barWrapStyle]}>
        {/* "…is typing" — above the reply/edit banner so it is the topmost thing in the
            composer stack and never covers the field. Owns its own realtime subscription
            (see the note in the component) so a typing event re-renders this strip alone
            rather than the whole transcript. Rides `barWrapStyle` with the rest of the
            stack, so it stays put relative to the input when the keyboard moves. */}
        <TypingIndicator channelName={typingChannel} />
        {banner && (
          <View style={[{ marginHorizontal: 12, marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden' }, glassActive ? null : { backgroundColor: theme.colors.background.elevated, borderWidth: 1, borderColor: theme.colors.border.light }]}>
            {glassActive ? <GlassBg borderRadius={12} glassStyle="regular" interactive={false} colorScheme={theme.isDark ? 'dark' : 'light'} tintColor={theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)'} /> : null}
            <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: theme.colors.accent.primary }} />
            <Feather name={editing ? 'edit-2' : 'corner-up-left'} size={15} color={theme.colors.accent.primary} />
            {banner.imageUrls && banner.imageUrls.length > 0 ? (
              <CachedImage uri={banner.imageUrls[0]} style={{ width: 32, height: 32, borderRadius: 6 }} resizeMode="cover" />
            ) : null}
            <View style={{ flex: 1 }}>
              <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} style={{ fontSize: 12 }}>{editing ? t('chat.editing') : t('chat.replying')}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 12 }}>{banner.text || (banner.imageUrls && banner.imageUrls.length > 0 ? `📷 ${banner.imageUrls.length > 1 ? t('chat.photos_count', undefined, { n: banner.imageUrls.length }) : t('chat.photo')}` : '')}</Text>
            </View>
            {/* Pixel-icon picker entry — only relevant on a reply
                compose, not on edit. Shows the currently-selected
                icon (per-chat) so the user can see at a glance what
                will be stamped onto the outgoing reply. Opens the
                picker bound to this chat. */}
            {!editing ? (
              <Pressable
                onPress={() => {
                  triggerHaptic('light');
                  router.push({ pathname: '/settings/pixel-icons', params: { purpose: 'chat-reply', chatId: id || '' } });
                }}
                hitSlop={8}
                style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
              >
                {chatSettings.replyPixelIcon ? (
                  <PixelIcon id={chatSettings.replyPixelIcon} size={22} />
                ) : (
                  <Feather name="image" size={18} color={theme.colors.text.tertiary} />
                )}
              </Pressable>
            ) : null}
            <Pressable onPress={() => { setReplyTo(null); setEditing(null); inputRef.current?.clear(); }} hitSlop={8}>
              <Feather name="x" size={18} color={theme.colors.text.tertiary} />
            </Pressable>
          </View>
        )}

        {/* Pending image attachments preview */}
        {pendingImages.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
            {pendingImages.map((uri, idx) => (
              <View key={idx} style={{ position: 'relative' }}>
                <CachedImage uri={uri} style={{ width: 60, height: 60, borderRadius: 10 }} resizeMode="cover" />
                <Pressable onPress={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))} style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="x" size={13} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <ChatInputBar
          ref={inputRef}
          isEditing={!!editing}
          hasPendingImages={pendingImages.length > 0}
          onSend={handleSend}
          onTyping={notifyTyping}
          onPickImages={openPhotoPanel}
          onPasteImage={pasteImageFromClipboard}
          onPasteImages={addPastedImages}
          onOpenGif={openGif}
          inputRowStyle={inputRowStyle}
          emojiOpen={emojiOpen}
          gifOpen={gifOpen}
          onOpenEmoji={openEmoji}
          onToggleEmoji={closeEmojiToKeyboard}
        />
      </Reanimated.View>
      )}

      {/* Search-result actions. Mounted only while searching so the bar's own
          enter animation is not competing with the input bar's unmount, and gated
          on having a match so it never appears with nothing to act on. */}
      {searchMode && (
        <SearchActionBar
          visible={!!activeMatchMessage}
          isPinned={!!activeMatchMessage && pinnedIds.includes(activeMatchMessage.id)}
          bottomInset={insets.bottom}
          keyboardHeight={keyboardHeight}
          glassActive={glassActive}
          theme={theme}
          pinLabel={t('chat.pin', 'Закрепить')}
          unpinLabel={t('chat.unpin', 'Открепить')}
          deleteLabel={t('common.delete')}
          onPin={onPinSearchResult}
          onDelete={onDeleteSearchResult}
        />
      )}

      {/* Inline media panel — bottom-anchored in the space the keyboard
          vacated. One surface hosting BOTH the emoji grid and the GIF grid on
          a horizontal slide track, a shared recently-used-emoji row at the top,
          and a Telegram-style bottom GIF/Эмодзи switcher. Mounted while open so
          the keyboard's slide-down REVEALS it; rendered AFTER the input bar so
          it paints on top and receives scroll/touch. */}
      {!searchMode && panelTab && (
        <Reanimated.View
          pointerEvents="box-none"
          style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, height: emojiPanelHeight }, panelSlideStyle]}
        >
          <View style={{ flex: 1, paddingTop: EMOJI_GAP }}>
            <MediaPanel
              height={emojiPanelHeight - EMOJI_GAP}
              tab={panelTab}
              onTabChange={switchPanel}
              onSelectEmoji={onPickEmoji}
              onSelectGif={onPickGif}
              onBackspace={() => inputRef.current?.backspace()}
              recentEmoji={recentEmoji}
              recentGifs={recentGif}
              theme={theme}
              bottomInset={insets.bottom}
              labels={{ gif: t('media.tab.gif'), emoji: t('media.tab.emoji'), copy: t('media.action.copy'), send: t('media.action.send') }}
              onSendEmoji={onSendEmojiMessage}
              onCopyEmoji={onCopyEmoji}
              onSendGif={onPickGif}
              onCopyGif={onCopyGif}
            />
          </View>
        </Reanimated.View>
      )}

      {/* In-app gallery picker — replaces the OS photo sheet. Docked at the
          bottom, expandable by dragging its grabber. Rendered AFTER the media
          panel so it paints on top if both were ever briefly mounted, and gated
          on `!searchMode` for the same reason the input bar is. Picked assets are
          handed to `addPastedImages`, which owns the shared downscale/dimension-
          cache step — so panel-picked and clipboard-pasted photos take exactly the
          same path into the composer. */}
      {!searchMode && photoPanelOpen && (
        <PhotoPickerPanel
          collapsedHeight={emojiPanelHeight}
          bottomInset={insets.bottom}
          theme={theme}
          selectionLimit={Math.max(1, 6 - pendingImages.length)}
          labels={{
            title: t('chat.photos.title', 'Фото'),
            send: t('media.action.send'),
            systemPicker: t('chat.photos.system', 'Галерея'),
            permission: t('chat.photos.permission', 'Нет доступа к галерее. Можно выбрать фото через системную галерею.'),
            empty: t('chat.photos.empty', 'Фотографий нет'),
          }}
          onConfirm={addPastedImages}
          onOpenSystemPicker={() => {
            closePhotoPanel();
            void pickImages();
          }}
          onClose={closePhotoPanel}
        />
      )}

      {/* Gradient fade header — three stops with a translucent middle so
          content scrolling under the header reads as a soft ghost rather
          than being abruptly clipped by a solid bg slab. The chrome
          (back / name / avatar) sits ON TOP of the gradient, so it stays
          fully readable; only the message list behind it fades through
          the dimming zone. */}
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        {/* Shared scrim ramp — see the note on the footer gradient below. */}
        <LinearGradient
          colors={topScrimColors(theme.isDark, bgColor)}
          locations={SCRIM_LOCATIONS}
          style={StyleSheet.absoluteFill}
        />
        {searchMode ? (
          <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
            {glassActive ? (
              <NativeGlassView glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingHorizontal: 14, height: 40 }}>
                <Feather name="search" size={16} color={theme.colors.text.tertiary} />
                <TextInput
                  autoFocus
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={t('chat.search_placeholder')}
                  placeholderTextColor={theme.colors.text.tertiary}
                  style={[styles.searchInput, { color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular }]}
                />
                {searchQuery.length > 0 && (
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 12, marginRight: 4 }}>
                    {searchMatches.length > 0 ? `${searchActiveIdx + 1}/${searchMatches.length}` : '0'}
                  </Text>
                )}
              </NativeGlassView>
            ) : (
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 20, borderWidth: 1, borderColor: theme.colors.border.light, paddingHorizontal: 14, height: 40 }}>
                <Feather name="search" size={16} color={theme.colors.text.tertiary} />
                <TextInput
                  autoFocus
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={t('chat.search_placeholder')}
                  placeholderTextColor={theme.colors.text.tertiary}
                  style={[styles.searchInput, { color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular }]}
                />
                {searchQuery.length > 0 && (
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 12, marginRight: 4 }}>
                    {searchMatches.length > 0 ? `${searchActiveIdx + 1}/${searchMatches.length}` : '0'}
                  </Text>
                )}
              </View>
            )}
            {searchMatches.length > 0 && (
              <View style={{ flexDirection: 'row', marginLeft: 6 }}>
                {glassActive ? (
                  <Pressable onPress={goToPrevMatch} style={{ borderRadius: 18 }}>
                    <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.headerCircleGlass}>
                      <Feather name="chevron-up" size={18} color={theme.colors.text.primary} />
                    </NativeGlassView>
                  </Pressable>
                ) : (
                  <Pressable onPress={goToPrevMatch} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
                    <Feather name="chevron-up" size={18} color={theme.colors.text.primary} />
                  </Pressable>
                )}
                {glassActive ? (
                  <Pressable onPress={goToNextMatch} style={{ borderRadius: 18, marginLeft: 6 }}>
                    <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.headerCircleGlass}>
                      <Feather name="chevron-down" size={18} color={theme.colors.text.primary} />
                    </NativeGlassView>
                  </Pressable>
                ) : (
                  <Pressable onPress={goToNextMatch} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, marginLeft: 6 }]}>
                    <Feather name="chevron-down" size={18} color={theme.colors.text.primary} />
                  </Pressable>
                )}
              </View>
            )}
            {glassActive ? (
              <Pressable onPress={closeSearch} style={{ borderRadius: 18, marginLeft: 6 }}>
                <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.headerCircleGlass}>
                  <Feather name="x" size={20} color={theme.colors.text.primary} />
                </NativeGlassView>
              </Pressable>
            ) : (
              <Pressable onPress={closeSearch} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, marginLeft: 6 }]}>
                <Feather name="x" size={20} color={theme.colors.text.primary} />
              </Pressable>
            )}
          </View>
        ) : (
          <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
            {/* Left column hugs the back pill and never shrinks, so the
                localized "Назад" label is always shown in full. The center
                title column (flex:1) absorbs all the squeeze and truncates the
                conversation name instead. iOS-style chevron + label. */}
            <View style={styles.headerSide}>
              {glassActive ? (
                <Pressable onPress={() => router.back()} style={{ borderRadius: 18 }}>
                  <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.backPillGlass}>
                    <Feather name="chevron-left" size={22} color={theme.colors.text.primary} />
                    <Text variant="caption" weight="semibold" numberOfLines={1} color={theme.colors.text.primary} style={styles.backLabel}>{t('common.back')}</Text>
                  </NativeGlassView>
                </Pressable>
              ) : (
                <Pressable onPress={() => router.back()} style={[styles.backPill, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
                  <Feather name="chevron-left" size={22} color={theme.colors.text.primary} />
                  <Text variant="caption" weight="semibold" numberOfLines={1} color={theme.colors.text.primary} style={styles.backLabel}>{t('common.back')}</Text>
                </Pressable>
              )}
            </View>
            <View style={styles.headerTitleWrap}>
              {glassActive ? (
                <Pressable
                  onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId, fromChat: '1' } })}
                  onLongPress={openSearch}
                  delayLongPress={300}
                  style={{ borderRadius: 18, maxWidth: '100%' }}
                >
                  {/* The name Text + badges are CHILDREN of the interactive
                      glass; with no fixed width the children drive the pill's
                      width and the liquid surface morphs outward on touch. */}
                  <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.headerPillGlass}>
                    <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{displayName}</Text>
                    {displayVerified && <VerifiedBadge size={12} />}
                    {displayBadge && <UserBadge badge={displayBadge} size="sm" />}
                  </NativeGlassView>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId, fromChat: '1' } })}
                  onLongPress={openSearch}
                  delayLongPress={300}
                  style={[styles.headerPill, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}
                >
                  <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{displayName}</Text>
                  {displayVerified && <VerifiedBadge size={12} />}
                  {displayBadge && <UserBadge badge={displayBadge} size="sm" />}
                </Pressable>
              )}
            </View>
            <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>
              <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId, fromChat: '1' } })} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, overflow: 'hidden' }]}>
                <Avatar emoji={displayEmoji} name={displayName} size="xs" />
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* Pinned message. Docked just under the header content, above the header's
          own gradient, so the transcript scrolls beneath it like Telegram's. Only
          rendered when the pinned id still resolves against the live transcript —
          a deleted pin therefore leaves no stale quote behind. */}
      {activePin ? (
        <PinnedMessageBar
          top={headerContentHeight - 2}
          title={
            pinnedResolved.length > 1
              ? `${t('chat.pinned_message', 'Закреплённое сообщение')} ${(pinCursor % pinnedResolved.length) + 1}/${pinnedResolved.length}`
              : t('chat.pinned_message', 'Закреплённое сообщение')
          }
          preview={
            activePin.message.text ||
            (activePin.message.imageUrls && activePin.message.imageUrls.length > 0
              ? t('chat.photo')
              : '')
          }
          glassActive={glassActive}
          theme={theme}
          closeLabel={t('chat.unpin', 'Открепить')}
          onPress={onJumpToPinned}
          onUnpin={onUnpin}
        />
      ) : null}

      {/* Long-press message menu — in-screen overlay (not a native Modal) so it
          can never deadlock with the GIF/image/video modals. High zIndex keeps it
          above the input bar and header. */}
      {!!actionMessage && (
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
          <MessageContextMenu
            ref={menuRef}
            visible={!!actionMessage}
            message={actionMessage}
            isOwn={menuIsOwn}
            bubbleColor={menuIsOwn ? withOpacity(bubbleColors[0], bubbleOpacity) : theme.colors.background.tertiary}
            bubbleTextColor={menuIsOwn ? bubbleTextColor : theme.colors.text.primary}
            bubbleRadius={chatSettings.bubbleRadius}
            linkEmoji={chatSettings.linkEmoji}
            // Request the SAME proxy width the bubble already used, so the held
            // photo comes from expo-image's memory cache rather than being
            // re-fetched at a menu-specific size (a different cache key). This is
            // what made long-press look like it re-downloaded the image.
            imageProxyWidth={CHAT_IMG_MAX_W}
            dragActive={dragActiveSV}
            hoveredAction={hoveredActionSV}
            actionZones={actionZonesSV}
            onClose={closeMenu}
            onAction={handleMenuAction}
          />
        </View>
      )}

      {/* Translation sheet — opens when the user picks "Translate" from
          the long-press menu. Source text is the message body; target is
          the app's UI locale. */}
      <TranslationSheet
        visible={!!translateText}
        text={translateText}
        onClose={() => setTranslateText('')}
      />

      {/* Full-screen photo viewer. Extracted and memoized — inline, its pager was
          handed fresh `renderItem` / `keyExtractor` / `getItemLayout` identities on
          every re-render of this screen, so all three mounted full-screen images
          re-rendered mid-gesture. That was the "the modal lags badly when I drag it".
          `proxyWidth` matches the bubbles so pages come from the memory cache. */}
      <ImageViewerModal
        payload={viewerImages}
        onClose={closeImageViewer}
        topInset={insets.top}
        proxyWidth={CHAT_IMG_MAX_W}
      />
      <ScreenshotShield visible={screenshotDetected} />
      {/* Emoji "dissolve" burst overlay — renders nothing until a delete fires.
          pointerEvents none, native-driver particles. */}
      <EmojiDeleteBurst ref={burstRef} />
    </View>
  );
}

/**
 * Centred date chip drawn above the first message of each local calendar day.
 *
 * Memoized and driven by primitives only, so a chip is reconciled at most once
 * per label change — a bubble scrolling into view never re-renders its neighbour's
 * chip.
 *
 * Liquid glass: `GlassBg` sits BEHIND the label as a sibling (the app-wide rule),
 * never wrapping it, so the text is never optically warped by the material. The
 * flat path uses a translucent fill that reads on both light and dark chat
 * backgrounds, including user-set photo backgrounds.
 */
const DaySeparatorChip = React.memo(function DaySeparatorChip({
  label,
  glassActive,
  theme,
}: {
  label: string;
  glassActive: boolean;
  theme: any;
}) {
  return (
    <View style={styles.dayChipRow} pointerEvents="none">
      <View
        style={[
          styles.dayChip,
          glassActive
            ? null
            : {
                backgroundColor: theme.isDark
                  ? 'rgba(0,0,0,0.38)'
                  : 'rgba(255,255,255,0.72)',
              },
        ]}
      >
        {glassActive ? (
          <GlassBg
            borderRadius={12}
            glassStyle="regular"
            interactive={false}
            colorScheme={theme.isDark ? 'dark' : 'light'}
          />
        ) : null}
        <Text
          variant="caption"
          weight="semibold"
          color={theme.colors.text.secondary}
          style={styles.dayChipText}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </View>
  );
});

/**
 * One control in the search-result action bar. Icon over label, fixed-width
 * column — same shape as the chat list's bulk-action bar so the two read as the
 * same piece of chrome.
 */
const SearchActionButton = React.memo(function SearchActionButton({
  icon,
  label,
  color,
  onPress,
}: {
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.searchActionBtn} accessibilityRole="button" accessibilityLabel={label}>
      <Feather name={icon as any} size={19} color={color} />
      <Text variant="caption" weight="medium" color={color} style={{ fontSize: 10.5 }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
});

/**
 * Action bar for the ACTIVE search result.
 *
 * Appears where the input bar normally sits (the input bar is hidden while
 * searching, so this occupies chrome the user is already looking at) and acts on
 * the single message the ↑/↓ chevrons and the "3/17" counter point at — never on
 * "all matches", which would be an unbounded destructive action behind one tap.
 *
 * Slides in on translateY, never opacity: a GlassView with `opacity: 0` anywhere
 * in its parent chain loses its glass entirely (expo/expo#41024).
 */
const SearchActionBar = React.memo(function SearchActionBar({
  visible,
  isPinned,
  bottomInset,
  keyboardHeight,
  glassActive,
  theme,
  pinLabel,
  unpinLabel,
  deleteLabel,
  onPin,
  onDelete,
}: {
  visible: boolean;
  isPinned: boolean;
  bottomInset: number;
  keyboardHeight: SharedValue<number>;
  glassActive: boolean;
  theme: any;
  pinLabel: string;
  unpinLabel: string;
  deleteLabel: string;
  onPin: () => void;
  onDelete: () => void;
}) {
  const progress = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, { duration: 200, easing: Easing.out(Easing.cubic) });
  }, [visible, progress]);

  // Rides ON the keyboard.
  //
  // The search field autofocuses, so the keyboard is ALWAYS up while this bar is
  // relevant. Anchored to the screen bottom it was simply behind the keyboard —
  // the reported "the delete/pin buttons appear somewhere I can't see". Reading
  // `keyboardHeight` (the same `useReanimatedKeyboardAnimation` value the input bar
  // uses) keeps it just above the keyboard on the UI thread, so it tracks the
  // keyboard's own animation curve rather than approximating it.
  //
  // `keyboardHeight` is reported as 0 → -kbHeight by the library, hence the abs.
  const barStyle = useAnimatedStyle(() => {
    const raw = keyboardHeight.value;
    const kb = raw < 0 ? -raw : raw;
    // While the keyboard is up the bottom inset is already inside the keyboard's
    // footprint, so subtract it to avoid double-counting the home-indicator gap.
    const kbLift = kb > 1 ? kb - bottomInset : 0;
    const enter = interpolate(progress.value, [0, 1], [140, 0]);
    return { transform: [{ translateY: enter - kbLift }] };
  });

  return (
    <Reanimated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.searchActionBar,
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
    >
      {glassActive ? (
        <GlassBg borderRadius={22} glassStyle="regular" interactive={false} colorScheme={theme.isDark ? 'dark' : 'light'} />
      ) : null}
      <SearchActionButton
        icon={isPinned ? 'x-circle' : 'bookmark'}
        label={isPinned ? unpinLabel : pinLabel}
        color={theme.colors.accent.primary}
        onPress={onPin}
      />
      {/* Destructive red rather than the accent: colour is the only warning the
          delete gets before its confirmation dialog. */}
      <SearchActionButton icon="trash-2" label={deleteLabel} color="#FF453A" onPress={onDelete} />
    </Reanimated.View>
  );
});

/**
 * Pinned-message bar, docked directly under the header.
 *
 * Tapping the body jumps the transcript to the message; the × unpins. The text is
 * always resolved from the LIVE transcript by the caller, so an edit is reflected
 * here and a delete removes the bar rather than leaving a stale quote.
 */
const PinnedMessageBar = React.memo(function PinnedMessageBar({
  top,
  title,
  preview,
  glassActive,
  theme,
  closeLabel,
  onPress,
  onUnpin,
}: {
  top: number;
  title: string;
  preview: string;
  glassActive: boolean;
  theme: any;
  closeLabel: string;
  onPress: () => void;
  onUnpin: () => void;
}) {
  return (
    <View style={[styles.pinnedBarWrap, { top }]} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        style={[
          styles.pinnedBar,
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
          <GlassBg borderRadius={14} glassStyle="regular" interactive={false} colorScheme={theme.isDark ? 'dark' : 'light'} />
        ) : null}
        <View style={[styles.pinnedAccent, { backgroundColor: theme.colors.accent.primary }]} />
        <Feather name="bookmark" size={14} color={theme.colors.accent.primary} />
        <View style={{ flex: 1 }}>
          <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} style={{ fontSize: 11 }} numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" color={theme.colors.text.secondary} style={{ fontSize: 12 }} numberOfLines={1}>
            {preview}
          </Text>
        </View>
        <Pressable onPress={onUnpin} hitSlop={10} accessibilityRole="button" accessibilityLabel={closeLabel}>
          <Feather name="x" size={16} color={theme.colors.text.tertiary} />
        </Pressable>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  // Reserved strip for the "loading older" indicator. Height is CONSTANT so the
  // indicator appearing or disappearing at the top of the transcript can never
  // shift content — see the note in `OlderMessagesLoader`.
  olderLoader: { height: 24, alignItems: 'center', justifyContent: 'center' },
  // Search-result action bar. Shrink-wraps to a centred pill (`alignSelf: center`,
  // no `right`) so two controls sit close together instead of stretching across
  // the display. zIndex clears the message list and the under-input gradient.
  searchActionBar: {
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
  // Fixed-width column, not `flex: 1`: inside a shrink-wrapping bar flex children
  // collapse to their content and the pitch drifts with label length.
  searchActionBtn: { width: 88, alignItems: 'center', justifyContent: 'center', gap: 2 },
  // Pinned bar sits above the header gradient (zIndex 101 > headerWrapper's 100)
  // so it reads as part of the header chrome and the transcript scrolls under it.
  pinnedBarWrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 12, zIndex: 101 },
  pinnedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  pinnedAccent: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  dayChipRow: { alignItems: 'center', marginVertical: 10 },
  dayChip: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    overflow: 'hidden',
    // Cap the width so a long localized date (e.g. a spelled-out month in a
    // verbose locale) wraps to an ellipsis instead of spanning the transcript.
    maxWidth: '80%',
  },
  dayChipText: { fontSize: 11.5, letterSpacing: 0.2 },
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  headerCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  // Side columns hug their content and NEVER shrink, so the back pill's "Назад"
  // label is always shown in full and the avatar stays fixed. The center title
  // takes the remaining space (flex:1) and the NAME pill truncates within it —
  // this is what stops the back label from being squeezed by a long name. iOS-
  // style approximate centering (the title is centered in the gap between the
  // back pill and the avatar, not the full screen) is intentional + sufficient.
  headerSide: { flexShrink: 0, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitleWrap: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  // iOS-style back pill: chevron + "Назад" label. Auto width (no fixed circle
  // size) so it grows to fit the localized label; keeps the 36pt height and
  // rounded geometry of the other header chrome. flexShrink:0 so it is never
  // squeezed below its content width (the label must never truncate).
  backPill: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', height: 36, borderRadius: 18, borderWidth: 1, paddingLeft: 6, paddingRight: 14, gap: 2 },
  backPillGlass: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', height: 36, borderRadius: 18, paddingLeft: 8, paddingRight: 16, gap: 2 },
  // flexShrink:0 + no width cap so the localized "Назад" label is never clipped.
  backLabel: { marginLeft: -2, flexShrink: 0 },
  // maxWidth:'100%' bounds the name pill to the available middle space so a long
  // name TRUNCATES (numberOfLines={1}) instead of overflowing or squeezing the
  // back button; short names still hug their content and stay centered.
  headerPill: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: 16 },
  // Interactive-glass shape variants: same geometry as the flat chrome but with
  // NO border and NO overflow clipping, so the liquid glass can morph OUTWARD
  // over content on touch. The icon/content lives INSIDE the glass as children.
  headerCircleGlass: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerPillGlass: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 36, borderRadius: 18, paddingHorizontal: 16 },

  // ── Message-search field ──────────────────────────────────────────────────
  //
  // Shared by the glass and flat search bars, which previously carried two
  // duplicated inline copies of this style — so a fix to one silently missed the
  // other.
  //
  // The text used to sit visibly off-centre. Cause: `height: 20` combined with
  // `fontSize: 15` and `lineHeight: 20`. A 15 pt system font needs more than
  // 20 pt of line box once ascender + descender are counted, so forcing the
  // frame to exactly 20 pushed the glyphs off the optical centre — and RN's
  // iOS `lineHeight` is applied as a paragraph style, which shifts text DOWN
  // within its line box and compounded it.
  //
  // Fix: no fixed height and no `lineHeight`. The field self-sizes to its font
  // and the parent bar (a 40 pt row with `alignItems: 'center'`) centres it.
  // `paddingVertical: 0` keeps iOS from adding its own asymmetric inset.
  //
  // `textAlignVertical` / `includeFontPadding` are intentionally absent: both are
  // Android-only and were doing nothing for the reported iOS symptom.
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 15,
    paddingVertical: 0,
  },
});
