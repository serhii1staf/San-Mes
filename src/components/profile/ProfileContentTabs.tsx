/**
 * The tabs under a profile header: «Публикации», «Медиа», «Ответы».
 *
 * Publishing lives here and nowhere else: there is no feed. Visitors read someone's posts on their
 * profile and open a post to comment on it; the owner writes a new post from the «Публикации» tab.
 *
 * Rendered inside the profile's ScrollView as plain views (one page of 30 at most), not as a list
 * component: the profile screens are guarded to stay list-free. What keeps opening a profile cheap
 * is WHEN the cards mount, not the list type: nothing below the tab strip is built during the
 * open transition, then cards are added a few per frame (see `useProgressiveCount`). Before this,
 * a profile with a full cached page mounted all thirty cards (text formatting, link previews,
 * thumbnails) in the same commit as the push animation, which is the lag seen on opening a profile.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Animated, InteractionManager, Pressable, StyleSheet, View, useWindowDimensions, ActivityIndicator, type LayoutChangeEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { CachedImage } from '../ui/CachedImage';
import { GlassBg, useLiquidGlassActive } from '../ui/LiquidGlass';
import { triggerHaptic } from '../../utils/haptics';
import { useT } from '../../i18n/store';
import { useShortAgo } from '../../utils/shortAgo';
import { deletePost, parseImageUrls } from '../../lib/supabase';
import { showToast } from '../../store/toastStore';
import { useIsBlocked } from '../../store/blockedUsersStore';
import { useProfileAppearanceStore } from '../../store/profileAppearanceStore';
import { stripMarkers } from '../../utils/previewText';
import { ProfilePostCard } from './ProfilePostCard';
import {
  invalidateProfilePosts,
  useProfilePosts,
  useProfileReplies,
  type ProfilePost,
  type ProfileReply,
} from '../../services/profilePosts';

type TabKey = 'posts' | 'media' | 'replies';

export interface ProfileAuthor {
  name: string;
  emoji: string;
  verified?: boolean;
  badge?: string | null;
}

const isAnimated = (u: string) => /\.gif(\?|$)/i.test(u) || /giphy\.com|tenor\.com/i.test(u);

function openPost(id: string) {
  triggerHaptic('light');
  router.push({ pathname: '/comments/[id]', params: { id } });
}

/**
 * How many of `total` items to render: the first `first` at once, then `step` more per frame once
 * the screen's open transition has finished.
 *
 * The first batch used to wait for the transition too, so every open painted an empty profile and
 * then filled it in waves, which read as "the data reloads every time" even though the posts come
 * from the memory/disk cache. The first screenful is now in the very first frame; only the cards
 * below the fold are added progressively, where nobody sees them arrive.
 */
function useProgressiveCount(total: number, first = 5, step = 5): number {
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(first);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => handle.cancel();
  }, []);
  useEffect(() => {
    if (!ready || count >= total) return;
    const raf = requestAnimationFrame(() => setCount((c) => Math.min(total, c + step)));
    return () => cancelAnimationFrame(raf);
  }, [ready, count, total, step]);
  return Math.min(count, total);
}

/**
 * Pins the tab strip under the status bar once the header has scrolled away.
 *
 * `top` is where the strip stops, from the top of the screen; `bottomPad` is the padding the screen
 * adds under the tabs. Both screens drive it from the same native-driver scroll value as the header.
 */
export interface ProfileStickyTabs {
  scrollY: Animated.Value;
  top: number;
  bottomPad: number;
}

