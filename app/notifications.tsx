import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Pressable, ViewStyle, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../src/theme';
import { Text, Avatar } from '../src/components/ui';
import { VerifiedBadge } from '../src/components/ui/VerifiedBadge';
import { apiGet } from '../src/services/apiClient';
import { useAuthStore } from '../src/store';
import { kvGetJSONSync, kvSetJSON } from '../src/services/kvStore';
import { useNotificationsBadge } from '../src/store/notificationsBadgeStore';
import { formatTimeAgo } from '../src/utils/mockData';
import { triggerHaptic } from '../src/utils/haptics';
import { useT } from '../src/i18n/store';

// Notification type — derived from base tables (likes / comments / follows).
// We don't have a dedicated server `notifications` table; instead we reduce
// the user's incoming events into a uniform feed on the client. This keeps
// the schema simple and side-steps an extra write path on every interaction.
type Kind = 'like' | 'comment' | 'follow';
interface Notification {
  id: string;          // synthetic — `${kind}:${pk}`
  kind: Kind;
  ts: string;          // ISO created_at
  // Actor (who liked / replied / followed) — always !== current user.
  actorId: string;
  actorName: string;
  actorUsername: string;
  actorEmoji: string;
  actorVerified?: boolean;
  // For like/comment: the post that received it. For follow: undefined.
  postId?: string;
  postPreview?: string;
  // For comment: the comment text.
  commentText?: string;
}

const CACHE_KEY = '@san:notifications';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — fast tab switches stay instant

// Comment storage uses two markers that we need to strip out of preview text:
//   `::gif::{url}`            — GIF comment (full content is just the URL)
//   `::re::{base64}::{body}`  — reply comment (real text comes after second `::`)
const GIF_TOKEN = '::gif::';
const REPLY_TOKEN = '::re::';

function b64decode(s: string): string {
  try { return typeof global.atob === 'function' ? decodeURIComponent(escape(global.atob(s))) : ''; }
  catch { return ''; }
}

// Pull the gif URL out of a reply marker's base64 metadata blob, if present.
function replyGifUrl(text: string): string {
  if (!text.startsWith(REPLY_TOKEN)) return '';
  const idx = text.indexOf('::', REPLY_TOKEN.length);
  if (idx <= 0) return '';
  try { return (JSON.parse(b64decode(text.slice(REPLY_TOKEN.length, idx))) || {}).gif || ''; }
  catch { return ''; }
}

function stripMediaTokens(text: string): string {
  if (!text) return '';
  let s = text;
  if (s.startsWith(REPLY_TOKEN)) {
    // Skip past the base64 metadata block to the actual reply body. If the
    // closing "::" terminator is missing (e.g. the stored content was
    // truncated mid-blob), there is no readable body — return empty rather
    // than leaking the raw "::re::eyJ1..." marker.
    const idx = s.indexOf('::', REPLY_TOKEN.length);
    s = idx > 0 ? s.slice(idx + 2) : '';
  } else if (s.startsWith('::re:')) {
    // Legacy single-colon reply format: ::re:<b64>:<b64>[:<b64>]::<body>
    const idx = s.indexOf('::', 5);
    s = idx > 0 ? s.slice(idx + 2) : '';
  }
  if (s.startsWith(GIF_TOKEN)) return '';
  // Safety net: any residual leading marker must never reach the UI.
  if (s.trimStart().startsWith('::')) return '';
  return s.trim();
}

interface MediaTag { icon: string; labelKey: string }

function mediaTagsFor(text: string): MediaTag[] {
  if (!text) return [];
  const tags: MediaTag[] = [];
  // Reply context first — most informative tag for "X replied" notifications.
  if (text.startsWith(REPLY_TOKEN) || text.startsWith('::re:')) tags.push({ icon: 'corner-up-left', labelKey: 'notifications.tag_reply' });
  // GIF can be a standalone ::gif:: comment OR embedded inside a reply's
  // quoted metadata — detect both so a reply-to-a-gif reads "Ответ · Гифка".
  if (text.includes(GIF_TOKEN) || replyGifUrl(text)) tags.push({ icon: 'image', labelKey: 'notifications.tag_gif' });
  // After stripping the marker tokens, look for a bare URL in the residual
  // text — covers comments that pasted a YouTube/article link, an image
  // URL, or a sticker host.
  const stripped = stripMediaTokens(text);
  const urlMatch = stripped.match(/https?:\/\/\S+/i);
  if (urlMatch) {
    const url = urlMatch[0].toLowerCase();
    if (/\.(jpg|jpeg|png|webp|heic|heif)(\?|$)/i.test(url)) tags.push({ icon: 'camera', labelKey: 'notifications.tag_photo' });
    else if (/\.gif(\?|$)/i.test(url) || url.includes('giphy.com') || url.includes('tenor.com')) {
      if (!tags.some((tg) => tg.labelKey === 'notifications.tag_gif')) tags.push({ icon: 'image', labelKey: 'notifications.tag_gif' });
    }
    else tags.push({ icon: 'link', labelKey: 'notifications.tag_link' });
  }
  return tags;
}

