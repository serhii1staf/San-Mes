import React, { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { View, FlatList, ScrollView, TextInput, Pressable, Platform, StyleSheet, Alert, Animated, ActivityIndicator, Dimensions, Keyboard, InteractionManager, AppState, type ViewToken } from 'react-native';
import { useReanimatedKeyboardAnimation, useKeyboardHandler } from 'react-native-keyboard-controller';
import { FlashList, useRecyclingState, type FlashListRef } from '@shopify/flash-list';
import Reanimated, { useAnimatedStyle, interpolate, Extrapolation, useSharedValue, withSpring, withTiming, withSequence, withDelay, runOnJS, useAnimatedRef, measure, Easing, type SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
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
import { ImageViewerModal, ViewerActionButton } from '../../src/components/chat/ImageViewerModal';
import { toPreviewText } from '../../src/utils/previewText';
import { useMediaPanelLabels } from '../../src/components/chat/useMediaPanelLabels';
import { encodeReplyMarker, decodeReplyMarker } from '../../src/utils/chatReplyMarker';
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
import { composerScrimHeight, headerScrimHeights, SCRIM_LOCATIONS, topSurfaceScrimColors, bottomSurfaceScrimColors } from '../../src/theme/scrim';
import { kvGetJSONSync, kvSetJSON, kvWarm } from '../../src/services/kvStore';
import { addTombstones, filterTombstoned } from '../../src/services/messageTombstones';
import { TypingIndicator } from '../../src/components/ui/TypingIndicator';
import { typingChatChannelName, useTypingPublisher } from '../../src/services/realtime/typing';
import { clearActiveThread, setActiveThread } from '../../src/services/activeThread';
import { useChatUnread } from '../../src/store/chatUnreadStore';
import { mockMessages, mockConversations, formatMessageTime } from '../../src/utils/mockData';
import { showToast } from '../../src/store/toastStore';
import { ChatMessage } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';
import { sanitizeUserText } from '../../src/utils/sanitizeText';
import { getRecentEmoji, pushRecentEmoji } from '../../src/services/recentEmoji';
import { getRecentGif, pushRecentGif, removeRecentGif } from '../../src/services/recentGif';
import { isCutoutCapableUrl } from '../../src/utils/mediaKind';
import { playSendSound } from '../../src/utils/sounds';
import { GiphyItem } from '../../src/services/giphy';
import { useT, useI18nStore } from '../../src/i18n/store';
import { buildDaySeparators, formatDaySeparator } from '../../src/utils/chatDaySeparators';
import { mergeHistory, pruneServerDeleted } from '../../src/utils/mergeHistory';

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
// ── INVERTED CONFIG ─────────────────────────────────────────────────────────────────
//
// `startRenderingFromBottom` is GONE, and its absence is deliberate. It existed to make a
// non-inverted list open at its last row; an inverted list opens at index 0, which IS the newest
// message, so asking for it again would be asking the list to start at the oldest end.
//
// `autoscrollToBottomThreshold` is KEPT and still means the right thing. New messages arrive at
// index 0 — the anchored end — so this is the stick-to-newest behaviour a chat wants: follow a
// new message when the user is already near it, leave them alone when they are reading history.
//
// The note below about `autoscrollToTopThreshold` still applies and still says do not add it.
const MVCP_INVERTED = { autoscrollToBottomThreshold: 0.1 } as const;
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

// ── THE FULL-BLOB WRITE IS THE FREEZE. IT NEEDS ITS OWN, MUCH SLOWER CHANNEL ──
//
// The in-app performance monitor finally named this. `chat/[id]`: 35 long tasks, worst
// 1318 ms, average 285 ms, FPS down to 1 — and `Mounts: 0`. Zero mounts is the decisive
// number: nothing was mounting, so it was never the list, the bubbles or the render path.
// It was ~10 seconds of synchronously blocked JS thread per session.
//
// The cause is this file writing the ENTIRE conversation to disk on every store change.
// `kvSetJSON('chat_messages:<id>', …)` JSON-stringifies up to MAX_PERSISTED_MESSAGES (1000)
// messages — text, imageUrls, reply fields, the lot — and hands MMKV a multi-megabyte string
// synchronously. On the un-hydrated branch it also reads and re-parses the same blob first and
// builds a Map over it.
//
// And the store changes constantly: every send, every realtime arrival, every history poll
// merge, every 60-message page load, every photo-heal pass, every edit, every delete.
//
// The existing 450 ms debounce coalesces BURSTS, which is why sending three photos in a row
// costs one write instead of three. It does nothing about the cost of a single write, so a
// conversation being actively used pays ~285 ms at every quiet moment. That is the freeze.
//
// ── WHY TWO CHANNELS FIXES IT RATHER THAN JUST HIDING IT ─────────────────────
//
// The two cached keys have completely different read patterns, and only one of them is on any
// hot path:
//
//   `chat_tail:<id>`      60 messages. Read SYNCHRONOUSLY on chat open to paint the first
//                         frame. Must be current, and costs ~nothing to write.
//   `chat_messages:<id>`  up to 1000. Read only by `hydrateFullHistory` / `ensureCachedHistory`
//                         — i.e. when the user scrolls to the top, opens search, or jumps to an
//                         old reply. Never on open, never per message.
//
// So the hot path only ever needed the tail. Writing the full blob at the same cadence was
// paying a 1000-message serialisation to keep a key that nothing reads until the user
// deliberately goes looking for old history.
//
// Now: the tail is written on the fast debounce, and the full blob on a 6 s trailing debounce —
// plus unconditionally on background and on teardown, through the durability wiring that
// already exists. So the hot path drops from stringify(1000) to stringify(60), and the full
// blob still lands before the app can be killed.
//
// DURABILITY, precisely: the worst case is the process dying between a tail write and the full
// write with no background transition — a crash, or an OS kill while foregrounded. Then the
// newest messages exist in the tail (which is what chat-open reads) and on the server (the
// history fetch backfills them), but not yet in the full blob. Scrolling far up in that state
// could miss them until the next successful full write. That is an acceptable trade against
// ten seconds of frozen UI per session, and it is strictly better than the previous behaviour
// on a crash mid-debounce, which lost the same messages from BOTH keys.
// ── 6 s WAS STILL A CADENCE, AND A CADENCE IS THE PROBLEM ───────────────────
//
// Splitting tail from full blob took chat/[id] from 35 freezes (worst 1318 ms) to zero. The next
// measurement showed SEVEN freezes back, worst 356 ms, average 194 ms — with Mounts still 0. Seven
// is what a 6 s debounce produces across a minute or so of active conversation: I made the hot
// path cheap and left the expensive path on a timer, so an actively-used chat paid ~200-350 ms
// every six seconds instead of every 450 ms. Better, and still wrong.
//
// The full blob does not need a cadence at all. Nothing reads it while the user is in the chat —
// `hydrateFullHistory` and `ensureCachedHistory` are the only readers, and both are triggered by
// deliberate actions (scroll to top, search, jump to an old reply) that run against the STORE,
// which is already correct in memory. The blob only has to be current at two moments: before the
// process can die, and before a future session reads it.
//
// Both are already wired: `runPendingFullPersist()` fires on background/inactive and on teardown.
// Those are frames nobody is looking at — the screen is gone or the app is leaving — so a 300 ms
// block there costs the user nothing.
//
// So this is now a SAFETY NET, not a schedule. Two minutes, so a marathon session in a chat that
// somehow never backgrounds still checkpoints occasionally rather than risking the whole session's
// divergence on one crash. During normal use it never fires: leaving the chat or switching apps
// happens first, and both flush.
const FULL_PERSIST_DEBOUNCE_MS = 120000;
let fullPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingFullWrite: (() => void) | null = null;
let pendingFullConv: string | null = null;
function runPendingFullPersist(): void {
  if (fullPersistTimer) { clearTimeout(fullPersistTimer); fullPersistTimer = null; }
  const fn = pendingFullWrite;
  pendingFullWrite = null;
  pendingFullConv = null;
  if (fn) { try { fn(); } catch {} }
}
function scheduleFullPersist(conversationId: string, write: () => void): void {
  if (pendingFullConv && pendingFullConv !== conversationId) runPendingFullPersist();
  pendingFullWrite = write;
  pendingFullConv = conversationId;
  if (fullPersistTimer) clearTimeout(fullPersistTimer);
  fullPersistTimer = setTimeout(runPendingFullPersist, FULL_PERSIST_DEBOUNCE_MS);
}

// How many of the most-recent messages the chat-open warm prefetches. Bounded
// low (the first screen is only a handful of bubbles) so opening a chat never
// front-loads a burst of image fetches onto the navigation frame. The rest
// stream in lazily on scroll. Was 20 — too many, and a measurable contributor
// to the open-the-chat decode burst.
const WARM_RECENT = 6;

// `isCutoutCapableUrl` moved to `src/utils/mediaKind.ts` — the long-press menu needs the identical
// answer (it was painting an opaque card behind a cut-out sticker), and two copies of a rule this
// subtle would drift apart invisibly. Imported at the top of this file.

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

// ── PER-STAGE ATTRIBUTION FOR THIS SCREEN'S LONG TASKS ─────────────────────
//
// The perf monitor reports `chat/[id]`: 38 long tasks, worst 709 ms, average 262 ms, worst fps 36 —
// and the worst task had `pendingDecodes: 1`, so it is not image work. What it does NOT report is
// WHICH of this screen's stages the time went into, because the only mark in this file is the screen
// mount. So the panel says "the chat blocks the thread for a quarter of a second, 38 times" and
// nothing about where.
//
// That gap has cost real regressions: several previous attempts at this screen changed a stage that
// turned out not to be the expensive one, and one of them had to be reverted. `UserProfilePostCard`
// was found the other way round — it was named by a mark, then fixed once, correctly.
//
// So: name the stages. Every wrap below is behaviour-neutral (`fn()` is called exactly once, its
// value returned, exceptions propagate through `finally`) and completely inert when the monitor is
// off — the store read short-circuits before any timing work, so a user who never opens the perf
// panel pays one boolean check per stage.
//
// `Date.now()` is millisecond-resolution, so a stage that is genuinely cheap will report 0. That is
// the correct outcome: we are looking for something in the hundreds of milliseconds, and a stage
// reporting 0 has been positively ruled out rather than left as a suspect.
function perfSpan<T>(label: string, fn: () => T): T {
  let enabled = false;
  try { enabled = useSettingsStore.getState().perfMonitorEnabled; } catch {}
  if (!enabled) return fn();
  const startedAt = Date.now();
  try {
    return fn();
  } finally {
    try { perfMonitor.mark(label, Date.now() - startedAt); } catch {}
  }
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
// ── BUBBLE WIDTH BUDGET — declared BEFORE the StyleSheet that consumes it ────
//
// These must sit above `bubbleStyles`, because `StyleSheet.create` runs at module evaluation and
// reads them immediately. Declaring them further down produced
// `Block-scoped variable 'META_ROW_MARGIN' used before its declaration`.
const META_ROW_MARGIN = 16;
const META_COL_WIDTH = 46; // metaOutsideCol: width 34 + marginHorizontal 6 * 2
const BUBBLE_H_PADDING = 28; // the bubble's paddingHorizontal (14) on both sides
const BUBBLE_MAX_W = SCREEN_WIDTH - META_ROW_MARGIN * 2 - META_COL_WIDTH;

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
  // ── META OUTSIDE THE BUBBLE ─────────────────────────────────────────────────
  // `metaRow` (the old in-bubble row) is gone. These two replace it.
  //
  // The row carries the horizontal margins the bubble used to own, because the bubble is no
  // longer the outermost element on its side — the row is, so it is the row that must clear the
  // screen edge. `alignItems: flex-end` sits the meta level with the bottom of the bubble, which
  // is where a timestamp reads correctly on a multi-line message.
  // Two frozen variants instead of one style plus an inline `{ flexDirection }` literal. The
  // literal was allocated per render PER ROW and handed React a new style identity every time,
  // which defeats the whole point of the memo comparator above it.
  metaRowOwn: { flexDirection: 'row-reverse', alignItems: 'flex-end', marginHorizontal: META_ROW_MARGIN },
  metaRowPeer: { flexDirection: 'row', alignItems: 'flex-end', marginHorizontal: META_ROW_MARGIN },
  // A POINT maximum, not a percentage — see the note on BUBBLE_MAX_W. `flexShrink: 1` lets a long
  // message stop at the limit instead of forcing the row wider than the screen, and hoisting this
  // into the StyleSheet means every bubble shares one frozen style object rather than allocating a
  // fresh literal on each render of each row.
  bubbleBox: { maxWidth: BUBBLE_MAX_W, flexShrink: 1, marginBottom: 4 },
  // `flexShrink: 0` is load-bearing: without it a long message squeezes the column to zero width
  // and the time disappears. `alignItems: center` stacks the button directly over the time.
  // FIXED width, so `META_COL_WIDTH` above is a fact rather than an estimate: 34 + 6 + 6 = 46.
  // If this width changes, change META_COL_WIDTH with it or the bubble limit silently stops
  // matching reality — which is precisely the bug this block exists to prevent.
  metaOutsideCol: { width: 34, flexShrink: 0, alignItems: 'center', justifyContent: 'flex-end', gap: 1, marginHorizontal: 6, paddingBottom: 2 },
  timestampOutside: { fontSize: 10, lineHeight: 12, opacity: 0.9 },
  // The icon's own box is small, but `hitSlop={10}` on the Pressable takes the touch
  // target well past Apple's 44 pt guidance without affecting layout.
  expandInline: { paddingVertical: 1 },
  timestampInline: { fontSize: 10 },
});

/**
 * Glyph sets the older-history indicator shimmers through, one set per mount.
 *
 * Module scope so the arrays have stable identities and are never re-created per render. Each set
 * is three glyphs because three is what fits in the reserved 24 pt strip without crowding, and
 * because three phases of one shared animation read as a wave rather than a blink.
 */
const OLDER_LOADER_SETS = [
  ['💬', '❤️', '💭'],
  ['✨', '💌', '🕊️'],
  ['📨', '⭐', '💫'],
  ['🫧', '💗', '📩'],
] as const;

/**
 * Which set this mount shows. Rotates on every mount, so opening a chat again shows a different
 * trio — requested as "let them change each time".
 *
 * A module-level counter rather than `Math.random()`: random repeats itself often enough with four
 * options that it would not read as changing, and a counter guarantees the user sees all four
 * before any repeat. Cheap, and it survives the screen unmounting.
 */
let olderLoaderSetCursor = 0;

// "Loading older messages" indicator shown at the TOP of the chat (oldest end) while the next
// older chunk is revealed from cache. The data is already local, so this is purely the
// Telegram-style "more is loading above" affordance instead of messages silently popping in.
//
// It was a pulsing bar. Now it is three shimmering emoji, as requested — a bar reads as a
// progress indicator, which is misleading here because there is no progress to report: the
// history is on disk and arrives in one commit. Emoji fading in and out say "something is
// coming" without implying a measurable percentage.
//
// Still opacity-only on the native driver, so it never touches the JS thread during a scroll —
// which matters more here than anywhere, since this is on screen exactly when the user is
// flicking through history.
function OlderMessagesLoader({ visible, color }: { visible: boolean; color: string }) {
  const pulse = useRef(new Animated.Value(0.25)).current;
  // Picked once per mount and held in a ref, so a re-render never swaps the glyphs mid-shimmer —
  // that would read as a glitch rather than as variety.
  const glyphs = useRef(OLDER_LOADER_SETS[olderLoaderSetCursor++ % OLDER_LOADER_SETS.length]).current;
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
      {glyphs.map((glyph, i) => (
        <Animated.Text
          key={glyph}
          style={{
            fontSize: 15,
            lineHeight: 19,
            height: 19,
            includeFontPadding: false,
            textAlignVertical: 'center',
            marginHorizontal: 3,
            // Each glyph reads the SAME shared `pulse` value through its own interpolation,
            // offset by a third of the cycle. One driver, three phases — so they shimmer in
            // sequence rather than blinking together, and there is still only one animation to
            // run. Three separate loops would be three native animations plus three JS timers.
            opacity: visible
              ? pulse.interpolate({
                  inputRange: [0.25, 1],
                  outputRange: i === 0 ? [0.35, 1] : i === 1 ? [0.7, 0.45] : [1, 0.35],
                })
              : 0,
          }}
        >
          {glyph}
        </Animated.Text>
      ))}
    </View>
  );
}

