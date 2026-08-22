import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Pressable, ViewStyle, StyleSheet, SectionList, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { headerScrimHeights, SCRIM_LOCATIONS, topScrimColors } from '../src/theme/scrim';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../src/theme';
import { Text, Avatar } from '../src/components/ui';
import { VerifiedBadge } from '../src/components/ui/VerifiedBadge';
import { useAuthStore } from '../src/store';
import { kvGetJSONSync } from '../src/services/kvStore';
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

/** Which kinds the chip row can filter to. `all` is the default. */
type FilterKey = 'all' | Kind;

/** Height of the chip row. CONSTANT — the scrim above and the list padding below both derive from it. */
const FILTER_ROW_HEIGHT = 46;

/** How recent an event has to be to land in the raised "Highlights" section. */
const FEATURED_WINDOW_MS = 12 * 60 * 60 * 1000;

/** And how many of them at most, so Highlights stays a highlight rather than a second feed. */
const FEATURED_MAX = 3;

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
      // Phase 5: one Worker round-trip instead of three Supabase calls,
      // shared with the home-tab badge's background refresh so the cache
      // format never diverges. The helper fetches, normalises, and writes
      // the `@san:notifications` cache; here we mirror it into screen state
      // and mark everything seen (clears the bell badge).
      const { fetchAndCacheNotifications } = await import('../src/services/notificationsFeed');
      const items = await fetchAndCacheNotifications();
      if (items) {
        setItems(items);
        useNotificationsBadge.getState().markAllSeen();
      }
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
  const { content: headerContentHeight, gradient: headerGradientHeight } = headerScrimHeights(insets.top);
  // The chrome is now two rows: title, then the filter chips. The scrim spans BOTH and the
  // list's top padding matches it exactly — the same flush rule the rest of the app follows,
  // because a gradient that stops short of where content begins leaves a lit strip and one
  // that overshoots dims the content.
  const chromeHeight = headerGradientHeight + FILTER_ROW_HEIGHT;
  const listTopPadding = headerContentHeight + FILTER_ROW_HEIGHT;

  const [filter, setFilter] = useState<FilterKey>('all');

  const filters = useMemo<{ key: FilterKey; label: string }[]>(() => ([
    { key: 'all', label: t('notifications.filter.all') },
    { key: 'like', label: t('notifications.filter.likes') },
    { key: 'comment', label: t('notifications.filter.comments') },
    { key: 'follow', label: t('notifications.filter.follows') },
  ]), [t]);

  // ── Sections ────────────────────────────────────────────────────────────────
  //
  // "Highlights" is the freshest handful, drawn as raised cards; everything else falls into
  // calendar buckets as flat rows. An item appears in exactly one section — the calendar
  // buckets explicitly skip whatever Highlights already took, otherwise the newest events
  // would show up twice.
  const sections = useMemo(() => {
    const visible = filter === 'all' ? items : items.filter((n) => n.kind === filter);
    if (visible.length === 0) return [];

    const now = Date.now();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = startOfToday.getTime() - 86400000;

    const featured: Notification[] = [];
    for (const n of visible) {
      if (featured.length >= FEATURED_MAX) break;
      const age = now - new Date(n.ts).getTime();
      if (age >= 0 && age <= FEATURED_WINDOW_MS) featured.push(n);
    }
    const taken = new Set(featured.map((n) => n.id));

    const today: Notification[] = [];
    const yesterday: Notification[] = [];
    const earlier: Notification[] = [];
    for (const n of visible) {
      if (taken.has(n.id)) continue;
      const ms = new Date(n.ts).getTime();
      if (ms >= startOfToday.getTime()) today.push(n);
      else if (ms >= startOfYesterday) yesterday.push(n);
      else earlier.push(n);
    }

    const out: { key: string; title: string; featured: boolean; data: Notification[] }[] = [];
    if (featured.length) out.push({ key: 'featured', title: t('notifications.section.featured'), featured: true, data: featured });
    if (today.length) out.push({ key: 'today', title: t('notifications.section.today'), featured: false, data: today });
    if (yesterday.length) out.push({ key: 'yesterday', title: t('notifications.section.yesterday'), featured: false, data: yesterday });
    if (earlier.length) out.push({ key: 'earlier', title: t('notifications.section.earlier'), featured: false, data: earlier });
    return out;
  }, [items, filter, t]);

  const renderItem = useCallback(({ item, section }: { item: Notification; section: { featured: boolean } }) => (
    <NotificationRow item={item} theme={theme} featured={section.featured} />
  ), [theme]);

  const renderSectionHeader = useCallback(({ section }: { section: { title: string } }) => (
    <Text variant="subheading" weight="bold" style={{ paddingHorizontal: 16, marginTop: 18, marginBottom: 10 }}>
      {section.title}
    </Text>
  ), []);

  const keyExtractor = useCallback((n: Notification) => n.id, []);

  const contentStyle = useMemo(
    () => ({ paddingTop: listTopPadding, paddingBottom: insets.bottom + 24 }),
    [listTopPadding, insets.bottom],
  );

  const refreshControl = useMemo(() => (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent.primary} progressViewOffset={listTopPadding} />
  ), [refreshing, onRefresh, theme.colors.accent.primary, listTopPadding]);

  return (
    <View style={containerStyle}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, height: chromeHeight }} pointerEvents="box-none">
        <LinearGradient colors={topScrimColors(theme.isDark, bgColor)} locations={SCRIM_LOCATIONS} style={StyleSheet.absoluteFill} />
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.lg, paddingTop: insets.top + 8, paddingBottom: 8, position: 'relative' }}
          pointerEvents="auto"
        >
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ position: 'absolute', left: theme.spacing.lg, top: insets.top + 8 }}>
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="subheading" weight="bold">{t('notifications.title')}</Text>
        </View>
        {/* Filter chips. Horizontally scrollable so the row never wraps or truncates a label
            on a narrow screen. `Репосты` is deliberately absent: the feed is reduced on the
            client from likes / comments / follows (see the note on `Notification`), and there
            is no repost event source, so the chip would filter to permanently empty. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // `flexGrow: 1` + `justifyContent: center` centres the row while the chips are
          // narrower than the screen, and degrades to normal left-aligned scrolling once they
          // are not. Without `flexGrow` the content container hugs its children and
          // `justifyContent` has nothing to distribute, which is why the row sat against the
          // left edge while the title above it was centred.
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, gap: 8, alignItems: 'center' }}
          style={{ height: FILTER_ROW_HEIGHT }}
        >
          {filters.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => { triggerHaptic('selection'); setFilter(f.key); }}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 18,
                  // EVERY chip gets a fill, not just the selected one. Inactive chips were
                  // `transparent`, so they read as floating text over the scrim and the row
                  // looked half-broken — only the one you had tapped looked like a button.
                  // The active chip is now distinguished by being LIGHTER and by its border,
                  // which is a contrast difference rather than a presence difference.
                  backgroundColor: active
                    ? theme.colors.background.elevated
                    : theme.isDark
                      ? 'rgba(255,255,255,0.07)'
                      : 'rgba(0,0,0,0.05)',
                  borderWidth: 1,
                  borderColor: active ? theme.colors.border.medium : 'transparent',
                }}
              >
                <Text
                  variant="caption"
                  weight={active ? 'semibold' : 'regular'}
                  color={active ? theme.colors.text.primary : theme.colors.text.secondary}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading && items.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="small" color={theme.colors.accent.primary} />
        </View>
      ) : sections.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 }}>
          <Feather name="bell" size={48} color={theme.colors.text.tertiary} />
          <Text variant="body" color={theme.colors.text.tertiary} style={{ marginTop: theme.spacing.base, textAlign: 'center' }}>
            {t('notifications.empty')}
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={keyExtractor}
          renderItem={renderItem as any}
          renderSectionHeader={renderSectionHeader as any}
          // ── STICKY HEADERS OFF ────────────────────────────────────────────────
          //
          // On iOS `SectionList` sticks section headers by DEFAULT, and it sticks them to the
          // top of its own viewport — which is y=0 of the screen, underneath the absolutely
          // positioned title + chips chrome. So "Актуальное" / "Сегодня" pinned themselves
          // ABOVE the filter chips, on top of the header, instead of behaving like
          // subheadings of it.
          //
          // Two ways to fix that: keep them sticky and offset them by the chrome height, or
          // let them scroll. Scrolling is what the design shows and it is the honest reading
          // of what a section label is here — a divider between groups, not a persistent
          // control. An offset would also have to be re-derived every time the chrome changes
          // height, which is the kind of coupling that drifts.
          stickySectionHeadersEnabled={false}
          contentContainerStyle={contentStyle}
          refreshControl={refreshControl}
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

const NotificationRow = React.memo(function NotificationRow({ item, theme, featured }: { item: Notification; theme: any; featured: boolean }) {
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
      style={
        // Two presentations, one component. Highlights rows are raised cards; calendar rows
        // are flat. Only the container differs — the contents are identical, so the two can
        // never drift apart the way two separate row components would.
        featured
          ? {
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 12,
              marginHorizontal: 16,
              marginBottom: 10,
              padding: 14,
              borderRadius: 18,
              backgroundColor: theme.colors.background.elevated,
            }
          : { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12, gap: 12 }
      }
    >
      {/* Avatar with a small kind icon overlaid bottom-left, as in the design. */}
      <View style={{ width: 44, height: 44 }}>
        <Avatar emoji={item.actorEmoji} size="md" />
        <View style={{ position: 'absolute', left: -3, bottom: -3, width: 20, height: 20, borderRadius: 10, backgroundColor: theme.colors.background.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={icon as any} size={12} color={accent} />
        </View>
      </View>
      <View style={{ flex: 1 }}>
        {/* Name on its own line, then the action + relative time beneath it. The three used to
            share one wrapping row, so a long display name pushed the verb onto a second line
            and the timestamp onto a third. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text variant="body" weight="bold" numberOfLines={1} style={{ fontSize: 15, flexShrink: 1 }}>{item.actorName}</Text>
          {item.actorVerified ? <VerifiedBadge size={13} /> : null}
        </View>
        <Text variant="caption" color={theme.colors.text.secondary} numberOfLines={1} style={{ fontSize: 13, marginTop: 1 }}>
          {verb} · {formatTimeAgo(item.ts)}
        </Text>
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
            // Full-strength text, up to three lines: this is the post the event is ABOUT, and
            // it is the only thing that tells the user which post was liked. It used to be
            // tertiary-coloured and clamped to one line, which made it read as a caption.
            return <Text variant="caption" numberOfLines={3} style={{ fontSize: 13, marginTop: 6, lineHeight: 18 }}>{item.postPreview}</Text>;
          }
          return null;
        })()}
      </View>
    </Pressable>
  );
}, (prev, next) =>
  prev.item.id === next.item.id &&
  prev.item.commentText === next.item.commentText &&
  prev.featured === next.featured &&
  prev.theme.isDark === next.theme.isDark
);
