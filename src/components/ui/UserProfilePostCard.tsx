import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { CachedImage } from './CachedImage';
import { VerifiedBadge } from './VerifiedBadge';
import { UserBadge } from './UserBadge';
import { FormattedText } from './FormattedText';
import { LinkPreview } from './LinkPreview';
import { SwipeablePostCard } from './SwipeablePostCard';
import { extractFirstUrl } from '../../services/linkPreview';
import { triggerHaptic } from '../../utils/haptics';
import { formatTimeAgo } from '../../utils/mockData';
import { useT } from '../../i18n/store';
import { perfMonitor } from '../../services/perfMonitor';
import { useSettingsStore } from '../../store/settingsStore';

interface UserProfilePostCardProps {
  post: any;
  authorName: string;
  authorUsername: string;
  authorEmoji: string;
  authorVerified?: boolean;
  authorBadge?: string | null;
  authorId: string;
  onLongPress: (enrichedPost: any) => void;
  onImagePress: (uri: string, postId: string, allImages: string[]) => void;
}

// Static style atoms — same rationale as ProfilePostCard. Layout-only
// values live here; theme-dependent overrides are still applied as a
// thin memoed object below.
const styles = StyleSheet.create({
  container: { flexDirection: 'row', borderRadius: 28, padding: 10, marginBottom: 12, borderWidth: 1, overflow: 'hidden' },
  thumbWrap: { width: 100, height: 100, borderRadius: 20, overflow: 'hidden' },
  thumbSingle: { width: 100, height: 100 },
  thumbRow: { flexDirection: 'row', width: 100, height: 100 },
  thumbHalf: { width: 49, height: 100 },
  thumbHalfCol: { width: 49, height: 100 },
  thumbQuarter: { width: 49, height: 49 },
  thumbGrid4: { flexDirection: 'row', flexWrap: 'wrap', width: 100, height: 100 },
  spacerH: { width: 2 },
  spacerV: { height: 2 },
  repostBadge: { position: 'absolute', top: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 2 },
  repostThumb: { width: 100, height: 100, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  repostLabel: { fontSize: 9, marginTop: 4 },
  rightCol: { flex: 1, justifyContent: 'center' },
  rightColMarginWide: { marginLeft: 14 },
  rightColMarginNarrow: { marginLeft: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  authorName: { flexShrink: 1 },
  timeText: { fontSize: 10, flexShrink: 0 },
  repostFromRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  repostFromText: { fontSize: 10, flexShrink: 1 },
  bodyText: { fontSize: 12, marginBottom: 6 },
  linkWrap: { marginBottom: 6 },
  metaRow: { flexDirection: 'row', gap: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 11 },
});

// Memoized post card for the user-profile screen (`app/profile/[id].tsx`).
// Mirrors the inline JSX that previously lived in that screen so the visual
// identity (emoji-less variant, repost overlay icon) stays exactly the same.
// Memoized by id + the fields that actually drive the card's visuals so
// scrolling/list re-renders no longer rebuild every card.
function UserProfilePostCardBase({
  post,
  authorName,
  authorUsername,
  authorEmoji,
  authorVerified,
  authorBadge,
  authorId,
  onLongPress,
  onImagePress,
}: UserProfilePostCardProps) {
  const theme = useTheme();
  const t = useT();

  // Mount-time diagnostic — captures render→commit latency on the JS thread.
  // Surfaces as `mount UserProfilePostCard <ms>` in the perf monitor's event
  // log so SLOW frames on profile screens have actionable context. The
  // setting check runs once at commit, not on every render — keeps this
  // ~free in production for users who turned the bubble off.
  const renderStart = Date.now();
  useEffect(() => {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    perfMonitor.mark('mount UserProfilePostCard', Date.now() - renderStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Defer the LinkPreview block past the first paint. The critical-path
  // content (avatar, name, body text, counters) appears immediately;
  // the link preview pops in one frame later so it doesn't compete
  // with the next FlatList batch.
  const [deferred, setDeferred] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setDeferred(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const postImages: string[] = useMemo(() => {
    if (post.imageUrls && post.imageUrls.length > 0) return post.imageUrls;
    if (post.imageUrl) return [post.imageUrl];
    return [];
  }, [post.imageUrls, post.imageUrl]);
  const hasImage = postImages.length > 0;
  const isRepostPost = !!post.isRepost;
  const origPost = post.originalPost;
  const content = post.content || origPost?.content || '';
  // Skip URL extraction when the post has an image (cover already shown)
  // and defer it past first paint to keep the regex off the critical path.
  const link = useMemo(
    () => (!hasImage && deferred ? extractFirstUrl(content) : null),
    [hasImage, deferred, content],
  );
  const timeAgo = useMemo(() => formatTimeAgo(post.createdAt), [post.createdAt]);

  // Theme-dependent style overrides, batched.
  const themedContainer = useMemo(
    () => ({
      // Transparent — same approach as PostCard on the feed: card content
      // sits directly on the screen background with only a hairline border
      // for separation. Matches what the user expects on profile screens.
      backgroundColor: 'transparent',
      borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    }),
    [theme.isDark],
  );
  const themedRepostBg = useMemo(
    () => ({ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }),
    [theme.isDark],
  );

  // Enrich the post with author info before bubbling up to the menu, matching
  // the prior inline behavior in app/profile/[id].tsx.
  const enrichLongPress = useCallback(() => {
    triggerHaptic('medium');
    onLongPress({
      ...post,
      authorName,
      authorUsername,
      authorEmoji,
      authorVerified,
      authorBadge,
      authorId,
    });
  }, [post, authorName, authorUsername, authorEmoji, authorVerified, authorBadge, authorId, onLongPress]);

  return (
    <SwipeablePostCard>
      <Pressable
        onPress={() => router.push({ pathname: '/comments/[id]', params: { id: post.id } })}
        onLongPress={enrichLongPress}
        delayLongPress={400}
        style={[styles.container, themedContainer]}
      >
        {/* Left: Image grid thumbnail */}
        {hasImage ? (
          <Pressable onPress={() => onImagePress(postImages[0], post.id, postImages)}>
            <View style={styles.thumbWrap}>
              {postImages.length === 1 ? (
                <CachedImage uri={postImages[0]} style={styles.thumbSingle} resizeMode="cover" />
              ) : postImages.length === 2 ? (
                <View style={styles.thumbRow}>
                  <CachedImage uri={postImages[0]} style={styles.thumbHalf} resizeMode="cover" />
                  <View style={styles.spacerH} />
                  <CachedImage uri={postImages[1]} style={styles.thumbHalf} resizeMode="cover" />
                </View>
              ) : postImages.length === 3 ? (
                <View style={styles.thumbRow}>
                  <CachedImage uri={postImages[0]} style={styles.thumbHalf} resizeMode="cover" />
                  <View style={styles.spacerH} />
                  <View style={styles.thumbHalfCol}>
                    <CachedImage uri={postImages[1]} style={styles.thumbQuarter} resizeMode="cover" />
                    <View style={styles.spacerV} />
                    <CachedImage uri={postImages[2]} style={styles.thumbQuarter} resizeMode="cover" />
                  </View>
                </View>
              ) : (
                <View style={styles.thumbGrid4}>
                  {postImages.slice(0, 4).map((imgUri: string, idx: number) => (
                    <CachedImage key={idx} uri={imgUri} style={{ width: 49, height: 49, marginRight: idx % 2 === 0 ? 2 : 0, marginBottom: idx < 2 ? 2 : 0 }} resizeMode="cover" />
                  ))}
                </View>
              )}
              {isRepostPost && (
                <View style={styles.repostBadge}>
                  <Feather name="repeat" size={8} color="#FFFFFF" />
                </View>
              )}
            </View>
          </Pressable>
        ) : isRepostPost ? (
          <View style={[styles.repostThumb, themedRepostBg]}>
            <Feather name="repeat" size={24} color={theme.colors.text.tertiary} />
            <Text variant="caption" color={theme.colors.text.tertiary} style={styles.repostLabel}>{t('post.repost_label')}</Text>
          </View>
        ) : null}

        {/* Right: Info */}
        <View style={[styles.rightCol, (hasImage || isRepostPost) ? styles.rightColMarginWide : styles.rightColMarginNarrow]}>
          <View style={styles.headerRow}>
            <Avatar emoji={authorEmoji} size="xs" />
            <Text variant="caption" weight="semibold" numberOfLines={1} style={styles.authorName}>{authorName}</Text>
            {authorVerified && <VerifiedBadge size={11} />}
            {authorBadge && <UserBadge badge={authorBadge} size="sm" />}
            <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={styles.timeText}>· {timeAgo}</Text>
          </View>
          {isRepostPost && origPost && (
            <View style={styles.repostFromRow}>
              <Feather name="repeat" size={10} color={theme.colors.accent.primary} />
              <Text variant="caption" color={theme.colors.accent.primary} numberOfLines={1} style={styles.repostFromText}>{t('post.reposted_from', undefined, { name: origPost.authorName })}</Text>
            </View>
          )}
          {content ? (
            <FormattedText style={styles.bodyText} color={theme.colors.text.secondary}>
              {content}
            </FormattedText>
          ) : null}
          {/* Link preview when the post has no image (Telegram-style, instant from cache) */}
          {link ? (
            <Pressable onLongPress={enrichLongPress} delayLongPress={400} style={styles.linkWrap}>
              <LinkPreview url={link} static />
            </Pressable>
          ) : null}
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Feather name="heart" size={12} color={theme.colors.text.tertiary} />
              <Text variant="caption" color={theme.colors.text.tertiary} style={styles.metaText}>{post.likesCount}</Text>
            </View>
            <View style={styles.metaItem}>
              <Feather name="message-circle" size={12} color={theme.colors.text.tertiary} />
              <Text variant="caption" color={theme.colors.text.tertiary} style={styles.metaText}>{post.commentsCount}</Text>
            </View>
          </View>
        </View>
      </Pressable>
    </SwipeablePostCard>
  );
}

export const UserProfilePostCard = memo(UserProfilePostCardBase, (prev, next) =>
  prev.post.id === next.post.id &&
  prev.post.content === next.post.content &&
  prev.post.likesCount === next.post.likesCount &&
  prev.post.commentsCount === next.post.commentsCount &&
  prev.post.imageUrl === next.post.imageUrl &&
  prev.post.imageUrls === next.post.imageUrls &&
  prev.authorName === next.authorName &&
  prev.authorUsername === next.authorUsername &&
  prev.authorEmoji === next.authorEmoji &&
  prev.authorVerified === next.authorVerified &&
  prev.authorBadge === next.authorBadge &&
  prev.authorId === next.authorId &&
  prev.onLongPress === next.onLongPress &&
  prev.onImagePress === next.onImagePress
);