// Max bounds for a single sent photo. The container is sized to the image's
// natural aspect ratio (capped to these bounds) so the WHOLE image is visible
// in the bubble — no crop — instead of being squeezed into a fixed square.
// ── BUBBLE WIDTH MUST BE A NUMBER, AND IT MUST FIT AN IMAGE ─────────────────
//
// Moving the timestamp outside the bubble broke this, badly, and the perf monitor showed how
// badly: chat/[id] went from 2-4 long tasks to 176, worst 562 ms, FPS down to 21. Reported at the
// same time as GIFs, photos and link previews "breaking — not opening fully".
//
// Both symptoms are one cause. I gave the bubble `maxWidth: '70%'`, a percentage of the ROW, while
// images inside it are sized by `CHAT_IMG_MAX_W`, an absolute number. On a 390 pt screen the row is
// 358 pt wide, 70% of that is 250, and the bubble's own padding leaves 222 pt of content — but
// `CHAT_IMG_MAX_W` asks for 257. Every media bubble therefore overflowed its own constraint, and a
// child that cannot satisfy its parent's max is exactly what makes a flex layout re-measure
// repeatedly. Hundreds of long tasks, and clipped media.
//
// So the bubble's limit is now derived from the same arithmetic that sizes the image, in points
// rather than percent:
//
//   SCREEN_WIDTH
//     − META_ROW_MARGIN * 2   the row's own horizontal margins (it owns them now, not the bubble)
//     − META_COL_WIDTH        the timestamp/fullscreen column plus its margins
//     = BUBBLE_MAX_W
//
// and `CHAT_IMG_MAX_W` is then clamped to fit INSIDE that, minus the bubble's horizontal padding.
// Deriving both from one expression is what stops them drifting apart again — the previous pair
// disagreed only because one was a percentage and the other was not, so no single edit could ever
// have kept them consistent.
const CHAT_IMG_MAX_W = Math.min(Math.round(SCREEN_WIDTH * 0.66), 270, BUBBLE_MAX_W - BUBBLE_H_PADDING);
const CHAT_IMG_MAX_H = 340;

