import React, { memo, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text, Avatar } from '../ui';
import { CachedImage } from '../ui/CachedImage';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { UserBadge } from '../ui/UserBadge';
import { FormattedText } from '../ui/FormattedText';
import { LinkPreview } from '../ui/LinkPreview';
import { EmojiPattern } from '../ui/EmojiPattern';
import { SwipeablePostCard } from '../ui/SwipeablePostCard';
import { extractFirstUrl } from '../../services/linkPreview';
import { triggerHaptic } from '../../utils/haptics';
import { formatTimeAgo } from '../../utils/mockData';
import { useT } from '../../i18n/store';
import { perfMonitor } from '../../services/perfMonitor';

interface ProfilePostCardProps {
  post: any;
  authorName: string;
  authorEmoji: string;
  authorVerified?: boolean;
  authorBadge?: string | null;
  shareText: string;
  postEmoji?: string;
  onLongPress: (post: any) => void;
  onImagePress: (uri: string, postId: string, allImages: string[]) => void;
}

// Static style atoms — hoisted out of render so RN's shadow-tree diff
// doesn't allocate + compare a fresh object identity per card on every
// commit. Theme-dependent values (background / border colors) are still
// applied as a thin override object built from `useMemo`.
//
// Each of the small inline styles below was previously re-allocated on
// every commit. With ~3 visible cards × 15+ inline objects each, every
// scroll batch built ~45 throwaway objects. Hoisting drops that to zero.
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
  repostFromTextSmall: { fontSize: 10 },
  bodyText: { fontSize: 12, marginBottom: 6 },
  linkWrap: { marginBottom: 6 },
  metaRow: { flexDirection: 'row', gap: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 11 },
});

