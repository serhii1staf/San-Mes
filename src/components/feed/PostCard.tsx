import React, { useState, useRef, useMemo, useEffect, useCallback, memo } from 'react';
import { View, Pressable, ViewStyle, ImageStyle, Dimensions, ScrollView, NativeSyntheticEvent, NativeScrollEvent, Text as RNText, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ImageLoadEventData } from 'expo-image';
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
import { useIsBlocked } from '../../store/blockedUsersStore';
import { useEntityStore } from '../../store';
import { BlockedContentPlaceholder } from './BlockedContentPlaceholder';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
// Kept for the repost-embed and spoiler paths, which stay a fixed height on
// purpose (secondary / hidden content). The primary single-image and carousel
// paths below are now aspect-ratio driven — see ASPECT constants.
const IMAGE_HEIGHT = 280;

// ─── Adaptive image sizing ──────────────────────────────────────────────
// Feed images render at their NATURAL aspect ratio (no hard crop) instead of
// a fixed height. `aspectRatio` + `cover` with the image's OWN ratio means
// the box matches the bitmap exactly, so nothing is trimmed. We clamp the
// ratio so a freakishly tall or wide photo can't blow out the layout:
//   • MIN 0.6 → tallest allowed box (≈ portrait 3:4..2:3); taller photos get
//     pinned and `cover` trims the overflow.
//   • MAX 2.2 → widest allowed box (≈ panorama); wider photos get trimmed.
// Card content width is the screen minus the feed's 16px horizontal padding
// on each side (same value `ImageCarousel` already used for `imgWidth`).
const CARD_CONTENT_WIDTH = SCREEN_WIDTH - 32;
// Actual on-screen DP width of a hero photo: the card content minus the 12px
// inset on each side of the image wrapper (single hero `paddingHorizontal: 12`
// / carousel `SLIDE_INSET` ×2). Exported so the feed screen can WARM the proxy
// at exactly this width — the single hero's style width is `'100%'` (a string),
// so CachedImage can't derive a numeric width and would otherwise fall back to
// the proxy DEFAULT (800px), producing a DIFFERENT weserv URL than the warm and
// guaranteeing a cache MISS on first paint. Pinning both sides to this constant
// gives one stable cache key shared by warm + display (matches the multi-image
// carousel, whose numeric `slideImgWidth` already equals this value).
export const HERO_IMG_WIDTH = CARD_CONTENT_WIDTH - 24;
const MIN_ASPECT_RATIO = 0.6;
const MAX_ASPECT_RATIO = 2.2;
// Placeholder ratio used before onLoad lands so the row doesn't jump much.
const PLACEHOLDER_ASPECT_RATIO = 4 / 5;
// Hard height cap (~60% of screen) so even a clamped-portrait card never eats
// the whole viewport. Beyond this we pin the height and let `cover` trim.
const MAX_IMAGE_HEIGHT = Math.round(SCREEN_HEIGHT * 0.6);

// Clamp a natural width/height ratio into the layout-safe band.
const clampAspectRatio = (ratio: number) =>
  Math.min(MAX_ASPECT_RATIO, Math.max(MIN_ASPECT_RATIO, ratio));

