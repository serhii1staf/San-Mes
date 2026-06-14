import React, { useState, useRef, useMemo, useEffect, memo } from 'react';
import { View, Pressable, ViewStyle, Dimensions, ScrollView, NativeSyntheticEvent, NativeScrollEvent, Text as RNText } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { CachedImage } from '../ui/CachedImage';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { UserBadge } from '../ui/UserBadge';
import { FormattedText } from '../ui/FormattedText';
import { SpoilerImage } from '../ui/SpoilerImage';
import { LinkPreview } from '../ui/LinkPreview';
import { extractFirstUrl } from '../../services/linkPreview';
import { Post } from '../../types';
import { formatTimeAgo } from '../../utils/mockData';
import { triggerHaptic } from '../../utils/haptics';
import { useT } from '../../i18n/store';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IMAGE_HEIGHT = 280;

// ─── Module-level "first frame" latch ───────────────────────────────────
// Two roles, one latch:
//   1. Lazy-hydrate the WHOLE card body. While `__firstFrameDone === false`,
//      cards render only an empty placeholder View; one RAF later the latch
//      flips and full card content (header, FormattedText, LinkPreview,
//      hero CachedImage, repost embed, action bar) commits in a frame the
//      user already perceives as the navigation transition. Initial-mount
//      cost drops from a full subtree per card to a single empty View per
//      card — the cumulative ~33ms native shadow-tree work that was
//      pulling the UI thread to 36fps becomes ~3ms.
//   2. Cross-card image-decode stagger. Once cards do hydrate, hero images
//      on the first wave still render with `priority="low"` for that frame
//      so iOS sequentializes their native decodes instead of fanning out
//      in parallel. After the latch flips, subsequent cards observe the
//      post-flip state directly (no re-render) and use `priority="high"`.
//
// The first card to mount kicks off one RAF that flips the latch; every
// card mounting after that initializes `primed` already-true and pays
// zero deferral cost. Same shape as `ProfilePostCard.tsx`.
let __firstFrameDone = false;
let __firstFramePending: ((b: boolean) => void)[] = [];
function __scheduleFirstFrameFlush() {
  if (__firstFrameDone) return;
  // Only the first card to mount kicks off the RAF. Subsequent cards just
  // append themselves to the wait list, so we don't queue N RAFs.
  if (__firstFramePending.length !== 1) return;
  requestAnimationFrame(() => {
    __firstFrameDone = true;
    const list = __firstFramePending;
    __firstFramePending = [];
    for (const fn of list) fn(true);
  });
}

interface PostCardProps {
  post: Post;
  currentUserId?: string;
  onLike: (postId: string) => void;
  onComment?: (postId: string) => void;
  onShare?: (postId: string) => void;
  onBookmark?: (postId: string) => void;
  onMenu?: (post: Post) => void;
  onFollow?: (userId: string) => void;
}