const TabStrip = memo(function TabStrip({ value, onChange }: { value: TabKey; onChange: (k: TabKey) => void }) {
  const theme = useTheme();
  const t = useT();
  const glassActive = useLiquidGlassActive();
  const scheme = theme.isDark ? 'dark' : 'light';
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'posts', label: t('profile.publications') },
    { key: 'media', label: t('profile.media') },
    { key: 'replies', label: t('profile.replies') },
  ];
  return (
    <View style={[styles.strip, glassActive ? null : { backgroundColor: theme.colors.background.elevated }]}>
      {/* Liquid glass behind the whole strip where the material exists (iOS 26 with glass on);
          the flat elevated surface everywhere else. */}
      {glassActive ? <GlassBg borderRadius={20} colorScheme={scheme} /> : null}
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            onPress={() => { if (!active) { triggerHaptic('selection'); onChange(tab.key); } }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[
              styles.stripItem,
              active && !glassActive ? { backgroundColor: theme.colors.accent.primary + '26' } : null,
            ]}
          >
            {active && glassActive ? (
              <GlassBg borderRadius={16} glassStyle="regular" colorScheme={scheme} tintColor={theme.colors.accent.primary + '59'} interactive={false} />
            ) : null}
            <Text variant="caption" weight={active ? 'bold' : 'medium'} color={active ? theme.colors.accent.primary : theme.colors.text.secondary} style={{ fontSize: 14 }}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

const ReplyRow = memo(function ReplyRow({ reply }: { reply: ProfileReply }) {
  const theme = useTheme();
  const t = useT();
  const ago = useShortAgo();
  const parentAuthor = reply.posts?.profiles?.display_name || reply.posts?.profiles?.username || '';
  const parentText = stripMarkers(reply.posts?.content || '') || (reply.posts?.image_url ? t('chat.photo') : '');
  const body = stripMarkers(reply.content) || reply.content;
  return (
    <Pressable
      onPress={() => openPost(reply.post_id)}
      style={({ pressed }) => [
        styles.replyCard,
        { borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      {reply.posts ? (
        <View style={[styles.quote, { borderLeftColor: theme.colors.accent.primary, backgroundColor: theme.colors.accent.primary + '12' }]}>
          <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} numberOfLines={1}>
            {parentAuthor || t('profile.in_reply_to')}
          </Text>
          {parentText ? (
            <Text variant="caption" color={theme.colors.text.secondary} numberOfLines={2}>{parentText}</Text>
          ) : null}
        </View>
      ) : null}
      <Text variant="body" numberOfLines={6} style={{ marginTop: reply.posts ? 8 : 0, fontSize: 14, lineHeight: 20 }}>{body}</Text>
      <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 6, fontSize: 11 }}>{ago(reply.created_at)}</Text>
    </Pressable>
  );
});

function Empty({ icon, text }: { icon: React.ComponentProps<typeof Feather>['name']; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Feather name={icon} size={26} color={theme.colors.text.tertiary} />
      <Text variant="caption" color={theme.colors.text.tertiary} align="center">{text}</Text>
    </View>
  );
}

export function ProfileContentTabs({ profileId, isOwn, author, sticky }: { profileId: string; isOwn: boolean; author: ProfileAuthor; sticky?: ProfileStickyTabs }) {
  const theme = useTheme();
  const t = useT();
  const { width, height: winHeight } = useWindowDimensions();
  const [tab, setTab] = useState<TabKey>('posts');

  // ── Sticky strip ──────────────────────────────────────────────────────────
  // The strip is the first child of the wrap, so the wrap's y in the scroll content is the strip's
  // y. Past `stickAt` the strip is translated down by exactly the extra scroll, so it stays put
  // under the status bar while the posts slide beneath it (native driver, no re-render).
  //
  // The wrap's minHeight is what stops the page: with little or no content the scroll ends exactly
  // when the strip reaches the top, instead of scrolling the tabs away into empty space. It also
  // keeps the translated strip inside the wrap's bounds; Android does not deliver touches to a
  // child drawn outside its parent.
  const [stripY, setStripY] = useState<number | null>(null);
  const onWrapLayout = useCallback((e: LayoutChangeEvent) => {
    const y = e.nativeEvent.layout.y;
    setStripY((prev) => (prev !== null && Math.abs(prev - y) < 0.5 ? prev : y));
  }, []);
  const scrollY = sticky?.scrollY;
  const stickyTop = sticky?.top ?? 0;
  const stickAt = stripY === null ? null : Math.max(0, stripY - stickyTop);
  const stickTranslate = useMemo(
    () => (scrollY && stickAt !== null
      ? scrollY.interpolate({ inputRange: [stickAt, stickAt + 1], outputRange: [0, 1], extrapolateLeft: 'clamp', extrapolateRight: 'extend' })
      : null),
    [scrollY, stickAt],
  );
  const scrimOpacity = useMemo(
    () => (scrollY && stickAt !== null
      ? scrollY.interpolate({ inputRange: [Math.max(0, stickAt - 18), stickAt], outputRange: [0, 1], extrapolate: 'clamp' })
      : null),
    [scrollY, stickAt],
  );
  const wrapMinHeight = sticky ? Math.max(0, winHeight - sticky.top - sticky.bottomPad) : undefined;
  const bg = theme.colors.background.primary;
  const blocked = useIsBlocked(isOwn ? '' : profileId);
  const postEmoji = useProfileAppearanceStore((s) => s.postEmoji);
  const { posts, loading } = useProfilePosts(blocked ? undefined : profileId);
  const { replies, loading: repliesLoading } = useProfileReplies(tab === 'replies' && !blocked ? profileId : undefined);
  const contentWidth = width - 32;

  const shownPosts = useProgressiveCount(posts.length);
  const shownReplies = useProgressiveCount(replies.length);

  const media = useMemo(() => {
    const out: { url: string; postId: string }[] = [];
    for (const p of posts) {
      for (const u of parseImageUrls(p.image_url)) {
        if (!isAnimated(u)) out.push({ url: u, postId: p.id });
      }
    }
    return out;
  }, [posts]);
  const shownMedia = useProgressiveCount(media.length, 12, 12);

  const compose = useCallback(() => {
    triggerHaptic('light');
    router.push('/post/new' as any);
  }, []);

  const onPressPost = useCallback((p: ProfilePost) => openPost(p.id), []);
  const onLongPressPost = useCallback((p: ProfilePost) => {
    triggerHaptic('medium');
    Alert.alert(t('profile.delete_post_title'), t('profile.delete_post_msg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const { error } = await deletePost(p.id, p.author_id);
          if (error) { showToast(error, 'alert-circle'); return; }
          invalidateProfilePosts(p.author_id);
          showToast(t('toast.post_deleted'), 'check');
        },
      },
    ]);
  }, [t]);

  if (blocked) {
    return (
      <View style={[styles.wrap, wrapMinHeight ? { minHeight: wrapMinHeight } : null]}>
        <Empty icon="slash" text={t('profile.blocked_content')} />
      </View>
    );
  }

  const cell = Math.floor((contentWidth - 3 * 2) / 3);
  const hairline = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  return (
    <View style={[styles.wrap, wrapMinHeight ? { minHeight: wrapMinHeight } : null]} onLayout={sticky ? onWrapLayout : undefined}>
      <Animated.View style={[styles.stickyLayer, stickTranslate ? { transform: [{ translateY: stickTranslate }] } : null]}>
        {/* Fades the posts out under the status bar once the strip is pinned. A sibling of the
            strip, never its ancestor: an alpha on a glass view's ancestor drops the glass. */}
        {sticky && scrimOpacity ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.scrim, { top: -stickyTop - 1, height: stickyTop + 26, opacity: scrimOpacity }]}
          >
            <LinearGradient colors={[bg, bg, bg + '00']} locations={[0, 0.7, 1]} style={StyleSheet.absoluteFill} />
          </Animated.View>
        ) : null}
        <TabStrip value={tab} onChange={setTab} />
      </Animated.View>

      {tab === 'posts' ? (
        <View style={{ marginTop: 12 }}>
          {isOwn ? (
            <Pressable
              onPress={compose}
              accessibilityRole="button"
              style={({ pressed }) => [styles.compose, { borderColor: hairline }, pressed ? { opacity: 0.85 } : null]}
            >
              <View style={[styles.composeIcon, { backgroundColor: theme.colors.accent.primary }]}>
                <Feather name="edit-3" size={16} color="#FFFFFF" />
              </View>
              <Text variant="body" color={theme.colors.text.secondary}>{t('post.compose_prompt')}</Text>
              <View style={{ flex: 1 }} />
              <Feather name="image" size={18} color={theme.colors.text.tertiary} />
            </Pressable>
          ) : null}
          {loading && posts.length === 0 ? (
            <ActivityIndicator style={{ marginTop: 28 }} color={theme.colors.text.tertiary} />
          ) : posts.length === 0 ? (
            <Empty icon="file-text" text={t('profile.no_posts')} />
          ) : (
            posts.slice(0, shownPosts).map((p) => (
              <ProfilePostCard
                key={p.id}
                post={p}
                authorName={author.name}
                authorEmoji={author.emoji}
                authorVerified={author.verified}
                authorBadge={author.badge}
                postEmoji={postEmoji}
                onPress={onPressPost}
                onLongPress={isOwn ? onLongPressPost : undefined}
              />
            ))
          )}
        </View>
      ) : null}

      {tab === 'media' ? (
        <View style={{ marginTop: 12 }}>
          {loading && posts.length === 0 ? (
            <ActivityIndicator style={{ marginTop: 28 }} color={theme.colors.text.tertiary} />
          ) : media.length === 0 ? (
            <Empty icon="image" text={t('profile.media_posts_empty')} />
          ) : (
            <View style={styles.mediaGrid}>
              {media.slice(0, shownMedia).map((m) => (
                <Pressable key={m.url} onPress={() => openPost(m.postId)} style={[styles.mediaCell, { width: cell, height: cell, backgroundColor: theme.colors.background.elevated }]}>
                  <CachedImage uri={m.url} style={{ width: cell, height: cell }} resizeMode="cover" proxyWidth={cell * 2} />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {tab === 'replies' ? (
        <View style={{ marginTop: 12 }}>
          {repliesLoading && replies.length === 0 ? (
            <ActivityIndicator style={{ marginTop: 28 }} color={theme.colors.text.tertiary} />
          ) : replies.length === 0 ? (
            <Empty icon="message-square" text={t('profile.replies_empty')} />
          ) : (
            replies.slice(0, shownReplies).map((r) => <ReplyRow key={r.id} reply={r} />)
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, marginTop: 18 },
  // Above the cards that slide under it while pinned.
  stickyLayer: { zIndex: 10 },
  scrim: { position: 'absolute', left: -16, right: -16 },
  strip: { flexDirection: 'row', borderRadius: 20, padding: 4, gap: 4, overflow: 'hidden' },
  stripItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 16, overflow: 'hidden' },
  compose: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 28,
    borderWidth: 1,
    marginBottom: 12,
  },
  composeIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  replyCard: { borderRadius: 24, borderWidth: 1, padding: 12, marginBottom: 12 },
  quote: { borderLeftWidth: 3, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  mediaCell: { borderRadius: 10, overflow: 'hidden' },
});