// ─── Per-card lazy hydrate ──────────────────────────────────────────────
// Each card defers its body ONE RAF after its OWN mount so any FlatList
// commit that lands a freshly-virtualized card carries only an empty
// placeholder, with the heavy subtree (header, FormattedText, LinkPreview,
// hero CachedImage, repost embed, action bar) committing on the NEXT
// frame.
//
// Why per-card (instead of a module-level "first frame done" latch): the
// previous module-level latch flipped to `true` once the initial 2 cards
// had finished their first paint, which meant every subsequent card —
// including ones mounted DURING SCROLL as FlatList virtualization ran —
// initialized with `primed = true` and committed its full body in a
// single frame. With ~11 ms of native shadow-tree work per card body
// (image decode + nested Text trees + action bar) a scroll batch landing
// 2-3 cards on the same frame storms the UI thread, reproducing the
// "lag on rapid taps and during scroll" users were reporting once the
// feed had real content. Per-card RAF spreads each card's mount across
// two frames regardless of where it lands in the session, so no
// scroll-induced commit ever carries more than a handful of empty
// placeholders + at most one full body. Same shape as
// `ProfilePostCard.tsx` (already on per-card RAF).

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
  // Follow state for the author, read from the entity store so the button
  // flips the moment the viewer (un)follows — here or anywhere else (profile,
  // follows list). Cheap boolean selector; re-renders only on an actual flip.
  const isFollowingAuthor = useEntityStore((s) =>
    currentUserId && currentUserId !== post.authorId ? s.isFollowing(currentUserId, post.authorId) : false,
  );

  // Block-awareness — read viewer's block list. We compute the effective
  // author up-front so the `useIsBlocked` hook calls always run in a fixed
  // order regardless of post shape (repost vs. regular). The actual early
  // return that swaps the card body for a placeholder MUST happen AFTER
  // every other hook in this component has been called — React's rules of
  // hooks require a stable hook-count per render, and on the
  // false→true transition (when the user just blocked someone) returning
  // early before subsequent useState/useEffect/useMemo calls would crash
  // with "Rendered fewer hooks than expected" → WatchdogTermination.
  const effectiveAuthorId =
    post.isRepost && post.originalPost ? (post.originalPost as any).authorId || post.authorId : post.authorId;
  const effectiveAuthorUsername =
    post.isRepost && post.originalPost ? (post.originalPost as any).authorUsername || post.authorUsername : post.authorUsername;
  const isBlockedReposter = useIsBlocked(post.isRepost ? post.authorId : null);
  const isBlockedAuthor = useIsBlocked(effectiveAuthorId);

  // Per-card lazy hydrate. Each card runs its OWN RAF after mounting so
  // a FlatList scroll batch that lands 2-3 fresh cells in the same frame
  // commits only empty placeholders on that frame, with each card's
  // heavy subtree committing on the next frame. See the header comment
  // for the full rationale.
  const [primed, setPrimed] = useState(false);
  useEffect(() => {
    const handle = requestAnimationFrame(() => setPrimed(true));
    return () => cancelAnimationFrame(handle);
  }, []);
  // Hero image priority — always `low`. iOS schedules `low`-priority decodes
  // serially on its image-decode queue rather than fanning them out in
  // parallel, which is what was causing the user-perceived ~1s scroll
  // judder on cold-open of feed/profile (4 cards × parallel decodes
  // saturated the native UI thread). The visible-paint delay is sub-frame
  // — `expo-image`'s memory-disk cache plus the prefetch path mean cached
  // bytes still appear within one frame; only NEW decodes get serialized.
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

  // Natural aspect ratio of the single hero image, learned from expo-image's
  // onLoad (fires once per image — no per-frame cost). Null until the bitmap
  // dimensions arrive, at which point the card resizes to fit the photo.
  const [heroAspect, setHeroAspect] = useState<number | null>(null);
  const handleHeroLoad = useCallback((e: ImageLoadEventData) => {
    const w = e?.source?.width;
    const h = e?.source?.height;
    if (w && h && w > 0 && h > 0) setHeroAspect(w / h);
  }, []);

  // Resolve the single-image box style. `aspectRatio` + `cover` at the image's
  // own (clamped) ratio = no crop. Only the two extreme cases trim: a photo
  // taller than the clamp band, or one so tall that even the clamped box would
  // exceed the height cap (then we pin to MAX_IMAGE_HEIGHT and let cover trim).
  const heroImageStyle = useMemo<ImageStyle>(() => {
    if (heroAspect == null) {
      // Pre-load: portrait-ish placeholder so layout barely shifts on load.
      return { width: '100%', aspectRatio: PLACEHOLDER_ASPECT_RATIO, borderRadius: 18 };
    }
    const clamped = clampAspectRatio(heroAspect);
    const derivedHeight = CARD_CONTENT_WIDTH / clamped;
    if (derivedHeight > MAX_IMAGE_HEIGHT) {
      return { width: '100%', height: MAX_IMAGE_HEIGHT, borderRadius: 18 };
    }
    return { width: '100%', aspectRatio: clamped, borderRadius: 18 };
  }, [heroAspect]);

  // Memoize the URL extraction so the regex only runs when the post text
  // actually changes. The IIFE below previously ran extractFirstUrl on every
  // render of every plain-text card on the feed.
  const linkPreviewUrl = useMemo<string | null>(
    () => (!post.isRepost && !hasImages && !hasSpoiler ? extractFirstUrl(post.content) : null),
    [post.isRepost, hasImages, hasSpoiler, post.content],
  );

  // Memoize the relative timestamp. `formatTimeAgo` allocates two Date objects
  // plus arithmetic; it previously ran on EVERY render of EVERY card, including
  // the rapid re-renders FlashList drives as it recycles cells during scroll.
  // Keying on `createdAt` recomputes only when the row is recycled to a new
  // post — behaviour is unchanged because the relative string only ever
  // refreshes on a re-render anyway (it has no internal ticker).
  const timeAgo = useMemo(() => formatTimeAgo(post.createdAt), [post.createdAt]);

  // Card colors — blend with theme background
  const cardBg = theme.isDark ? theme.colors.background.elevated : 'rgba(255,255,255,0.95)';
  const cardBorder = theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  // ─── Now all hooks have been called. Below this line are the conditional
  //     early returns (block-aware placeholder, lazy-hydrate placeholder).

  // Block-aware short circuit. When the viewer has blocked this post's
  // author (or the original author of a repost), swap the entire card
  // for the placeholder. The placeholder is memoized so virtualization
  // doesn't pay re-render cost as the list scrolls.
  if (isBlockedAuthor || isBlockedReposter) {
    return (
      <BlockedContentPlaceholder
        blockedUserId={isBlockedAuthor ? effectiveAuthorId : post.authorId}
        username={isBlockedAuthor ? effectiveAuthorUsername : post.authorUsername}
        variant="card"
      />
    );
  }

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
        <View style={styles.repostRow}>
          <Feather name="repeat" size={12} color={theme.colors.text.tertiary} style={styles.repostIcon} />
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11, flexShrink: 1 }} numberOfLines={1}>{t('post.reposted_by', undefined, { name: post.authorName })}</Text>
        </View>
      )}

      {/* Header: avatar + name + username + time + icons */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: post.isRepost ? 8 : 14, paddingBottom: 8 }}>
        <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: post.authorId } })}>
          <Avatar emoji={post.authorEmoji} name={post.authorName} size="sm" tint />
        </Pressable>
        <View style={styles.headerNameWrap}>
          <View style={styles.headerNameRow}>
            <Text weight="bold" variant="body" numberOfLines={1} style={{ fontSize: 15, flexShrink: 1, minWidth: 0 }}>{post.authorName}</Text>
            {post.authorVerified && <VerifiedBadge size={13} />}
            {post.authorBadge && <UserBadge badge={post.authorBadge} size="sm" />}
          </View>
          <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 12 }}>@{post.authorUsername} · {timeAgo}</Text>
        </View>
        {/* Right icons */}
        {currentUserId !== post.authorId && (
          <Pressable onPress={() => { triggerHaptic('light'); onFollow?.(post.authorId); }} hitSlop={8} style={styles.iconBtn}>
            <Feather
              name={isFollowingAuthor ? 'user-check' : 'user-plus'}
              size={16}
              color={isFollowingAuthor ? theme.colors.accent.primary : theme.colors.text.tertiary}
            />
          </Pressable>
        )}
        <Pressable onPress={() => { triggerHaptic('light'); onMenu?.(post); }} hitSlop={8} style={styles.menuBtn}>
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

      {/* Image — single hero renders at the photo's natural (clamped) aspect
          ratio; multi-image carousel keeps one consistent height. */}
      {hasImages && !post.isRepost && (
        imageUrls.length === 1 ? (
          // Inset + rounded so the photo "floats" inside the card with
          // breathing room on every side instead of bleeding to the edges.
          <Pressable onPress={() => { const now = Date.now(); if (now - lastTap.current < 300) handleDoubleTap(); lastTap.current = now; }} style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
            {/* Single hero image — sized to its own aspect ratio via onLoad so
                tall/wide photos aren't cropped (clamped to a layout-safe band;
                see ASPECT constants). `priority` follows `heroPriority`.
                `proxyWidth` is pinned to HERO_IMG_WIDTH because the style width
                is `'100%'` (non-numeric) — without it CachedImage falls back to
                the proxy DEFAULT (800px), a different cache key than the feed's
                warm + the carousel, so the warmed bytes would never hit. */}
            <CachedImage uri={imageUrls[0]} style={heroImageStyle} resizeMode="cover" proxyWidth={HERO_IMG_WIDTH} priority={heroPriority} onLoad={handleHeroLoad} skeleton />
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
      <View style={styles.actionBar}>
        {/* Star (like) */}
        <Pressable onPress={handleLike} style={styles.actionBtn}>
          <Feather name="star" size={16} color={post.isLiked ? theme.colors.accent.primary : theme.colors.text.tertiary} />
          <Text variant="caption" color={post.isLiked ? theme.colors.accent.primary : theme.colors.text.tertiary} style={{ marginLeft: 4, fontSize: 12 }}>{post.likesCount || ''}</Text>
        </Pressable>

        {/* Comments */}
        <Pressable onPress={() => onComment?.(post.id)} style={styles.actionBtn}>
          <Feather name="message-square" size={16} color={theme.colors.text.tertiary} />
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginLeft: 4, fontSize: 12 }}>{post.commentsCount || ''}</Text>
        </Pressable>

        {/* Repost */}
        <Pressable onPress={() => { triggerHaptic('light'); onShare?.(post.id); }} style={styles.actionBtn}>
          <Feather name="corner-up-right" size={16} color={theme.colors.text.tertiary} />
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginLeft: 4, fontSize: 12 }}>{post.sharesCount || ''}</Text>
        </Pressable>

        {/* Share */}
        <Pressable onPress={async () => { triggerHaptic('light'); try { const { sharePost } = require('../../utils/sharePost'); await sharePost(post); } catch {} }} style={styles.actionBtnLast}>
          <Feather name="send" size={15} color={theme.colors.text.tertiary} />
        </Pressable>
      </View>
    </View>
  );
});

