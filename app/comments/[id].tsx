import React, { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import { View, FlatList, TextInput, Pressable, Platform, ActivityIndicator, StyleSheet, Text as RNText, Modal, Alert, LayoutAnimation, UIManager, InteractionManager, ScrollView, Dimensions, Keyboard } from 'react-native';
import { useReanimatedKeyboardAnimation, useKeyboardHandler } from 'react-native-keyboard-controller';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming, runOnJS, Easing } from 'react-native-reanimated';
import type { ScrollViewProps } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { useLiquidGlassActive, NativeGlassView, GlassBg } from '../../src/components/ui/LiquidGlass';
import { Text, Avatar } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { FormattedText } from '../../src/components/ui/FormattedText';
import { LinkPreview } from '../../src/components/ui/LinkPreview';
import { extractFirstUrl } from '../../src/services/linkPreview';
import { useContextMenuGuard } from '../../src/hooks/useContextMenuGuard';
import { useChatKeyboardMode } from '../../src/hooks/useChatKeyboardMode';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { useStaggeredReveal, useStaggeredGifReveal } from '../../src/hooks/useStaggeredReveal';
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
import { getComments, createComment, updateComment, deleteComment, isRepost, parseImageUrls } from '../../src/lib/supabase';
import { triggerHaptic } from '../../src/utils/haptics';
import { sanitizeUserText } from '../../src/utils/sanitizeText';
import { playSendSound } from '../../src/utils/sounds';
import { showToast } from '../../src/store/toastStore';
import { useT } from '../../src/i18n/store';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useBrowserStore } from '../../src/store/browserStore';
import { useIsBlocked } from '../../src/store/blockedUsersStore';
import { BlockedContentPlaceholder } from '../../src/components/feed/BlockedContentPlaceholder';
import { ChatKeyboardScrollView } from '../../src/components/ui/ChatKeyboardScrollView';
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

// Enable LayoutAnimation on Android (no-op on iOS where it's already on by default).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  onImagePress: (uri: string) => void;
  gifTracker: GifVisTracker;
};

