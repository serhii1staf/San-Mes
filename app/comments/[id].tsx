import React, { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore, useImperativeHandle } from 'react';
import { View, FlatList, TextInput, Pressable, Platform, ActivityIndicator, StyleSheet, Text as RNText, Modal, Alert, InteractionManager, ScrollView, Dimensions, Keyboard, AppState } from 'react-native';
import { useReanimatedKeyboardAnimation, useKeyboardHandler } from 'react-native-keyboard-controller';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming, runOnJS, Easing } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { bottomScrimColorsStrong, composerScrimHeight, headerScrimHeights, SCRIM_LOCATIONS, topScrimColors } from '../../src/theme/scrim';
import { Feather } from '@expo/vector-icons';
import { useSwipeToReply } from '../../src/hooks/useMessageGestures';
import { useTheme } from '../../src/theme';
import { useLiquidGlassActive, NativeGlassView, GlassBg } from '../../src/components/ui/LiquidGlass';
import { Text, Avatar } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { FormattedText, hasCodeBlock } from '../../src/components/ui/FormattedText';
import { LinkPreview } from '../../src/components/ui/LinkPreview';
import { extractFirstUrl } from '../../src/services/linkPreview';
import { useContextMenuGuard } from '../../src/hooks/useContextMenuGuard';
import { useChatKeyboardMode } from '../../src/hooks/useChatKeyboardMode';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { ImageViewerModal, ViewerActionButton } from '../../src/components/chat/ImageViewerModal';
import { formatTimeAgo } from '../../src/utils/mockData';
import Skeleton from '../../src/components/ui/Skeleton';
import { useStaggeredReveal, useStaggeredGifReveal, setRevealScrollPaused } from '../../src/hooks/useStaggeredReveal';
import { CommentContextMenu, CommentAction } from '../../src/components/ui/CommentContextMenu';
import { SlideUpSheet } from '../../src/components/ui/SlideUpSheet';
import { MediaPanel } from '../../src/components/chat/MediaPanel';
import { AnimatedEmojiIcon } from '../../src/components/chat/AnimatedEmojiIcon';
import { AnimatedGifIcon } from '../../src/components/chat/AnimatedGifIcon';
import { AnimatedKeyboardIcon } from '../../src/components/chat/AnimatedKeyboardIcon';
import { parseGif, GiphyItem } from '../../src/services/giphy';
import { getRecentEmoji, pushRecentEmoji } from '../../src/services/recentEmoji';
import { getRecentGif, pushRecentGif } from '../../src/services/recentGif';
import { kvGetJSONSync, kvSetJSON } from '../../src/services/kvStore';
import { useAuthStore, useConnectivityStore } from '../../src/store';
import { getRealtime, postChannelName } from '../../src/services/realtime/ably';
import { TypingIndicator } from '../../src/components/ui/TypingIndicator';
import { typingPostChannelName, useTypingPublisher } from '../../src/services/realtime/typing';
import { clearActiveThread, setActiveThread } from '../../src/services/activeThread';
import { getComments, createComment, updateComment, deleteComment, isRepost, parseImageUrls } from '../../src/lib/supabase';
import { generateClientMutationId, queueMutation } from '../../src/services/offlineQueue';
import { triggerHaptic } from '../../src/utils/haptics';
import { sanitizeUserText } from '../../src/utils/sanitizeText';
import { playSendSound } from '../../src/utils/sounds';
import { showToast } from '../../src/store/toastStore';
import { useT } from '../../src/i18n/store';
import { useMediaPanelLabels } from '../../src/components/chat/useMediaPanelLabels';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useEffectiveBrowserWidgetPosition } from '../../src/lib/browserWidget';
import { useBrowserStore } from '../../src/store/browserStore';
import { useIsBlocked } from '../../src/store/blockedUsersStore';
import { BlockedContentPlaceholder } from '../../src/components/feed/BlockedContentPlaceholder';
const SCREEN_WIDTH = Dimensions.get('window').width;

// Delete one full user-perceived character from the end of a string. Handles
// astral emoji (surrogate pairs), variation selectors, skin-tone modifiers and
// ZWJ-joined sequences (👨‍👩‍👧, ❤️‍🔥, 🏳️‍🌈) so one backspace removes one emoji.
// (Mirror of the helper in ChatInputBar — kept local so the comments composer
// doesn't depend on the chat input internals.)
function deleteLastGrapheme(s: string): string {
  if (!s) return s;
  const cps = Array.from(s);
  if (cps.length === 0) return s;
  const isMod = (cp: string) => {
    const c = cp.codePointAt(0) || 0;
    return (
      c === 0xfe0f || c === 0xfe0e ||
      (c >= 0x1f3fb && c <= 0x1f3ff) ||
      (c >= 0x0300 && c <= 0x036f)
    );
  };
  cps.pop();
  while (cps.length > 0) {
    const last = cps[cps.length - 1];
    const c = last.codePointAt(0) || 0;
    if (c === 0x200d) {
      cps.pop();
      if (cps.length > 0) cps.pop();
    } else if (isMod(last)) {
      cps.pop();
    } else {
      break;
    }
  }
  return cps.join('');
}

const REPORT_CATS: { key: string; labelKey: string }[] = [
  { key: 'spam', labelKey: 'report.cat.spam' },
  { key: 'violence', labelKey: 'report.cat.violence' },
  { key: 'misinformation', labelKey: 'report.cat.misinformation' },
  { key: 'fraud', labelKey: 'report.cat.fraud' },
  { key: 'harassment', labelKey: 'report.cat.harassment' },
  { key: 'other', labelKey: 'report.cat.other' },
];

// NOTE: the Android `setLayoutAnimationEnabledExperimental(true)` call that used to sit
// here is gone along with the composer's `configureNext` (see `handleContentSizeChange`).
// Nothing on this screen requests a layout animation any more, so arming the flag only
// widened the blast radius of any OTHER screen's `configureNext` that happened to commit
// while this screen was mounted.