export default function NotificationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const userId = useAuthStore((s) => s.user?.id);

  // Hydrate from MMKV synchronously so the first paint isn't blank — the
  // network refetch runs in the background and updates the list.
  const [items, setItems] = useState<Notification[]>(() => {
    try {
      const c = kvGetJSONSync<{ ts: number; data: Notification[] } | null>(CACHE_KEY, null);
      if (c && Array.isArray(c.data)) return c.data;
    } catch {}
    return [];
  });
  const [loading, setLoading] = useState(items.length === 0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      // Phase 5: one Worker round-trip instead of three Supabase calls.
      // The endpoint synthesises likes/comments/follows targeting the
      // current authed user and returns them with the actor profile
      // already embedded.
      const { data, error } = await apiGet<{
        likes: any[];
        comments: any[];
        follows: any[];
      }>('/v1/notifications');
      if (error || !data) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // The post-preview map is built client-side. We only need it for
      // the rows attached to the user's own posts, which the Worker
      // already filtered down to — but the post text isn't in the
      // notifications payload (the screen only shows a short preview),
      // so we re-fetch the matching post bodies from the entity store
      // when present and leave them blank otherwise. The entity store
      // already holds every post the user has rendered recently.
      const { useEntityStore } = await import('../src/store');
      const postsById = useEntityStore.getState().posts;
      const previewFor = (postId: string | undefined): string | undefined => {
        if (!postId) return undefined;
        const p = postsById[postId];
        if (!p) return undefined;
        return (p.content || '').replace(/^::[a-z]+::[^:]+::/i, '').trim().slice(0, 80);
      };

      const profileOf = (row: any) => Array.isArray(row?.profiles) ? row.profiles[0] : row?.profiles;

      const merged: Notification[] = [];
      for (const r of data.likes || []) {
        const p = profileOf(r);
        if (!p) continue;
        merged.push({
          id: `like:${p.id}:${r.post_id}:${r.created_at}`,
          kind: 'like',
          ts: r.created_at,
          actorId: p.id,
          actorName: p.display_name || 'User',
          actorUsername: p.username || 'user',
          actorEmoji: p.emoji || '😊',
          actorVerified: !!p.is_verified,
          postId: r.post_id,
          postPreview: previewFor(r.post_id),
        });
      }
      for (const r of data.comments || []) {
        const p = profileOf(r);
        if (!p) continue;
        merged.push({
          id: `comment:${r.id}`,
          kind: 'comment',
          ts: r.created_at,
          actorId: p.id,
          actorName: p.display_name || 'User',
          actorUsername: p.username || 'user',
          actorEmoji: p.emoji || '😊',
          actorVerified: !!p.is_verified,
          postId: r.post_id,
          postPreview: previewFor(r.post_id),
          // Keep the FULL content here — stripMediaTokens must see the closing
          // "::" terminator of a reply marker, which a premature slice would
          // chop off (the cause of the raw "::re::eyJ1..." leak). The row
          // strips + display-slices for rendering.
          commentText: (r.content || ''),
        });
      }
      for (const r of data.follows || []) {
        const p = profileOf(r);
        if (!p) continue;
        merged.push({
          id: `follow:${p.id}:${r.created_at}`,
          kind: 'follow',
          ts: r.created_at,
          actorId: p.id,
          actorName: p.display_name || 'User',
          actorUsername: p.username || 'user',
          actorEmoji: p.emoji || '😊',
          actorVerified: !!p.is_verified,
        });
      }

      // Newest first.
      merged.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      const trimmed = merged.slice(0, 150);
      setItems(trimmed);
      try { kvSetJSON(CACHE_KEY, { ts: Date.now(), data: trimmed }); } catch {}
      useNotificationsBadge.getState().markAllSeen();
    } catch {
      // Network error — keep whatever was on screen.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  // Initial load: ALWAYS refetch in the background on mount. The TTL gate
  // only controlled the loading-spinner UI; data freshness shouldn't be
  // gated by it. Cache is shown instantly; fresh data overwrites it once it
  // arrives. Fixes the "notifications come with big delay" complaint.
  useEffect(() => {
    if (!userId) return;
    // Items already hydrated synchronously from MMKV in the useState init —
    // suppress the spinner if we have anything to show while the refresh runs.
    if (items.length > 0) setLoading(false);
    load();
  }, [userId, load]);

  // Mark anything currently cached as seen the moment the screen mounts.
  // Without this, the home-tab badge would keep showing the count until the
  // background refetch finishes.
  useEffect(() => {
    useNotificationsBadge.getState().markAllSeen();
  }, []);

  const onRefresh = useCallback(() => {
    triggerHaptic('light');
    setRefreshing(true);
    load();
  }, [load]);

  const containerStyle: ViewStyle = { flex: 1, backgroundColor: theme.colors.background.primary };
  const bgColor = theme.colors.background.primary;
  const bgTransparent = theme.colors.background.primary + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  const renderItem = useCallback(({ item }: { item: Notification }) => {
    return <NotificationRow item={item} theme={theme} />;
  }, [theme]);

  const keyExtractor = useCallback((n: Notification) => n.id, []);

  return (
    <View style={containerStyle}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, height: headerGradientHeight }} pointerEvents="box-none">
        <LinearGradient colors={[bgColor, bgColor, bgTransparent]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.lg, paddingTop: insets.top + 8, paddingBottom: 8, position: 'relative' }}
          pointerEvents="auto"
        >
          <Pressable onPress={() => router.back()} style={{ position: 'absolute', left: theme.spacing.lg, top: insets.top + 8 }}>
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="subheading" weight="bold">{t('notifications.title')}</Text>
        </View>
      </View>

      {loading && items.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="small" color={theme.colors.accent.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 }}>
          <Feather name="bell" size={48} color={theme.colors.text.tertiary} />
          <Text variant="body" color={theme.colors.text.tertiary} style={{ marginTop: theme.spacing.base, textAlign: 'center' }}>
            {t('notifications.empty')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ paddingTop: headerContentHeight + 4, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent.primary} progressViewOffset={headerContentHeight} />}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={8}
          maxToRenderPerBatch={4}
          windowSize={6}
        />
      )}
    </View>
  );
}