const CommentRow = React.memo(function CommentRow({ item, onLongPress, onReply, onImagePress, gifTracker }: CommentRowProps) {
  const theme = useTheme();
  const t = useT();
  // Block-aware short circuit: comments authored by a blocked user are
  // swapped for the inline placeholder so the rest of the thread stays
  // intact. Tapping the placeholder offers an unblock confirmation — the
  // user can also unblock from the messages-tab Blocked section.
  const authorId: string | undefined = item.profiles?.id || item.author_id;
  const isAuthorBlocked = useIsBlocked(authorId);
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

  const link = !gif ? extractFirstUrl(parsed.body) : null;

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
    <Pressable onLongPress={() => onLongPress(item)} delayLongPress={300} style={{ flexDirection: 'row', marginBottom: 16 }}>
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
          <Pressable onPress={() => onImagePress(gif)} onLongPress={() => onLongPress(item)} delayLongPress={300} style={{ marginTop: 6 }}>
            {gifReveal ? (
              <CachedImage uri={gif} style={{ width: 160, height: 160, borderRadius: 14, backgroundColor: theme.colors.background.secondary }} resizeMode="cover" autoplay={gifActive} />
            ) : (
              <View style={{ width: 160, height: 160, borderRadius: 14, backgroundColor: theme.colors.background.secondary }} />
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
export default function CommentsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
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
  const browserWidgetPosition = useSettingsStore((s) => s.browserWidgetPosition);
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
      initialCommentsRef.current = postId
        ? kvGetJSONSync<any[]>(`comments:${postId}`, [])
        : [];
    } catch {
      initialCommentsRef.current = [];
    }
  }
  const [comments, setComments] = useState<any[]>(initialCommentsRef.current);
  const [text, setText] = useState('');
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
  const inputRef = useRef<TextInput>(null);
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
    const rowListeners = new Map<string, Set<() => void>>();
    const notifyGifs = () => {
      gifIds.forEach((id) => {
        const s = rowListeners.get(id);
        if (s) s.forEach((fn) => fn());
      });
    };
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
        const onScreen = !ready || visibleSet.has(id);
        return onScreen && !scrolling;
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
        if (gifIds.size === 0) return;
        notifyGifs();
      },
      setHasGif(id, has) { if (has) gifIds.add(id); else gifIds.delete(id); },
    };
  }
  const gifTracker = gifTrackerRef.current;
  const gifScrollIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommentsScroll = useCallback(() => {
    gifTracker.setScrolling(true);
    if (gifScrollIdleRef.current) clearTimeout(gifScrollIdleRef.current);
    gifScrollIdleRef.current = setTimeout(() => gifTracker.setScrolling(false), 200);
  }, [gifTracker]);
  useEffect(() => () => { if (gifScrollIdleRef.current) clearTimeout(gifScrollIdleRef.current); }, []);
  const onCommentsViewable = useRef(({ viewableItems }: { viewableItems: any[] }) => {
    const next = new Set<string>();
    for (const v of viewableItems) { const id = v?.item?.id; if (id) next.add(id); }
    gifTrackerRef.current?.update(next);
  }).current;
  const commentsViewabilityConfig = useRef({ itemVisiblePercentThreshold: 35 }).current;

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

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
          // De-dupe — the author's own create path already inserted
          // the row optimistically via `loadComments` after the POST
          // succeeded.
          setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
          return;
        }
        if (msg.name === 'comment.edit') {
          const id = String(payload.id || '');
          if (!id) return;
          setComments((prev) =>
            prev.map((c) => (c.id === id ? { ...c, content: payload.content ?? c.content } : c)),
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
      const { comments: data } = await getComments(postId);
      if (Array.isArray(data)) {
        setComments(data);
        kvSetJSON(`comments:${postId}`, data);
        kvSetJSON(tsKey, Date.now());
        if (data.length > 0) {
          setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 150);
        }
      }
    } catch {}
    clearTimeout(safety);
    setIsLoading(false);
  };

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

  const handleSend = async () => {
    if (!text.trim() || !user?.id || !postId) return;
    playSendSound();
    // Strip dangerous invisible / control / bidi-override chars; keep
    // decorative Unicode + emoji. sanitizeUserText also trims.
    const body = sanitizeUserText(text);

    // Edit mode: update the existing comment, preserving any reply-quote prefix.
    if (editing) {
      const parsed = parseReply(editing.content || '');
      const newContent = parsed.replyUser
        ? encodeReply(parsed.replyUser, parsed.replyText || '', body, parsed.replyGif)
        : body;
      const editId = editing.id;
      setText('');
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
    setText('');
    setReplyTo(null);
    setIsSending(true);
    const { error } = await createComment(postId, user.id, sendText);
    if (!error) {
      const { comments: data } = await getComments(postId);
      setComments(data);
      kvSetJSON(`comments:${postId}`, data);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
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
      setText(parsed.body);
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
    if (!url || !user?.id || !postId) return;
    triggerHaptic('light');
    const content = `::gif::${url}`;
    setReplyTo(null);
    setIsSending(true);
    const { error } = await createComment(postId, user.id, content);
    if (!error) {
      const { comments: data } = await getComments(postId);
      setComments(data);
      kvSetJSON(`comments:${postId}`, data);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
    setIsSending(false);
  };

  // Send a single emoji as its own comment (long-press → Send in the panel).
  const sendEmojiComment = async (emoji: string) => {
    if (!emoji || !user?.id || !postId) return;
    triggerHaptic('light');
    playSendSound();
    const quoted = parseReply(replyTo?.content || '').body;
    const quotedGif = parseGif(quoted);
    const sendText = replyTo
      ? encodeReply(replyTo.profiles?.username || 'user', quotedGif ? '' : quoted, emoji, quotedGif || undefined)
      : emoji;
    setReplyTo(null);
    setIsSending(true);
    const { error } = await createComment(postId, user.id, sendText);
    if (!error) {
      const { comments: data } = await getComments(postId);
      setComments(data);
      kvSetJSON(`comments:${postId}`, data);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
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
    setText((prev) => prev + e);
    setRecentEmoji(pushRecentEmoji(e));
  }, []);

  const onBackspaceComposer = useCallback(() => {
    setText((prev) => deleteLastGrapheme(prev));
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
  const openImageViewer = useCallback((uri: string) => {
    setViewingImage({ uri });
  }, []);
  const renderComment = useCallback(
    ({ item }: { item: any }) => (
      <CommentRow item={item} onLongPress={openCommentMenu} onReply={startReply} onImagePress={openImageViewer} gifTracker={gifTracker} />
    ),
    [openCommentMenu, startReply, openImageViewer, gifTracker],
  );
  const keyExtractor = useCallback((item: any) => item.id, []);

  // Stable renderScrollComponent — the comments list is NON-inverted, so the
  // wrapper gets inverted={false}. KeyboardChatScrollView repositions the list
  // content on keyboard open/close natively (default "always" lift). A stable
  // useCallback reference is required so FlatList doesn't rebuild the scroll
  // view on every render.
  const renderScrollComponent = useCallback(
    (p: ScrollViewProps) => <ChatKeyboardScrollView {...p} inverted={false} />,
    [],
  );

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {/* Gradient fade header */}
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient colors={[bgColor, bgColor, bgTransparent]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
          <Pressable onPress={() => router.back()}>
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="body" weight="bold">{t('comments.title')}</Text>
          <View style={{ width: 24 }} />
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
            renderItem={renderComment}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerContentHeight, paddingBottom: 80 + insets.bottom }}
            showsVerticalScrollIndicator={false}
            onScroll={onCommentsScroll}
            scrollEventThrottle={64}
            onViewableItemsChanged={onCommentsViewable}
            viewabilityConfig={commentsViewabilityConfig}
            ListHeaderComponent={postData ? (() => {
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
            })() : null}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 40 }}>
                <RNText style={{ fontSize: 32 }} allowFontScaling={false}>💬</RNText>
                <Text variant="body" color={theme.colors.text.tertiary} style={{ marginTop: 8 }}>{t('comments.empty')}</Text>
              </View>
            }
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
          colors={[bgTransparent, bgColor + 'B3', bgColor]}
          locations={[0, 0.45, 1]}
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: insets.bottom + 120 }}
        />

        {/* Input area — manually keyboard-stuck via `barWrapStyle`
            (translateY = -max(keyboardHeight, panelHeight)) so the emoji/GIF
            media panel lift folds into a monotonic max() with no handoff jump,
            exactly like the chat composer. The input row has no solid
            backgroundColor: the fade above supplies the darkening so the
            composer floats over content like the other chats. */}
        <Reanimated.View style={[{ position: 'absolute', left: 0, right: 0, bottom: 0 }, barWrapStyle]}>
          {editing ? (
            <View style={[{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 12, overflow: 'hidden' }, glassActive ? null : { backgroundColor: theme.colors.background.elevated, borderWidth: 1, borderColor: theme.colors.border.light }]}>
              {glassActive ? <GlassBg borderRadius={12} glassStyle="regular" interactive={false} colorScheme={theme.isDark ? 'dark' : 'light'} tintColor={theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)'} /> : null}
              <View style={{ width: 3, height: 30, borderRadius: 2, backgroundColor: theme.colors.accent.primary, marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} numberOfLines={1} style={{ fontSize: 12 }}>{t('comments.editing')}</Text>
                <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{parseReply(editing.content || '').body}</Text>
              </View>
              <Pressable onPress={() => { setEditing(null); setText(''); }} hitSlop={8} style={{ padding: 4 }}>
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
                <TextInput
                  ref={inputRef}
                  value={text}
                  onChangeText={setText}
                  placeholder={t('comments.placeholder')}
                  placeholderTextColor={theme.colors.text.tertiary}
                  style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20, alignSelf: 'center' }}
                  multiline
                  autoCorrect={false}
                  autoComplete="off"
                  spellCheck={false}
                  textAlignVertical="center"
                  onContentSizeChange={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); }}
                  // Captures keyboard-to-first-frame latency for the
                  // comments composer. Free when the perf monitor is off
                  // (singleton early-returns on the disabled flag).
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
                <TextInput
                  ref={inputRef}
                  value={text}
                  onChangeText={setText}
                  placeholder={t('comments.placeholder')}
                  placeholderTextColor={theme.colors.text.tertiary}
                  style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20, alignSelf: 'center' }}
                  multiline
                  autoCorrect={false}
                  autoComplete="off"
                  spellCheck={false}
                  textAlignVertical="center"
                  onContentSizeChange={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); }}
                  // Captures keyboard-to-first-frame latency for the
                  // comments composer. Free when the perf monitor is off
                  // (singleton early-returns on the disabled flag).
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
            {glassActive && !text.trim() ? (
              <Pressable onPress={handleSend} disabled={isSending} style={{ marginLeft: 10, borderRadius: 20 }}>
                <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name={editing ? 'check' : 'send'} size={16} color={theme.colors.text.tertiary} />
                </NativeGlassView>
              </Pressable>
            ) : (
              <Pressable onPress={handleSend} disabled={!text.trim() || isSending} style={{ marginLeft: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: text.trim() ? theme.colors.accent.primary : theme.colors.background.elevated, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name={editing ? 'check' : 'send'} size={16} color={text.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
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
                labels={{ gif: t('media.tab.gif'), emoji: t('media.tab.emoji'), copy: t('media.action.copy'), send: t('media.action.send') }}
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

        {/* Fullscreen Image Viewer — mirrors the profile-screen viewer. Black
            backdrop, glass-aware close button top-right, contain-fit image, and
            a horizontal pager for multi-image posts starting on the tapped one.
            Tapping the backdrop (or any letterboxed area) closes it. */}
        <Modal visible={!!viewingImage} transparent animationType="fade" onRequestClose={() => setViewingImage(null)} statusBarTranslucent>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' }}>
            {/* Image — full width, contain-fit. Multi-image posts get a paged
                horizontal scroll starting at the tapped index. */}
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              {viewingImage && (
                viewingImage.images && viewingImage.images.length > 1 ? (
                  <ScrollView
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    style={{ flex: 1 }}
                    contentOffset={{ x: (viewingImage.index || 0) * SCREEN_WIDTH, y: 0 }}
                  >
                    {viewingImage.images.map((imgUri, idx) => (
                      <Pressable key={idx} onPress={() => setViewingImage(null)} style={{ width: SCREEN_WIDTH, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                        <CachedImage uri={imgUri} style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH }} resizeMode="contain" />
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : (
                  <Pressable onPress={() => setViewingImage(null)} style={{ flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center' }}>
                    <CachedImage uri={viewingImage.uri} style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH }} resizeMode="contain" />
                  </Pressable>
                )
              )}
            </View>
            {/* Close (X) — top-right, respects safe-area insets. Liquid glass when active. */}
            <View style={{ position: 'absolute', top: insets.top + 12, right: 16, zIndex: 10 }}>
              {glassActive ? (
                <Pressable onPress={() => setViewingImage(null)} style={{ borderRadius: 18 }}>
                  <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="x" size={20} color="#FFFFFF" />
                  </NativeGlassView>
                </Pressable>
              ) : (
                <Pressable onPress={() => setViewingImage(null)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="x" size={20} color="#FFFFFF" />
                </Pressable>
              )}
            </View>
          </View>
        </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
});