// Fit a photo's natural pixel size into the bubble's max bounds, preserving
// aspect ratio (no crop). Shared by the live onLoad handler and the
// remembered-dimensions path so both compute the SAME box.
function fitChatImageBox(natW: number, natH: number): { w: number; h: number } {
  // Degenerate input guard. A zero or non-finite dimension makes `ar` 0, Infinity or NaN, and the
  // arithmetic below then produces a zero-width, Infinity-tall or NaN box which React Native lays out
  // as an unconstrained view — a plausible route to "it jerked to the whole screen". Nothing upstream
  // guaranteed these were sane: they arrive from MediaLibrary, from expo-image-manipulator and from
  // `onLoad`, and any of the three can report 0 for a file it failed to read.
  if (!Number.isFinite(natW) || !Number.isFinite(natH) || natW <= 0 || natH <= 0) {
    return { w: CHAT_IMG_MAX_W, h: Math.min(CHAT_IMG_MAX_W, CHAT_IMG_MAX_H) };
  }
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
function SingleChatImage({ uri, isVisible, onPress, cutout, uploading }: { uri: string; isVisible?: boolean; onPress: () => void; cutout?: boolean; uploading?: boolean }) {
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
  // ── WAS THE BOX SEEDED FROM THE CACHE? ──────────────────────────────────────
  //
  // `useRecyclingState`, for the same reason `size` uses it: it must be re-evaluated when this row is
  // recycled onto a different photo, and a `useRef` would keep the previous message's answer.
  const [seeded] = useRecyclingState(() => !!getImageDims(uri), [uri]);
  /**
   * ── A PHOTO ALREADY ON SCREEN NEVER CHANGES SIZE ──────────────────────────
   *
   * Reported three times: after sending, the bubble grows, shrinks, and sometimes jerks to nearly
   * the whole screen before settling.
   *
   * I twice went after the wrong half of this. Both previous attempts made the FIRST box correct — by
   * caching the processed dimensions, then by taking them from MediaLibrary — on the assumption that
   * the jump was a wrong initial size correcting itself. That assumption was wrong, and the snapshots
   * said so: the box was right on the first frame, and it moved anyway.
   *
   * The cause is here. `handleLoad` re-sized UNCONDITIONALLY on every load, including when the box had
   * already been seeded from trusted cached dimensions. So a second sizing event always fired, and it
   * only had to disagree slightly to be visible. It has several ways to disagree:
   *
   *   EXIF ORIENTATION. A rotated photo's stored pixel dimensions are the raw ones, while
   *   MediaLibrary reports the DISPLAY ones. Those are transposed, so the aspect ratio flips — a
   *   portrait 1179x2556 read as 2556x1179 turns a 156x340 box into 270x124. That is a dramatic jerk,
   *   and it happens per-photo, which is exactly why this was intermittent ("sometimes").
   *
   *   THE PROXY. The remote copy is served through weserv at `CHAT_IMG_MAX_W`, so `e.source` reports
   *   the derivative's size, not the original's.
   *
   *   THE HEAL. `healPhotos` swaps file:// for https://, so this fires a second time for the same
   *   photo under a different uri.
   *
   * So: if the box was seeded, it is already correct and `onLoad` has nothing to teach. It only
   * measures when nothing was cached, which is the case the measurement exists for. That makes the
   * box a decision taken once per photo rather than a value that can be revised while the user is
   * looking at it.
   */
  const handleLoad = useCallback((e: any) => {
    setLoading(false);
    if (seeded) return;
    const s = e?.source;
    if (!s?.width || !s?.height) return;
    setImageDims(uri, s.width, s.height);
    setSize(fitChatImageBox(s.width, s.height));
  }, [uri, seeded, setLoading, setSize]);
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
      {/* ── A CUT-OUT GETS NO TILE, NO RADIUS AND NO SKELETON ────────────────────
   
          Reported: imported stickers and GIFs arrive with no container and it looks wrong. The cause is
          the mirror image of the delete bug — TWO layers paint a background here and only one of them
          was ever cleaned.
   
          `isStickerLike` removes the BUBBLE's fill, and the comment on it says the goal is that a cut-out
          shows the chat background through its transparent parts. But this view, one level further in,
          unconditionally painted `background.tertiary` behind every image. So the bubble fill went away
          and a grey rounded rectangle stayed exactly where it had been: the sticker still sat on a slab,
          which is precisely "the container is strange". The `MediaPanel` preview already got this right
          and says so — "no background: a cut-out sticker must show the dimmed screen through its
          transparent parts, not a grey rectangle" — the chat bubble simply never matched it.
   
          `resizeMode` also has to change. `cover` CROPS to fill the box, which is right for a photo and
          wrong for a sticker: a 512-square sticker whose subject does not reach the edges gets its
          transparent margin trimmed away and the artwork pushed to the bleed. `contain` keeps the whole
          sticker inside its box.
   
          The skeleton goes too. It is an opaque shimmer sized to the full box, so on a cut-out it painted
          the very slab this is removing, for as long as the load took.
   
          An ordinary photo is untouched: it keeps the tile, the 12-px radius, `cover` and the skeleton. */}
      {/* ── THE RADIUS STAYS. ONLY THE FILL GOES. ────────────────────────────────
   
          I got this wrong last round and it produced the report "the imported GIF is sent without a
          normal container". I set `borderRadius: 0` here along with the transparent background, which
          conflated two separate things:
   
            the FILL   is what was showing through a cut-out's transparent pixels. It had to go.
            the FRAME  is the media message's own presentation — rounded corners and a bounded box. It
                       was never the problem, and removing it left media butted against the chat
                       background with square corners, which reads as no container at all.
   
          A cut-out with rounded corners loses nothing: there are no opaque pixels at the corners to
          clip. So the radius is unconditional now and only the fill branches. The box itself is still
          sized by `fitChatImageBox`, so max width/height and aspect ratio are unchanged for both
          kinds. */}
      <View style={{
        width: size.w,
        height: size.h,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: cutout ? 'transparent' : theme.colors.background.tertiary,
      }}>
        <CachedImage
          uri={uri}
          style={{ width: '100%', height: '100%' }}
          resizeMode={cutout ? 'contain' : 'cover'}
          proxyWidth={CHAT_IMG_MAX_W}
          priority="low"
          autoplay={isVisible}
          onLoad={handleLoad}
          onError={handleError}
        />
        {loading && !cutout ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Skeleton width={'100%'} height={'100%'} radius={0} />
          </View>
        ) : null}
        {/* ── UPLOAD IN PROGRESS: A SPINNER, OVER THE VISIBLE PHOTO ────────────────
   
            Reported: after sending, there should be a circle showing that it is loading — instead it
            was "blind", something blurred filling in from the bottom.
   
            That description is the `Skeleton` above. It is an opaque shimmer covering the whole box,
            and it is the RIGHT thing while nothing can be drawn yet, but the wrong thing here: a just
            sent photo is already on disk, so the picture is available immediately and what is actually
            pending is the UPLOAD. Covering it with a sweeping shimmer hides a photo we can show and
            says nothing about the upload.
   
            `uploading` is derived from the uri, which is the same signal `healPhotos` uses: a local
            reference means the file has not been swapped for its remote url yet. So the photo shows at
            full size straight away with a small spinner over it, and the spinner disappears when the
            heal swaps the uri — which is the moment the upload actually completed, not a guess. */}
        {uploading ? (
          <View style={{ position: 'absolute', right: 8, bottom: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="small" color="#FFFFFF" />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * One line describing the message a reply is quoting.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 *
 * Reported: "when I reply to a message it should show WHICH message I replied to — a preview of it.
 * When I reply to a GIF it says 'Вы'."
 *
 * Two separate faults produced that. The heading printed `t('chat.you')` / `t('chat.peer')` — "Вы" /
 * "Собеседник" — instead of the person's actual name, which is what every messenger shows and the
 * only thing that makes a quote identifiable in a group of them. And the body was baked at SEND time:
 * both send paths wrote `replyToText = t('chat.photo')` for ANY quoted message carrying images, so a
 * GIF was labelled "Фото", and a photo that had a caption lost the caption — the single most useful
 * thing the preview could have shown.
 *
 * ── WHY IT IS DERIVED HERE RATHER THAN STORED ───────────────────────────────
 *
 * Baking a display label into stored data is what caused this: the label is a rendering decision (it
 * depends on the reader's locale, and on rules that change) and it was frozen into the wire format at
 * the moment of sending. `toPreviewText` is the app's one reader for stored content, so a quote now
 * gets the same treatment as a conversation row: a caption shows as its text, a GIF says GIF, a photo
 * says photo, a bare link says link, and no marker ever leaks.
 *
 * Old messages still read correctly. Their `replyToText` already holds a plain label like "Фото",
 * which passes through `toPreviewText` unchanged because it is not a marker and not a URL.
 */
function quotedLinePreview(
  replyToText: string | undefined,
  replyToImage: string | undefined,
  t: (key: string, fallback?: string) => string,
): string {
  // Same label keys the pinned-message bar already passes to `toPreviewText` (`pinPreviewLabels`).
  // Deliberately identical: two label sets for one reader is how "GIF" ends up spelled two ways in
  // two places on the same screen.
  const labels = {
    photo: t('chat.photo'),
    gif: 'GIF',
    link: t('chat.link', 'Ссылка'),
    reply: t('chat.reply_label', 'Ответ'),
  };
  const fromText = toPreviewText(replyToText, labels);
  if (fromText) return fromText;
  // No text at all: the quote is pure media, so name it from the thumbnail's URL. This is where a
  // GIF stops being called a photo — `toPreviewText` already knows how to tell them apart from a
  // URL, so the same rule decides it here.
  if (replyToImage) return toPreviewText(replyToImage, labels) || labels.photo;
  return '';
}

function MessageBubble({ message, isOwn, fontSize, bubbleRadius, fontFamily, linkEmoji, bubbleColors, bubbleOpacity, bubbleTextColor, inColors, inOpacity, inTextColor, highlighted, isVisible, imagesReady, onReply, onReplyJump, onLongPress, onMeasured, onSwipeActive, onImagePress, dragActive, dragFingerY, hoveredAction, actionZones, onFireDragAction, onOpenFullscreen }: { message: ChatMessage; isOwn: boolean; fontSize: number; bubbleRadius: number; fontFamily: string; linkEmoji?: string; bubbleColors: string[]; bubbleOpacity: number; bubbleTextColor: string; inColors: string[]; inOpacity: number; inTextColor: string; highlighted?: boolean; isVisible?: boolean; imagesReady?: boolean; onReply: (m: ChatMessage) => void; onReplyJump?: (messageId?: string) => void; onLongPress: (m: ChatMessage) => void; onMeasured?: (id: string, x: number, y: number, w: number, h: number) => void; onSwipeActive: (active: boolean) => void; onImagePress: (images: string[], index: number, message: ChatMessage) => void; dragActive: SharedValue<boolean>; dragFingerY: SharedValue<number>; hoveredAction: SharedValue<string>; actionZones: SharedValue<ActionZone[]>; onFireDragAction: (m: ChatMessage, action: string) => void; onOpenFullscreen: (m: ChatMessage) => void }) {
  const theme = useTheme();
  const t = useT();
  // The quoted message's one-line preview. Cheap (a few string checks) and only meaningful when this
  // bubble is a reply, so it is computed unconditionally rather than memoized — a memo here would
  // cost more in hook bookkeeping than the work it saves, on the most-mounted component in the app.
  const quotedPreview = quotedLinePreview(message.replyToText, message.replyToImage, t);
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
  /**
   * Should this message render as a STICKER — no bubble at all?
   *
   * ── THE PREVIOUS VERSION OF THIS WAS TOO BROAD, AND IT WAS A REGRESSION ───
   *
   * It asked only "is this media with no text", and dropped the bubble for all of them. Reported
   * immediately: "the containers disappeared from my photos — not the ones I pick from a pack, my own
   * ones from the phone."
   *
   * Right, and the goal never needed that much. What had to lose its background was a CUT-OUT image — a
   * sticker or an alpha GIF, where the bubble fill was showing through the transparent part. An ordinary
   * photo has no transparency to reveal, so removing its bubble changed nothing for the better and took
   * away the frame that separates one photo from the next in a column of them.
   *
   * So the test is now about the KIND of media, not merely the absence of text. Alpha cannot be detected
   * without decoding the image, but the SOURCE is known from the URL, and the sources that carry cut-outs
   * are exactly the ones the picker offers: GIFs, and stickers imported through our own proxy. A camera
   * roll photo lands on R2 as `.jpg`/`.webp` and keeps its bubble.
   *
   * Every URL in the message has to qualify, so a mixed group falls back to a normal bubble rather than
   * leaving one photo of several unframed.
   */
  const isStickerLike =
    !!message.imageUrls &&
    message.imageUrls.length > 0 &&
    !message.text &&
    !message.replyToText &&
    !message.replyToImage &&
    !message.replyPixelIconId &&
    message.imageUrls.every(isCutoutCapableUrl);

  const replyBorderColor = coloredBubble ? sideTextDim : theme.colors.accent.primary;
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

  // ── THIS SCREEN HAD NO MOUNT INSTRUMENTATION AT ALL ───────────────────────
  //
  // `chat/[id]` is the worst route in the latest snapshot — twelve long tasks, worst 533 ms, average
  // 272 ms, worst fps 38 — and it reports `mountCount: 0`. Not "cheap mounts": no mount marks exist
  // here, so every one of those tasks is unattributed. The screen's only marks are its seed reads and
  // the reverse/day-label passes, and all of them report 0-1 ms, which positively rules them out and
  // leaves nothing named.
  //
  // The profile card is the precedent for both the fix and the trap. Naming it found the real cost
  // (35-77 ms per body, against the 21 ms a broken mark had been reporting) — but the FIRST version of
  // that mark measured the wrong commit, because its effect fired after the placeholder render rather
  // than after the body. So this one keys on `imgReveal`: the clock starts on the render where the
  // media gate is already open, which is the commit that actually mounts the images, the reply quote,
  // the formatted text and the link preview.
  //
  // A text-only bubble has `hasImages === false` and so never satisfies the guard — deliberately. It
  // would report the cheap path and dilute the average with rows that were never suspected.
  // NON-REACTIVE read, deliberately. As a subscription this was one live store listener per mounted
  // bubble (24 of them, given `maxItemsInRecyclePool`) whose only purpose was measurement — the
  // profiler billing itself to the thing it profiles. `perfMonitor.markScreenMount` re-checks the
  // flag itself before recording, and a debug toggle has no business re-rendering the transcript.
  const perfEnabled = useSettingsStore.getState().perfMonitorEnabled;
  const bodyRenderStart = perfEnabled && hasImages && imgReveal ? Date.now() : 0;
  useEffect(() => {
    if (!perfEnabled || !hasImages || !imgReveal) return;
    perfMonitor.markScreenMount('MessageBubble.media', Date.now() - bodyRenderStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfEnabled, hasImages, imgReveal]);
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
          <MaterialIcons name="reply" size={16} color={theme.colors.accent.primary} />
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
        {/* ── META OUTSIDE THE BUBBLE ────────────────────────────────────────────
            Asked for repeatedly: the time and the full-screen button should sit BESIDE the
            bubble, not in it — on the far side from the sender, so an own message has them on
            its left and a received one on its right, Telegram-style.

            Why this is the right shape and not just a move: inside the bubble, the metadata row
            set a FLOOR on bubble width. "ok" still had to be wide enough for a timestamp plus a
            button plus padding, so short messages looked padded out and the transcript lost its
            rhythm. Outside, the bubble shrink-wraps its text and short messages finally read as
            short.

            LAYOUT: this is a flex row whose direction flips with `isOwn`, so the bubble is
            always adjacent to the screen edge on the sender's side and the meta column sits
            inboard of it. `flexShrink: 0` on the meta keeps it from being squeezed to nothing by
            a long message, and the bubble's `maxWidth` drops from 78% to 70% to pay for the
            space the column now occupies — without that, a long message would push the meta off
            screen, which is exactly the failure mode this layout invites.

            `alignItems: flex-end` puts the meta level with the BOTTOM of the bubble, which is
            where a timestamp belongs on a multi-line message. */}
        <View style={isOwn ? bubbleStyles.metaRowOwn : bubbleStyles.metaRowPeer}>
        <Reanimated.View ref={bubbleRef} style={[bubbleAnimStyle, bubbleStyles.bubbleBox]}>
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

          {/* ── A MEDIA-ONLY MESSAGE GETS NO BUBBLE ──────────────────────────────────
   
              Asked for: "GIFs that have no background — a dance, or a photo with no backdrop. I want
              them with no background everywhere."
   
              The transparency was never lost in transit. The proxy already keeps GIF alpha intact
              (`output=gif&n=-1`, deliberately never re-encoding to WebP — see `proxiedImageUrl`). What
              filled it in was THIS view: the bubble paints its fill, or its gradient, directly behind
              the image. So a cut-out sticker showed the bubble colour where its background should have
              been, which is exactly "it has a background".
   
              A message that is nothing but media does not need a bubble at all. No text to sit on, no
              quote, no padding to earn — so the fill, the gradient and the 14/10 padding all go, and the
              image sits on the chat background. A cut-out GIF then reads as a sticker, and an ordinary
              photo loses a coloured frame it never needed either.
   
              Safe because the timestamp lives OUTSIDE this view (see `metaRowOwn`/`metaRowPeer`), so it
              keeps its own colour against the chat background and cannot be lost with the fill. */}
          <View style={{
            paddingHorizontal: isStickerLike ? 0 : 14,
            paddingVertical: isStickerLike ? 0 : 10,
            borderRadius: bubbleRadius,
            backgroundColor: isStickerLike || isGradient ? 'transparent' : solidBg,
            borderBottomRightRadius: isOwn ? 4 : bubbleRadius,
            borderBottomLeftRadius: isOwn ? bubbleRadius : 4,
            overflow: !isStickerLike && isGradient ? 'hidden' : undefined,
          }}>
            {isGradient && gradFill && !isStickerLike ? (
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
                {/* NO AUTHOR LINE. Just the message being answered.
   
                    Asked for directly: "it writes his name — make it simply what I replied to. He writes
                    hello, I swipe and reply, and it shows hello."
   
                    It is also the better design for a one-to-one chat, which is the only kind this screen
                    renders. There are exactly two possible authors and the quote sits inside a bubble that
                    is already on one side or the other, so the name was restating what the layout says
                    while costing the quote a whole line — and on a short quote the name was the larger
                    half of it. A group chat would need the name back; there are no group chats. */}
                <View style={bubbleStyles.replyTextWrap}>
                  <Text variant="caption" color={replyBodyColor} numberOfLines={1} style={bubbleStyles.replyBody}>
                    {quotedPreview}
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
                      cutout={isStickerLike}
                      // A local reference means the upload has not completed — the same signal
                      // `healPhotos` keys on. Drives the spinner, nothing else.
                      uploading={!message.imageUrls[0].startsWith('http')}
                      onPress={() => onImagePress(message.imageUrls!, 0, message)}
                    />
                  ) : (
                    <Pressable onPress={() => onImagePress(message.imageUrls!, 0, message)}>
                      {(() => {
                        // Size the placeholder to the remembered photo box when
                        // known, so the swap placeholder → real image never
                        // changes the bubble height (no layout jump on open).
                        const d = getImageDims(message.imageUrls![0]);
                        const box = d ? fitChatImageBox(d.w, d.h) : { w: 220, h: 220 };
                        // A cut-out reserves its space with nothing in it. The shimmer is an opaque
                        // slab, so on a sticker it painted the grey rectangle this change exists to
                        // remove — just before the sticker itself arrived without one, which reads as
                        // a flash of the old bug on every open.
                        // A cut-out reserves its space with nothing in it. The shimmer is an opaque
                        // slab, so on a sticker it painted the grey rectangle the fill change exists
                        // to remove — right before the sticker arrived without one, which reads as a
                        // flash of the old bug on every open. Same box, so no layout shift either way.
                        return isStickerLike ? (
                          <View style={{ width: box.w, height: box.h }} />
                        ) : (
                          <Skeleton width={box.w} height={box.h} radius={12} />
                        );
                      })()}
                    </Pressable>
                  )
                ) : (
                  message.imageUrls.map((uri, idx) => (
                    <Pressable key={idx} onPress={() => onImagePress(message.imageUrls!, idx, message)}>
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
                  // Only unfurl what the user can actually see. FlashList mounts rows within
                  // `drawDistance` of the viewport, so without this a scroll past several links
                  // fires several requests for bubbles nobody is looking at — and each one lands a
                  // parse, a state update, a card re-render and an MMKV write on the JS thread. The
                  // perf log measured four such fetches (335, 257, 313, 799 ms) followed by long
                  // tasks of 356 and 175 ms. A preview the user CAN see is visible by definition,
                  // so nothing they look at appears any later; and an already-cached preview is
                  // unaffected either way, because that path is a synchronous read.
                  active={isVisible !== false}
                />
              </View>
            ) : null}
            {/* The timestamp and the full-screen button used to live HERE, inside the bubble.
                They now sit OUTSIDE it — see the meta column rendered as a sibling of the
                bubble further down. Keeping them inside is what made every bubble at least as
                wide as `time + button + padding`, so a two-character message still occupied a
                third of the row. */}
          </View>
        </View>
        </Reanimated.View>
        {/* The meta column: full-screen button ABOVE the time, as requested. Both are tiny and
            tinted from the theme rather than from the bubble's contrast colour — they are no
            longer ON the bubble, so they must read against the chat background instead. */}
        <View style={bubbleStyles.metaOutsideCol}>
          <Pressable
            onPress={handleOpenFullscreen}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('chat.open_fullscreen', 'Открыть на весь экран')}
            style={bubbleStyles.expandInline}
          >
            <MaterialIcons name="open-in-full" size={10} color={theme.colors.text.tertiary} />
          </Pressable>
          <Text variant="caption" color={theme.colors.text.tertiary} style={bubbleStyles.timestampOutside}>
            {timeLabel}
          </Text>
        </View>
        </View>
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
    // Reference first: both arrays are useMemo'd in the screen, so this is the common path and it
    // costs nothing. The join is kept as the fallback so a rebuilt-but-equal array still compares
    // equal — dropping it would re-render every bubble whenever the theme object churned.
    (prev.bubbleColors === next.bubbleColors || prev.bubbleColors.join(',') === next.bubbleColors.join(',')) &&
    prev.bubbleOpacity === next.bubbleOpacity &&
    prev.bubbleTextColor === next.bubbleTextColor &&
    (prev.inColors === next.inColors || prev.inColors.join(',') === next.inColors.join(',')) &&
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
  // Media-panel strings, shared with the comments screen. See the hook for why they are not inline.
  const mediaPanelLabels = useMediaPanelLabels();
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
    // Being on screen IS reading it — so clear this conversation's unread count here, alongside the
    // registration that already means "on screen". Both ids, because the badge in the list is keyed
    // by conversation id while this screen may still be holding only the route id.
    //
    // This is the call that was missing. `chatStore.markAsRead` existed but a repo-wide search found
    // NO caller, so nothing ever marked a conversation read anywhere in the app. Clearing on the
    // registration effect also means re-foregrounding into an open chat re-clears anything that
    // arrived while away.
    try {
      for (const cid of ids) if (cid) useChatUnread.getState().clear(cid);
    } catch {}
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        setActiveThread('chat', ids);
        try {
          for (const cid of ids) if (cid) useChatUnread.getState().clear(cid);
        } catch {}
      }
    });
    return () => {
      try { sub.remove(); } catch {}
      clearActiveThread('chat', ids);
      // CLEAR ON LEAVE, not just on enter.
      //
      // Reported: "I open a chat, write to him, close it — and I get an unread indicator on MY OWN
      // row." Exactly what the enter-only clear produced. The watermark was stamped when the screen
      // opened; the message was then sent, so that conversation's `lastMessageAt` became NEWER than
      // the watermark, and the reconcile pass that exists to catch "arrived while the app was
      // killed" could not tell the difference — a `Conversation` row carries no author for its last
      // message, and `participantId` is always the PEER, so no guard there can recognise our own
      // send.
      //
      // Stamping the watermark on the way out fixes it at the source: everything up to the moment
      // you left is read, including whatever you just sent. Which is also simply true.
      try {
        for (const cid of ids) if (cid) useChatUnread.getState().clear(cid);
      } catch {}
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
  // The message the open viewer belongs to — see openImageViewer.
  const [viewerMsg, setViewerMsg] = useState<ChatMessage | null>(null);
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

  // ONE ROW, NOT THE WHOLE LIST. This used to select `s.conversations` and `find` outside the
  // selector, so every `setConversations` anywhere in the app re-rendered this chat — and
  // `reconcileConversation` fires one on every single send. `find` returns the EXISTING element, so
  // a new array holding an unchanged row yields the same reference and Zustand bails out on
  // `Object.is`. Nothing is constructed in the selector, so this cannot trip React 19's
  // "getSnapshot should be cached" rule either.
  const entityConv = useEntityStore((s) => s.conversations.find((c) => c.id === id));
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
      const tail = perfSpan('chat.seed.tailRead', () => kvGetJSONSync<ChatMessage[]>(tailKey(conversationId), []));
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
      // The expensive branch: parses the WHOLE blob (up to MAX_PERSISTED_MESSAGES) during render.
      // Marked separately from the tail read above so the panel distinguishes "cold chat, full blob
      // parsed on the open frame" from "warm tail, cheap open".
      const cached = perfSpan('chat.seed.fullBlobRead', () => kvGetJSONSync<ChatMessage[]>(`chat_messages:${conversationId}`, []));
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

  /**
   * Minimum gap between two older-page loads. See the long note in `onStartReached` — without
   * it, the offset correction a prepend triggers generates the scroll event that requests the
   * next page, and one flick chains pages until the history runs out.
   */
  const OLDER_LOAD_COOLDOWN_MS = 900;
  const lastOlderLoadAtRef = useRef(0);

  /**
   * Set when the list has asked for an older page; cleared when that page is committed.
   *
   * The request and the commit are deliberately separated. `onStartReached` fires during the
   * gesture, and committing a prepend there makes FlashList's offset correction fight an
   * in-flight fling. The commit therefore happens on the scroll-settle timer in `onChatScroll`,
   * with the list stationary, where the same correction is imperceptible.
   */
  const pendingOlderLoadRef = useRef(false);
  const hydrateFullHistory = useCallback((): ChatMessage[] | null => {
    if (!conversationId) return null;
    if (historyHydratedRef.current === conversationId) return null;
    let full: ChatMessage[];
    try {
      full = perfSpan('chat.hydrateFull.read', () => kvGetJSONSync<ChatMessage[]>(`chat_messages:${conversationId}`, []));
    } catch {
      return null;
    }
    historyHydratedRef.current = conversationId;
    if (full.length === 0) return null;
    // ── NAMED, BECAUSE THIS IS THE LEADING SUSPECT AND IT WAS INVISIBLE ───────
    //
    // `chat/[id]` is the worst route in the latest snapshot by a wide margin — 55 long tasks, average
    // 209 ms, worst 652 ms, worst fps 28 — and three of them land at 1.5 s, 3.3 s and 4.7 s after
    // arriving, all with `pendingDecodes: 0`. So it is JS, it recurs after the screen has settled, and
    // nothing named it.
    //
    // `hydrateFullHistory` is deferred to exactly that window by `runAfterInteractions`, and the note
    // further up this file already records it being measured as expensive once before. Its MMKV READ was
    // marked; everything after it was not — and the read is the cheap half. This pass walks the ENTIRE
    // stored history (capped at a thousand messages) allocating a healed copy of every row, and the merge
    // below then builds a Map over all of them.
    //
    // The count goes in the label deliberately. The seed marks report `(60)` because that is the seed
    // window, and the open question is whether this pass is working over sixty rows or a thousand — which
    // decides whether the answer is to make it cheaper or to stop doing it eagerly at all. One snapshot
    // now settles that instead of another round of reasoning about it.
    let healed = perfSpan(`chat.hydrateFull.heal(${full.length})`, () =>
      full.map((m) => healLegacySender(m, currentUserId, participantId)),
    );
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
      full = perfSpan('chat.cachedHistory.read', () => kvGetJSONSync<ChatMessage[]>(`chat_messages:${conversationId}`, []));
    } catch {
      full = [];
    }
    // HEAL LAZILY, PER ROW — see the note above. This used to be an eager `.map` over the whole
    // blob (up to MAX_PERSISTED_MESSAGES = 1000) to serve a 60-row page, and it was outside any
    // span, which is why the snapshot showed a 5 ms read inside a 190 ms task.
    //
    // `healLegacySender` returns the SAME object for a modern row, so the WeakMap only ever holds
    // entries for rows that genuinely needed rewriting, and a repeat page pays nothing.
    const healCache = new WeakMap<object, ChatMessage>();
    const healRow = (m: ChatMessage): ChatMessage => {
      if (typeof m !== 'object' || m === null) return m;
      const hit = healCache.get(m);
      if (hit) return hit;
      const out = healLegacySender(m, currentUserId, participantId);
      healCache.set(m, out);
      return out;
    };
    const healed = perfSpan(`chat.cachedHistory.heal(${full.length})`, () => full.map(healRow));
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
  // ── 6 s WAS A CRUTCH FOR DEAD REALTIME. REALTIME WORKS NOW. ────────────────
  //
  // This interval was added when `/api/ably-token` was 401ing every request and no device had
  // ever opened a realtime connection — polling was the only thing delivering messages at all.
  // That is fixed and confirmed from both ends: Ably's stats show real client connections, and
  // typing indicators (which are pure realtime, with no poll fallback) work on the device.
  //
  // The perf snapshot shows what the leftover cadence costs. Two long tasks inside one chat
  // session, 167 ms and 193 ms, at 8.3 s and 13.3 s after navigation — no mount nearby, no
  // pending decodes, nothing else running. Those are poll ticks: a fetch, a JSON parse of up to
  // 200 rows, a map to ChatMessage, a tombstone filter and a merge, all synchronous.
  //
  // So it goes from a delivery mechanism to what it should always have been: a safety net for
  // the gap realtime genuinely cannot cover — messages published while the app was backgrounded
  // or between token refreshes. 30 s is frequent enough for that (the first tick still runs
  // immediately on open, which is the case that actually matters) and rare enough that its cost
  // stops being something the user can feel.
  //
  // The `?since` cursor makes each subsequent tick nearly free anyway, but "nearly free" times
  // ten fewer ticks is still the right direction, and the FIRST tick — the expensive one, with no
  // cursor yet — is unaffected either way.
  const HISTORY_POLL_MS = 30000;
  // Page size for the history poll. Named because the delete-detection below compares the response
  // length against it: a page that came back SHORT of the limit was not truncated, which is what
  // makes "the server did not return this row" mean "the row is gone" rather than "the row is on
  // another page". A literal in two places would let those two drift apart silently.
  const POLL_PAGE_LIMIT = 200;
  useEffect(() => {
    if (!conversationId) return;
    if (!useConnectivityStore.getState().isOnline) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    // Off the open frame: this is a network round trip plus a store write, and first paint is
    // already served from cache.
    const handle = InteractionManager.runAfterInteractions(() => {
      // Cursor for the polls AFTER the first one. The first fetch of a session deliberately
      // has none: the local tail may have gaps (messages that arrived while the app was
      // closed land after whatever is cached), so a cursor built from it could skip them. Once
      // a full page has been reconciled the newest timestamp IS a trustworthy watermark, and
      // from then on an idle poll transfers an empty array instead of re-sending the tail
      // every six seconds.
      let sinceCursor: string | null = null;
      // Only the FIRST fetch of a session can be used to detect deletions — it is the only one that
      // asks from the beginning of the conversation rather than from a cursor. See the prune block
      // below for why that distinction is the whole safety argument.
      let isFirstPage = true;
      const runFetch = async () => {
        try {
          const { getMessages } = await import('../../src/lib/supabase');
          const { messages, error } = await getMessages(conversationId, {
            limit: POLL_PAGE_LIMIT,
            ...(sinceCursor ? { since: sinceCursor } : {}),
          });
          if (cancelled || error) return;
          // Advance the watermark even when the page is empty — nothing new means the cursor
          // is still correct, and an empty response is the steady state we want.
          if (Array.isArray(messages) && messages.length > 0) {
            const newest = messages[messages.length - 1];
            const at = newest?.created_at;
            if (typeof at === 'string' && (!sinceCursor || at > sinceCursor)) sinceCursor = at;
          } else if (!sinceCursor) {
            // First fetch came back empty: seed the cursor from what we hold so later polls
            // are incremental instead of repeatedly asking for a full page.
            const local = (useChatStore.getState().messages[conversationId] || []) as ChatMessage[];
            const newestLocal = local[local.length - 1]?.createdAt;
            if (typeof newestLocal === 'string') sinceCursor = newestLocal;
          }
          if (!Array.isArray(messages) || messages.length === 0) return;

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

          let local = (useChatStore.getState().messages[conversationId] || []) as ChatMessage[];

          // ── A MESSAGE DELETED ON ANOTHER DEVICE MUST DISAPPEAR HERE TOO ─────
          //
          // Reported: "I deleted messages on one device. I open the same chat on my other phone,
          // scroll up, and they are still there."
          //
          // Deleting hard-deletes on the server and publishes `msg.delete` on the conversation
          // channel. THIS device only learns from that event, which requires it to be subscribed at
          // that exact moment — app open, this chat on screen. Miss it and nothing ever tells it
          // again: the poll's merge is additive by design, its tombstone list is empty (tombstones
          // belong to whoever pressed delete), and the row sits in its own MMKV blob across
          // restarts. The two devices then disagree for ever.
          //
          // This is the poll noticing. The precondition is what makes it safe, and it is only
          // available on the FIRST fetch of a session:
          //
          //   • no cursor  — the Worker reads `ORDER BY created_at ASC LIMIT ?` from the beginning
          //                  of the conversation, so the page starts at the true oldest row;
          //   • under the  — a page that came back short of the limit was not truncated, so it is
          //     limit        the server's COMPLETE answer for the span it covers.
          //
          // Once `sinceCursor` is set every later page is incremental and deliberately excludes
          // almost everything, so absence from it proves nothing at all. Hence `isFirstPage`.
          //
          // `pruneServerDeleted` holds the rest of the guarantees (never touches an unconfirmed
          // local send, never touches anything outside the span the response covers) — see its
          // note. It is a separate function from `mergeHistory` on purpose: that one's additive
          // contract is what protects queued and failed sends.
          if (isFirstPage) {
            const { kept, removedIds } = pruneServerDeleted(local, remote, messages.length < POLL_PAGE_LIMIT);
            if (removedIds.length > 0) {
              // Tombstone them, do not merely drop them from the store. The on-disk history blob
              // still holds these rows, and the full-blob persist path MERGES the store into the
              // cache rather than replacing it — so a store-only purge would be undone the moment
              // the user scrolled to the top and `hydrateFullHistory` read the blob back in.
              // `filterTombstoned` is already applied by both history readers, which is exactly
              // the seam this needs.
              addTombstones(conversationId, removedIds);
              setMessages(conversationId, kept as any);
              local = kept;
            }
          }
          isFirstPage = false;

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
    // Same rule for the slow channel: a full write still owed to the PREVIOUS conversation must
    // land before this one starts accumulating, or switching chats quickly would drop it.
    if (pendingFullConv && pendingFullConv !== conversationId) runPendingFullPersist();
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
        if (s === 'background' || s === 'inactive') {
          runPendingPersist();
          // The full blob is on a 6 s debounce, so it is the one most likely to be outstanding
          // when the app goes away. Flushing it here is what keeps the slow channel safe:
          // backgrounding is the moment before an OS kill, and it is a frame nobody is looking
          // at, so a 285 ms write there costs the user nothing.
          runPendingFullPersist();
        }
      });
      return () => {
        sub.remove();
        handle?.cancel();
        persistTeardownPending = true;
        Promise.resolve().then(() => {
          if (persistTeardownPending) {
            persistTeardownPending = false;
            runPendingPersist();
            // Leaving the chat is also a safe place to pay for the full write: the screen is
            // already gone, so the blocked frame is not one the user is scrolling.
            runPendingFullPersist();
          }
        });
      };
    };

    if (historyHydratedRef.current === convId) {
      // Full history hydrated → the store IS the complete authoritative array
      // → safe to mirror wholesale (capped to the newest MAX_PERSISTED_MESSAGES).
      // HOT PATH: the tail only. 60 messages, which is what chat-open reads. See the note on
      // `scheduleFullPersist` — this used to serialise the whole 1000-message array here, on
      // every store change, and that was the 285 ms freeze the perf monitor measured.
      schedulePersist(convId, () => {
        perfSpan(`chat.persist.tail(${snapshot.length})`, () => writeTailCache(convId, snapshot));
      });
      // COLD PATH: the full blob, on a 6 s trailing debounce. Nothing reads this key until the
      // user scrolls to the top, searches, or jumps to an old reply.
      scheduleFullPersist(convId, () => {
        perfSpan(`chat.persist.full(${snapshot.length})`, () => kvSetJSON(`chat_messages:${convId}`, capPersisted(snapshot)));
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
    // HOT PATH: the tail, unconditionally. The store window always contains the newest
    // messages, so the tail derived from it is correct regardless of what the full blob holds.
    // Cheap, and it is the key chat-open reads.
    schedulePersist(convId, () => {
      perfSpan(`chat.persist.tail(${snapshot.length})`, () => writeTailCache(convId, snapshot));
    });

    // COLD PATH: the read-merge-write against the full blob, on the slow debounce.
    //
    // This branch is the expensive one — it PARSES up to 1000 messages, builds a Map over them,
    // merges, then serialises the result back. Roughly double the work of the hydrated branch,
    // and it was running on every store change too.
    //
    // The merge itself is still required here and cannot be simplified away: the store holds
    // only the bounded seed window on this branch, so writing it wholesale would TRUNCATE the
    // older history already on disk. Merging by id is what makes the write non-destructive.
    scheduleFullPersist(convId, () => perfSpan('chat.persist.fullMerge', () => {
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
        } else {
          // Brand-new chat (no cached history yet) → the store is the whole truth.
          kvSetJSON(`chat_messages:${convId}`, capPersisted(snapshot));
        }
      } catch {}
    }));

    // ── NO EAGER FULL HYDRATION HERE ANY MORE ────────────────────────────────
    //
    // This used to be `runAfterInteractions(() => hydrateFullHistory())`, and it was measured as the
    // single worst freeze in the app: a 1105 ms long task on chat/[id], arriving ~2.3 s after the
    // chat opened, with `pendingDecodes: 0` and the last image mark 1.8 s earlier — so unambiguously
    // JS, not image work.
    //
    // Look at what it does in one synchronous pass: JSON.parse up to 1000 messages out of MMKV, map
    // `healLegacySender` over all of them, build a Map over all of them, merge the store in,
    // `filterTombstoned` over the result, then `setMessages` — which pushes a 1000-item array into
    // the store, so `buildDaySeparators` walks all 1000 and the list reconciles against a data prop
    // that just grew twentyfold. None of that can be split by the scheduler; it is one task.
    //
    // It was also redundant. Its stated purpose was "so scroll-up / reply-jump / search have the
    // complete array in memory", and every one of those already hydrates for itself, on demand:
    //
    //   search      → openSearch() calls hydrateFullHistory() when the user opens search
    //   reply-jump  → the jump handler calls it before resolving a target older than the window
    //   delete      → the Ably msg.delete path calls it through hydrateFullHistoryRef
    //   scroll-up   → served by the Worker's paged older-messages route, not from this blob
    //
    // So the whole array was being materialised on EVERY chat open to serve three interactions that
    // each fetch it themselves, and a fourth that does not use it at all. The guard
    // (`historyHydratedRef`) meant it ran once per conversation — that once being the 1105 ms.
    //
    // The tail cache is unaffected: `writeTailCache(convId, snapshot)` above runs on the hot path,
    // unconditionally and from data already in hand, so the cheap next-open path is still warmed.
    // That was never the eager hydration's job.
    return wireDurability();
  }, [conversationId, myMessages]);

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
          // This row is being stamped because WE just sent something, so record that. Without it the
          // row went back to carrying a fresh timestamp with no author roughly a second after every
          // send — which is precisely the moment the unread badge was observed to appear on the
          // sender's own screen. The realtime bridge writes this field for incoming messages; this is
          // the outgoing half, and it is the only place the send path touches the list row.
          lastSenderId: currentUserId || undefined,
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
    [id, participantId, displayName, displayEmoji, setMessages, t, currentUserId],
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
    // INVERTED: `contentOffset.y` measures distance from the NEWEST end, because index 0 is at
    // the bottom and scrolling up increases y. So the old `contentH - (y + layoutH)` arithmetic
    // is not just wrong here, it is inverted — it would report "far from newest" precisely when
    // the user is sitting on the newest message.
    const distanceFromBottom = m.y;
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
      // INVERTED: the newest message is index 0, not `length - 1`. And the follow-up is
      // `scrollToOffset({ offset: 0 })` rather than `scrollToEnd()` — "end" in an inverted list
      // is the OLDEST message, so `scrollToEnd` would fling the user to the top of the history.
      if (windowedMessagesRef.current.length === 0) return;
      void (async () => {
        try {
          await flatListRef.current?.scrollToIndex({ index: 0, animated: true, viewPosition: 0 });
          if (gen !== scrollGenRef.current) return;
          flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
        } catch {
          if (gen !== scrollGenRef.current) return;
          try { flatListRef.current?.scrollToOffset({ offset: 0, animated: true }); } catch {}
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

  // ── SEARCH: DON'T RE-SCAN THE WHOLE TRANSCRIPT ON EVERY KEYSTROKE ──────────
  //
  // This effect used to run its full scan synchronously for each character typed, and `openSearch`
  // deliberately hydrates the ENTIRE history first — so on a long conversation every keystroke was
  // up to a thousand `toLowerCase()` calls (a thousand fresh string allocations), a thousand
  // `includes`, then a `setSearchMatches` that re-renders this screen, then `scrollToIndex` which
  // does another `findIndex` over the same thousand rows. Typing a five-letter word paid for that
  // five times over, and the third character's scan was still running while the fourth arrived.
  //
  // Two changes, both of which remove work rather than hide it:
  //
  //   1. The lowercased form of each message is cached against the message object. Message text is
  //      immutable for a given object, so this is a pure memo — and it means only the FIRST scan of
  //      a session pays for the allocations. Subsequent keystrokes compare against strings that
  //      already exist. A WeakMap so it cannot leak: entries die with the messages.
  //
  //   2. The scan is debounced. A scan mid-word is work whose result is discarded by the next
  //      character, and the jump it triggers moves the viewport to a match for a prefix the user
  //      has not finished typing — so the old behaviour was not merely expensive, it was visibly
  //      wrong, yanking the list around while typing. 180 ms is below the threshold where typing
  //      feels laggy and above a fast typist's inter-key gap.
  //
  // Clearing on an empty query stays SYNCHRONOUS: emptying the field must drop the highlights
  // immediately, and there is no scan to pay for.
  const lowerTextCache = useRef(new WeakMap<object, string>()).current;
  const lowerTextOf = useCallback((m: ChatMessage): string => {
    if (!m.text) return '';
    const hit = lowerTextCache.get(m);
    if (hit !== undefined) return hit;
    const low = m.text.toLowerCase();
    lowerTextCache.set(m, low);
    return low;
  }, [lowerTextCache]);

  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) { setSearchMatches([]); setSearchActiveIdx(0); return; }
    const timer = setTimeout(() => {
      const matches: number[] = [];
      for (let i = 0; i < chatMessages.length; i++) {
        if (lowerTextOf(chatMessages[i]).includes(q)) matches.push(i);
      }
      setSearchMatches(matches);
      if (matches.length > 0) {
        const last = matches.length - 1;
        setSearchActiveIdx(last);
        scrollToIndex(matches[last]);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [searchQuery, chatMessages, scrollToIndex, lowerTextOf]);

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
          // ── 1280 → 1080, TO MATCH `pickImages` ────────────────────────────────────
          //
          // Measured, from the perf snapshot taken while sending: two IMG marks labelled `file`, at
          // 284 ms and 286 ms, landing on the same millisecond, with `pendingDecodes: 0` on the long
          // tasks around them — so these are local decodes of the just-sent photos, not network.
          //
          // `pickImages` has resized to 1080 for a long time and its comment records why: "visually
          // identical while cutting the local decode cost ~55% (pixel area (1080/1600)² ≈ 0.46) — a
          // big chunk of the rapid-send decode storm". This function was left at 1280, and it is now
          // the path that carries EVERY photo picked in the app's own panel, so the tuning applied to
          // the path that is barely used any more.
          //
          // 1280² / 1080² = 1.40, so this removes about 29 % of the pixels each of those decodes has
          // to chew through, and there are two of them on the same frame. Upload quality is unchanged
          // in any way the user can see at chat-bubble or fullscreen size.
          const r = await manipulateAsync(u, [{ resize: { width: 1080 } }], { compress: 0.8, format: SaveFormat.JPEG });
          // ── THE BUBBLE THAT RESIZES ITSELF AFTER SEND ─────────────────────────────
          //
          // Reported: send a photo and the bubble is first one size, then another — "sometimes
          // smaller, sometimes bigger", and it looks wrong.
          //
          // This line was missing, and only here. `pickImages` (the OS-sheet path) has always
          // recorded the processed dimensions, and its comment says exactly why: so the optimistic
          // bubble mounts at the correct aspect-ratio box with no size jump. `addPastedImages` did
          // the same resize and threw the dimensions away.
          //
          // That matters because this is now the MAIN path. The in-app `PhotoPickerPanel` confirms
          // through `onConfirm={addPastedImages}`, so every photo attached from the app's own gallery
          // arrived with no cached size. `SingleChatImage` seeds its box from `getImageDims(uri)` and
          // falls back to a 220x220 square when there is nothing cached — so the bubble mounted as a
          // square, the image then loaded, `handleLoad` measured it and set the real aspect ratio, and
          // the bubble jumped. Two layouts for one send, on the frame the message lands, which is also
          // part of why sending felt heavy.
          //
          // Recorded against `r.uri` — the PROCESSED file — because that is the uri that goes into the
          // message and therefore the one the bubble will look up.
          if (r.width && r.height) setImageDims(r.uri, r.width, r.height);
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
  // Clears the message too, so the chrome cannot outlive the photo it described.
  const closeImageViewer = useCallback(() => { setViewerImages(null); setViewerMsg(null); }, []);

  // Carries the MESSAGE the photo came from, not just the urls.
  //
  // The viewer had no idea which message it was showing, which is why it could only ever offer a
  // close button: an author row needs the sender, a delete needs the message id and ownership, and a
  // pin needs the id too. A sibling state rather than widening the viewer's `payload`, because the
  // component freezes a copy of `payload` for the exit animation — chrome must keep reading the live
  // value while the parent has already cleared it.
  const openImageViewer = useCallback((images: string[], index: number, message: ChatMessage) => {
    setViewerImages({ images, index });
    setViewerMsg(message);
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
      // See handleSend: the quoted message own text only. The label is derived at render time.
      replyToText: currentReply?.text || undefined,
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
  // Deleting an imported sticker has to clear it from RECENTS as well as from the store, or the copy
  // recents kept when it was sent survives and the grid re-shows it a few cells further down. See the
  // long note on `removeRecentGif`.
  const onForgetGif = useCallback((id: string) => {
    setRecentGif(removeRecentGif(id));
  }, []);

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

  // ─── FULLSCREEN VIEWER CHROME ─────────────────────────────────────────────
  //
  // Author row and actions for the photo viewer, matching what the profile viewers already show.
  //
  // Declared HERE, after `handleMenuAction` and the pin handlers, deliberately: `const` bindings in a
  // component body are not hoisted, so a memo declared above them and capturing them would throw a
  // TDZ ReferenceError on the first render. The same ordering note already exists above for the
  // search-result actions, for the same reason.
  //
  // Memoized because the viewer compares chrome BY REFERENCE — an inline node would defeat its memo
  // and re-render all three mounted pager images on every render of this (very busy) screen, which is
  // the bug that made dragging the viewer stutter when it was inline JSX.
  const viewerHeader = useMemo(() => {
    if (!viewerMsg) return null;
    const own = viewerMsg.senderId === currentUserId || viewerMsg.senderId === 'current';
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {/* Own emoji is read from the auth store at render time rather than being captured, for the
            same reason bubble ownership is: one device can switch accounts, and the viewer must show
            the account that is signed in NOW. */}
        <Avatar emoji={own ? (useAuthStore.getState().user?.emoji || '😊') : (displayEmoji || '😊')} size="xs" />
        <View style={{ flexShrink: 1 }}>
          <Text variant="caption" weight="semibold" color="#FFFFFF" numberOfLines={1} style={{ fontSize: 11 }}>
            {own ? t('chat.you', 'Вы') : (displayName || t('chat.fallback_name'))}
          </Text>
          <Text variant="caption" color="rgba(255,255,255,0.6)" style={{ fontSize: 9 }}>
            {viewerMsg.createdAt ? formatMessageTime(viewerMsg.createdAt) : ''}
          </Text>
        </View>
      </View>
    );
  }, [viewerMsg, currentUserId, displayEmoji, displayName, t]);

  /**
   * Delete THE PHOTO, not the message.
   *
   * Reported: "I can send a photo together with text. When I open the photo and delete, it should
   * delete the photo, not the text. Right now the text is deleted."
   *
   * Correct — the button routed straight to `handleMenuAction('delete')`, which removes the whole
   * message row. From the chat menu that is right: the user is holding the message. From inside the
   * photo viewer it is not: the user is looking at ONE photo and asking for that photo to go.
   *
   * So this removes only the image currently on screen:
   *
   *   • other images or text remain → the message is EDITED. Store updated, the server PATCHed with
   *     the same `::img::urls::` + text encoding a send uses (the image list lives inside the stored
   *     text, so omitting the marker would have silently dropped the surviving photos on the next
   *     history fetch), and `msg.edit` published so the peer's open chat rewrites in place.
   *
   *   • nothing would be left → falls through to the existing full-message delete, because an empty
   *     message is not a thing. That path owns the confirmation, the tombstone that stops the
   *     history poll resurrecting the row, the dissolve burst and the realtime publish.
   *
   * The viewer is closed first either way, so the user is not left staring at a photo that no longer
   * exists.
   */
  const deleteViewerPhoto = useCallback(async () => {
    const target = viewerMsg;
    const shown = viewerImages;
    if (!target || !conversationId) return;
    const currentUri = shown ? shown.images[Math.min(shown.index, shown.images.length - 1)] : undefined;
    const all = target.imageUrls || [];
    const remaining = currentUri ? all.filter((u) => u !== currentUri) : [];
    const text = target.text || '';

    closeImageViewer();

    // Nothing survives → this is a message delete after all. That path asks for confirmation itself.
    if (remaining.length === 0 && !text.trim()) {
      if (pinnedIds.includes(target.id)) unpinMessage(conversationId, target.id);
      handleMenuAction('delete', target);
      return;
    }

    // ── CONFIRM FIRST ─────────────────────────────────────────────────────────
    //
    // Reported: "before I press delete it should ask whether I really want to — right now it just
    // deletes, too fast."
    //
    // Correct, and it was an inconsistency as much as a hazard: deleting a whole message asks (the
    // menu path opens an Alert), while deleting one photo out of a message did not. Same finger, same
    // icon, same screen, two different levels of ceremony — and the un-asked one is the irreversible
    // one, because a removed photo cannot be recovered from the transcript.
    //
    // Reuses the message-delete strings rather than adding a near-duplicate pair, so both flows read
    // the same in both locales.
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(t('chat.delete_message_title'), '', [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('common.delete'), style: 'destructive', onPress: () => resolve(true) },
      ], { onDismiss: () => resolve(false) });
    });
    if (!confirmed) return;

    triggerHaptic('medium');
    const nextImages = remaining.length > 0 ? remaining : undefined;
    setMessages(
      conversationId,
      (useChatStore.getState().messages[conversationId] || []).map((m) =>
        (m.id === target.id ? { ...m, imageUrls: nextImages } : m),
      ) as any,
    );

    // Persist. Same encoding as a send: the marker carries the image list inside the text column.
    try {
      const serverId = target.serverId || target.id;
      if (!serverId.startsWith('m-')) {
        const marker = remaining.length > 0 ? `::img::${remaining.join('|')}::` : '';
        const { apiPatch } = await import('../../src/services/apiClient');
        const { error } = await apiPatch(`/v1/messages/${encodeURIComponent(serverId)}`, { text: marker + text });
        if (error) showToast(t('toast.error_generic'), 'alert-circle');
      }
    } catch {
      showToast(t('toast.error_generic'), 'alert-circle');
    }

    // Tell the peer, so their open chat rewrites the row in place rather than keeping the photo.
    try {
      const realtime = getRealtime();
      if (realtime) {
        const channel = realtime.channels.get(chatChannelName(conversationId));
        // ALWAYS an array, never `undefined` — this is the fix for "he deletes the photo and it
        // stays on my side".
        //
        // The receiver applies images with `Array.isArray(payload.imageUrls) ? payload.imageUrls :
        // m.imageUrls`, i.e. a non-array means "no information, keep what you have". Publishing
        // `nextImages` sent `undefined` in precisely the case that matters most — a message with ONE
        // photo and some text, where removing the photo leaves the text behind — so the peer kept the
        // photo for ever while it was gone locally.
        //
        // `remaining` is `[]` there, which IS an array, so the peer clears its list. Every render path
        // guards on `imageUrls && imageUrls.length > 0`, so an empty array reads as "no photos"
        // everywhere without a second change.
        void channel.publish('msg.edit', { id: target.serverId || target.id, text, imageUrls: remaining });
      }
    } catch {}
  }, [viewerMsg, viewerImages, conversationId, pinnedIds, unpinMessage, handleMenuAction, closeImageViewer, setMessages, t]);

  const viewerFooter = useMemo(() => {
    if (!viewerMsg) return null;
    const own = viewerMsg.senderId === currentUserId || viewerMsg.senderId === 'current';
    const isPinned = !!conversationId && pinnedIds.includes(viewerMsg.id);
    return (
      <View style={{ alignItems: 'center', gap: 10 }}>
        {/* THE MESSAGE'S OWN TEXT, when it has any.
   
            Asked for: a photo sent together with text should show that text in the viewer, compactly,
            scrollable, with no container around it.
   
            So: no background, no border, no card — just the words over the photo, with a shadow so
            they stay readable on a light image. Capped at 96 pt and scrollable, because a caption can
            be a paragraph and the actions must never be pushed off screen. `bounces={false}` so a
            short caption does not rubber-band, and `nestedScrollEnabled` because this sits inside the
            viewer's own gesture area and Android needs it stated.
   
            Rendered above the buttons and inside the same fading footer, so it arrives and leaves with
            them rather than being a fourth thing with its own timing. */}
        {viewerMsg.text?.trim() ? (
          <ScrollView
            style={{ maxHeight: 96, alignSelf: 'stretch', marginHorizontal: 24 }}
            contentContainerStyle={{ paddingBottom: 2 }}
            showsVerticalScrollIndicator={false}
            bounces={false}
            nestedScrollEnabled
          >
            <Text
              variant="caption"
              color="#FFFFFF"
              style={{ fontSize: 13, lineHeight: 18, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }}
            >
              {viewerMsg.text}
            </Text>
          </ScrollView>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {/* THE ICON REFLECTS STATE.
   
            It did not: I wrote `icon={isPinned ? 'bookmark' : 'bookmark'}` — the same glyph in both
            branches — so pressing it changed nothing visible and there was no way to tell a pinned
            photo from an unpinned one. Reported as "it should become a checkmark, that I saved it".
   
            So it does: `check` once pinned, `bookmark` while not. Feather has no filled-bookmark
            variant, and a tick is what "done, it is saved" looks like anyway.
   
            Pin is offered for ANY message, own or not — pinning is about what matters in the
            conversation, not about authorship, which is how the pinned bar already behaves. */}
        <ViewerActionButton
          icon={isPinned ? 'check' : 'bookmark'}
          accessibilityLabel={isPinned ? t('chat.unpin', 'Открепить') : t('chat.pin', 'Закрепить')}
          onPress={() => {
            if (!conversationId) return;
            triggerHaptic('medium');
            togglePinnedMessage(conversationId, viewerMsg.id);
          }}
        />
        {own && (
          <ViewerActionButton
            icon="trash-2"
            destructive
            accessibilityLabel={t('chat.menu.delete')}
            onPress={() => { void deleteViewerPhoto(); }}
          />
        )}
        </View>
      </View>
    );
  }, [viewerMsg, currentUserId, conversationId, pinnedIds, togglePinnedMessage, deleteViewerPhoto, t]);

  const onDeleteSearchResult = useCallback(() => {
    if (!activeMatchMessage) return;
    // A pinned message that gets deleted must not leave a dangling pin.
    if (conversationId && pinnedIds.includes(activeMatchMessage.id)) {
      unpinMessage(conversationId, activeMatchMessage.id);
    }
    handleMenuAction('delete', activeMatchMessage);
  }, [activeMatchMessage, conversationId, pinnedIds, unpinMessage, handleMenuAction]);

  // Labels for `toPreviewText`, memoized on the translator so the object identity is stable — it is
  // passed into a util on every render of this very busy screen.
  const pinPreviewLabels = useMemo(
    () => ({ photo: t('chat.photo'), gif: 'GIF', link: t('chat.link', 'Ссылка'), reply: t('chat.reply_label', 'Ответ') }),
    [t],
  );

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
    // Sending is reading. Stamps this conversation's read watermark to NOW, which closes the window
    // the "I see an unread badge for my own message" report came through: the outgoing row updates the
    // conversation's `lastMessageAt`, and anything comparing that against an older watermark would
    // raise a badge for a message the user just typed. Cheap, idempotent, and belt-and-braces with the
    // bridge-side guard — that one requires positive evidence of another sender, this one makes the
    // question moot for the chat you are actually in.
    try { if (conversationId) useChatUnread.getState().clear(conversationId); } catch {}
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
      // ── PERSIST THE EDIT ON THE SERVER ────────────────────────────────────
      //
      // The step that never existed. Reported as "editing does not work anywhere — I edit and
      // the old message stays".
      //
      // Everything else in this branch is local: the store is rewritten and `msg.edit` is
      // published so the peer rewrites theirs. Nothing updated D1, so the server kept the
      // ORIGINAL text for ever and it came back the moment the transcript was rebuilt from it —
      // reopening the chat, opening it on another device, or a history fetch. Exactly the
      // disease delete had.
      //
      // Awaited, unlike the delete call, because the local store has already been rewritten
      // above: if this fails we want to know before the user walks away believing it saved.
      // Failure is surfaced as a toast rather than reverted — reverting would throw away text
      // the user typed, and the edit is still correct locally and on the peer's screen.
      void (async () => {
        try {
          const serverId = editing.serverId || editing.id;
          // Local-only ids were never on the server; there is nothing to PATCH. The row will
          // carry the edited text when its create finally lands.
          if (serverId.startsWith('m-')) return;
          const { apiPatch } = await import('../../src/services/apiClient');
          const { error } = await apiPatch(`/v1/messages/${encodeURIComponent(serverId)}`, { text });
          if (error) showToast(t('toast.error_generic'), 'alert-circle');
        } catch {
          showToast(t('toast.error_generic'), 'alert-circle');
        }
      })();
      // Sync the edit to the peer's open chat. The receiver's subscription
      // handler updates the message in place by id. The Worker now publishes the same event
      // after a successful PATCH, so a peer whose socket missed this client-side publish still
      // gets it — and a peer who was offline entirely reads the edited text from the server.
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
      // The quoted message OWN text, never a display label. This used to bake a photo label in
      // whenever the quote carried images, which is why replying to a GIF read as a photo and why a
      // photo WITH a caption lost the caption - the most useful thing the preview could show. The
      // label is a rendering decision and is now made at render time by quotedLinePreview, from the
      // thumbnail when there is no text.
      replyToText: currentReply?.text || undefined,
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
        // ── THE REPLY IS PERSISTED NOW ────────────────────────────────────────
        //
        // This payload used to be `{ text: imageMarker + text }`, and that single omission is the whole
        // "the other person does not see that I replied" report. The realtime publish below already
        // carried the reply fields and the receiver already applied them — but nothing was stored, so
        // the reply lived only in the two devices' memory. Visible while both had the chat open, gone
        // the moment the peer opened it later and the transcript came from the database.
        //
        // The quoted AUTHOR's id goes in rather than a "is it mine" boolean: that answer is relative to
        // whoever is looking, so a stored boolean is wrong on one of the two devices by construction.
        // See src/utils/chatReplyMarker.ts.
        const replyMarker = encodeReplyMarker(
          currentReply
            ? {
                id: currentReply.id,
                text: newMessage.replyToText,
                image: newMessage.replyToImage,
                senderId: currentReply.senderId,
                pixelIconId: newMessage.replyPixelIconId,
              }
            : null,
        );
        const { data: sentData } = await apiPost<{ id: string }>(
          `/v1/conversations/${encodeURIComponent(convId)}/messages`,
          { text: replyMarker + imageMarker + text },
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
    let healed = healLegacySender(m, currentUserId, participantId);

    // ── REPLY CONTEXT, DECODED FROM THE STORED TEXT ──────────────────────────
    //
    // Reported repeatedly: "I reply to a message and the other person just sees an ordinary message."
    //
    // The live path was never the problem — the realtime publish carries the reply fields and the
    // receiver applies them. What was missing is PERSISTENCE. Only `{ text: imageMarker + text }` was
    // ever sent to the server, so the reply existed solely in the two devices' memory: visible while
    // both had the chat open, gone the moment the peer opened it later and the transcript was rebuilt
    // from the database. That is why it looked like replies "sometimes" worked.
    //
    // `decodeReplyMarker` reads the `::rp::` prefix a send now writes. Ownership of the QUOTED message
    // is derived here from the quoted author's id against the signed-in user, rather than trusting a
    // transmitted boolean — "is this mine" is relative to whoever is looking, so a stored `true` would
    // be wrong on exactly one of the two devices.
    //
    // Runs BEFORE the image parse, because a send writes the reply marker first and the two are
    // stripped in the same order they were written.
    const decodedReply = decodeReplyMarker(healed.text, currentUserId);
    if (decodedReply) {
      healed = { ...healed, ...decodedReply.fields, text: decodedReply.rest };
    }

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
  // ── INVERTED LIST: DATA IS NEWEST-FIRST ─────────────────────────────────────
  //
  // This is the change every previous scroll fix was working around.
  //
  // The list used to be non-inverted with `startRenderingFromBottom`, so the newest message was
  // at the END of `data` and loading older history was a PREPEND. A prepend cannot be free:
  // FlashList has to record the first visible item's layout, re-find it after the update and
  // scroll by the difference. That correction is what produced every "it throws me to the top"
  // report — deleting the render window, deleting a competing scrollToIndex, paging in 60s,
  // adding a cooldown and deferring the commit to the scroll-settle all reduced its size or
  // moved its timing, and none of them removed it.
  //
  // Inverted, index 0 is the newest message and sits at the bottom. Loading older history
  // becomes an APPEND at the far end of the data — off-screen, below the anchor, with no
  // measured row above the viewport changing position. There is nothing to correct, so there is
  // nothing to feel. That is why every messenger builds its transcript this way, and FlashList's
  // own prop docs name `inverted` as being for exactly this: "chat-like interfaces where the
  // newest content appears at the bottom".
  //
  // WHAT THIS DOES NOT BREAK, AND WHY
  //   Reply-jump, search-jump and pinned-jump all resolve by ID, not by index: `scrollToIndex`
  //   converts its argument to `chatMessages[index].id` immediately and the resolver does a
  //   `findIndex` on the RENDERED array. So they follow the inversion for free, and
  //   `searchMatches` can keep holding chronological indices.
  //
  //   Day separators are keyed by message id (`buildDaySeparators` returns id → iso), so they
  //   are direction-independent as long as the CHRONOLOGICAL array is what gets analysed — see
  //   `dayLabels`, which is passed `chatMessages` rather than this.
  //
  // The reverse is a shallow copy per message-list change. That is O(n) on an array we already
  // rebuild on those same commits, and it buys the removal of offset correction from every
  // scroll — not a trade worth optimising away with a mutable structure.
  const windowedMessages = useMemo(() => perfSpan(`chat.reverse(${chatMessages.length})`, () => {
    const out = chatMessages.slice();
    out.reverse();
    return out;
  }), [chatMessages]);
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
      lastOlderLoadAtRef.current = 0;
      pendingOlderLoadRef.current = false;
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

    // ── ONE PAGE PER GESTURE, NOT A CASCADE ──────────────────────────────────
    //
    // Reported after paging landed as: it still throws me to the top, and messages move by
    // themselves. Both were this.
    //
    // `loadingOlderRef` is released as soon as a chunk commits, and `onChatScroll` re-arms
    // `startReachedArmedRef` on EVERY scroll event. A prepend makes FlashList apply offset
    // correction, which scrolls — which produces another scroll event, which re-arms, and the
    // list is still near the top, so `onStartReached` fires again immediately. One flick to the
    // top therefore chained page after page, each one a prepend that moved content under the
    // user. Replacing the old load-everything hydrate with paging reduced the size of each
    // jump and multiplied their number, which is why it did not feel fixed.
    //
    // A cooldown bounds it to one page per interval regardless of how many scroll events the
    // correction generates. 900 ms is longer than the correction takes to settle, and short
    // enough that deliberately scrolling up through history still feels continuous.
    const now = Date.now();
    if (now - lastOlderLoadAtRef.current < OLDER_LOAD_COOLDOWN_MS) return;
    lastOlderLoadAtRef.current = now;
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
    // Request it; do not perform it. The commit happens on the scroll-settle timer in
    // `onChatScroll`, so the prepend's offset correction never competes with an in-flight
    // fling — see the long note there. `loadingOlderRef` stays true until that commit, which
    // is what stops a second request being queued for the same gesture.
    pendingOlderLoadRef.current = true;
  }, []);

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
  const dayLabels = useMemo(() => perfSpan(`chat.dayLabels(${chatMessages.length})`, () => {
    // CHRONOLOGICAL array on purpose, not the inverted render array. `buildDaySeparators` marks
    // the first message of each local day by comparing each row with the one before it, so it
    // needs time to run forwards. Its output is keyed by message id, which makes it independent
    // of render order — the renderer looks the label up by id.
    //
    // This runs on EVERY change to the message array, and after the full history is hydrated that
    // is a walk over up to a thousand rows. The per-message date parsing it used to do on each of
    // those walks is now cached against the message objects (see `buildDaySeparators`), so a
    // recompute costs a WeakMap lookup and a string compare per row rather than a `Date.parse`,
    // a `Date` allocation and a key-string allocation. The row count is in the mark's label so the
    // perf panel shows how the cost scales with transcript length.
    const separators = buildDaySeparators(chatMessages);
    const now = Date.now();
    const out = new Map<string, string>();
    for (const [id, iso] of separators) {
      const label = formatDaySeparator(iso, now, locale, t);
      if (label) out.set(id, label);
    }
    return out;
  }),
    // `t` is intentionally NOT a dependency — it is a fresh function every
    // render, and `locale` is the value that actually changes the output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  [chatMessages, locale]);

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
      // ── OLDER PAGES ARE COMMITTED HERE, WHEN THE LIST IS STILL ───────────────
      //
      // This is the fix for "it throws me to the top", and it is about WHEN, not how much.
      //
      // Prepending older messages requires FlashList to correct the scroll offset: it records
      // the first visible item's measured layout, re-finds that key after the update, and
      // scrolls by the difference. That is correct and it is what `maintainVisibleContentPosition`
      // is documented to do ("maintaining scroll position when content changes... enabled by
      // default to reduce visible glitches"). Our FlashList config already matches the chat
      // example in those docs exactly.
      //
      // The problem was never the correction — it was that the request fires DURING the gesture,
      // so the correction competed with an in-flight fling. A scroll being corrected while the
      // finger is still moving it is precisely the sensation reported: content shifting on its
      // own, and the viewport being dragged toward the top.
      //
      // Committing on the settle timer means the load lands ~180 ms after the last scroll event,
      // with the list stationary.
      //
      // KEPT AFTER THE INVERSION even though the inversion removes the correction entirely (older
      // messages now APPEND below the anchor — see the note on `windowedMessages`). Two reasons
      // it still earns its place: the work itself is a store write plus a re-render of the data
      // array, which is real JS-thread cost that has no business landing mid-fling; and a
      // deferred commit is the safer default if the list ever stops being inverted.
      //
      // The cooldown and the `moreOlderRef` latch still gate the request; this only defers it.
      if (pendingOlderLoadRef.current) {
        pendingOlderLoadRef.current = false;
        loadOlderChunkRef.current();
        loadingOlderRef.current = false;
      }
    }, 180);
    const now = Date.now();
    if (now - lastScrollEventAt.current < 32) return;
    lastScrollEventAt.current = now;
    const ne = e?.nativeEvent;
    const y = ne?.contentOffset?.y ?? 0;
    const layoutH = ne?.layoutMeasurement?.height ?? 0;
    const contentH = ne?.contentSize?.height ?? 0;
    // INVERTED list: index 0 (the newest message) is at the bottom, and `contentOffset.y` grows
    // as the user scrolls UP into history. So y IS the distance from the newest message — no
    // arithmetic needed, and the old `contentH - (y + layoutH)` would now be backwards, hiding
    // the scroll-to-newest button exactly when it is needed and showing it when it is not.
    scrollMetricsRef.current = { y, layoutH, contentH };
    const next = y > SCROLL_BTN_THRESHOLD;
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
    // So: ask for the newest message and await it. The single follow-up is ordered by the promise
    // rather than by a guessed timer, and only covers the spacer beyond the final bubble — a few
    // points, un-animated, therefore invisible. One gesture, one move.
    //
    // INVERTED: the newest message is index 0, and the follow-up is `scrollToOffset({ offset: 0 })`
    // rather than `scrollToEnd()` — "end" now means the OLDEST message, so `scrollToEnd` would
    // send the user to the top of the entire history, which is the opposite of this button.
    if (windowedMessagesRef.current.length === 0) return;

    // Claim the scroll generation so any other chain already in flight
    // (`revealNewest`, a reply jump) abandons its follow-up instead of fighting
    // this one for the viewport.
    const gen = ++scrollGenRef.current;

    void (async () => {
      try {
        await fl.scrollToIndex({ index: 0, animated: true, viewPosition: 0 });
        // Land past the spacer beyond the newest bubble. Guarded because the user may have
        // started scrolling again, or navigated away, while the animation ran.
        if (gen !== scrollGenRef.current) return;
        flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
      } catch {
        // Any rejection (index out of range after a concurrent data change,
        // list unmounted) falls back to the plain call, which is still correct
        // — just without the measured animation.
        if (gen !== scrollGenRef.current) return;
        try { flatListRef.current?.scrollToOffset({ offset: 0, animated: true }); } catch {}
      }
    })();
  }, []);

  const banner = editing || replyTo;
  const menuIsOwn = actionMessage ? (actionMessage.senderId === currentUserId || actionMessage.senderId === 'current') : false;

  // ── THE TRANSCRIPT IS ITS OWN MEMO BOUNDARY ────────────────────────────────
  //
  // From the user's snapshot: chat/[id] shows 3 long tasks (worst 199 ms, avg 174 ms), 9 jank
  // events and a worst FPS of 11 — while the MARKED work inside those tasks adds up to 6 ms
  // (`chat.cachedHistory.read` 5, `chat.reverse(120)` 0, `chat.dayLabels(120)` 1). The derivations
  // are not the cost. What costs is what a new array identity CAUSES: this component body re-runs
  // and FlashList reconciles 120 rows.
  //
  // And the body re-runs constantly for reasons the transcript does not care about. It owns 26
  // pieces of local state — search text, the scroll-to-bottom button, keyboard height, the emoji
  // panel, replyTo, editing, pendingImages, uploading, pinCursor, jumpNonce, realtimeTick,
  // profileData, viewerImages, translateText, photoPanelOpen — and until now the list element was
  // built inline in that same body, so every one of them handed FlashList a fresh element.
  // Typing one character into search reconciled the whole transcript.
  //
  // Hoisting the element into a memo is the documented remedy: React skips a subtree whose element
  // identity is unchanged, and react.dev prescribes splitting at the state read so the expensive
  // child only sees what it needs. https://react.dev/reference/react/memo
  //
  // This is deliberately NOT the full fix. The real one is to split this 4,835-line body into a data
  // owner and a transcript child, which is a much larger change. This puts the memo boundary where
  // that split would put it, so the win lands now and the split becomes a mechanical follow-up.
  //
  // WHY THE DEPENDENCY LIST IS SHORT, AND WHY THAT IS NOT AN OVERSIGHT
  //   Every other prop in the block is already stable by construction: `chatKeyExtractor` and
  //   `chatGetItemType` are useCallback([]), `viewabilityConfig` and `onViewableItemsChanged` are
  //   useRef(...).current, `onStartReached` and `onChatScroll` are useCallback([]), the two spacer
  //   elements are memoised, and MVCP_INVERTED / LIST_CONTENT_CONTAINER_STYLE are module constants.
  //   They are listed anyway so a future change to any of them cannot silently stale the memo.
  //
  // The dead `listReady` ternary went with this. `listReady` is a hardcoded `true` (its rAF gate was
  // removed earlier and the branch was left behind), so the `<View absoluteFill/>` fallback had been
  // unreachable.
  const transcriptEl = useMemo(
    () => (
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
          // Newest at the bottom, and — the reason this exists — loading older history becomes an
          // APPEND instead of a prepend, so there is no offset correction to fight. See the long
          // note on `windowedMessages`. From the v2 prop docs: "Reverses the direction of the
          // list... Useful for chat-like interfaces where the newest content appears at the bottom."
          inverted
          maintainVisibleContentPosition={MVCP_INVERTED}
          // Bound how far ahead rows are built. Chat bubbles are expensive — each
          // carries gesture handlers and Reanimated layers — so an unbounded
          // pre-render window turns a fling through a media-heavy chat into a burst
          // of row construction plus image decodes landing on the same frames.
          // Halved again on weak hardware and in Low Power Mode.
          drawDistance={chatBudget.drawDistance}
          // ── BOUND THE RECYCLE POOL ────────────────────────────────────────────
          //
          // From the FlashList v2 prop docs: "Maximum number of items in the recycle pool. These
          // are the items that are cached in the recycle pool when they are scrolled off the
          // screen. [...] There's no limit by default."
          //
          // No limit is the wrong default for THIS list. A chat bubble is one of the most
          // expensive rows in the app — a GestureDetector with a composed gesture, three
          // Reanimated views with their own animated styles, and for gradient bubbles a
          // LinearGradient. Scrolling a long conversation therefore accumulates retained native
          // views for every distinct item type it has passed, and none are ever released.
          //
          // 24 is comfortably more than fits on screen plus overscan at `drawDistance` 250, so
          // recycling still hits the pool on normal scrolling; it just stops the pool growing
          // without bound over a long session. Deliberately not 0 — the docs note that disables
          // the pool entirely and unmounts rows as they leave, which would re-pay the full mount
          // cost for every row scrolled back into view.
          maxItemsInRecyclePool={24}
          contentContainerStyle={LIST_CONTENT_CONTAINER_STYLE}
          // Non-inverted: ListHeaderComponent is the TOP (oldest) spacer under the
          // header gradient; ListFooterComponent is the BOTTOM spacer above the
          // input bar. (Swapped from the old inverted layout.)
          // SWAPPED for the inversion. `inverted` flips the visual order of header and footer along
          // with everything else, so the element that must appear at the TOP of the screen (the
          // spacer under the header gradient, plus the loading-older affordance) is now the FOOTER,
          // and the bottom spacer above the composer is the HEADER. The names refer to positions in
          // the data, and in an inverted list the start of the data is the bottom of the screen.
          ListHeaderComponent={listFooterEl}
          ListFooterComponent={listHeaderEl}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          // Load OLDER history when the user nears the TOP (oldest) of the list.
          // `onEndReached`, not `onStartReached`. Older messages live at the END of an inverted
          // list's data, so reaching the end is what "the user scrolled up to the oldest loaded
          // message" now means. Wiring the start would fire when the user reached the NEWEST
          // message, i.e. immediately and constantly, since that is where the list rests.
          onEndReached={onStartReached}
          // 0.05, not 0.15. The threshold is a FRACTION of the content length, so on a short
          // window 0.15 is satisfied while the user is still nowhere near the top — the list
          // asked for older history unprompted. Combined with the cooldown in `onStartReached`,
          // loading now begins when the user is genuinely approaching the oldest loaded message.
          onEndReachedThreshold={0.05}
          // Scroll-to-bottom button visibility — onChatScroll computes distance
          // from the bottom (newest) from the scroll event.
          onScroll={onChatScroll}
          scrollEventThrottle={32}
        />
    ),
    [windowedMessages, renderItem, chatBudget.drawDistance, listHeaderEl, listFooterEl,
     chatKeyExtractor, chatGetItemType, onStartReached, onChatScroll, viewabilityConfig,
     onViewableItemsChanged],
  );

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
      {transcriptEl}
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
      {/* ── BACK TO FLUSH WITH THE COMPOSER. THE OVERHANG WAS MY MISTAKE. ────────
   
            Reported: the darkening must not sit ABOVE the input field.
   
            Last round I wrapped this in `surfaceScrimHeight`, which adds 28 pt so the chat would match
            the sticker library "one to one". I argued that the recorded objection to overhang — "it
            sticks out above the input field", "the dimming sticks out over the messages" — applied only
            to the BLACK ramp, because a surface ramp dissolves content instead of darkening it.
   
            That argument was wrong, and the distinction I drew does not survive contact with the screen.
            A surface ramp above the field still ERASES the messages behind it: the fact that they fade
            into the page rather than going grey does not make covering them acceptable. The transcript's
            bottom rows simply vanish early. `scrim.ts` had the rule right the first time, twice, and I
            talked myself past it on a colour-theory technicality.
   
            Flush again: exactly this composer's footprint, `COMPOSER_SCRIM_OVERHANG` at 0. The sticker
            library keeps its overhang, where there is no field for the ramp to climb over. */}
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
        {/* ── THE SURFACE RAMP, NOT THE BLACK ONE ──────────────────────────────────
   
            Asked for by comparison with the imported-stickers screen: the same fade, exactly, in the
            chat. The difference was never the softness — both use the same seventeen-stop
            `smoothstep × gamma` curve — it is WHAT the ramp goes to. The black ramp DIMS content as it
            approaches the composer; the surface ramp IS the page, so content dissolves into the
            background and vanishes with no colour shift to notice.
   
            Still the shared builder rather than local stops, and the geometry is untouched: this scrim
            is exactly as tall as THIS composer's footprint (`composerScrimHeight`), which is a
            different measurement from the tab bar's, deliberately — see the note above. */}
        <LinearGradient
          colors={bottomSurfaceScrimColors(bgColor)}
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
                  <MaterialIcons name="keyboard-arrow-down" size={20} color={theme.colors.text.primary} />
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
                <MaterialIcons name="keyboard-arrow-down" size={20} color={theme.colors.text.primary} />
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
            <MaterialIcons name={editing ? 'edit' : 'reply'} size={15} color={theme.colors.accent.primary} />
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
                  <MaterialIcons name="image" size={18} color={theme.colors.text.tertiary} />
                )}
              </Pressable>
            ) : null}
            <Pressable onPress={() => { setReplyTo(null); setEditing(null); inputRef.current?.clear(); }} hitSlop={8}>
              <MaterialIcons name="close" size={18} color={theme.colors.text.tertiary} />
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
                  <MaterialIcons name="close" size={13} color="#FFFFFF" />
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
              labels={mediaPanelLabels}
              onSendEmoji={onSendEmojiMessage}
              onCopyEmoji={onCopyEmoji}
              onSendGif={onPickGif}
              onCopyGif={onCopyGif}
              onForgetGif={onForgetGif}
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
          the dimming zone.

          FLUSH WITH THE HEADER, for the same reason as the composer scrim below.
          Reported: the dimming must not reach BELOW the back button / name / avatar.
          `surfaceScrimHeight` added 28 pt of overhang here to match the sticker library;
          downward overhang on a TOP scrim lands squarely on the first message rows, which
          is exactly the complaint. The wrapper is the chrome's own footprint again, so the
          ramp finishes where the header finishes. */}
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        {/* Shared scrim ramp — see the note on the footer gradient below. */}
        <LinearGradient
          colors={topSurfaceScrimColors(bgColor)}
          locations={SCRIM_LOCATIONS}
          style={StyleSheet.absoluteFill}
        />
        {searchMode ? (
          <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
            {glassActive ? (
              <NativeGlassView glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingHorizontal: 14, height: 40 }}>
                <MaterialIcons name="search" size={16} color={theme.colors.text.tertiary} />
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
                <MaterialIcons name="search" size={16} color={theme.colors.text.tertiary} />
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
                      <MaterialIcons name="keyboard-arrow-up" size={18} color={theme.colors.text.primary} />
                    </NativeGlassView>
                  </Pressable>
                ) : (
                  <Pressable onPress={goToPrevMatch} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
                    <MaterialIcons name="keyboard-arrow-up" size={18} color={theme.colors.text.primary} />
                  </Pressable>
                )}
                {glassActive ? (
                  <Pressable onPress={goToNextMatch} style={{ borderRadius: 18, marginLeft: 6 }}>
                    <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.headerCircleGlass}>
                      <MaterialIcons name="keyboard-arrow-down" size={18} color={theme.colors.text.primary} />
                    </NativeGlassView>
                  </Pressable>
                ) : (
                  <Pressable onPress={goToNextMatch} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, marginLeft: 6 }]}>
                    <MaterialIcons name="keyboard-arrow-down" size={18} color={theme.colors.text.primary} />
                  </Pressable>
                )}
              </View>
            )}
            {glassActive ? (
              <Pressable onPress={closeSearch} style={{ borderRadius: 18, marginLeft: 6 }}>
                <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.headerCircleGlass}>
                  <MaterialIcons name="close" size={20} color={theme.colors.text.primary} />
                </NativeGlassView>
              </Pressable>
            ) : (
              <Pressable onPress={closeSearch} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, marginLeft: 6 }]}>
                <MaterialIcons name="close" size={20} color={theme.colors.text.primary} />
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
                    <MaterialIcons name="chevron-left" size={22} color={theme.colors.text.primary} />
                    <Text variant="caption" weight="semibold" numberOfLines={1} color={theme.colors.text.primary} style={styles.backLabel}>{t('common.back')}</Text>
                  </NativeGlassView>
                </Pressable>
              ) : (
                <Pressable onPress={() => router.back()} style={[styles.backPill, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
                  <MaterialIcons name="chevron-left" size={22} color={theme.colors.text.primary} />
                  <Text variant="caption" weight="semibold" numberOfLines={1} color={theme.colors.text.primary} style={styles.backLabel}>{t('common.back')}</Text>
                </Pressable>
              )}
            </View>
            {/* ── RESTORED. THE BARE VERSION WAS WORSE. ────────────────────────────────
   
                I removed the name's pill and moved the avatar to sit directly after the back button,
                on the request "back button, then the emoji and the name, without any container". The
                result was rejected: it "looks terrible", and the earlier arrangement — name centred,
                avatar separate on the right — was the one that read properly.
   
                So this is back verbatim: the name keeps its pill (glass when active, elevated fill
                with a hairline border otherwise), centred by `headerTitleWrap` between two
                non-shrinking side columns, and the avatar is its own circular control at the right
                edge. Both still open the profile; the name still opens search on long-press.
   
                Worth keeping in mind for the next attempt: what was asked for after this was
                something DISTINCTIVE, not the removal of containers. Stripping chrome makes a header
                plainer, which is the opposite direction. */}
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
          // Cleaned, not raw.
          //
          // Reported: pinning a photo-with-text message showed "dots, image, ID and a link" in the
          // pinned bar. That is the stored `::img::<url>::` marker rendered verbatim — the bar printed
          // `message.text` straight out of the store, and a message that arrived from the server (or
          // whose parse left the marker in place) carries the marker inside its text.
          //
          // `toPreviewText` is the shared cleaner the chat list already uses for exactly this: it strips
          // every marker and labels media instead of printing a URL. Reusing it rather than adding a
          // strip here is the point — the marker vocabulary now has ONE reader on the client, so a new
          // marker cannot leak into a fourth surface.
          preview={
            toPreviewText(activePin.message.text, pinPreviewLabels) ||
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
      {/* Chrome added: the chat viewer used to show a close button and nothing else — no author, no
          date, no actions — while the profile viewers had all three. Same component, so it was only
          ever missing the props. `bottomInset` matters too: it was absent, and the footer's
          safe-area padding comes from it, so actions would have sat under the home indicator. */}
      <ImageViewerModal
        payload={viewerImages}
        onClose={closeImageViewer}
        topInset={insets.top}
        bottomInset={insets.bottom}
        proxyWidth={CHAT_IMG_MAX_W}
        header={viewerHeader}
        footer={viewerFooter}
        zoomable
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
      <MaterialIcons name={icon as any} size={19} color={color} />
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
        icon={isPinned ? 'cancel' : 'bookmark'}
        label={isPinned ? unpinLabel : pinLabel}
        color={theme.colors.accent.primary}
        onPress={onPin}
      />
      {/* Destructive red rather than the accent: colour is the only warning the
          delete gets before its confirmation dialog. */}
      <SearchActionButton icon="delete" label={deleteLabel} color="#FF453A" onPress={onDelete} />
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
        <MaterialIcons name="bookmark" size={14} color={theme.colors.accent.primary} />
        <View style={{ flex: 1 }}>
          <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} style={{ fontSize: 11 }} numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" color={theme.colors.text.secondary} style={{ fontSize: 12 }} numberOfLines={1}>
            {preview}
          </Text>
        </View>
        <Pressable onPress={onUnpin} hitSlop={10} accessibilityRole="button" accessibilityLabel={closeLabel}>
          <MaterialIcons name="close" size={16} color={theme.colors.text.tertiary} />
        </Pressable>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  // Reserved strip for the "loading older" indicator. Height is CONSTANT so the
  // indicator appearing or disappearing at the top of the transcript can never
  // shift content — see the note in `OlderMessagesLoader`.
  // `flexDirection: row` so the three glyphs sit side by side. Height stays 24 — the reserved
  // strip must not change size, and the 19 pt emoji boxes fit inside it with room to spare.
  olderLoader: { height: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
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