const NotificationRow = React.memo(function NotificationRow({ item, theme }: { item: Notification; theme: any }) {
  const t = useT();
  const onPress = () => {
    triggerHaptic('light');
    if (item.kind === 'follow') {
      router.push({ pathname: '/profile/[id]', params: { id: item.actorId } });
    } else if (item.postId) {
      router.push({ pathname: '/comments/[id]', params: { id: item.postId } });
    }
  };

  const verb =
    item.kind === 'like' ? t('notifications.verb.like')
    : item.kind === 'comment' ? t('notifications.verb.comment')
    : t('notifications.verb.follow');
  const icon =
    item.kind === 'like' ? 'heart'
    : item.kind === 'comment' ? 'message-circle'
    : 'user-plus';
  const accent =
    item.kind === 'like' ? '#FF3B30'
    : item.kind === 'comment' ? '#0A84FF'
    : '#30D158';

  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}
    >
      {/* Avatar with a small kind icon overlaid bottom-right. */}
      <View style={{ width: 44, height: 44 }}>
        <Avatar emoji={item.actorEmoji} size="md" />
        <View style={{ position: 'absolute', right: -4, bottom: -4, width: 20, height: 20, borderRadius: 10, backgroundColor: accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: theme.colors.background.primary }}>
          <Feather name={icon as any} size={11} color="#FFFFFF" />
        </View>
      </View>
      <View style={{ flex: 1, marginTop: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          <Text variant="caption" weight="semibold" style={{ fontSize: 13 }}>{item.actorName}</Text>
          {item.actorVerified ? <VerifiedBadge size={11} /> : null}
          <Text variant="caption" color={theme.colors.text.secondary} style={{ fontSize: 13 }}>{verb}</Text>
        </View>
        {(() => {
          // Comment text often contains a GIF/image/link instead of (or in
          // addition to) plain words. Detect those so the preview shows a
          // human "🎁 Гифка" / "🔗 Ссылка" / "📷 Фото" hint instead of a
          // raw URL — matches what the user sees inside the comments thread.
          const ct = item.commentText || '';
          const stripped = stripMediaTokens(ct).slice(0, 140);
          const tags = mediaTagsFor(ct);
          if (ct) {
            const showText = stripped.trim().length > 0 ? stripped : null;
            return (
              <View style={{ marginTop: 3, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {tags.map((tag) => (
                  <View key={tag.labelKey} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}>
                    <Feather name={tag.icon as any} size={10} color={theme.colors.text.tertiary} />
                    <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10 }}>{t(tag.labelKey)}</Text>
                  </View>
                ))}
                {showText ? (
                  <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={2} style={{ fontSize: 12, flexShrink: 1 }}>«{showText}»</Text>
                ) : null}
              </View>
            );
          }
          if (item.postPreview) {
            return <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 12, marginTop: 3 }}>{item.postPreview}</Text>;
          }
          return null;
        })()}
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11, marginTop: 3 }}>{formatTimeAgo(item.ts)}</Text>
      </View>
    </Pressable>
  );
}, (prev, next) =>
  prev.item.id === next.item.id &&
  prev.item.commentText === next.item.commentText &&
  prev.theme.isDark === next.theme.isDark
);