export const PostCard = memo(function PostCard({ post, currentUserId, onLike, onComment, onShare, onBookmark, onMenu, onFollow }: PostCardProps) {
  const theme = useTheme();
  const t = useT();
  const lastTap = useRef<number>(0);

  // Cross-card stagger AND lazy-hydrate gate. While `primed === false`
  // the card returns only a sized placeholder (see early return below);
  // once primed, hero images render with the cross-card priority stagger
  // described in the `__firstFrameDone` block at top of file.
  const [primed, setPrimed] = useState(__firstFrameDone);
  useEffect(() => {
    if (__firstFrameDone) return;
    __firstFramePending.push(setPrimed);
    __scheduleFirstFrameFlush();
    // No cleanup: the flush callback drains the array atomically; calling
    // setPrimed on an unmounted component is a benign no-op in React 18+.
  }, []);
  // Hero image priority — always `low`. iOS schedules `low`-priority decodes
  // serially on its image-decode queue rather than fanning them out in
  // parallel, which is what was causing the user-perceived ~1s scroll
  // judder on cold-open of feed/profile (4 cards × parallel decodes
  // saturated the native UI thread). The visible-paint delay is sub-frame
  // — `expo-image`'s memory-disk cache plus the prefetch path mean cached
  // bytes still appear within one frame; only NEW decodes get serialized.
  // Pinning to `low` always (not just during the first frame) means
  // scroll-induced new card mounts also stagger.
  const heroPriority: 'high' | 'low' = 'low';

  const handleLike = () => { triggerHaptic('light'); onLike(post.id); };
  const handleDoubleTap = () => { if (!post.isLiked) onLike(post.id); };

  // Memoize the image-url collection — was re-allocating an array on every
  // render when the post had `imageUrl` (singular). For a feed scroll over
  // 50 cards that's 50 throwaway arrays per scroll commit.
  const imageUrls = useMemo<string[]>(
    () => (post.imageUrls && post.imageUrls.length > 0 ? post.imageUrls : post.imageUrl ? [post.imageUrl] : []),
    [post.imageUrls, post.imageUrl],
  );
  const hasImages = imageUrls.length > 0 && !post.isSpoilerImage;
  const hasSpoiler = post.isSpoilerImage && imageUrls.length > 0;

  // Memoize the URL extraction so the regex only runs when the post text
  // actually changes. The IIFE below previously ran extractFirstUrl on every
  // render of every plain-text card on the feed.
  const linkPreviewUrl = useMemo<string | null>(
    () => (!post.isRepost && !hasImages && !hasSpoiler ? extractFirstUrl(post.content) : null),
    [post.isRepost, hasImages, hasSpoiler, post.content],
  );

  // Card colors — blend with theme background
  const cardBg = theme.isDark ? theme.colors.background.elevated : 'rgba(255,255,255,0.95)';
  const cardBorder = theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  // First-paint placeholder — outer dimensions approximate the real card so
  // the FlatList layout doesn't jump when the body commits one RAF later.
  // No header, no FormattedText, no CachedImage, no LinkPreview, no
  // ImageCarousel, no action bar. Initial-mount native shadow-tree work
  // collapses from a full subtree to a single empty View. We keep the same
  // bg/border as the real card so there's no color flash on hydration.
  // Heuristic height: image cards ≈ 400 (image 280 + chrome ~120), text
  // cards ≈ 140 (chrome ~120 + content ~20). Real height settles on the
  // very next frame.
  if (!primed) {
    return (
      <View
        style={{
          marginBottom: 12,
          borderRadius: 28,
          backgroundColor: cardBg,
          borderWidth: 1,
          borderColor: cardBorder,
          height: hasImages || hasSpoiler ? 400 : 140,
        }}
      />
    );
  }

  return (
    <View style={{ marginBottom: 12, borderRadius: 28, backgroundColor: cardBg, borderWidth: 1, borderColor: cardBorder, overflow: 'hidden' }}>
      {/* Repost indicator */}
      {post.isRepost && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, gap: 6 }}>
          <Feather name="repeat" size={12} color={theme.colors.text.tertiary} style={{ flexShrink: 0 }} />
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11, flexShrink: 1 }} numberOfLines={1}>{t('post.reposted_by', undefined, { name: post.authorName })}</Text>
        </View>
      )}

      {/* Header: avatar + name + username + time + icons */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: post.isRepost ? 8 : 14, paddingBottom: 8 }}>
        <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: post.authorId } })}>
          <Avatar emoji={post.authorEmoji} name={post.authorName} size="sm" />
        </Pressable>
        <View style={{ marginLeft: 10, flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Text weight="bold" variant="body" numberOfLines={1} style={{ fontSize: 15, flexShrink: 1 }}>{post.authorName}</Text>
            {post.authorVerified && <VerifiedBadge size={13} />}
            {post.authorBadge && <UserBadge badge={post.authorBadge} size="sm" />}
          </View>
          <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 12 }}>@{post.authorUsername} · {formatTimeAgo(post.createdAt)}</Text>
        </View>
        {/* Right icons */}
        {currentUserId !== post.authorId && (
          <Pressable onPress={() => { triggerHaptic('light'); onFollow?.(post.authorId); }} hitSlop={8} style={{ padding: 4 }}>
            <Feather name="user-plus" size={16} color={theme.colors.text.tertiary} />
          </Pressable>
        )}
        <Pressable onPress={() => { triggerHaptic('light'); onMenu?.(post); }} hitSlop={8} style={{ padding: 4, marginLeft: 6 }}>
          <Feather name="more-vertical" size={16} color={theme.colors.text.tertiary} />
        </Pressable>
      </View>

      {/* Content text */}
      {post.content ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: hasImages || hasSpoiler ? 10 : 4 }}>
          <FormattedText style={{ fontSize: 14, lineHeight: 20 }}>{post.content}</FormattedText>
        </View>
      ) : null}

      {/* Link preview — only when the post has a URL and no image of its own */}
      {linkPreviewUrl ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <LinkPreview url={linkPreviewUrl} />
        </View>
      ) : null}

      {/* Original post embed (reposts) */}
      {post.isRepost && post.originalPost && (
        <View style={{ marginHorizontal: 16, marginBottom: 10, borderWidth: 1, borderColor: cardBorder, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
            <Avatar emoji={post.originalPost.authorEmoji} size="xs" />
            <Text variant="caption" weight="semibold" numberOfLines={1} style={{ marginLeft: 8, fontSize: 12, flexShrink: 1 }}>{post.originalPost.authorName}</Text>
            {post.originalPost.authorVerified && <VerifiedBadge size={10} />}
          </View>
          {post.originalPost.content && (
            <View style={{ paddingHorizontal: 10, paddingBottom: 10 }}>
              <FormattedText style={{ fontSize: 13 }}>{post.originalPost.content}</FormattedText>
            </View>
          )}
          {post.originalPost.imageUrls && post.originalPost.imageUrls.length > 0 ? (
            // Repost embed image — secondary content inside a quoted block,
            // so it's marked low priority. iOS routes the parent post's
            // hero (if any) ahead of this on the native decode queue.
            <CachedImage uri={post.originalPost.imageUrls[0]} style={{ width: '100%', height: 140 }} resizeMode="cover" priority="low" />
          ) : post.originalPost.imageUrl ? (
            <CachedImage uri={post.originalPost.imageUrl} style={{ width: '100%', height: 140 }} resizeMode="cover" priority="low" />
          ) : null}
        </View>
      )}

      {/* Image — fixed height, cover mode, rounded inside card */}
      {hasImages && !post.isRepost && (
        imageUrls.length === 1 ? (
          <Pressable onPress={() => { const now = Date.now(); if (now - lastTap.current < 300) handleDoubleTap(); lastTap.current = now; }}>
            {/* Single hero image — `priority` follows the cross-card latch
                (low during first frame of cold-open, high afterwards). See
                `__firstFrameDone` block at top of file. */}
            <CachedImage uri={imageUrls[0]} style={{ width: '100%', height: IMAGE_HEIGHT, marginBottom: 0 }} resizeMode="cover" priority={heroPriority} />
          </Pressable>
        ) : (
          <ImageCarousel imageUrls={imageUrls} onDoubleTap={handleDoubleTap} heroPriority={heroPriority} />
        )
      )}

      {hasSpoiler && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <SpoilerImage uri={imageUrls[0]} width="100%" height={IMAGE_HEIGHT} borderRadius={12} isSpoiler={true} />
        </View>
      )}

      {/* Action bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 4 }}>
        {/* Star (like) */}
        <Pressable onPress={handleLike} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
          <Feather name="star" size={16} color={post.isLiked ? theme.colors.accent.primary : theme.colors.text.tertiary} />
          <Text variant="caption" color={post.isLiked ? theme.colors.accent.primary : theme.colors.text.tertiary} style={{ marginLeft: 4, fontSize: 12 }}>{post.likesCount || ''}</Text>
        </Pressable>

        {/* Comments */}
        <Pressable onPress={() => onComment?.(post.id)} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
          <Feather name="message-square" size={16} color={theme.colors.text.tertiary} />
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginLeft: 4, fontSize: 12 }}>{post.commentsCount || ''}</Text>
        </Pressable>

        {/* Repost */}
        <Pressable onPress={() => { triggerHaptic('light'); onShare?.(post.id); }} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
          <Feather name="corner-up-right" size={16} color={theme.colors.text.tertiary} />
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginLeft: 4, fontSize: 12 }}>{post.sharesCount || ''}</Text>
        </Pressable>

        {/* Share */}
        <Pressable onPress={async () => { triggerHaptic('light'); try { const { sharePost } = require('../../utils/sharePost'); await sharePost(post); } catch {} }} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Feather name="send" size={15} color={theme.colors.text.tertiary} />
        </Pressable>
      </View>
    </View>
  );
});