// Image carousel for multiple images
function ImageCarousel({ imageUrls, onDoubleTap, heroPriority }: { imageUrls: string[]; onDoubleTap: () => void; heroPriority: 'high' | 'low' }) {
  const theme = useTheme();
  const [activeIndex, setActiveIndex] = useState(0);
  const lastTapRef = useRef<number>(0);
  const imgWidth = SCREEN_WIDTH - 32;
  // Each slide pages at full width, but the photo inside is inset on both
  // sides and rounded so it floats with breathing room (matches the single
  // hero). Paging math still uses the full `imgWidth`.
  const SLIDE_INSET = 12;
  const slideImgWidth = imgWidth - SLIDE_INSET * 2;

  // Mixed aspect ratios inside a horizontal pager look broken, so every slide
  // shares ONE height. We derive that height from the FIRST image's natural
  // (clamped) ratio — a portrait set gets a taller carousel, a landscape set a
  // shorter one — capped at MAX_IMAGE_HEIGHT. Learned once via onLoad.
  const [firstAspect, setFirstAspect] = useState<number | null>(null);
  const handleFirstLoad = useCallback((e: ImageLoadEventData) => {
    const w = e?.source?.width;
    const h = e?.source?.height;
    if (w && h && w > 0 && h > 0) setFirstAspect(w / h);
  }, []);
  const carouselHeight = useMemo(() => {
    const ratio = firstAspect == null ? PLACEHOLDER_ASPECT_RATIO : clampAspectRatio(firstAspect);
    return Math.min(MAX_IMAGE_HEIGHT, Math.round(slideImgWidth / ratio));
  }, [firstAspect, slideImgWidth]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / imgWidth);
    setActiveIndex(Math.max(0, Math.min(index, imageUrls.length - 1)));
  };

  const handlePress = () => { const now = Date.now(); if (now - lastTapRef.current < 300) onDoubleTap(); lastTapRef.current = now; };

  return (
    <View style={{ paddingBottom: 12 }}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={handleScroll} scrollEventThrottle={16}>
        {imageUrls.map((url, i) => (
          <Pressable key={i} onPress={handlePress} style={{ width: imgWidth, alignItems: 'center' }}>
            {/* Within-card stagger: only the visible (first) image takes
                `heroPriority`; off-screen carousel pages are `low` so iOS
                queues them behind the first page's decode. The first slide
                also reports its dimensions so the shared carousel height
                matches the set's orientation. */}
            <CachedImage uri={url} style={{ width: slideImgWidth, height: carouselHeight, borderRadius: 18 }} resizeMode="cover" priority={i === 0 ? heroPriority : 'low'} onLoad={i === 0 ? handleFirstLoad : undefined} skeleton />
          </Pressable>
        ))}
      </ScrollView>
      {imageUrls.length > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 8, gap: 4 }}>
          {imageUrls.map((_, i) => (
            <View key={i} style={{ width: i === activeIndex ? 7 : 5, height: 5, borderRadius: 3, backgroundColor: i === activeIndex ? theme.colors.accent.primary : (theme.isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)') }} />
          ))}
        </View>
      )}
    </View>
  );
}

// Static, prop-independent styles hoisted out of render. These objects were
// previously inline literals re-allocated on every card commit — and FlashList
// recycles cells aggressively during scroll, so each fast flick re-rendered a
// handful of cards per frame, each minting a fresh copy of every structural
// style. Hoisting them to a single frozen StyleSheet removes that per-recycle
// allocation/GC churn. Only styles that depend on nothing (no theme, no post,
// no measured aspect ratio) live here; dynamic styles stay inline.
const styles = StyleSheet.create({
  repostRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, gap: 6 },
  repostIcon: { flexShrink: 0 },
  headerNameWrap: { marginLeft: 10, flex: 1 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  iconBtn: { padding: 4 },
  menuBtn: { padding: 4, marginLeft: 6 },
  actionBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 4 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', marginRight: 12 },
  actionBtnLast: { flexDirection: 'row', alignItems: 'center' },
});
