/**
 * The tabs under a profile header: «Публикации», «Медиа», «Ответы».
 *
 * Publishing lives here and nowhere else: there is no feed. Visitors read someone's posts on their
 * profile and open a post to comment on it; the owner writes a new post from the «Публикации» tab.
 *
 * Rendered inside the profile's ScrollView as plain views (one page of 30 at most), not as a list
 * component: the profile screens are guarded to stay list-free so a profile push never pays for a
 * virtualised list's mount. Only the active tab is built, and «Ответы» is not even fetched until it
 * is opened.
 */
import React, { memo, useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View, useWindowDimensions, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { CachedImage } from '../ui/CachedImage';
import { FormattedText } from '../ui/FormattedText';
import { triggerHaptic } from '../../utils/haptics';
import { useT } from '../../i18n/store';
import { useShortAgo } from '../../utils/shortAgo';
import { deletePost, parseImageUrls } from '../../lib/supabase';
import { showToast } from '../../store/toastStore';
import { useIsBlocked } from '../../store/blockedUsersStore';
import { stripMarkers } from '../../utils/previewText';
import {
  invalidateProfilePosts,
  useProfilePosts,
  useProfileReplies,
  type ProfilePost,
  type ProfileReply,
} from '../../services/profilePosts';

type TabKey = 'posts' | 'media' | 'replies';

const isAnimated = (u: string) => /\.gif(\?|$)/i.test(u) || /giphy\.com|tenor\.com/i.test(u);

function openPost(id: string) {
  triggerHaptic('light');
  router.push({ pathname: '/comments/[id]', params: { id } });
}

const TabStrip = memo(function TabStrip({ value, onChange }: { value: TabKey; onChange: (k: TabKey) => void }) {
  const theme = useTheme();
  const t = useT();
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'posts', label: t('profile.publications') },
    { key: 'media', label: t('profile.media') },
    { key: 'replies', label: t('profile.replies') },
  ];
  return (
    <View style={[styles.strip, { backgroundColor: theme.colors.background.elevated }]}>
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            onPress={() => { if (!active) { triggerHaptic('selection'); onChange(tab.key); } }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.stripItem, active ? { backgroundColor: theme.colors.accent.primary + '26' } : null]}
          >
            <Text variant="caption" weight={active ? 'bold' : 'medium'} color={active ? theme.colors.accent.primary : theme.colors.text.secondary} style={{ fontSize: 14 }}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

const PostImages = memo(function PostImages({ urls, width }: { urls: string[]; width: number }) {
  const theme = useTheme();
  if (urls.length === 0) return null;
  if (urls.length === 1) {
    return (
      <CachedImage
        uri={urls[0]}
        style={[styles.image, { width, height: Math.round(width * 0.66), backgroundColor: theme.colors.background.secondary }]}
        resizeMode="cover"
        proxyWidth={Math.round(width * 2)}
      />
    );
  }
  const gap = 4;
  const cell = Math.floor((width - gap) / 2);
  return (
    <View style={[styles.imageGrid, { gap }]}>
      {urls.slice(0, 4).map((u) => (
        <CachedImage
          key={u}
          uri={u}
          style={[styles.image, { width: cell, height: cell, backgroundColor: theme.colors.background.secondary }]}
          resizeMode="cover"
          proxyWidth={cell * 2}
        />
      ))}
    </View>
  );
});

const PostCard = memo(function PostCard({ post, isOwn, width }: { post: ProfilePost; isOwn: boolean; width: number }) {
  const theme = useTheme();
  const t = useT();
  const ago = useShortAgo();
  const images = useMemo(() => parseImageUrls(post.image_url), [post.image_url]);
  const onLongPress = isOwn
    ? () => {
        triggerHaptic('medium');
        Alert.alert(t('profile.delete_post_title'), t('profile.delete_post_msg'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: async () => {
              const { error } = await deletePost(post.id, post.author_id);
              if (error) { showToast(error, 'alert-circle'); return; }
              invalidateProfilePosts(post.author_id);
              showToast(t('toast.post_deleted'), 'check');
            },
          },
        ]);
      }
    : undefined;
  return (
    <Pressable
      onPress={() => openPost(post.id)}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.colors.background.elevated },
        pressed ? { opacity: 0.92 } : null,
      ]}
    >
      {post.content ? (
        <FormattedText style={{ fontSize: 15, lineHeight: 21, color: theme.colors.text.primary }} numberOfLines={10}>
          {post.content}
        </FormattedText>
      ) : null}
      {images.length > 0 ? <View style={{ marginTop: post.content ? 10 : 0 }}><PostImages urls={images} width={width - 28} /></View> : null}
      <View style={styles.cardFooter}>
        <Text variant="caption" color={theme.colors.text.tertiary}>{ago(post.created_at)}</Text>
        <View style={{ flex: 1 }} />
        <View style={styles.counter}>
          <Feather name="heart" size={14} color={theme.colors.text.tertiary} />
          <Text variant="caption" color={theme.colors.text.tertiary}>{post.likes_count || 0}</Text>
        </View>
        <View style={styles.counter}>
          <Feather name="message-circle" size={14} color={theme.colors.text.tertiary} />
          <Text variant="caption" color={theme.colors.text.tertiary}>{post.comments_count || 0}</Text>
        </View>
      </View>
    </Pressable>
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
      style={({ pressed }) => [styles.card, { backgroundColor: theme.colors.background.elevated }, pressed ? { opacity: 0.92 } : null]}
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
      <Text variant="body" numberOfLines={6} style={{ marginTop: reply.posts ? 8 : 0, lineHeight: 21 }}>{body}</Text>
      <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 8 }}>{ago(reply.created_at)}</Text>
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

