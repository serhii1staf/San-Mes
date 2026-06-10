import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Pressable, ViewStyle, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../src/theme';
import { Text, Avatar } from '../src/components/ui';
import { VerifiedBadge } from '../src/components/ui/VerifiedBadge';
import { supabase } from '../src/lib/supabase';
import { useAuthStore } from '../src/store';
import { kvGetJSONSync, kvSetJSON } from '../src/services/kvStore';
import { formatTimeAgo } from '../src/utils/mockData';
import { triggerHaptic } from '../src/utils/haptics';

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

export default function NotificationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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
      // 1) All MY posts (we only notify on activity targeting my own content).
      const { data: myPosts } = await supabase
        .from('posts')
        .select('id, content')
        .eq('author_id', userId)
        .order('created_at', { ascending: false })
        .limit(200);
      const myPostIds = (myPosts || []).map((p: any) => p.id);
      const postPreviewById = new Map<string, string>();
      for (const p of myPosts || []) {
        const text = (p.content || '').replace(/^::[a-z]+::[^:]+::/i, '').trim();
        postPreviewById.set(p.id, text.slice(0, 80));
      }

      // 2) Run the three event queries in parallel — separate plans, no joins,
      // each cheap on its own. We cap each batch to avoid pulling huge lists
      // for very active users.
      const [likesRes, commentsRes, followsRes] = await Promise.all([
        myPostIds.length > 0
          ? supabase.from('likes')
              .select('user_id, post_id, created_at, profiles:user_id (id, username, display_name, emoji, is_verified)')
              .in('post_id', myPostIds)
              .neq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(80)
          : Promise.resolve({ data: [] }) as any,
        myPostIds.length > 0
          ? supabase.from('comments')
              .select('id, author_id, post_id, content, created_at, profiles:author_id (id, username, display_name, emoji, is_verified)')
              .in('post_id', myPostIds)
              .neq('author_id', userId)
              .order('created_at', { ascending: false })
              .limit(80)
          : Promise.resolve({ data: [] }) as any,
        supabase.from('follows')
          .select('follower_id, created_at, profiles:follower_id (id, username, display_name, emoji, is_verified)')
          .eq('following_id', userId)
          .neq('follower_id', userId)
          .order('created_at', { ascending: false })
          .limit(80),
      ]);

      const profileOf = (row: any) => Array.isArray(row?.profiles) ? row.profiles[0] : row?.profiles;

      const merged: Notification[] = [];
      for (const r of (likesRes.data || [])) {
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
          postPreview: postPreviewById.get(r.post_id),
        });
      }
      for (const r of (commentsRes.data || [])) {
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
          postPreview: postPreviewById.get(r.post_id),
          commentText: (r.content || '').slice(0, 120),
        });
      }
      for (const r of (followsRes.data || [])) {
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
      // Cap the list — older events are noise.
      const trimmed = merged.slice(0, 150);
      setItems(trimmed);
      try { kvSetJSON(CACHE_KEY, { ts: Date.now(), data: trimmed }); } catch {}
    } catch {
      // Network error — keep whatever was on screen.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  // Initial load with TTL gate so re-entering the screen doesn't always re-hit.
  useEffect(() => {
    if (!userId) return;
    try {
      const c = kvGetJSONSync<{ ts: number } | null>(CACHE_KEY, null);
      const fresh = c && Date.now() - c.ts < CACHE_TTL_MS;
      if (fresh) { setLoading(false); return; }
    } catch {}
    load();
  }, [userId, load]);

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
          <Text variant="subheading" weight="bold">Уведомления</Text>
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
            Нет уведомлений
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
          initialNumToRender={14}
          maxToRenderPerBatch={10}
          windowSize={9}
        />
      )}
    </View>
  );
}

const NotificationRow = React.memo(function NotificationRow({ item, theme }: { item: Notification; theme: any }) {
  const onPress = () => {
    triggerHaptic('light');
    if (item.kind === 'follow') {
      router.push({ pathname: '/profile/[id]', params: { id: item.actorId } });
    } else if (item.postId) {
      router.push({ pathname: '/comments/[id]', params: { id: item.postId } });
    }
  };

  const verb =
    item.kind === 'like' ? 'оценил(а) ваш пост'
    : item.kind === 'comment' ? 'прокомментировал(а) ваш пост'
    : 'подписался(ась) на вас';
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
        {item.commentText ? (
          <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={2} style={{ fontSize: 12, marginTop: 3 }}>«{item.commentText}»</Text>
        ) : item.postPreview ? (
          <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 12, marginTop: 3 }}>{item.postPreview}</Text>
        ) : null}
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11, marginTop: 3 }}>{formatTimeAgo(item.ts)}</Text>
      </View>
    </Pressable>
  );
}, (prev, next) =>
  prev.item.id === next.item.id &&
  prev.item.commentText === next.item.commentText &&
  prev.theme.isDark === next.theme.isDark
);
