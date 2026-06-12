import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, FlatList, TextInput, Pressable, Platform, ActivityIndicator, StyleSheet, Text as RNText, Modal, Alert, LayoutAnimation, UIManager } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
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

export default function CommentsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const inputPadStyle = useAnimatedStyle(() => {
    const open = Math.abs(keyboardHeight.value) > 1;
    return { paddingBottom: open ? 8 : (insets.bottom > 0 ? insets.bottom : 14) };
  });
  const { id: postId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const [comments, setComments] = useState<any[]>(() => {
    try { return postId ? kvGetJSONSync<any[]>(`comments:${postId}`, []) : []; } catch { return []; }
  });
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(() => {
    try { return !(postId && kvGetJSONSync<any[]>(`comments:${postId}`, []).length > 0); } catch { return true; }
  });
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

  useEffect(() => {
    loadComments();
    // Load post from entity store (cached) — no network request needed
    if (postId) {
      const { useEntityStore } = require('../../src/store');
      const cached = useEntityStore.getState().posts[postId];
      if (cached) {
        // Get author profile from store
        const profile = useEntityStore.getState().profiles[cached.author_id];
        setPostData({ ...cached, profiles: profile || null });
      } else {
        loadPost();
      }
    }
  }, [postId]);

  const loadPost = async () => {
    if (!postId) return;
    const { supabase } = await import('../../src/lib/supabase');
    const { data } = await supabase.from('posts').select('*, profiles:author_id (id, display_name, username, emoji, badge, is_verified)').eq('id', postId).single();
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
    // Don't show the spinner if we already painted cached comments.
    if (comments.length === 0) setIsLoading(true);
    // Safety: never let the spinner spin forever if the request stalls.
    const safety = setTimeout(() => setIsLoading(false), 8000);
    try {
      const { comments: data } = await getComments(postId);
      if (Array.isArray(data)) {
        setComments(data);
        kvSetJSON(`comments:${postId}`, data);
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
    (async () => {
      const { useEntityStore } = require('../../src/store');
      const cachedOrig = useEntityStore.getState().posts[info.originalPostId!];
      if (cachedOrig) {
        const prof = useEntityStore.getState().profiles[cachedOrig.author_id];
        if (!cancelled) setRepostOriginal({ ...cachedOrig, profiles: prof || null });
        return;
      }
      // Don't hit the network when offline
      if (!useConnectivityStore.getState().isOnline) return;
      const { supabase } = await import('../../src/lib/supabase');
      const { data } = await supabase.from('posts').select('*, profiles:author_id (id, display_name, username, emoji, badge, is_verified)').eq('id', info.originalPostId).single();
      if (!cancelled && data) setRepostOriginal(data);
    })();
    return () => { cancelled = true; };
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

  const startReply = (comment: any) => {
    closeMenu();
    setEditing(null);
    setReplyTo(comment);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

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
          <FlatList
            ref={listRef}
            data={comments}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerContentHeight, paddingBottom: 80 + insets.bottom }}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={true}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={9}
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
            renderItem={({ item }) => {
              const parsed = parseReply(item.content || '');
              return (
              <Pressable onLongPress={() => openCommentMenu(item)} delayLongPress={300} style={{ flexDirection: 'row', marginBottom: 16 }}>
                <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: item.profiles?.id || item.author_id } })} onLongPress={() => openCommentMenu(item)} delayLongPress={300}>
                  <Avatar emoji={item.profiles?.emoji || '😊'} size="sm" />
                </Pressable>
                <View style={{ marginLeft: 10, flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{item.profiles?.display_name || 'User'}</Text>
                    {item.profiles?.is_verified && <VerifiedBadge size={10} />}
                    {item.profiles?.badge && <UserBadge badge={item.profiles.badge} size="sm" />}
                    <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ marginLeft: 4, flexShrink: 0 }}>{formatTime(item.created_at)}</Text>
                  </View>
                  {/* Quoted comment this one replies to */}
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
                  {parseGif(parsed.body) ? null : <FormattedText style={{ marginTop: 3, fontSize: 14 }}>{parsed.body}</FormattedText>}
                  {(() => {
                    const gif = parseGif(parsed.body);
                    if (gif) {
                      return (
                        <Pressable onLongPress={() => openCommentMenu(item)} delayLongPress={300} style={{ marginTop: 6 }}>
                          <CachedImage uri={gif} style={{ width: 160, height: 160, borderRadius: 14, backgroundColor: theme.colors.background.secondary }} resizeMode="cover" />
                        </Pressable>
                      );
                    }
                    const link = extractFirstUrl(parsed.body);
                    return link ? (
                      <Pressable onLongPress={() => openCommentMenu(item)} delayLongPress={300} style={{ marginTop: 6 }}>
                        <LinkPreview url={link} onLongPress={() => openCommentMenu(item)} delayLongPress={300} />
                      </Pressable>
                    ) : null;
                  })()}
                  {/* Reply action */}
                  <Pressable onPress={() => startReply(item)} onLongPress={() => openCommentMenu(item)} delayLongPress={300} hitSlop={6} style={{ marginTop: 4, alignSelf: 'flex-start' }}>
                    <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{t('comments.reply')}</Text>
                  </Pressable>
                </View>
              </Pressable>
              );
            }}
          />
        )}

        {/* Input area — sticks to keyboard (smooth, no lag) */}
        <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
          {editing ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6, backgroundColor: bgColor }}>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6, backgroundColor: bgColor }}>
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
          <Reanimated.View style={[{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 8, backgroundColor: bgColor }, inputPadStyle]}>
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
              />
              {/* GIF button inside the input, right side */}
              <Pressable onPress={() => setGifPickerVisible(true)} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, marginBottom: 2, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.colors.accent.primary + '18' }}>
                <RNText style={{ fontSize: 11, fontWeight: '800', color: theme.colors.accent.primary }}>GIF</RNText>
              </Pressable>
            </View>
            <Pressable onPress={handleSend} disabled={!text.trim() || isSending} style={{ marginLeft: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: text.trim() ? theme.colors.accent.primary : theme.colors.background.elevated, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name={editing ? 'check' : 'send'} size={16} color={text.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
            </Pressable>
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