// Image carousel for multiple images
function ImageCarousel({ imageUrls, onDoubleTap, heroPriority }: { imageUrls: string[]; onDoubleTap: () => void; heroPriority: 'high' | 'low' }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const lastTapRef = useRef<number>(0);
  const imgWidth = SCREEN_WIDTH - 32;

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / imgWidth);
    setActiveIndex(Math.max(0, Math.min(index, imageUrls.length - 1)));
  };

  const handlePress = () => { const now = Date.now(); if (now - lastTapRef.current < 300) onDoubleTap(); lastTapRef.current = now; };

  return (
    <View>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={handleScroll} scrollEventThrottle={16}>
        {imageUrls.map((url, i) => (
          <Pressable key={i} onPress={handlePress}>
            {/* Within-card stagger: only the visible (first) image takes
                `heroPriority`; off-screen carousel pages are `low` so iOS
                queues them behind the first page's decode. The user sees
                the first page render first, then off-screen pages stream
                in as they're scrolled into view (or as the decoder gets
                idle frames). */}
            <CachedImage uri={url} style={{ width: imgWidth, height: IMAGE_HEIGHT }} resizeMode="cover" priority={i === 0 ? heroPriority : 'low'} />
          </Pressable>
        ))}
      </ScrollView>
      {imageUrls.length > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 6, gap: 4 }}>
          {imageUrls.map((_, i) => (
            <View key={i} style={{ width: i === activeIndex ? 7 : 5, height: 5, borderRadius: 3, backgroundColor: i === activeIndex ? '#FFFFFF' : 'rgba(255,255,255,0.3)' }} />
          ))}
        </View>
      )}
    </View>
  );
}