export function ProfileContentTabs({ profileId, isOwn }: { profileId: string; isOwn: boolean }) {
  const theme = useTheme();
  const t = useT();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<TabKey>('posts');
  const blocked = useIsBlocked(isOwn ? '' : profileId);
  const { posts, loading } = useProfilePosts(blocked ? undefined : profileId);
  const { replies, loading: repliesLoading } = useProfileReplies(tab === 'replies' && !blocked ? profileId : undefined);
  const contentWidth = width - 32;

  const media = useMemo(() => {
    const out: { url: string; postId: string }[] = [];
    for (const p of posts) {
      for (const u of parseImageUrls(p.image_url)) {
        if (!isAnimated(u)) out.push({ url: u, postId: p.id });
      }
    }
    return out;
  }, [posts]);

  const compose = useCallback(() => {
    triggerHaptic('light');
    router.push('/post/new' as any);
  }, []);

  if (blocked) {
    return (
      <View style={styles.wrap}>
        <Empty icon="slash" text={t('profile.blocked_content')} />
      </View>
    );
  }

  const cell = Math.floor((contentWidth - 3 * 2) / 3);

  return (
    <View style={styles.wrap}>
      <TabStrip value={tab} onChange={setTab} />

      {tab === 'posts' ? (
        <View style={{ marginTop: 12 }}>
          {isOwn ? (
            <Pressable
              onPress={compose}
              accessibilityRole="button"
              style={({ pressed }) => [styles.compose, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }, pressed ? { opacity: 0.85 } : null]}
            >
              <View style={[styles.composeIcon, { backgroundColor: theme.colors.accent.primary }]}>
                <Feather name="edit-3" size={16} color="#FFFFFF" />
              </View>
              <Text variant="body" color={theme.colors.text.secondary}>{t('post.compose_prompt')}</Text>
            </Pressable>
          ) : null}
          {loading && posts.length === 0 ? (
            <ActivityIndicator style={{ marginTop: 28 }} color={theme.colors.text.tertiary} />
          ) : posts.length === 0 ? (
            <Empty icon="file-text" text={t('profile.no_posts')} />
          ) : (
            posts.map((p) => <PostCard key={p.id} post={p} isOwn={isOwn} width={contentWidth} />)
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
              {media.map((m) => (
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
            replies.map((r) => <ReplyRow key={r.id} reply={r} />)
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, marginTop: 18 },
  strip: { flexDirection: 'row', borderRadius: 18, padding: 4, gap: 4 },
  stripItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 14 },
  compose: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  composeIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 20, padding: 14, marginBottom: 10 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  image: { borderRadius: 14 },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  quote: { borderLeftWidth: 3, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  mediaCell: { borderRadius: 10, overflow: 'hidden' },
});
