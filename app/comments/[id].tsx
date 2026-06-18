import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, FlatList, TextInput, Pressable, Platform, ActivityIndicator, StyleSheet, Text as RNText, Modal, Alert, LayoutAnimation, UIManager, InteractionManager } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation, useKeyboardHandler } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
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
import { CachedImage } from '../../src/components/ui/CachedImage';
import { CommentContextMenu, CommentAction } from '../../src/components/ui/CommentContextMenu';
import { SlideUpSheet } from '../../src/components/ui/SlideUpSheet';
import { GiphyPicker } from '../../src/components/ui/GiphyPicker';
import { parseGif } from '../../src/services/giphy';
import { kvGetJSONSync, kvSetJSON } from '../../src/services/kvStore';
import { useAuthStore, useConnectivityStore } from '../../src/store';
import { getComments, createComment, updateComment, deleteComment, isRepost, parseImageUrls } from '../../src/lib/supabase';
import { triggerHaptic } from '../../src/utils/haptics';
import { playSendSound } from '../../src/utils/sounds';
import { showToast } from '../../src/store/toastStore';
import { useT } from '../../src/i18n/store';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useBrowserStore } from '../../src/store/browserStore';
import { useIsBlocked } from '../../src/store/blockedUsersStore';
import { BlockedContentPlaceholder } from '../../src/components/feed/BlockedContentPlaceholder';

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
type CommentRowProps = {
  item: any;
  onLongPress: (c: any) => void;
  onReply: (c: any) => void;
};

const CommentRow = React.memo(function CommentRow({ item, onLongPress, onReply }: CommentRowProps) {
  const theme = useTheme();
  const t = useT();
  // Block-aware short circuit: comments authored by a blocked user are
  // swapped for the inline placeholder so the rest of the thread stays
  // intact. Tapping the placeholder offers an unblock confirmation — the
  // user can also unblock from the messages-tab Blocked section.
  const authorId: string | undefined = item.profiles?.id || item.author_id;
  const isAuthorBlocked = useIsBlocked(authorId);
  if (isAuthorBlocked && authorId) {
    return (
      <BlockedContentPlaceholder
        blockedUserId={authorId}
        username={item.profiles?.username}
        variant="inline"
      />
    );
  }

  const parsed = parseReply(item.content || '');
  const gif = parseGif(parsed.body);
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
          <Pressable onLongPress={() => onLongPress(item)} delayLongPress={300} style={{ marginTop: 6 }}>
            <CachedImage uri={gif} style={{ width: 160, height: 160, borderRadius: 14, backgroundColor: theme.colors.background.secondary }} resizeMode="cover" />
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
  prev.onReply === next.onReply,
);

export default function CommentsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
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
  const inputPadStyle = useAnimatedStyle(() => {
    const open = Math.abs(keyboardHeight.value) > 1;
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
  const stickyOffset = React.useMemo(
    () => ({ closed: 0, opened: stickyOpenedOffset }),
    [stickyOpenedOffset],
  );
  // Shift the comment list upward by the keyboard height so the very last
  // comment stays visible above the input bar when the user taps it. We
  // drive translateY from `useKeyboardHandler.onMove` — the same low-level
  // event source `KeyboardStickyView` uses — so the list lifts in lock-step
  // with the input bar instead of snapping when the JS thread is briefly
  // busy. `onInteractive` covers the iOS interactive-dismiss drag so the
  // list rides the finger with the keyboard and we don't get a phantom
  // strip where the last comment used to sit.
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
      },
    },
    [],
  );
  const listShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: listShiftY.value }],
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
  const [gifPickerVisible, setGifPickerVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList>(null);

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
    const body = text.trim();

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

  // Long-press menu opener — wraps the guard with the haptic + edge cases that
  // belong here (we still want haptic feedback only for accepted opens).
  const openCommentMenu = useCallback((c: any) => {
    triggerHaptic('medium');
    openMenu(c);
  }, [openMenu]);
  const closeCommentMenu = closeMenu;

  // Stable callbacks for the FlatList — see CommentRow for why this matters.
  const renderComment = useCallback(
    ({ item }: { item: any }) => (
      <CommentRow item={item} onLongPress={openCommentMenu} onReply={startReply} />
    ),
    [openCommentMenu, startReply],
  );
  const keyExtractor = useCallback((item: any) => item.id, []);

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
          <FlatList
            ref={listRef}
            data={comments}
            keyExtractor={keyExtractor}
            renderItem={renderComment}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerContentHeight, paddingBottom: 80 + insets.bottom }}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={true}
            initialNumToRender={6}
            maxToRenderPerBatch={4}
            windowSize={6}
            updateCellsBatchingPeriod={80}
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
                  if (imgs.length === 1) return <CachedImage uri={imgs[0]} style={{ width: '100%', height: 200, borderRadius: 12, marginBottom: 8 }} resizeMode="cover" />;
                  return (
                    <FlatList
                      data={imgs}
                      horizontal
                      keyExtractor={(u, i) => u + i}
                      showsHorizontalScrollIndicator={false}
                      style={{ marginBottom: 8 }}
                      renderItem={({ item }) => <CachedImage uri={item} style={{ width: 200, height: 200, borderRadius: 12, marginRight: 8 }} resizeMode="cover" />}
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
                      {origImages.length === 1 && <CachedImage uri={origImages[0]} style={{ width: '100%', height: 160, borderRadius: 10, marginTop: 6 }} resizeMode="cover" />}
                      {origImages.length > 1 && (
                        <FlatList
                          data={origImages}
                          horizontal
                          keyExtractor={(u, i) => u + i}
                          showsHorizontalScrollIndicator={false}
                          style={{ marginTop: 6 }}
                          renderItem={({ item }) => <CachedImage uri={item} style={{ width: 150, height: 150, borderRadius: 10, marginRight: 6 }} resizeMode="cover" />}
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

        {/* Input area — sticks to keyboard (smooth, no lag). The input row has
            no solid backgroundColor: the fade above supplies the darkening so
            the composer floats over content like the other chats. */}
        <KeyboardStickyView offset={stickyOffset} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
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
                  textAlignVertical="center"
                  onContentSizeChange={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); }}
                  // Captures keyboard-to-first-frame latency for the
                  // comments composer. Free when the perf monitor is off
                  // (singleton early-returns on the disabled flag).
                  onFocus={() => perfMonitor.markInputFocus('comments')}
                />
                {/* GIF button inside the input, right side */}
                <Pressable onPress={() => setGifPickerVisible(true)} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, marginBottom: 2, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.colors.accent.primary + '18' }}>
                  <RNText style={{ fontSize: 11, fontWeight: '800', color: theme.colors.accent.primary }}>GIF</RNText>
                </Pressable>
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
                  textAlignVertical="center"
                  onContentSizeChange={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); }}
                  // Captures keyboard-to-first-frame latency for the
                  // comments composer. Free when the perf monitor is off
                  // (singleton early-returns on the disabled flag).
                  onFocus={() => perfMonitor.markInputFocus('comments')}
                />
                {/* GIF button inside the input, right side */}
                <Pressable onPress={() => setGifPickerVisible(true)} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, marginBottom: 2, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.colors.accent.primary + '18' }}>
                  <RNText style={{ fontSize: 11, fontWeight: '800', color: theme.colors.accent.primary }}>GIF</RNText>
                </Pressable>
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
        </KeyboardStickyView>

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

        {/* GIF picker (GIPHY) */}
        <GiphyPicker visible={gifPickerVisible} onClose={() => setGifPickerVisible(false)} onSelect={sendGifComment} />
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
});