// Reply quoting without a schema change. A reply comment is stored as:
//   ::re::<base64(JSON{u, sn, gif})>::<actual body>
// The quote metadata is packed into a SINGLE base64 blob. Base64's alphabet
// never contains ':' , so the first "::" after the blob is unambiguously the
// body terminator — this fixes the earlier bug where an empty segment produced a
// stray "::" that truncated the body (showing a raw base64 string).
const REPLY_PREFIX = '::re::';
function b64encode(s: string): string {
  try { return global.btoa ? global.btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'); }
  catch { return ''; }
}
function b64decode(s: string): string {
  try { return global.atob ? decodeURIComponent(escape(global.atob(s))) : Buffer.from(s, 'base64').toString('utf8'); }
  catch { return ''; }
}
function encodeReply(username: string, snippet: string, body: string, gifUrl?: string): string {
  const meta = JSON.stringify({ u: username || '', sn: (snippet || '').slice(0, 140), gif: gifUrl || '' });
  return `${REPLY_PREFIX}${b64encode(meta)}::${body}`;
}
function parseReply(content: string): { replyUser?: string; replyText?: string; replyGif?: string; body: string } {
  // New format: ::re::<base64(json)>::<body>
  if (content.startsWith(REPLY_PREFIX)) {
    const rest = content.slice(REPLY_PREFIX.length);
    const endIdx = rest.indexOf('::');
    if (endIdx === -1) return { body: content };
    const blob = rest.slice(0, endIdx);
    const body = rest.slice(endIdx + 2);
    try {
      const meta = JSON.parse(b64decode(blob));
      return {
        replyUser: meta.u || undefined,
        replyText: meta.sn || undefined,
        replyGif: meta.gif || undefined,
        body,
      };
    } catch {
      return { body };
    }
  }
  // Legacy A: ::re:<b64(u)>:<b64(sn)>[:<b64(gif)>]::<body>
  if (content.startsWith('::re:')) {
    const rest = content.slice('::re:'.length);
    const endIdx = rest.indexOf('::');
    if (endIdx !== -1) {
      const head = rest.slice(0, endIdx);
      const body = rest.slice(endIdx + 2);
      const parts = head.split(':');
      const u = b64decode(parts[0] || '');
      const sn = b64decode(parts[1] || '');
      const gif = parts.length > 2 ? b64decode(parts[2] || '') : '';
      if (u || sn || gif) return { replyUser: u || undefined, replyText: sn || undefined, replyGif: gif || undefined, body };
    }
  }
  return { body: content };
}

// Merge a freshly-fetched comments array into the previous one, REUSING the
// previous object reference for any row whose id + content + created_at are
// unchanged. CommentRow is memoized on `item` identity, so reusing references
// lets every unchanged row bail out of re-render — only genuinely new / edited
// rows (and the just-sent comment) re-render. Previously `setComments(data)`
// after a send/refetch replaced EVERY identity, so the whole visible window
// re-rendered (re-running parseReply/parseGif/extractFirstUrl per row) in one
// synchronous commit — a contributor to the long task flagged on send. Server
// order + content are preserved exactly (order/content are read from `next`).
function reconcileComments(prev: any[], next: any[]): any[] {
  if (!Array.isArray(next)) return prev;
  if (!Array.isArray(prev) || prev.length === 0) return next;
  const prevById = new Map<string, any>();
  for (const c of prev) if (c && c.id != null) prevById.set(String(c.id), c);
  let identical = prev.length === next.length;
  const merged = next.map((c, i) => {
    const old = prevById.get(String(c?.id));
    const reuse = !!old && old.content === c.content && old.created_at === c.created_at;
    const row = reuse ? old : c;
    if (identical && prev[i] !== row) identical = false;
    return row;
  });
  return identical ? prev : merged;
}

/** How many comments one page holds. Also bounds the cold-paint slice and the cache write. */
const COMMENTS_PAGE_SIZE = 50;

/**
 * Union a freshly fetched page into what is already on screen.
 *
 * `reconcileComments` REPLACES the list with `next` (it maps over `next`, reusing old objects only
 * to keep identities stable). That was correct when every fetch returned the whole thread. It is
 * wrong now: a refetch after sending returns only the newest page, so replacing would silently
 * discard every older page the reader had scrolled up to load.
 *
 * Union by id with the server row winning, then sort chronologically, then hand the result through
 * `reconcileComments` so unchanged rows keep their object identity and FlashList can go on recycling
 * their cells. Locally-pending comments not present in the page survive, because the union starts
 * from what is already there.
 */
function mergeCommentPages(prev: any[], page: any[]): any[] {
  if (!Array.isArray(page)) return prev;
  if (!Array.isArray(prev) || prev.length === 0) return page;
  const byId = new Map<string, any>();
  for (const c of prev) if (c && c.id != null) byId.set(String(c.id), c);
  for (const c of page) if (c && c.id != null) byId.set(String(c.id), c);
  const out = Array.from(byId.values());
  // `created_at` is ISO-8601 from the Worker, so lexicographic order IS chronological order.
  out.sort((a, b) => String(a?.created_at || '').localeCompare(String(b?.created_at || '')));
  return reconcileComments(prev, out);
}

// ─── Memoized comment row ──────────────────────────────────────────────────
// Hoisted out of CommentsScreen so the FlatList's renderItem can hand each row
// a STABLE component reference. Previously the row JSX lived inline inside
// `renderItem`, so every parent re-render (auth field flip, scroll-driven
// state, keyboard show/hide, locale change) created fresh element trees for
// every visible comment — defeating cell recycling and producing the long
// stutter the perf monitor flagged.
//
// `onLongPress` and `onReply` are stable callbacks from the parent, so when
// the parent re-renders the row's props don't change and React.memo bails.
type GifVisTracker = {
  subscribeRow: (id: string, l: () => void) => () => void;
  isActive: (id: string) => boolean;
  update: (next: Set<string>) => void;
  setScrolling: (b: boolean) => void;
  setHasGif: (id: string, has: boolean) => void;
};

type CommentRowProps = {
  item: any;
  onLongPress: (c: any) => void;
  onReply: (c: any) => void;
  onImagePress: (uri: string, comment?: any) => void;
  gifTracker: GifVisTracker;
};

// Swipe-to-reply affordance. Module-level StyleSheet so the objects are created once for the whole
// list rather than per row per render. `position: absolute` means the icon adds ZERO layout, so a
// row's height cannot change mid-swipe.
const commentSwipeStyles = StyleSheet.create({
  replyIcon: { position: 'absolute', right: 8, top: 0, bottom: 0, justifyContent: 'center' },
  replyIconCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});

const CommentRow = React.memo(function CommentRow({ item, onLongPress, onReply, onImagePress, gifTracker }: CommentRowProps) {
  const theme = useTheme();
  const t = useT();
  // Block-aware short circuit: comments authored by a blocked user are
  // swapped for the inline placeholder so the rest of the thread stays
  // intact. Tapping the placeholder offers an unblock confirmation — the
  // user can also unblock from the messages-tab Blocked section.
  const authorId: string | undefined = item.profiles?.id || item.author_id;
  const isAuthorBlocked = useIsBlocked(authorId);
  // Swipe-left-to-reply. Declared before any early return so the hook order is stable — the
  // blocked-author branch below returns a placeholder, and hooks cannot be skipped.
  const { gesture: swipeGesture, rowAnimStyle, replyIconAnimStyle } = useSwipeToReply({
    item,
    onReply,
  });
  // Parsed body + GIF detection are computed BEFORE the early return so the
  // staggered-reveal hook below is always called (rules of hooks). Cheap.
  const parsed = parseReply(item.content || '');
  const gif = parseGif(parsed.body);
  // GIF-paced reveal: animated GIFs cost ~100-180ms to decode, so the
  // one-per-FRAME photo pump starts them faster than they finish and a thread
  // with several GIF comments lands a decode burst (the recurring ~110ms x10
  // stall the perf monitor flagged on comment threads). The wider GIF pump
  // (~90ms apart) keeps at most ~2 decoding at once — same fix as the chat.
  const gifReveal = useStaggeredGifReveal(!!gif);
  // Per-row animation gate (chat-style): a GIF only ANIMATES while it is
  // on-screen AND the list isn't scrolling. Off-screen / during-scroll it
  // freezes (autoplay=false → stopAnimating), so recycled rows don't re-decode
  // and a thread of GIFs doesn't saturate the UI thread. `useSyncExternalStore`
  // re-renders ONLY the rows whose state flips (the tracker notifies just GIF
  // rows), so this adds no cost to text rows or to scroll start.
  const subscribeRow = useCallback((cb: () => void) => gifTracker.subscribeRow(item.id, cb), [gifTracker, item.id]);
  const gifActive = useSyncExternalStore(subscribeRow, () => gifTracker.isActive(item.id));
  useEffect(() => {
    gifTracker.setHasGif(item.id, !!gif);
    return () => gifTracker.setHasGif(item.id, false);
  }, [item.id, gif, gifTracker]);
  if (isAuthorBlocked && authorId) {
    return (
      <BlockedContentPlaceholder
        blockedUserId={authorId}
        username={item.profiles?.username}
        variant="inline"
      />
    );
  }

  const link = (!gif && !hasCodeBlock(parsed.body)) ? extractFirstUrl(parsed.body) : null;

  const formatTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('comments.time_now');
    if (mins < 60) return t('comments.time_min', undefined, { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('comments.time_hour', undefined, { n: hours });
    return t('comments.time_day', undefined, { n: Math.floor(hours / 24) });
  };

  return (
    // ── SWIPE LEFT TO REPLY, same mechanism as the chat ───────────────────────
    //
    // The gesture comes from `useSwipeToReply`, which shares the chat's constants rather than
    // copying them — `REPLY_THRESHOLD`, the [-80, 0] clamp, the activation offsets and the spring
    // are literally the same values, so the two surfaces cannot drift apart.
    //
    // It cannot conflict with anything already here: `failOffsetY([-10, 10])` fails the pan the
    // moment the finger moves 10 px vertically, so list scrolling always wins; `activeOffsetX`
    // needs 12 px LEFT to activate, so the OS back-gesture is untouched; and a pan that never
    // activates does not consume the touch, so the Pressables below (open profile, open image,
    // tap-to-reply) and the long-press menu all keep working exactly as before.
    //
    // Only the row's content translates. The reply icon sits behind it as an absolute sibling, so
    // it adds no layout and cannot change row height mid-gesture.
    <GestureDetector gesture={swipeGesture}>
      <View style={{ marginBottom: 16 }} collapsable={false}>
        <Reanimated.View style={[commentSwipeStyles.replyIcon, replyIconAnimStyle]} pointerEvents="none">
          {/* A flat tinted circle, deliberately not a glass view — the same decision the chat's
              swipe icon documents: a UIVisualEffectView per row is one of the most expensive
              native views to instantiate, and this icon exists on every comment. */}
          <View style={[commentSwipeStyles.replyIconCircle, { backgroundColor: theme.colors.accent.primary + '20' }]}>
            <Feather name="corner-up-left" size={15} color={theme.colors.accent.primary} />
          </View>
        </Reanimated.View>
        <Reanimated.View style={rowAnimStyle}>
    <Pressable onLongPress={() => onLongPress(item)} delayLongPress={300} style={{ flexDirection: 'row' }}>
      <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: item.profiles?.id || item.author_id } })} onLongPress={() => onLongPress(item)} delayLongPress={300}>
        <Avatar emoji={item.profiles?.emoji || '😊'} size="sm" />
      </Pressable>
      <View style={{ marginLeft: 10, flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{item.profiles?.display_name || 'User'}</Text>
          {item.profiles?.is_verified && <VerifiedBadge size={10} />}
          {item.profiles?.badge && <UserBadge badge={item.profiles.badge} size="sm" />}
          <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ marginLeft: 4, flexShrink: 0 }}>{formatTime(item.created_at)}</Text>
        </View>
        {parsed.replyUser ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: theme.colors.accent.primary }}>
            {parsed.replyGif ? (
              <>
                <CachedImage uri={parsed.replyGif} style={{ width: 28, height: 28, borderRadius: 6, marginRight: 6, backgroundColor: theme.colors.background.secondary }} resizeMode="cover" />
                <View style={{ flex: 1 }}>
                  <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} numberOfLines={1} style={{ fontSize: 11 }}>@{parsed.replyUser}</Text>
                  <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>GIF</Text>
                </View>
              </>
            ) : (
              <View style={{ flex: 1 }}>
                <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} numberOfLines={1} style={{ fontSize: 11 }}>@{parsed.replyUser}</Text>
                {parsed.replyText ? <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{parsed.replyText}</Text> : null}
              </View>
            )}
          </View>
        ) : null}
        {gif ? null : <FormattedText style={{ marginTop: 3, fontSize: 14 }}>{parsed.body}</FormattedText>}
        {gif ? (
          <Pressable onPress={() => onImagePress(gif, item)} onLongPress={() => onLongPress(item)} delayLongPress={300} style={{ marginTop: 6 }}>
            {gifReveal ? (
              <CachedImage uri={gif} style={{ width: 160, height: 160, borderRadius: 14, backgroundColor: theme.colors.background.secondary }} resizeMode="cover" autoplay={gifActive} />
            ) : (
              <Skeleton width={160} height={160} radius={14} />
            )}
          </Pressable>
        ) : link ? (
          <Pressable onLongPress={() => onLongPress(item)} delayLongPress={300} style={{ marginTop: 6 }}>
            <LinkPreview url={link} onLongPress={() => onLongPress(item)} delayLongPress={300} />
          </Pressable>
        ) : null}
        <Pressable onPress={() => onReply(item)} onLongPress={() => onLongPress(item)} delayLongPress={300} hitSlop={6} style={{ marginTop: 4, alignSelf: 'flex-start' }}>
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{t('comments.reply')}</Text>
        </Pressable>
      </View>
    </Pressable>
        </Reanimated.View>
      </View>
    </GestureDetector>
  );
}, (prev, next) =>
  // Only re-render a row when its underlying comment payload actually changed.
  prev.item === next.item &&
  prev.item.content === next.item.content &&
  prev.item.created_at === next.item.created_at &&
  prev.onLongPress === next.onLongPress &&
  prev.onReply === next.onReply &&
  prev.onImagePress === next.onImagePress &&
  prev.gifTracker === next.gifTracker,
);
// ─── Isolated comments composer field (PER-KEYSTROKE RE-RENDER FIX) ─────────
// The <TextInput> + its local `text` state live HERE, in a memoized child, so a
// keystroke re-renders ONLY this component — never CommentsScreen (the FlashList
// wrapper, the reply/edit banner, the keyboard-shift animated styles, or the
// glass chrome). The screen drives/observes the text purely through this child's
// imperative handle (getText/setText/clear/insert/backspace/focus) and learns
// about send-enable transitions through `onHasTextChange`, which fires ONLY when
// the field flips between empty and non-empty (not per character) — so the send
// button reconciles at most once per transition. Mirrors `ChatField` in
// src/components/chat/ChatInputBar.tsx.
//
// This field's hooks live in IT and are all unconditional (no early return), so
// the screen's hook order is untouched.
export interface CommentFieldHandle {
  getText: () => string;
  setText: (text: string) => void;
  clear: () => void;
  // Append a string (emoji pick) to the local text — used by the media panel so
  // picks land in the composer without re-rendering the screen.
  insert: (s: string) => void;
  // Delete the last grapheme (whole emoji, incl. ZWJ/skin-tone sequences) —
  // used by the media panel's backspace button.
  backspace: () => void;
  // Programmatically focus the TextInput (re-open the keyboard).
  focus: () => void;
}

interface CommentFieldProps {
  // Fires ONLY when emptiness flips (true ⇄ false) — drives the send button's
  // enabled state / colors without a per-keystroke screen render.
  onHasTextChange: (hasText: boolean) => void;
  onFocus: () => void;
  // Fires on EVERY keystroke, so the screen can broadcast a typing indicator.
  // MUST be a stable, state-free callback (see `useTypingPublisher`) — anything
  // that set state here would reintroduce the per-keystroke screen render this
  // component exists to prevent.
  onTyping?: () => void;
}

const CommentField = React.memo(React.forwardRef<CommentFieldHandle, CommentFieldProps>(function CommentField(
  { onHasTextChange, onFocus, onTyping },
  ref,
) {
  const theme = useTheme();
  const t = useT();
  const [text, setText] = useState('');
  const textInputRef = useRef<TextInput>(null);

  // Notify the screen only when emptiness flips — keeps the send button + glass
  // chrome out of the per-keystroke render path while keeping send-enable correct.
  const hadTextRef = useRef(false);
  useEffect(() => {
    const has = text.trim().length > 0;
    if (has !== hadTextRef.current) {
      hadTextRef.current = has;
      onHasTextChange(has);
    }
  }, [text, onHasTextChange]);

  useImperativeHandle(ref, () => ({
    getText: () => text,
    setText: (val: string) => setText(val),
    clear: () => setText(''),
    insert: (s: string) => setText((prev) => prev + s),
    backspace: () => setText((prev) => deleteLastGrapheme(prev)),
    focus: () => { textInputRef.current?.focus(); },
  }), [text]);

  const handleChangeText = useCallback((val: string) => {
    setText(val);
    // From the change handler, not an effect on `text`: an effect would also fire for
    // programmatic `setText` (entering edit mode, an emoji pick, a media-panel backspace),
    // none of which is the user typing.
    if (val.length > 0) onTyping?.();
  }, [onTyping]);
  // ── NO `LayoutAnimation` ON COMPOSER GROWTH ─────────────────────────────────
  //
  // This used to call `LayoutAnimation.configureNext(easeInEaseOut)` from
  // `onContentSizeChange` to ease the field's height as it gained/lost a line.
  //
  // `configureNext` is GLOBAL for the next layout commit — it is not scoped to the view
  // that requested it. So every time the composer crossed a line boundary WHILE TYPING, it
  // armed an animation for every other view whose frame changed in that same commit,
  // which on this screen means comment rows. The chat composer has the same shape and
  // deliberately does not do this (`ChatInputBar.heightTransition.bug.test.tsx` asserts
  // `configureNext` is never called); comments was the remaining caller.
  //
  // The field now resizes in one step. Doing it properly would mean the composer
  // publishing its height as a shared value and each affected surface applying its own
  // transform — no layout involved — which is a real change to how this screen is
  // positioned, not a one-liner.
  const handleContentSizeChange = undefined;

  return (
    <TextInput
      ref={textInputRef}
      value={text}
      onChangeText={handleChangeText}
      placeholder={t('comments.placeholder')}
      placeholderTextColor={theme.colors.text.tertiary}
      style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20, alignSelf: 'center' }}
      multiline
      autoCorrect={false}
      autoComplete="off"
      spellCheck={false}
      textAlignVertical="center"
      onContentSizeChange={handleContentSizeChange}
      // Captures keyboard-to-first-frame latency for the comments composer. Free
      // when the perf monitor is off (singleton early-returns on the flag).
      onFocus={onFocus}
    />
  );
}));