// Memoized profile post card. Extracted + memoized so switching profile tabs (or
// re-rendering the screen) does NOT rebuild every card — only cards whose data
// actually changed re-render. This removes the freeze on the "Posts" tab.
function ProfilePostCardBase({ post, authorName, authorEmoji, authorVerified, authorBadge, postEmoji, onLongPress, onImagePress }: ProfilePostCardProps) {
  const theme = useTheme();
  const t = useT();

  // Mount-time diagnostic — captures render→commit latency on the JS thread.
  // Surfaces as `MOUNT ProfilePostCard <ms>` in the perf-monitor panel so
  // SLOW frames on the (tabs)/profile screen have actionable context. The
  // markScreenMount helper early-returns when the user has the perf bubble
  // disabled, so the cost is one boolean check + one call.
  const renderStart = Date.now();
  useEffect(() => {
    perfMonitor.markScreenMount('ProfilePostCard', Date.now() - renderStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Defer non-critical children (the LinkPreview block) past the first
  // paint. The critical-path content — avatar / name / body text /
  // counters — mounts immediately. The link preview pops in one frame
  // later so it doesn't compete with the next FlatList batch. This
  // halves the per-card work the FlatList sees on the first frame.
  const [deferred, setDeferred] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setDeferred(true));
    return () => cancelAnimationFrame(r);
  }, []);

  // Pull derived data through `useMemo` so re-renders (theme flip,
  // sibling updates) don't re-walk the prop object or re-run regexes.
  const origPost = post.originalPost;
  const isRepostPost = !!post.isRepost;
  const imgs = useMemo<string[]>(() => {
    if (post.imageUrls && post.imageUrls.length > 0) return post.imageUrls;
    if (post.imageUrl) return [post.imageUrl];
    if (origPost?.imageUrls && origPost.imageUrls.length > 0) return origPost.imageUrls;
    if (origPost?.imageUrl) return [origPost.imageUrl];
    return [];
  }, [post.imageUrls, post.imageUrl, origPost?.imageUrls, origPost?.imageUrl]);
  const hasImage = imgs.length > 0;
  const content = post.content || origPost?.content || '';
  // Skip the URL-extraction regex entirely when the post has an image
  // (the image is already the cover; the link preview would not show)
  // AND defer it past the first frame so it doesn't run on the
  // critical paint path.
  const link = useMemo(
    () => (!hasImage && deferred ? extractFirstUrl(content) : null),
    [hasImage, deferred, content],
  );
  const timeAgo = useMemo(() => formatTimeAgo(post.createdAt), [post.createdAt]);

  // Theme-dependent style overrides, batched into a single memoed
  // object so each card commits only ONE composite style array per
  // outer Pressable instead of inlining several object literals.
  const themedContainer = useMemo(
    () => ({
      // Transparent so cards blend with the screen background — matches the
      // home feed where PostCard has no per-card surface either. Border is
      // a soft hairline to keep visual separation between cards.
      backgroundColor: 'transparent',
      borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    }),
    [theme.isDark],
  );
  const themedRepostBg = useMemo(
    () => ({ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }),
    [theme.isDark],
  );

  return (
    <SwipeablePostCard>
      <Pressable
        onPress={() => router.push({ pathname: '/comments/[id]', params: { id: post.id } })}
        onLongPress={() => { triggerHaptic('medium'); onLongPress(post); }}
        delayLongPress={400}
        style={[styles.container, themedContainer]}
      >
        {postEmoji ? <EmojiPattern emoji={postEmoji} opacity={theme.isDark ? 0.12 : 0.10} /> : null}

        {hasImage ? (
          <Pressable onPress={() => onImagePress(imgs[0], post.id, imgs)}>
            <View style={styles.thumbWrap}>
              {imgs.length === 1 ? (
                <CachedImage uri={imgs[0]} style={styles.thumbSingle} resizeMode="cover" proxyWidth={100} />
              ) : imgs.length === 2 ? (
                <View style={styles.thumbRow}>
                  <CachedImage uri={imgs[0]} style={styles.thumbHalf} resizeMode="cover" proxyWidth={49} />
                  <View style={styles.spacerH} />
                  <CachedImage uri={imgs[1]} style={styles.thumbHalf} resizeMode="cover" proxyWidth={49} />
                </View>
              ) : imgs.length === 3 ? (
                <View style={styles.thumbRow}>
                  <CachedImage uri={imgs[0]} style={styles.thumbHalf} resizeMode="cover" proxyWidth={49} />
                  <View style={styles.spacerH} />
                  <View style={styles.thumbHalfCol}>
                    <CachedImage uri={imgs[1]} style={styles.thumbQuarter} resizeMode="cover" proxyWidth={49} />
                    <View style={styles.spacerV} />
                    <CachedImage uri={imgs[2]} style={styles.thumbQuarter} resizeMode="cover" proxyWidth={49} />
                  </View>
                </View>
              ) : (
                <View style={styles.thumbGrid4}>
                  {imgs.slice(0, 4).map((imgUri, idx) => (
                    <CachedImage key={idx} uri={imgUri} style={{ width: 49, height: 49, marginRight: idx % 2 === 0 ? 2 : 0, marginBottom: idx < 2 ? 2 : 0 }} resizeMode="cover" proxyWidth={49} />
                  ))}
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
          {isRepostPost && !origPost && (
            <View style={styles.repostFromRow}>
              <Feather name="repeat" size={10} color={theme.colors.accent.primary} />
              <Text variant="caption" color={theme.colors.accent.primary} style={styles.repostFromTextSmall}>{t('post.repost_label')}</Text>
            </View>
          )}
          {content ? <FormattedText style={styles.bodyText} color={theme.colors.text.secondary}>{content}</FormattedText> : null}
          {link ? (
            <Pressable onLongPress={() => { triggerHaptic('medium'); onLongPress(post); }} delayLongPress={400} style={styles.linkWrap}>
              <LinkPreview url={link} static />
            </Pressable>
          ) : null}
          <View style={styles.metaRow}>
            <View style={styles.metaItem}><Feather name="heart" size={12} color={theme.colors.text.tertiary} /><Text variant="caption" color={theme.colors.text.tertiary} style={styles.metaText}>{post.likesCount}</Text></View>
            <View style={styles.metaItem}><Feather name="message-circle" size={12} color={theme.colors.text.tertiary} /><Text variant="caption" color={theme.colors.text.tertiary} style={styles.metaText}>{post.commentsCount}</Text></View>
          </View>
        </View>
      </Pressable>
    </SwipeablePostCard>
  );
}

export const ProfilePostCard = memo(ProfilePostCardBase, (prev, next) =>
  prev.post.id === next.post.id &&
  prev.post.content === next.post.content &&
  prev.post.likesCount === next.post.likesCount &&
  prev.post.commentsCount === next.post.commentsCount &&
  prev.post.imageUrl === next.post.imageUrl &&
  prev.postEmoji === next.postEmoji &&
  prev.authorName === next.authorName &&
  prev.authorEmoji === next.authorEmoji &&
  prev.authorVerified === next.authorVerified &&
  prev.authorBadge === next.authorBadge
);