export default function CommentsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Shared with the chat screen so the two label sets cannot drift apart.
  const mediaPanelLabels = useMediaPanelLabels();
  // Android: while focused, stop the OS window resize so ONLY our JS-driven
  // input lift moves content (kills the first-focus jump). No-op on iOS.
  useChatKeyboardMode();
  // Native iOS-26 liquid glass for the composer chrome. iOS-only and only when
  // the user enabled it — everywhere else this is false and the existing flat
  // bordered capsule renders unchanged (Android always hits the fallback).
  const glassActive = useLiquidGlassActive();
  // Mount-time marker — surfaces in the perf-monitor panel as
  // `MOUNT comments/[id] <ms>` so freezes when opening comments have
  // an actionable starting point. Skipped when the monitor is off.
  const mountStart = useRef(Date.now()).current;
  const perfEnabled = useSettingsStore((s) => s.perfMonitorEnabled);
  useEffect(() => {
    if (!perfEnabled) return;
    perfMonitor.markScreenMount('comments/[id]', Date.now() - mountStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfEnabled]);
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();

  // ── Media panel (emoji / GIF) state — mirrors the chat composer. ──────────
  // `panelTab` drives which panel is open (null = none). The bar is lifted
  // above the panel via `liftSV`; `emojiPanelSV` carries the panel height so
  // the bar + list shift match it on the UI thread.
  const [panelTab, setPanelTab] = useState<'emoji' | 'gif' | null>(null);
  const emojiOpen = panelTab === 'emoji';
  const gifOpen = panelTab === 'gif';
  const [emojiPanelHeight, setEmojiPanelHeight] = useState(300);
  const [keepLifted, setKeepLifted] = useState(false);
  const [recentEmoji, setRecentEmoji] = useState<string[]>(() => getRecentEmoji());
  const [recentGif, setRecentGif] = useState<GiphyItem[]>(() => getRecentGif());
  const lastKbHeightRef = useRef(0);
  const liftSV = useSharedValue(0);
  const emojiPanelSV = useSharedValue(300);
  const EMOJI_GAP = 8;

  const inputPadStyle = useAnimatedStyle(() => {
    const open = Math.abs(keyboardHeight.value) > 1 || liftSV.value > 0.5;
    return { paddingBottom: open ? 8 : (insets.bottom > 0 ? insets.bottom : 14) };
  });

  // Compensate the KeyboardStickyView's `offset.opened` for the bottom-
  // docked browser widget. When the band is active it lives INSIDE the
  // root flex column as a 56-px-tall sibling of the Stack wrapper, which
  // squeezes every screen (including this comments screen) so its bottom
  // edge sits 56 px above the actual screen bottom. The input sticks to
  // the screen bottom, and KSV translates the sticky surface upward by
  // the keyboard height when the keyboard appears — but because the
  // screen is already 56 px above the screen bottom, the input ends up
  // 56 px ABOVE the keyboard top instead of right on it. Adding
  // `BAND_HEIGHT` to KSV's `translateY` while the keyboard is open
  // pushes the input back down into the band's overlapped region (the
  // keyboard hides the band anyway), so the input lands flush against
  // the keyboard top in both states.
  const minimizedUrl = useBrowserStore((s) => s.minimizedUrl);
  const browserWidgetPosition = useEffectiveBrowserWidgetPosition();
  const stickyOpenedOffset = !!minimizedUrl && browserWidgetPosition === 'bottom' ? 56 : 0;
  // Keyboard-driven list repositioning is now handled NATIVELY by the official
  // KeyboardChatScrollView (wired via `renderScrollComponent` on the FlatList
  // below, default "always" lift). We keep `useKeyboardHandler` ONLY to capture
  // the settled keyboard height so the emoji/GIF media panel can size itself to
  // match the keyboard it replaces.
  //
  // The list still needs a PANEL-driven lift, though: when the media panel
  // opens the keyboard is down (so KeyboardChatScrollView contributes nothing),
  // yet the panel covers the bottom of the screen, so the list must shift up by
  // the panel height to keep the last comment visible above it. `listShiftStyle`
  // below carries only that panel lift.
  // Capture the settled keyboard height so the media panel can match it.
  // Guarded to ignore the close (height 0) — runs on the JS thread.
  const captureKbHeight = useCallback((h: number) => {
    if (h > 1) {
      lastKbHeightRef.current = h;
      emojiPanelSV.value = h;
      setEmojiPanelHeight(h);
    }
  }, [emojiPanelSV]);
  useKeyboardHandler(
    {
      onEnd: (e) => {
        'worklet';
        runOnJS(captureKbHeight)(e.height);
      },
    },
    [],
  );
  const listShiftStyle = useAnimatedStyle(() => {
    // FULL monotonic list lift (chat-style). The comments list is now a
    // FlashList, which does NOT support `renderScrollComponent`, so the native
    // KeyboardChatScrollView path is gone — this transform owns the ENTIRE
    // keyboard + panel lift on the UI thread (driven by the keyboard shared
    // value, identical mechanism to `app/chat/[id].tsx`'s `listShiftY`).
    //   lift = max(keyboardHeight, panelLift)
    // Monotonic max() means opening the GIF/emoji panel while the keyboard is
    // up produces ZERO net jump (the panel ≈ keyboard height), and the keyboard
    // ↔ panel handoff is seamless. The input bar uses the same max() in
    // `barWrapStyle`, so bar + list move together.
    const raw = keyboardHeight.value;
    const kb = raw < 0 ? -raw : raw;
    const panelLift = liftSV.value * emojiPanelSV.value;
    const lift = Math.max(kb, panelLift);
    return { transform: [{ translateY: -lift }] };
  });

  // Input bar lift — replaces KeyboardStickyView so we can fold the media-panel
  // lift into a MONOTONIC max(keyboardHeight, panelLift), eliminating the
  // keyboard↔panel handoff jump (same approach as the chat composer).
  const barWrapStyle = useAnimatedStyle(() => {
    const raw = keyboardHeight.value;
    const kb = raw < 0 ? -raw : raw;
    const panelLift = liftSV.value * emojiPanelSV.value;
    const lift = Math.max(kb, panelLift);
    const band = kb > 1 ? stickyOpenedOffset : 0;
    return { transform: [{ translateY: -(lift - band) }] };
  });

  // Slide the media panel up/down in sync with the bar lift. liftSV 0 → pushed
  // fully below the screen; liftSV 1 → resting in place.
  const panelSlideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - liftSV.value) * emojiPanelSV.value }],
  }));
  const { id: postId } = useLocalSearchParams<{ id: string }>();
  // Field selector — destructuring the whole auth store re-rendered the entire
  // CommentsScreen on every unrelated auth change (token refresh, badge sync,
  // etc.), which in turn invalidated the FlatList's inline renderItem and
  // forced every visible comment row to re-render.
  const user = useAuthStore((s) => s.user);
  // Read the cached comments synchronously ONCE on first mount. Both the
  // initial `comments` list and the initial `isLoading` flag derive from
  // this single read; previously each `useState` initializer fired its own
  // `kvGetJSONSync + JSON.parse`, so on a chat with 100+ comments the same
  // payload was parsed twice on the cold-open frame — a measurable mount
  // cost that contributed to the 60→40 fps drop when entering this screen.
  const initialCommentsRef = useRef<any[] | null>(null);
  if (initialCommentsRef.current === null) {
    try {
      // Bounded to the newest page, same as what the network now returns.
      //
      // Caches written before pagination existed can hold an entire thread — a thousand rows — and
      // painting all of them on the cold-open frame is the cost pagination is meant to remove. The
      // slice keeps the first painted list the same size as the first fetched page, so the two
      // agree and the list does not visibly shrink when the fetch lands. Older rows come back on
      // scroll from the server, and the cache is rewritten bounded from now on.
      const cached = postId ? kvGetJSONSync<any[]>(`comments:${postId}`, []) : [];
      initialCommentsRef.current = Array.isArray(cached) && cached.length > COMMENTS_PAGE_SIZE
        ? cached.slice(-COMMENTS_PAGE_SIZE)
        : cached;
    } catch {
      initialCommentsRef.current = [];
    }
  }
  const [comments, setComments] = useState<any[]>(initialCommentsRef.current);
  // The composer's `text` now lives in the isolated <CommentField> (see top of
  // file). The screen keeps only a lightweight `hasText` mirror — flipped at
  // most once per empty⇄non-empty transition via the field's onHasTextChange —
  // to drive the send button's enabled state / colors without re-rendering the
  // whole screen on every keystroke.
  const [hasText, setHasText] = useState(false);
  const handleHasTextChange = useCallback((next: boolean) => setHasText(next), []);
  const [isLoading, setIsLoading] = useState(initialCommentsRef.current.length === 0);
  const [isSending, setIsSending] = useState(false);
  const [postData, setPostData] = useState<any>(null);
  const [repostOriginal, setRepostOriginal] = useState<any>(null);
  const { target: actionComment, open: openMenu, close: closeMenu } = useContextMenuGuard<any>();
  const [reportComment, setReportComment] = useState<any>(null); // comment being reported
  const [replyTo, setReplyTo] = useState<any>(null); // comment we are replying to
  const [editing, setEditing] = useState<any>(null); // comment being edited
  // Fullscreen image viewer — `images`/`index` are set for multi-image posts so
  // the viewer opens a horizontal pager on the tapped image; single images and
  // comment GIFs just carry `uri`. Mirrors the profile-screen viewer.
  const [viewingImage, setViewingImage] = useState<{ uri: string; images?: string[]; index?: number } | null>(null);
  // The COMMENT the open viewer belongs to, when it was opened from a comment's GIF rather than from
  // one of the post's own photos. Drives the viewer's caption and its delete action — the post images
  // deliberately leave this null, because deleting a comment from a post photo would be wrong.
  const [viewerComment, setViewerComment] = useState<any | null>(null);

  const inputRef = useRef<CommentFieldHandle>(null);
  const listRef = useRef<FlashListRef<any>>(null);

  // ── GIF animation gate (chat-style) ──────────────────────────────────────
  // Pauses comment-GIF animation off-screen and during scroll so recycled rows
  // don't re-decode and a thread of GIFs never saturates the UI thread. Only
  // GIF rows subscribe + re-render when their state flips (text rows untouched,
  // scroll start hitch-free).
  const gifTrackerRef = useRef<GifVisTracker | null>(null);
  if (!gifTrackerRef.current) {
    let visibleSet = new Set<string>();
    let ready = false;
    let scrolling = false;
    const gifIds = new Set<string>();
    // Per-row listeners keyed by comment id. Keying by id (not one flat Set)
    // lets the scroll-pause / staggered-resume pump notify ONLY the rows that
    // change and release GIFs one at a time when the list settles.
    const rowListeners = new Map<string, Set<() => void>>();
    const notify = (id: string) => {
      const s = rowListeners.get(id);
      if (s) s.forEach((fn) => fn());
    };
    const notifyGifs = () => { gifIds.forEach((id) => notify(id)); };

    // ── Staggered GIF resume (mirrors app/chat/[id].tsx visTracker) ───────
    // Pausing GIFs while scrolling is cheap and correct. The trap is the
    // RESUME: flipping every visible GIF back to autoplay on ONE frame
    // restarts ~10 expo-image decodes at once → the decode storm / long-task
    // the perf snapshot caught (10 giphy decodes inside an ~11 ms window). So
    // when the list settles we HOLD every visible GIF and release ONE every
    // RESUME_INTERVAL_MS, capped by GIF_ANIM_CAP, so resuming never lands a
    // burst. A generation counter aborts an in-flight stagger the instant a
    // new scroll begins.
    const RESUME_INTERVAL_MS = 90;
    // Telegram-style hard cap: only the first N visible GIFs animate; the rest
    // show their static first frame until they scroll into the cap window.
    // This is the decisive fix for the on-open storm — at most ~2 decode at
    // once instead of the whole visible screenful.
    const GIF_ANIM_CAP = 2;
    const held = new Set<string>();
    let resumeGen = 0;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const clearResume = () => { if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; } };

    gifTrackerRef.current = {
      subscribeRow(id, l) {
        let s = rowListeners.get(id);
        if (!s) { s = new Set(); rowListeners.set(id, s); }
        s.add(l);
        return () => {
          const set = rowListeners.get(id);
          if (set) { set.delete(l); if (set.size === 0) rowListeners.delete(id); }
        };
      },
      isActive(id) {
        // `ready` gate (mirrors chat): nothing animates before the first
        // viewability callback lands. The cap can't rank an empty viewable set,
        // so on open EVERY GIF would otherwise read active and decode at once —
        // exactly the storm. Hold them on their static frame until the viewable
        // set is known (fires within a frame of layout), then the cap applies.
        if (!ready) return false;
        if (!visibleSet.has(id)) return false;
        // Paused for the whole active scroll, then held until this row's
        // staggered-resume turn after the scroll settles.
        if (scrolling || held.has(id)) return false;
        // Concurrency cap: visibleSet preserves viewable order (the viewability
        // callback inserts top→bottom), so count GIF rows until we reach this
        // one — only the first GIF_ANIM_CAP animate.
        let rank = 0;
        for (const vid of visibleSet) {
          if (!gifIds.has(vid)) continue;
          if (vid === id) return rank < GIF_ANIM_CAP;
          rank++;
          if (rank >= GIF_ANIM_CAP) break;
        }
        if (rank >= GIF_ANIM_CAP) return false;
        return true;
      },
      update(next) {
        if (ready && next.size === visibleSet.size) {
          let same = true;
          for (const id of next) if (!visibleSet.has(id)) { same = false; break; }
          if (same) return;
        }
        visibleSet = next;
        ready = true;
        notifyGifs();
      },
      setScrolling(b) {
        if (b === scrolling) return;
        scrolling = b;
        if (gifIds.size === 0) { clearResume(); held.clear(); return; }
        if (b) {
          // Scroll started → pause GIFs immediately (the `scrolling` flag does
          // it). Drop any pending resume + holds and notify only the VISIBLE
          // GIF rows so just they re-render to their static frame; off-screen
          // rows keep an unchanged snapshot → no re-render → hitch-free start.
          clearResume();
          held.clear();
          gifIds.forEach((gid) => { if (!ready || visibleSet.has(gid)) notify(gid); });
        } else {
          // Scroll settled → hold every visible GIF, then release ONE per
          // RESUME_INTERVAL_MS. No notify on hold: the snapshot is already
          // false from the scroll, so nothing re-renders until its release.
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
      setHasGif(id, has) {
        if (has) gifIds.add(id); else { gifIds.delete(id); held.delete(id); }
      },
    };
  }
  const gifTracker = gifTrackerRef.current;
  const gifScrollIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latch mirroring `revealScrollPaused`, so the pause is dispatched to React ONCE per
  // gesture instead of once per scroll event.
  //
  // This was calling `setRevealScrollPaused(true)` unconditionally on every scroll event.
  // At `scrollEventThrottle={64}` that is ~15 React dispatches per second, and this screen
  // OWNS the comment list — so the very gesture the pause exists to protect was paying for
  // a render storm. `app/chat/[id].tsx` already carries this exact fix (see the long note
  // on its `scrollPausedRef`); the comments screen was missed at the time.
  //
  // The pause semantics are unchanged: the flag still goes true on the first scroll event
  // and false 200 ms after the last one. Only the dispatch count changes — twice per
  // gesture instead of once per event.
  const commentsScrollPausedRef = useRef(false);
  const onCommentsScroll = useCallback(() => {
    gifTracker.setScrolling(true);
    if (!commentsScrollPausedRef.current) {
      commentsScrollPausedRef.current = true;
      setRevealScrollPaused(true);
    }
    if (gifScrollIdleRef.current) clearTimeout(gifScrollIdleRef.current);
    gifScrollIdleRef.current = setTimeout(() => {
      gifTracker.setScrolling(false);
      commentsScrollPausedRef.current = false;
      setRevealScrollPaused(false);
    }, 200);
  }, [gifTracker]);
  useEffect(() => () => { if (gifScrollIdleRef.current) clearTimeout(gifScrollIdleRef.current); commentsScrollPausedRef.current = false; setRevealScrollPaused(false); }, []);
  const onCommentsViewable = useRef(({ viewableItems }: { viewableItems: any[] }) => {
    const next = new Set<string>();
    for (const v of viewableItems) { const id = v?.item?.id; if (id) next.add(id); }
    gifTrackerRef.current?.update(next);
  }).current;
  const commentsViewabilityConfig = useRef({ itemVisiblePercentThreshold: 35 }).current;

  // ─── FULLSCREEN VIEWER ────────────────────────────────────────────────────
  //
  // Maps this screen's `{ uri, images?, index? }` onto the shared viewer's `{ images, index }`.
  // Falls back to the single tapped uri, which is the common case here: a comment carrying one GIF.
  const viewerPayload = useMemo(() => {
    if (!viewingImage) return null;
    const images = viewingImage.images && viewingImage.images.length > 0
      ? viewingImage.images
      : [viewingImage.uri];
    // Prefer the explicit index the opener passed; otherwise locate the tapped uri.
    const idx = typeof viewingImage.index === 'number'
      ? Math.min(Math.max(viewingImage.index, 0), images.length - 1)
      : Math.max(0, images.indexOf(viewingImage.uri));
    return { images, index: idx };
  }, [viewingImage]);

  const closeViewer = useCallback(() => { setViewingImage(null); setViewerComment(null); }, []);

  // ── VIEWER CHROME — THE SAME SYSTEM THE CHAT HAS ──────────────────────────
  //
  // Asked for: if someone manages to send a GIF together with text in a comment, opening it should
  // behave like the chat does — the text readable and scrollable over the media, and a delete.
  //
  // Only present when the viewer was opened from a COMMENT's GIF. The post's own photos open the same
  // viewer (from the list header) and deliberately get no chrome here: they belong to the post, not to
  // a comment, and offering "delete" there would delete the wrong thing.
  //
  // Both memoized because the viewer compares chrome by reference; an inline node would defeat its memo
  // and re-render all mounted pager images on every render of this screen.
  const viewerCommentBody = useMemo(() => {
    if (!viewerComment) return '';
    // The stored content carries the reply wrapper and the `::gif::` marker; `parseReply` strips the
    // wrapper and `parseGif` tells us the body IS the gif (in which case there is no caption to show).
    const parsed = parseReply(viewerComment.content || '');
    return parseGif(parsed.body) ? '' : parsed.body;
  }, [viewerComment]);

  const viewerHeader = useMemo(() => {
    if (!viewerComment) return null;
    const profile = viewerComment.profiles || {};
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Avatar emoji={profile.emoji || '😊'} size="xs" />
        <View style={{ flexShrink: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Text variant="caption" weight="semibold" color="#FFFFFF" numberOfLines={1} style={{ fontSize: 11 }}>
              {profile.display_name || 'User'}
            </Text>
            {profile.is_verified && <VerifiedBadge size={10} />}
          </View>
          <Text variant="caption" color="rgba(255,255,255,0.6)" style={{ fontSize: 9 }}>
            {viewerComment.created_at ? formatTimeAgo(viewerComment.created_at) : ''}
          </Text>
        </View>
      </View>
    );
  }, [viewerComment]);

  const viewerFooter = useMemo(() => {
    if (!viewerComment) return null;
    const isOwn = !!user?.id && (viewerComment.author_id === user.id || viewerComment.profiles?.id === user.id);
    if (!viewerCommentBody && !isOwn) return null;
    return (
      <View style={{ alignItems: 'center', gap: 10 }}>
        {/* Caption: no container, no card — the words over the media with a shadow so they read on a
            bright GIF. Capped and scrollable for the same reason as the chat's: a caption can be a
            paragraph and must never push the action off screen. */}
        {viewerCommentBody ? (
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
              {viewerCommentBody}
            </Text>
          </ScrollView>
        ) : null}
        {isOwn ? (
          <ViewerActionButton
            icon="trash-2"
            destructive
            accessibilityLabel={t('common.delete')}
            onPress={() => {
              // The whole comment, not "the GIF out of the comment": a comment's media IS its content
              // here, so removing it leaves nothing. Routes through `handleMenuAction('delete')`, which
              // owns the confirmation and the optimistic removal.
              const target = viewerComment;
              closeViewer();
              handleMenuAction('delete', target);
            }}
          />
        ) : null}
      </View>
    );
  }, [viewerComment, viewerCommentBody, user?.id, closeViewer, t]);

  // Frozen at module-constant identity via `useRef`, not an inline literal on the FlashList. v2's
  // docs are explicit that memoizing props matters more than in v1 ("we will instead allow
  // developers to ensure that props are memoized"), and a fresh object here every render would hand
  // the list a changed scroll-behaviour config on each keystroke in the composer.
  const COMMENTS_MVCP = useRef({
    startRenderingFromBottom: true,
    autoscrollToBottomThreshold: 0.2,
  }).current;

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const { content: headerContentHeight, gradient: headerGradientHeight } = headerScrimHeights(insets.top);

  // Defer all non-critical mount work past the navigation transition so the
  // first paint carries only the cached header + cached comments. The
  // network fetches (`loadComments`, `loadPost`, repost-original lookup)
  // were the dominant cost on the open-the-comments-screen frame and are
  // what produced the 60→40 fps drop the perf monitor flagged.
  useEffect(() => {
    if (!postId) return;
    // Cached lookups are cheap (synchronous store reads, no network) — keep
    // them on the critical path so the post header renders immediately and
    // the user never sees a flash of empty space at the top of the list.
    const { useEntityStore } = require('../../src/store');
    const cached = useEntityStore.getState().posts[postId];
    if (cached) {
      const profile = useEntityStore.getState().profiles[cached.author_id];
      setPostData({ ...cached, profiles: profile || null });
    }
    const handle = InteractionManager.runAfterInteractions(() => {
      loadComments();
      if (!cached) loadPost();
    });
    return () => handle.cancel();
  }, [postId]);

  // Realtime: live updates for the per-post channel. New / edited /
  // deleted comments + the post's like count are all fanned out from
  // the Worker on `post:<id>`. Subscribe ONLY while this screen is
  // mounted — the bridge handles cross-app channels (notifications,
  // profile, follows, feed); per-post subs are scoped per-screen so
  // memory + connection footprint stays minimal. Subscribe is deferred
  // past the navigation transition for the same cold-open reason as
  // the bridge: the WebSocket subscribe on a fresh post id otherwise
  // lands on the same RAF as the comments-list mount and steals frame
  // time.
  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const handle = InteractionManager.runAfterInteractions(async () => {
      if (cancelled) return;
      const { getRealtime, postChannelName } = await import('../../src/services/realtime/ably');
      const realtime = getRealtime();
      if (!realtime) return;
      const channel = realtime.channels.get(postChannelName(postId));

      const onEvent = (msg: { name?: string; data?: any }) => {
        const payload = msg?.data;
        if (!payload || typeof payload !== 'object') return;

        if (msg.name === 'comment.new') {
          const c = payload.comment;
          if (!c || !c.id) return;
          // SANITIZE inbound realtime text so a malicious client can't inject
          // bidi/zero-width/control characters into rendered comments.
          const safe = { ...c, content: sanitizeUserText(c.content || '') };
          // De-dupe — the author's own create path already inserted
          // the row optimistically via `loadComments` after the POST
          // succeeded.
          setComments((prev) => (prev.some((x) => x.id === safe.id) ? prev : [...prev, safe]));
          return;
        }
        if (msg.name === 'comment.edit') {
          const id = String(payload.id || '');
          if (!id) return;
          // SANITIZE the incoming edited text before applying it locally.
          const safeContent = sanitizeUserText(payload.content ?? '');
          setComments((prev) =>
            prev.map((c) => (c.id === id ? { ...c, content: payload.content != null ? safeContent : c.content } : c)),
          );
          return;
        }
        if (msg.name === 'comment.delete') {
          const id = String(payload.id || '');
          if (!id) return;
          setComments((prev) => prev.filter((c) => c.id !== id));
          return;
        }
        if (msg.name === 'post.like' || msg.name === 'post.unlike') {
          const newCount =
            typeof payload.likes_count === 'number' ? payload.likes_count : null;
          if (newCount == null) return;
          // Reflect the canonical count on the post header + entity
          // store (the comments screen reads from both).
          setPostData((prev: any) => (prev ? { ...prev, likes_count: newCount } : prev));
          try {
            const { useEntityStore } = require('../../src/store');
            const entity = useEntityStore.getState();
            const cached = entity.posts[postId];
            if (cached) {
              entity.upsertPost({ ...cached, likes_count: newCount });
            }
          } catch {}
        }
      };

      void channel.subscribe(onEvent);
      cleanup = () => {
        try { channel.unsubscribe(onEvent); } catch {}
      };
    });
    return () => {
      cancelled = true;
      handle.cancel();
      if (cleanup) cleanup();
    };
  }, [postId]);

  const loadPost = async () => {
    if (!postId) return;
    const { apiGet } = await import('../../src/services/apiClient');
    const { data } = await apiGet<any>(`/v1/posts/${encodeURIComponent(postId)}`);
    if (data) setPostData(data);
  };

  const loadComments = async () => {
    if (!postId) return;
    // Offline: never hang on a network call. Show whatever is cached (already
    // seeded synchronously) and stop the spinner immediately.
    if (!useConnectivityStore.getState().isOnline) {
      setIsLoading(false);
      return;
    }
    // 5-minute TTL gate. The synchronous MMKV hydrate above already paints
    // the last-known thread, so when the user pops back into the same post
    // within five minutes we skip the network refetch entirely. New
    // comments still appear because the create / edit / delete paths below
    // refresh the cache after their mutation lands. Without this gate, a
    // rapid back-tap-back-tap of the same comments screen burned three
    // identical reads of every comment row + author profile per cycle —
    // measurable Supabase egress and a visible spinner flash on each.
    const TTL_MS = 5 * 60 * 1000;
    const tsKey = `comments:${postId}:ts`;
    const lastFetch = kvGetJSONSync<number>(tsKey, 0);
    if (initialCommentsRef.current && initialCommentsRef.current.length > 0 && Date.now() - lastFetch < TTL_MS) {
      setIsLoading(false);
      return;
    }
    // Don't show the spinner if we already painted cached comments.
    if (comments.length === 0) setIsLoading(true);
    // Safety: never let the spinner spin forever if the request stalls.
    const safety = setTimeout(() => setIsLoading(false), 8000);
    try {
      const { comments: data } = await getComments(postId, { limit: COMMENTS_PAGE_SIZE });
      if (Array.isArray(data)) {
        setComments((prev) => mergeCommentPages(prev, data));
        // Defer the cache serialize off the open/render frame: JSON.stringify of
        // a long thread is synchronous and was landing on the same frame as the
        // list mount → a contributor to the cold-open long task.
        InteractionManager.runAfterInteractions(() => {
          kvSetJSON(`comments:${postId}`, data);
          kvSetJSON(tsKey, Date.now());
        });
        // NO `scrollToEnd` HERE ANY MORE. This line was the "it flings me violently" bug.
        //
        // It was `setTimeout(() => scrollToEnd({ animated: false }), 150)`. The list painted from
        // the TOP, then 150ms later got yanked to the bottom. Two things went wrong with that:
        //
        //   1. 150ms is a guess about when layout has settled. When rows are still measuring, the
        //      content height at t=150ms is not the final height, so the jump lands short and the
        //      following layout passes drag the viewport again — the "it jerks, then ends up back
        //      at the top" part of the report. Android measures slower, which is exactly why it
        //      showed up there more ("maybe only on Android").
        //   2. Even when it landed correctly, it is still a visible trip from top to bottom.
        //
        // The list now opens AT the newest comment with no scroll at all, via
        // `maintainVisibleContentPosition.startRenderingFromBottom` on the FlashList below. There
        // is nothing to time and nothing to animate. New comments arriving are handled by
        // `autoscrollToBottomThreshold` in the same prop, and reconciling the fetched page against
        // the cached one keeps its position because `maintainVisibleContentPosition` is on.
      }
    } catch {}
    clearTimeout(safety);
    setIsLoading(false);
  };
  // ── OLDER PAGES, ON SCROLL ────────────────────────────────────────────────
  //
  // The thread opens with the newest page only. Scrolling toward the top fetches the page before it,
  // which is the behaviour asked for: "it should not load the whole thread, just the first 50, and
  // the rest as I scroll up".
  //
  // `before` is the oldest `created_at` currently held. The server compares with a strict `<`, so
  // the cursor row is never resent and pages cannot overlap into duplicates.
  //
  // Two guards, both refs so they never cause a render:
  //   • in-flight — `onStartReached` fires repeatedly while the edge stays in range, and without
  //     this a single flick would launch a burst of identical requests.
  //   • exhausted — a short page means there is nothing older, so stop asking forever. Without it
  //     the top of a fully-loaded thread would poll the Worker on every scroll.
  //
  // Scroll position is preserved by `maintainVisibleContentPosition`, which is already enabled for
  // the open-at-the-bottom behaviour, so prepending does not shift what the reader is looking at.
  const loadingOlderRef = useRef(false);
  const noMoreOlderRef = useRef(false);
  const loadOlderComments = useCallback(async () => {
    if (!postId) return;
    if (loadingOlderRef.current || noMoreOlderRef.current) return;
    const oldest = comments[0]?.created_at;
    if (!oldest) return;
    loadingOlderRef.current = true;
    try {
      const { comments: older } = await getComments(postId, {
        limit: COMMENTS_PAGE_SIZE,
        before: String(oldest),
      });
      if (Array.isArray(older)) {
        // A page shorter than requested means the beginning of the thread is now loaded.
        if (older.length < COMMENTS_PAGE_SIZE) noMoreOlderRef.current = true;
        if (older.length > 0) setComments((prev) => mergeCommentPages(prev, older));
      }
    } catch {}
    loadingOlderRef.current = false;
  }, [postId, comments]);

  // ── LIVE COMMENTS. THIS SUBSCRIPTION DID NOT EXIST. ─────────────────────────
  //
  // Reported: "in comments they do not see each other at all until they re-enter, and even
  // then not reliably." That was not a broken connection — this screen had NO realtime
  // subscription of any kind. A grep for `postChannelName`, `getRealtime` and `subscribe(`
  // over this file returned nothing.
  //
  // Everything needed was already in place on both sides and simply never wired together:
  //
  //   server   `POST /v1/posts/:id/comments`  publishes `comment.new`    (posts.ts:530)
  //            `PATCH /v1/comments/:id`       publishes `comment.edit`   (comments.ts:41)
  //            `DELETE /v1/comments/:id`      publishes `comment.delete` (comments.ts:87)
  //            all three onto `post:<postId>` via `channels.post()`
  //   client   `postChannelName(postId)` produces the SAME `post:<postId>` string
  //            `api/ably-token` grants `post:*` subscribe + history
  //
  // So the events have been going out to a channel nobody listened on.
  //
  // The payloads mirror the REST shapes deliberately, which is what lets `reconcileComments`
  // be reused verbatim: `comment.new` carries `{ comment: <same shape as GET returns> }`,
  // `comment.edit` carries `{ id, content }`, `comment.delete` carries `{ id }`.
  //
  // `post:*` is SUBSCRIBE-ONLY for devices (see the capability map in api/ably-token.ts), so
  // there is nothing to publish from here — the Worker is the only publisher, which is the
  // pattern the 1:1 chat channel does NOT follow and is exactly why chat delivery is the
  // fragile one.
  useEffect(() => {
    if (!postId) return;
    const realtime = getRealtime();
    if (!realtime) return;
    const channel = realtime.channels.get(postChannelName(postId));

    const onNew = (msg: { data?: any }) => {
      const incoming = msg?.data?.comment;
      if (!incoming || !incoming.id) return;
      // `reconcileComments` is server-authoritative on membership, so it cannot be used to
      // ADD a single row — it would drop everything not in `next`. Append by hand, deduped
      // by id so our own optimistic insert plus the echoed event do not double up.
      setComments((prev) => (prev.some((c) => String(c?.id) === String(incoming.id)) ? prev : [...prev, incoming]));
    };

    const onEdit = (msg: { data?: any }) => {
      const p = msg?.data;
      if (!p?.id) return;
      setComments((prev) =>
        prev.map((c) => (String(c?.id) === String(p.id) ? { ...c, content: p.content ?? c.content } : c)),
      );
    };

    const onDelete = (msg: { data?: any }) => {
      const p = msg?.data;
      if (!p?.id) return;
      setComments((prev) => prev.filter((c) => String(c?.id) !== String(p.id)));
    };

    // Rejections are surfaced rather than discarded. A silently dead subscription here is
    // indistinguishable from "nobody commented", which is the state this screen was in.
    const onErr = (event: string) => (err: unknown) => {
      if (__DEV__) {
        console.warn(`[comments] realtime subscribe failed for "${event}" on ${postChannelName(postId)}`, err);
      }
    };
    channel.subscribe('comment.new', onNew).catch(onErr('comment.new'));
    channel.subscribe('comment.edit', onEdit).catch(onErr('comment.edit'));
    channel.subscribe('comment.delete', onDelete).catch(onErr('comment.delete'));
    return () => {
      try { channel.unsubscribe('comment.new', onNew); } catch {}
      try { channel.unsubscribe('comment.edit', onEdit); } catch {}
      try { channel.unsubscribe('comment.delete', onDelete); } catch {}
    };
  }, [postId]);

  // If this post is a repost, resolve the original post (with author) to render a proper preview
  useEffect(() => {
    if (!postData?.content) { setRepostOriginal(null); return; }
    const info = isRepost(postData.content);
    if (!info.isRepost || !info.originalPostId) { setRepostOriginal(null); return; }
    let cancelled = false;
    // Cached path stays sync (no network, no allocations beyond a hash
    // lookup) so the embedded repost preview shows up on the first paint
    // when we have the original cached. The network branch is deferred
    // past the navigation transition — it was contributing to the
    // 60→40 fps drop on cold-open of a repost's comments screen.
    const { useEntityStore } = require('../../src/store');
    const cachedOrig = useEntityStore.getState().posts[info.originalPostId!];
    if (cachedOrig) {
      const prof = useEntityStore.getState().profiles[cachedOrig.author_id];
      setRepostOriginal({ ...cachedOrig, profiles: prof || null });
      return () => { cancelled = true; };
    }
    if (!useConnectivityStore.getState().isOnline) return;
    const handle = InteractionManager.runAfterInteractions(async () => {
      const { apiGet } = await import('../../src/services/apiClient');
      const { data } = await apiGet<any>(`/v1/posts/${encodeURIComponent(info.originalPostId!)}`);
      if (!cancelled && data) setRepostOriginal(data);
    });
    return () => { cancelled = true; handle.cancel(); };
  }, [postData?.content]);

  // ── Typing indicator ────────────────────────────────────────────────────────
  //
  // Its own `typing:post:<id>` channel, NOT the `post:<id>` one the comment events use: that
  // namespace is subscribe-only in the Ably token so a device cannot forge a `comment.new`,
  // and typing has to be client-published. See src/services/realtime/typing.ts.
  const typingChannel = postId ? typingPostChannelName(postId) : null;
  const { notifyTyping, notifyStopped } = useTypingPublisher(typingChannel);

  // Tell the push handler this comment thread is on screen, so a comment on THIS post does not
  // raise a banner the user does not need — it is already arriving over Ably. Comments on other
  // posts still notify. Re-registers on foreground; the root drops the register on background.
  useEffect(() => {
    if (!postId) return;
    const ids = [postId];
    setActiveThread('post', ids);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setActiveThread('post', ids);
    });
    return () => {
      try { sub.remove(); } catch {}
      clearActiveThread('post', ids);
    };
  }, [postId]);

  const handleSend = async () => {
    // RE-ENTRY GUARD: prevent a double-send if invoked again while a send is
    // already in flight (the button is also disabled, but this is belt-and-braces).
    if (isSending) return;
    const draft = inputRef.current?.getText() ?? '';
    if (!draft.trim() || !user?.id || !postId) return;
    // Clear the indicator at once — the comment itself is about to appear, so leaving
    // "is typing" up would read as a second one on the way.
    notifyStopped();
    playSendSound();
    // Strip dangerous invisible / control / bidi-override chars; keep
    // decorative Unicode + emoji. sanitizeUserText also trims.
    const body = sanitizeUserText(draft);

    // Edit mode: update the existing comment, preserving any reply-quote prefix.
    if (editing) {
      const parsed = parseReply(editing.content || '');
      const newContent = parsed.replyUser
        ? encodeReply(parsed.replyUser, parsed.replyText || '', body, parsed.replyGif)
        : body;
      const editId = editing.id;
      inputRef.current?.clear();
      setEditing(null);
      // Optimistic local update
      setComments((prev) => prev.map((c) => (c.id === editId ? { ...c, content: newContent } : c)));
      await updateComment(editId, user.id, newContent);
      return;
    }

    // Embed a reply quote when replying to a comment (round-trips via marker).
    // For GIF comments, carry the GIF URL so the quote renders a mini thumbnail.
    const quotedBody = parseReply(replyTo?.content || '').body;
    const quotedGif = parseGif(quotedBody);
    const quotedSnippet = quotedGif ? '' : quotedBody;
    const sendText = replyTo
      ? encodeReply(replyTo.profiles?.username || 'user', quotedSnippet, body, quotedGif || undefined)
      : body;
    // ONE idempotency key shared by the online attempt AND the queued retry
    // below — the server dedupes on it so a reconnect retry can't double-post.
    const cmid = generateClientMutationId();
    // DRAFT PRESERVATION: do NOT clear the input yet. We only clear once the
    // comment is safely sent (online success) or safely queued (offline). On a
    // transient failure with no queue the draft stays in the composer.
    setReplyTo(null);
    setIsSending(true);
    const { error } = await createComment(postId, user.id, sendText, cmid);
    if (!error) {
      inputRef.current?.clear();
      const { comments: data } = await getComments(postId, { limit: COMMENTS_PAGE_SIZE });
      setComments((prev) => mergeCommentPages(prev, data));
      // Defer the cache serialize past the send interaction — JSON.stringify of
      // a long thread is synchronous and was piling onto the same frame as the
      // list re-render + scroll-to-end.
      InteractionManager.runAfterInteractions(() => kvSetJSON(`comments:${postId}`, data));
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } else {
      // OFFLINE / TRANSIENT FAILURE FALLBACK: queue with the SAME cmid so a
      // later retry shares the idempotency key (server dedupes → no double
      // post). The comment is now safely persisted, so clear the draft.
      await queueMutation('create_comment', { postId, content: sendText }, cmid);
      inputRef.current?.clear();
      showToast(t('toast.will_send_offline', 'Will send when online'), 'clock');
    }
    setIsSending(false);
  };

  const handleMenuAction = (action: CommentAction, c: any) => {
    const parsed = parseReply(c.content || '');
    if (action === 'reply') {
      startReply(c);
    } else if (action === 'copy') {
      Clipboard.setStringAsync(parsed.body);
      showToast(t('toast.copied'), 'check');
    } else if (action === 'edit') {
      setReplyTo(null);
      setEditing(c);
      inputRef.current?.setText(parsed.body);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else if (action === 'delete') {
      Alert.alert(t('comments.delete_title'), '', [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'), style: 'destructive', onPress: async () => {
            if (!user?.id || !postId) return;
            triggerHaptic('medium');
            setComments((prev) => prev.filter((x) => x.id !== c.id));
            await deleteComment(c.id, user.id, postId);
          },
        },
      ]);
    } else if (action === 'report') {
      setTimeout(() => setReportComment(c), 220);
    }
  };

  const startReply = useCallback((comment: any) => {
    closeMenu();
    setEditing(null);
    setReplyTo(comment);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [closeMenu]);

  // Send a GIF as a comment — stored with the ::gif:: marker, rendered as an
  // animated image. No upload to our storage (GIPHY URL sent directly).
  const sendGifComment = async (url: string) => {
    if (isSending) return;
    if (!url || !user?.id || !postId) return;
    triggerHaptic('light');
    const content = `::gif::${url}`;
    // ONE idempotency key shared by the online attempt AND any queued retry.
    const cmid = generateClientMutationId();
    setReplyTo(null);
    setIsSending(true);
    const { error } = await createComment(postId, user.id, content, cmid);
    if (!error) {
      const { comments: data } = await getComments(postId, { limit: COMMENTS_PAGE_SIZE });
      setComments((prev) => mergeCommentPages(prev, data));
      InteractionManager.runAfterInteractions(() => kvSetJSON(`comments:${postId}`, data));
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } else {
      // OFFLINE / TRANSIENT FALLBACK: queue with the SAME cmid (server dedupes).
      await queueMutation('create_comment', { postId, content }, cmid);
      showToast(t('toast.will_send_offline', 'Will send when online'), 'clock');
    }
    setIsSending(false);
  };

  // Send a single emoji as its own comment (long-press → Send in the panel).
  const sendEmojiComment = async (emoji: string) => {
    if (isSending) return;
    if (!emoji || !user?.id || !postId) return;
    triggerHaptic('light');
    playSendSound();
    const quoted = parseReply(replyTo?.content || '').body;
    const quotedGif = parseGif(quoted);
    const sendText = replyTo
      ? encodeReply(replyTo.profiles?.username || 'user', quotedGif ? '' : quoted, emoji, quotedGif || undefined)
      : emoji;
    // ONE idempotency key shared by the online attempt AND any queued retry.
    const cmid = generateClientMutationId();
    setReplyTo(null);
    setIsSending(true);
    const { error } = await createComment(postId, user.id, sendText, cmid);
    if (!error) {
      const { comments: data } = await getComments(postId, { limit: COMMENTS_PAGE_SIZE });
      setComments((prev) => mergeCommentPages(prev, data));
      InteractionManager.runAfterInteractions(() => kvSetJSON(`comments:${postId}`, data));
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } else {
      // OFFLINE / TRANSIENT FALLBACK: queue with the SAME cmid (server dedupes).
      await queueMutation('create_comment', { postId, content: sendText }, cmid);
      showToast(t('toast.will_send_offline', 'Will send when online'), 'clock');
    }
    setIsSending(false);
  };

  // ── Media panel: lift mirror, open / close, tab switch, pick handlers ─────
  // Mirrors the chat composer exactly so the panel rises smoothly whether the
  // keyboard is up (descent reveals it) or down (animated rise via liftSV).
  useEffect(() => {
    if (emojiOpen || gifOpen || keepLifted) {
      if (keepLifted) liftSV.value = 1;
    } else {
      liftSV.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
    }
  }, [emojiOpen, gifOpen, keepLifted, liftSV]);

  useEffect(() => {
    if (!keepLifted) return;
    const sub = Keyboard.addListener('keyboardDidShow', () => setKeepLifted(false));
    const tid = setTimeout(() => setKeepLifted(false), 650);
    return () => { sub.remove(); clearTimeout(tid); };
  }, [keepLifted]);

  useEffect(() => {
    if (!panelTab) return;
    setRecentEmoji(getRecentEmoji());
    setRecentGif(getRecentGif());
  }, [panelTab]);

  const openEmoji = useCallback(() => {
    const h = lastKbHeightRef.current > 0 ? lastKbHeightRef.current : 300;
    emojiPanelSV.value = h;
    setEmojiPanelHeight(h);
    setKeepLifted(false);
    // Mount the panel off-screen first (liftSV still 0 → parked below screen),
    // then start the lift after the mount/layout commits — see chat composer.
    setPanelTab('emoji');
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

  const switchPanel = useCallback((tab: 'emoji' | 'gif') => {
    setPanelTab(tab);
  }, []);

  const closeEmojiToKeyboard = useCallback(() => {
    liftSV.value = 1;
    setPanelTab(null);
    setKeepLifted(true);
    inputRef.current?.focus();
  }, [liftSV]);

  // Dismiss the panel entirely (no keyboard) — fired by a tap on the comment-
  // list region while a panel is open. The lift mirror effect slides the bar +
  // panel back down once the state clears.
  const dismissPanel = useCallback(() => {
    setPanelTab(null);
    setKeepLifted(false);
  }, []);

  // Tap-to-dismiss that yields to scrolling — a Tap fails the moment the finger
  // moves, so the comment list scrolls freely with the panel open; a plain tap
  // on the list dismisses the panel. Enabled only while a panel is open.
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

  // Composer button taps: open the panel, switch tabs if the other is open, or
  // return to the keyboard if this tab is already open.
  const onEmojiBtn = useCallback(() => {
    if (emojiOpen) closeEmojiToKeyboard();
    else if (gifOpen) switchPanel('emoji');
    else openEmoji();
  }, [emojiOpen, gifOpen, closeEmojiToKeyboard, switchPanel, openEmoji]);
  const onGifBtn = useCallback(() => {
    if (gifOpen) closeEmojiToKeyboard();
    else if (emojiOpen) switchPanel('gif');
    else openGif();
  }, [emojiOpen, gifOpen, closeEmojiToKeyboard, switchPanel, openGif]);

  // Tapping the field while a media panel is open must RETURN to the keyboard,
  // not leave the panel armed. We hold the lift, unmount the panel, and keep
  // it lifted until the keyboard actually shows (keepLifted) — otherwise the
  // panel stayed tracked and re-appeared the next time the keyboard was
  // dismissed (the "GIF re-opens when I tap outside" bug). Mirrors the chat
  // composer's onFocus → closeEmojiToKeyboard behaviour.
  const handleInputFocus = useCallback(() => {
    perfMonitor.markInputFocus('comments');
    if (emojiOpen || gifOpen) {
      liftSV.value = 1;
      setPanelTab(null);
      setKeepLifted(true);
    }
  }, [emojiOpen, gifOpen, liftSV]);

  // Insert emoji into the composer; panel stays open for multi-pick.
  const onPickEmoji = useCallback((e: string) => {
    inputRef.current?.insert(e);
    setRecentEmoji(pushRecentEmoji(e));
  }, []);

  const onBackspaceComposer = useCallback(() => {
    inputRef.current?.backspace();
  }, []);

  // Tap (or long-press → Send) a GIF → send as a comment, close the panel.
  // Plain functions so they always see the latest replyTo / user / postId.
  const onPickGif = (item: GiphyItem) => {
    setRecentGif(pushRecentGif(item));
    setPanelTab(null);
    setKeepLifted(false);
    void sendGifComment(item.sendUrl);
  };
  const onSendEmojiMessage = (e: string) => {
    setRecentEmoji(pushRecentEmoji(e));
    setPanelTab(null);
    setKeepLifted(false);
    void sendEmojiComment(e);
  };
  const onCopyEmoji = (e: string) => {
    Clipboard.setStringAsync(e);
    showToast(t('toast.copied'), 'check');
  };
  const onCopyGif = (item: GiphyItem) => {
    Clipboard.setStringAsync(item.sendUrl);
    showToast(t('toast.copied'), 'check');
  };

  // Long-press menu opener — wraps the guard with the haptic + edge cases that
  // belong here (we still want haptic feedback only for accepted opens).
  const openCommentMenu = useCallback((c: any) => {
    triggerHaptic('medium');
    openMenu(c);
  }, [openMenu]);
  const closeCommentMenu = closeMenu;

  // Stable callbacks for the FlatList — see CommentRow for why this matters.
  const openImageViewer = useCallback((uri: string, comment?: any) => {
    setViewingImage({ uri });
    setViewerComment(comment ?? null);
  }, []);
  const renderComment = useCallback(
    ({ item }: { item: any }) => (
      <CommentRow item={item} onLongPress={openCommentMenu} onReply={startReply} onImagePress={openImageViewer} gifTracker={gifTracker} />
    ),
    [openCommentMenu, startReply, openImageViewer, gifTracker],
  );
  const keyExtractor = useCallback((item: any) => item.id, []);
  // Recycle pools by comment row SHAPE so FlashList v2 reuses a text cell only
  // as another text cell, a GIF cell as another GIF cell, and a link-preview
  // cell as another link-preview cell. Without this, scrolling reshapes a
  // recycled text row into a GIF/link row (and back), forcing a full re-layout
  // of that cell on the scroll frame — the same image/GIF-mixed scroll jank
  // fixed in the chat screen (`chatGetItemType`). The discriminator MIRRORS
  // CommentRow's own content-shape decision: parse the reply wrapper, then a
  // GIF body wins, else a non-code link body, else plain text. All helpers are
  // module-level + pure, so the deps array is empty (stable identity across
  // every CommentsScreen render — keystrokes, keyboard/panel lifts, GIF gate).
  const getItemType = useCallback((item: any) => {
    const parsed = parseReply(item.content || '');
    const gif = parseGif(parsed.body);
    if (gif) return 'gif';
    const link = (!gif && !hasCodeBlock(parsed.body)) ? extractFirstUrl(parsed.body) : null;
    if (link) return 'link';
    return 'text';
  }, []);

  // Memoized FlashList content-container padding — a fresh inline object here
  // would hand FlashList a new contentContainerStyle reference on every
  // CommentsScreen render (every keystroke, keyboard/panel animation), so this
  // hoists it behind its real inputs.
  const listContentStyle = useMemo(
    () => ({ paddingHorizontal: 20, paddingTop: headerContentHeight, paddingBottom: 80 + insets.bottom }),
    [headerContentHeight, insets.bottom],
  );

  // Memoized empty-state element — inline JSX rebuilt the element tree on every
  // render; it only depends on the theme + locale.
  const listEmpty = useMemo(
    () => (
      <View style={{ alignItems: 'center', paddingTop: 40 }}>
        <RNText style={{ fontSize: 32 }} allowFontScaling={false}>💬</RNText>
        <Text variant="body" color={theme.colors.text.tertiary} style={{ marginTop: 8 }}>{t('comments.empty')}</Text>
      </View>
    ),
    [theme, t],
  );

  // Memoized post-header element. Previously an inline IIFE that ran on EVERY
  // CommentsScreen render (typing, keyboard/panel lift, GIF-gate flips) —
  // re-parsing the repost marker + image URLs and rebuilding the whole header
  // subtree each time. It only changes with the post payload, the resolved
  // repost original, the theme, or the locale.
  const listHeader = useMemo(() => {
    if (!postData) return null;
    const repostInfo = isRepost(postData.content || '');
    const repostComment = repostInfo.isRepost ? (repostInfo.comment || '') : '';
    const mainContent = repostInfo.isRepost ? repostComment : (postData.content || '');
    const origProfile = repostOriginal ? (Array.isArray(repostOriginal.profiles) ? repostOriginal.profiles[0] : repostOriginal.profiles) : null;
    const origImages = repostOriginal ? parseImageUrls(repostOriginal.image_url) : [];
    return (
      <View style={{ marginBottom: 16, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
        {repostInfo.isRepost && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <Feather name="repeat" size={12} color={theme.colors.text.tertiary} />
            <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ flexShrink: 1 }}>{postData.profiles?.display_name || 'User'} {t('comments.repost_label')}</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Avatar emoji={postData.profiles?.emoji || '😊'} size="sm" />
          <View style={{ marginLeft: 10, flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text variant="body" weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>{postData.profiles?.display_name || 'User'}</Text>
              {postData.profiles?.is_verified && <VerifiedBadge size={12} />}
              {postData.profiles?.badge && <UserBadge badge={postData.profiles.badge} size="sm" />}
            </View>
            <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>@{postData.profiles?.username}</Text>
          </View>
        </View>
        {mainContent ? <FormattedText style={{ fontSize: 15, lineHeight: 21, marginBottom: 8 }}>{mainContent}</FormattedText> : null}
        {!repostInfo.isRepost && parseImageUrls(postData.image_url).length === 0 && (() => {
          const link = extractFirstUrl(mainContent);
          return link ? <View style={{ marginBottom: 8 }}><LinkPreview url={link} /></View> : null;
        })()}
        {!repostInfo.isRepost && (() => {
          const imgs = parseImageUrls(postData.image_url);
          if (imgs.length === 0) return null;
          if (imgs.length === 1) return (
            <Pressable onPress={() => setViewingImage({ uri: imgs[0], images: imgs, index: 0 })}>
              <CachedImage uri={imgs[0]} style={{ width: '100%', height: 200, borderRadius: 12, marginBottom: 8 }} resizeMode="cover" />
            </Pressable>
          );
          return (
            <FlatList
              data={imgs}
              horizontal
              keyExtractor={(u, i) => u + i}
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 8 }}
              renderItem={({ item, index }) => (
                <Pressable onPress={() => setViewingImage({ uri: item, images: imgs, index })}>
                  <CachedImage uri={item} style={{ width: 200, height: 200, borderRadius: 12, marginRight: 8 }} resizeMode="cover" />
                </Pressable>
              )}
            />
          );
        })()}

        {/* Repost — embedded original post preview */}
        {repostInfo.isRepost && (
          repostOriginal ? (
            <View style={{ borderWidth: 1, borderColor: theme.colors.border.light, borderRadius: 14, padding: 10, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                <Avatar emoji={origProfile?.emoji || '😊'} size="xs" />
                <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{origProfile?.display_name || 'User'}</Text>
                {origProfile?.is_verified && <VerifiedBadge size={10} />}
                {origProfile?.badge && <UserBadge badge={origProfile.badge} size="sm" />}
                {origProfile?.username ? <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11, flexShrink: 0 }}>@{origProfile.username}</Text> : null}
              </View>
              {repostOriginal.content ? <FormattedText style={{ fontSize: 13 }} color={theme.colors.text.secondary}>{repostOriginal.content}</FormattedText> : null}
              {origImages.length === 1 && (
                <Pressable onPress={() => setViewingImage({ uri: origImages[0], images: origImages, index: 0 })}>
                  <CachedImage uri={origImages[0]} style={{ width: '100%', height: 160, borderRadius: 10, marginTop: 6 }} resizeMode="cover" />
                </Pressable>
              )}
              {origImages.length > 1 && (
                <FlatList
                  data={origImages}
                  horizontal
                  keyExtractor={(u, i) => u + i}
                  showsHorizontalScrollIndicator={false}
                  style={{ marginTop: 6 }}
                  renderItem={({ item, index }) => (
                    <Pressable onPress={() => setViewingImage({ uri: item, images: origImages, index })}>
                      <CachedImage uri={item} style={{ width: 150, height: 150, borderRadius: 10, marginRight: 6 }} resizeMode="cover" />
                    </Pressable>
                  )}
                />
              )}
            </View>
          ) : (
            <View style={{ borderWidth: 1, borderColor: theme.colors.border.light, borderRadius: 14, padding: 14, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={theme.colors.accent.primary} />
            </View>
          )
        )}
      </View>
    );
  }, [postData, repostOriginal, theme, t]);

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {/* Gradient fade header */}
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient colors={topScrimColors(theme.isDark, bgColor)} locations={SCRIM_LOCATIONS} style={StyleSheet.absoluteFill} />
        <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
          {/* Back affordance now carries a LABEL beside the chevron, matching the chat
              header's back pill. `t('common.back')` already exists in both locales
              ("Назад" / "Back"), so nothing new had to be added to the dictionaries.

              The three-column shape is copied from the chat header rather than invented:
              the side columns hug their content and never shrink (`flexShrink: 0`) so the
              label is always shown in full, and the title takes the remaining space
              (`flex: 1`) and truncates within it. That means the title is centred in the
              gap between the two columns rather than on the screen — iOS does the same,
              and the chat header documents it as deliberate. Perfectly centring it would
              need absolute positioning, which lets a long title run under the label. */}
          {/* ── SAME BACK AFFORDANCE AS THE CHAT HEADER ───────────────────────────
              Asked for as "put an outline around the back button in comments, like in chat".

              It was a bare chevron plus a label with nothing around it; the chat header wraps the
              same two elements in a PILL — interactive liquid glass where the material is
              available, and a bordered elevated capsule where it is not. Two branches rather than
              one bordered box, because that is exactly what the chat does: on a glass device a
              border drawn over the material reads as a seam, and on a flat device the border IS
              the edge. Sharing the geometry (height 36, radius 18, the same paddings) is what
              makes them read as the same control rather than as two similar ones.

              `flexShrink: 0` on the pill and on the label, so a long screen title can never
              squeeze the affordance or truncate its text — the chat header documents the same
              constraint for the same reason. */}
          {glassActive ? (
            <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backPillPress}>
              <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.backPillGlass}>
                <Feather name="chevron-left" size={22} color={theme.colors.text.primary} />
                <Text variant="caption" weight="semibold" numberOfLines={1} color={theme.colors.text.primary} style={styles.backLabel}>
                  {t('common.back')}
                </Text>
              </NativeGlassView>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              style={[styles.backPill, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}
            >
              <Feather name="chevron-left" size={22} color={theme.colors.text.primary} />
              <Text variant="caption" weight="semibold" numberOfLines={1} color={theme.colors.text.primary} style={styles.backLabel}>
                {t('common.back')}
              </Text>
            </Pressable>
          )}
          <View style={styles.headerTitleWrap}>
            <Text variant="body" weight="bold" numberOfLines={1}>{t('comments.title')}</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>
      </View>

      {/* Comments list */}
      {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={theme.colors.accent.primary} />
          </View>
        ) : (
          // Wrapped so the whole list rides up with the keyboard via a
          // UI-thread transform — no FlatList relayout when the keyboard
          // animates, and the last comment stays above the sticky input.
          <Reanimated.View style={[{ flex: 1 }, listShiftStyle]} pointerEvents="box-none">
          <GestureDetector gesture={panelDismissTap}>
          <FlashList
            ref={listRef}
            data={comments}
            keyExtractor={keyExtractor}
            getItemType={getItemType}
            renderItem={renderComment}
            contentContainerStyle={listContentStyle}
            showsVerticalScrollIndicator={false}
            onScroll={onCommentsScroll}
            scrollEventThrottle={64}
            onViewableItemsChanged={onCommentsViewable}
            viewabilityConfig={commentsViewabilityConfig}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={listEmpty}
            /* OPEN AT THE NEWEST COMMENT — the documented FlashList v2 way, replacing the timed
               `scrollToEnd` that caused the violent fling (see the note in the fetch above).
   
               `startRenderingFromBottom` makes the INITIAL render begin at the bottom, so the
               newest comment is on screen from the first painted frame. No timer, no animation, no
               dependence on when measurement finishes — which is what made the old approach
               unreliable on Android.
   
               `autoscrollToBottomThreshold: 0.2` keeps the thread following new comments while the
               reader is near the bottom (within 20% of a viewport), and leaves the viewport alone
               when they have scrolled up to read — so a comment arriving mid-read does not snatch
               the screen away.
   
               Chosen over `inverted` deliberately. The chat list could be inverted because it has no
               header content; this screen renders the POST as `ListHeaderComponent`, and inverting
               would move the post to the visual bottom. FlashList v2's docs cover exactly this case:
               "Chat apps without inverted will also be possible." */
            maintainVisibleContentPosition={COMMENTS_MVCP}
            /* Older pages arrive as the reader approaches the top, rather than the whole thread
               arriving up front. `onStartReached` is FlashList v2's start-edge callback (v1 had no
               equivalent, which is part of why this screen fetched everything). The threshold is
               expressed in viewports, so 0.3 means "start fetching while roughly a third of a screen
               of unread scroll remains" — early enough that the page is usually merged before the
               reader gets there, late enough that opening a thread does not immediately pull a
               second page it may never need. */
            onStartReached={loadOlderComments}
            onStartReachedThreshold={0.3}
          />
          </GestureDetector>
          </Reanimated.View>
        )}

        {/* Static under-input fade — pinned to the screen bottom and kept
            OUTSIDE the KeyboardStickyView so it does NOT ride up with the
            keyboard. Mirrors the user/music/ai chats: the solid composer
            container is gone, so comments scroll UNDER the input and dissolve
            into the background instead of hitting a hard bar edge. */}
        <LinearGradient
          colors={bottomScrimColorsStrong(theme.isDark, bgColor)}
          locations={SCRIM_LOCATIONS}
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: composerScrimHeight(insets.bottom, 14) }}
        />

        {/* Input area — manually keyboard-stuck via `barWrapStyle`
            (translateY = -max(keyboardHeight, panelHeight)) so the emoji/GIF
            media panel lift folds into a monotonic max() with no handoff jump,
            exactly like the chat composer. The input row has no solid
            backgroundColor: the fade above supplies the darkening so the
            composer floats over content like the other chats. */}
        <Reanimated.View style={[{ position: 'absolute', left: 0, right: 0, bottom: 0 }, barWrapStyle]}>
          {/* "…is typing" — topmost in the composer stack so it never covers the field.
              Owns its own realtime subscription, so a typing event in a busy thread
              re-renders this strip alone and not the comment list. */}
          <TypingIndicator channelName={typingChannel} />
          {editing ? (
            <View style={[{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 12, overflow: 'hidden' }, glassActive ? null : { backgroundColor: theme.colors.background.elevated, borderWidth: 1, borderColor: theme.colors.border.light }]}>
              {glassActive ? <GlassBg borderRadius={12} glassStyle="regular" interactive={false} colorScheme={theme.isDark ? 'dark' : 'light'} tintColor={theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)'} /> : null}
              <View style={{ width: 3, height: 30, borderRadius: 2, backgroundColor: theme.colors.accent.primary, marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} numberOfLines={1} style={{ fontSize: 12 }}>{t('comments.editing')}</Text>
                <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{parseReply(editing.content || '').body}</Text>
              </View>
              <Pressable onPress={() => { setEditing(null); inputRef.current?.clear(); }} hitSlop={8} style={{ padding: 4 }}>
                <Feather name="x" size={18} color={theme.colors.text.tertiary} />
              </Pressable>
            </View>
          ) : replyTo ? (
            <View style={[{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 12, overflow: 'hidden' }, glassActive ? null : { backgroundColor: theme.colors.background.elevated, borderWidth: 1, borderColor: theme.colors.border.light }]}>
              {glassActive ? <GlassBg borderRadius={12} glassStyle="regular" interactive={false} colorScheme={theme.isDark ? 'dark' : 'light'} tintColor={theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)'} /> : null}
              <View style={{ width: 3, height: 30, borderRadius: 2, backgroundColor: theme.colors.accent.primary, marginRight: 8 }} />
              {(() => {
                const rb = parseReply(replyTo.content || '').body;
                const rgif = parseGif(rb);
                return rgif ? <CachedImage uri={rgif} style={{ width: 30, height: 30, borderRadius: 6, marginRight: 8, backgroundColor: theme.colors.background.secondary }} resizeMode="cover" /> : null;
              })()}
              <View style={{ flex: 1 }}>
                <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} numberOfLines={1} style={{ fontSize: 12 }}>{t('comments.reply_to', undefined, { username: replyTo.profiles?.username || 'user' })}</Text>
                <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{parseGif(parseReply(replyTo.content || '').body) ? 'GIF' : parseReply(replyTo.content || '').body}</Text>
              </View>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8} style={{ padding: 4 }}>
                <Feather name="x" size={18} color={theme.colors.text.tertiary} />
              </Pressable>
            </View>
          ) : null}
          <Reanimated.View style={[{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 8 }, inputPadStyle]}>
            {/* Input wrap → interactive liquid glass holding the TextInput +
                GIF button as CHILDREN (matches ChatInputBar). NO visible border
                (the glass supplies the edge) and NO overflow clip. The non-glass
                fallback keeps its existing bordered capsule byte-for-byte. */}
            {glassActive ? (
              <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, minHeight: 44 }}>
                <CommentField
                  ref={inputRef}
                  onTyping={notifyTyping}
                  onHasTextChange={handleHasTextChange}
                  onFocus={handleInputFocus}
                />
                {/* Emoji + GIF buttons inside the input, right side */}
                <Pressable onPress={onEmojiBtn} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, height: 24, alignItems: 'center', justifyContent: 'center' }}>
                  <AnimatedEmojiIcon size={20} color={emojiOpen ? theme.colors.accent.primary : theme.colors.text.tertiary} />
                </Pressable>
                {panelTab ? (
                  <Pressable onPress={closeEmojiToKeyboard} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, height: 24, paddingHorizontal: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent.primary + '18' }}>
                    <AnimatedKeyboardIcon size={18} color={theme.colors.accent.primary} />
                  </Pressable>
                ) : (
                  <Pressable onPress={openGif} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, height: 24, paddingHorizontal: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent.primary + '18' }}>
                    <AnimatedGifIcon color={theme.colors.accent.primary} fontSize={11} />
                  </Pressable>
                )}
              </NativeGlassView>
            ) : (
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: theme.colors.border.light, minHeight: 44 }}>
                <CommentField
                  ref={inputRef}
                  onTyping={notifyTyping}
                  onHasTextChange={handleHasTextChange}
                  onFocus={handleInputFocus}
                />
                {/* Emoji + GIF buttons inside the input, right side */}
                <Pressable onPress={onEmojiBtn} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, height: 24, alignItems: 'center', justifyContent: 'center' }}>
                  <AnimatedEmojiIcon size={20} color={emojiOpen ? theme.colors.accent.primary : theme.colors.text.tertiary} />
                </Pressable>
                {panelTab ? (
                  <Pressable onPress={closeEmojiToKeyboard} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, height: 24, paddingHorizontal: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent.primary + '18' }}>
                    <AnimatedKeyboardIcon size={18} color={theme.colors.accent.primary} />
                  </Pressable>
                ) : (
                  <Pressable onPress={openGif} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, height: 24, paddingHorizontal: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent.primary + '18' }}>
                    <AnimatedGifIcon color={theme.colors.accent.primary} fontSize={11} />
                  </Pressable>
                )}
              </View>
            )}
            {/* Send button → keep the solid accent affordance when it can send.
                When it can't (empty) AND glass is active, render interactive
                glass holding the icon as a CHILD (mirrors ChatInputBar). */}
            {glassActive && !hasText ? (
              <Pressable onPress={handleSend} disabled={isSending} style={{ marginLeft: 10, borderRadius: 20 }}>
                <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name={editing ? 'check' : 'send'} size={16} color={theme.colors.text.tertiary} />
                </NativeGlassView>
              </Pressable>
            ) : (
              <Pressable onPress={handleSend} disabled={!hasText || isSending} style={{ marginLeft: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: hasText ? theme.colors.accent.primary : theme.colors.background.elevated, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name={editing ? 'check' : 'send'} size={16} color={hasText ? '#FFFFFF' : theme.colors.text.tertiary} />
              </Pressable>
            )}
          </Reanimated.View>
        </Reanimated.View>

        {/* Media panel (emoji / GIF) — twin of the chat composer's. Mounted
            while open at the screen bottom; the keyboard's slide-down (or the
            animated liftSV rise when the keyboard is already down) reveals it.
            `panelSlideStyle` pushes it below the screen at liftSV 0 and brings
            it to rest at liftSV 1, in sync with the input-bar lift. */}
        {panelTab && (
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
                onBackspace={onBackspaceComposer}
                recentEmoji={recentEmoji}
                recentGifs={recentGif}
                theme={theme}
                bottomInset={insets.bottom}
                labels={mediaPanelLabels}
                onSendEmoji={onSendEmojiMessage}
                onCopyEmoji={onCopyEmoji}
                onSendGif={onPickGif}
                onCopyGif={onCopyGif}
              />
            </View>
          </Reanimated.View>
        )}

        {/* Comment long-press menu — smooth slide-up (matches chat/feed) */}
        {(() => {
          const parsed = actionComment ? parseReply(actionComment.content || '') : { body: '' as string, replyUser: undefined as string | undefined, replyText: undefined as string | undefined };
          const gif = actionComment ? parseGif(parsed.body) : null;
          const isOwnComment = !!actionComment && !!user?.id && (actionComment.author_id === user.id || actionComment.profiles?.id === user.id);
          return (
            <CommentContextMenu
              visible={!!actionComment}
              comment={actionComment}
              isOwn={isOwnComment}
              displayBody={parsed.body}
              replyUser={parsed.replyUser}
              replyText={parsed.replyText}
              gifUrl={gif}
              onClose={closeCommentMenu}
              onAction={handleMenuAction}
            />
          );
        })()}

        {/* Report categories — smooth slide-up sheet (matches the dots menu) */}
        <SlideUpSheet visible={!!reportComment} onClose={() => setReportComment(null)}>
          <Text variant="body" weight="semibold" align="center" style={{ paddingVertical: 8 }}>{t('report.title')}</Text>
          {REPORT_CATS.map((cat) => (
            <Pressable key={cat.key} onPress={() => { triggerHaptic('medium'); setReportComment(null); showToast(t('toast.report_sent'), 'flag'); }} style={{ paddingVertical: 14, paddingHorizontal: 20, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}>
              <Text variant="body">{t(cat.labelKey)}</Text>
            </Pressable>
          ))}
        </SlideUpSheet>

        {/* GIF picker now lives in the inline MediaPanel (emoji/GIF switcher). */}

        {/* Fullscreen viewer — the SAME component the chat and both profiles use.
   
            This was the third hand-copied Modal viewer: a static backdrop, tap-anywhere to close,
            and no gestures. Comments show GIFs, which is exactly where dragging one away and
            pinching into it are wanted, so it gets the shared viewer too. The tab bar hides itself
            from inside the component, so this screen needs no extra wiring for that. */}
        <ImageViewerModal
          payload={viewerPayload}
          onClose={closeViewer}
          topInset={insets.top}
          bottomInset={insets.bottom}
          proxyWidth={SCREEN_WIDTH}
          header={viewerHeader}
          footer={viewerFooter}
          zoomable
        />    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8, gap: 8 },
  // Back affordance: chevron + localized label. `flexShrink: 0` so the label is never
  // squeezed by a long title. Mirrors `backPill` / `backLabel` in the chat header.
  // Geometry copied deliberately from `backPill` / `backPillGlass` in the chat header so the two
  // controls are the same control. If one is ever retuned, retune both — they are compared
  // side by side by anyone moving between the screens.
  backPillPress: { borderRadius: 18 },
  backPill: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', height: 36, borderRadius: 18, borderWidth: 1, paddingLeft: 6, paddingRight: 14, gap: 2 },
  backPillGlass: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', height: 36, borderRadius: 18, paddingLeft: 8, paddingRight: 16, gap: 2 },
  backLabel: { marginLeft: -2, flexShrink: 0 },
  // Title takes the space between the two side columns and truncates within it.
  headerTitleWrap: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  // Right-hand counterweight, same width the bare chevron used to occupy.
  headerSpacer: { width: 24, flexShrink: 0 },
});
