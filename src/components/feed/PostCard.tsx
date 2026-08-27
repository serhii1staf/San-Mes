import React, { useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import { getImageDims, setImageDims } from '../../services/imageDimsCache';
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
import { isInAppCardUrl, stripInAppCardUrl } from '../../utils/appLinks';
import { Post } from '../../types';
import { formatTimeAgo } from '../../utils/mockData';
import { triggerHaptic } from '../../utils/haptics';
import { useT } from '../../i18n/store';
import { useIsBlocked } from '../../store/blockedUsersStore';
import { openPostShareSheet } from '../../store/shareSheetStore';
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
  // ── SHARED FRAME-PACED QUEUE, NOT A BARE RAF ──────────────────────────────
  //
  // This was `requestAnimationFrame(() => setPrimed(true))`. Both profile cards were migrated to the
  // shared queue after a snapshot showed what a bare rAF costs, and this card — the one on the busiest
  // route in the app — was the one that never got it. `(tabs)` reports the worst long task of any
  // route in the latest snapshot.
  //
  // The reason a per-card rAF does not work is written out in full in src/utils/revealQueue.ts: it
  // delays each card by one frame but does NOT serialise cards against each other, so every card the
  // list mounts in the same batch schedules for the SAME next frame and their bodies commit together.
  // The delay relocates the storm instead of breaking it up.
  //
  // `enqueueReveal` releases at most two bodies per frame in mount order, and its canceller drops the
  // slot if FlashList recycles this cell before its turn — so a fast flick never hydrates a card that
  // has already scrolled away.
  //
  // ── THE GATE IS GONE. IT WAS THE "EVERYTHING IS LOADING" FEELING ──────────
  //
  // Everything above is an accurate description of a real long task and of a real fix for it. It is
  // kept because the reasoning is worth having on record. What it never accounted for is the cost of
  // the cure, and this route is where that cost is largest.
  //
  // At two bodies per frame a screenful of eight cards assembles over four frames, each frame being a
  // separate React render + commit + native shadow-tree diff. That is MORE total work than one commit
  // carrying eight cards; the queue does not remove work, it fragments it and adds per-commit overhead.
  // What the user sees is not one hitch followed by a complete screen, it is a screen that visibly
  // builds itself. Reported, repeatedly, as "everything is loading" and "something is being redrawn
  // every millisecond". That report is literally correct, and this queue is one of its sources.
  //
  // The precedent for removing it is in this codebase already: `listReady` in app/chat/[id].tsx was
  // deleted with the note that blank-then-populated across consecutive frames "is exactly the 'content
  // loads with some kind of flash' report, and it is worse than the thing the gate was protecting
  // against". The same argument applies here with more force, because this is four frames rather than
  // two and it happens on every scroll batch rather than once per open.
  //
  // On the long task the gate was preventing: it lands during a native-stack push or a tab swap. Both
  // animate in UIKit / on the platform's own thread, not in JS, so a busy JS thread does not stutter
  // them — the same fact the deleted `listReady` note relies on. The honest trade is one invisible
  // JS-busy period against a visible multi-frame assembly, and the invisible one is better.
  //
  // Reducing what a single card costs to mount is the actual fix and is tracked separately. Fragmenting
  // the cost was never a substitute for lowering it.
  const primed = true;
  // Hero image priority.
  //
  // This was `low`, to make iOS schedule the decodes serially instead of in parallel. Same reasoning as
  // the reveal pumps, same objection: the hero photo IS the post. Marking the single most important
  // pixel on the card as low priority puts it behind every avatar, icon and thumbnail in the request
  // queue, so the feed fills in with its chrome first and its content last. That is the trickle, not a
  // defence against it.
  //
  // `normal` rather than `high`: high would push heroes ahead of the avatars sitting right next to them
  // and produce a different lopsided order. Normal simply stops singling the content out for last place
  // and lets the fetcher's own ordering stand.
  const heroPriority: 'high' | 'normal' | 'low' = 'normal';

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
  const heroUri = imageUrls[0];

  // Seed from the remembered natural size so an already-seen photo mounts at
  // its FINAL height on the very first frame. No resize, so nothing below it
  // shifts — this is what removed the viewport nudge while scrolling:
  // `maintainVisibleContentPosition` anchors against insertions, not against a
  // rendered cell changing its own height after a decode.
  const seededHeroAspect = useMemo(() => {
    const d = getImageDims(heroUri);
    return d ? d.w / d.h : null;
  }, [heroUri]);

  // `useRecyclingState` resets DURING RENDER when the deps change, so a
  // recycled cell never paints one frame of the previous post's shape. The old
  // `useEffect(() => setHeroAspect(null), [heroUri])` ran AFTER commit, which
  // is exactly the one-frame window where the new photo appeared inside the old
  // post's aspect box — the "content changes to the wrong one" symptom.
  //
  // Keyed on `post.id` as well as the URI: the id is the cell's identity, the
  // URI covers a post whose image was edited while keeping its id.
  const [heroAspect, setHeroAspect] = useRecyclingState<number | null>(
    seededHeroAspect,
    [post.id, heroUri],
  );
  const handleHeroLoad = useCallback((e: ImageLoadEventData) => {
    const w = e?.source?.width;
    const h = e?.source?.height;
    if (w && h && w > 0 && h > 0) {
      setHeroAspect(w / h);
      // Remember it so every later view — including a recycle — skips the snap.
      setImageDims(heroUri, w, h);
    }
  }, [heroUri, setHeroAspect]);

  // Resolve the single-image box style. `aspectRatio` + `cover` at the image's
  // own (clamped) ratio = no crop. Only the two extreme cases trim: a photo
  // taller than the clamp band, or one so tall that even the clamped box would
  // exceed the height cap (then we pin to MAX_IMAGE_HEIGHT and let cover trim).
  const heroImageStyle = useMemo<ImageStyle>(() => {
    // Flat neutral placeholder background. CachedImage's default (non-skeleton)
    // path returns a bare expo-image with no `placeholder` and no background,
    // so the box would be transparent until the bitmap paints. Warm/prefetched
    // heroes paint within ~1 frame, but a cold/uncached photo would otherwise
    // flash a transparent gap. Painting this subtle theme-aware fill behind the
    // image removes that flash — and is far cheaper than the old `skeleton`
    // shimmer (LinearGradient + Reanimated loop) that FlashList had to
    // mount/unmount for every recycled cell during scroll.
    const placeholderBg = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
    if (heroAspect == null) {
      // Pre-load: portrait-ish placeholder so layout barely shifts on load.
      return { width: '100%', aspectRatio: PLACEHOLDER_ASPECT_RATIO, borderRadius: 18, backgroundColor: placeholderBg };
    }
    const clamped = clampAspectRatio(heroAspect);
    const derivedHeight = CARD_CONTENT_WIDTH / clamped;
    if (derivedHeight > MAX_IMAGE_HEIGHT) {
      return { width: '100%', height: MAX_IMAGE_HEIGHT, borderRadius: 18, backgroundColor: placeholderBg };
    }
    return { width: '100%', aspectRatio: clamped, borderRadius: 18, backgroundColor: placeholderBg };
  }, [heroAspect, theme.isDark]);

  // Memoize the URL extraction so the regex only runs when the post text
  // actually changes. The IIFE below previously ran extractFirstUrl on every
  // render of every plain-text card on the feed.
  const linkPreviewUrl = useMemo<string | null>(
    () => (!post.isRepost && !hasImages && !hasSpoiler ? extractFirstUrl(post.content) : null),
    [post.isRepost, hasImages, hasSpoiler, post.content],
  );

  // Body text with our own share URL removed when the preview below renders it as a full card.
  // Memoised alongside `linkPreviewUrl` because it depends on the same two inputs and this runs for
  // every card on the feed.
  const bodyText = useMemo<string>(
    () => (isInAppCardUrl(linkPreviewUrl) ? stripInAppCardUrl(post.content, linkPreviewUrl) : (post.content || '')),
    [post.content, linkPreviewUrl],
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
      {/* `bodyText`, not `post.content`. When the link below renders as one of our own in-app cards,
          the bare URL is stripped out of the text — the card already shows the author, the text, the
          thumbnail and the counts, so printing `san-m-app.com/post` above it is duplication, and the
          elided label reads as a broken half-link. Third-party URLs keep their text. See
          `isInAppCardUrl` in src/utils/appLinks.ts. */}
      {bodyText ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: hasImages || hasSpoiler ? 10 : 4 }}>
          <FormattedText style={{ fontSize: 14, lineHeight: 20 }}>{bodyText}</FormattedText>
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
            <CachedImage uri={imageUrls[0]} style={heroImageStyle} resizeMode="cover" proxyWidth={HERO_IMG_WIDTH} priority={heroPriority} onLoad={handleHeroLoad} />
          </Pressable>
        ) : (
          <ImageCarousel imageUrls={imageUrls} onDoubleTap={handleDoubleTap} heroPriority={heroPriority} postId={post.id} />
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
        {/* Opens the in-app picker (people you have talked to recently) rather than the OS share sheet.
            Routed through the global store because this card is rendered by a virtualized list several
            screens deep — see src/store/shareSheetStore.ts. */}
        <Pressable
          onPress={() => {
            triggerHaptic('light');
            const target = post.isRepost && post.originalPost ? post.originalPost : post;
            openPostShareSheet(post.id, (target as any)?.content || '');
          }}
          style={styles.actionBtnLast}
        >
          <Feather name="send" size={15} color={theme.colors.text.tertiary} />
        </Pressable>
      </View>
    </View>
  );
});

// Image carousel for multiple images
function ImageCarousel({ imageUrls, onDoubleTap, heroPriority, postId }: { imageUrls: string[]; onDoubleTap: () => void; heroPriority: 'high' | 'normal' | 'low'; postId: string }) {
  const theme = useTheme();
  // Recycled with the cell. Plain `useState` kept the previous post's page
  // index, so a recycled carousel showed dots pointing at page 3 of a photo set
  // the user had never opened.
  const [activeIndex, setActiveIndex] = useRecyclingState(0, [postId]);
  const lastTapRef = useRef<number>(0);
  const scrollRef = useRef<ScrollView | null>(null);

  // The inner ScrollView keeps its own horizontal offset across recycling, so
  // resetting `activeIndex` alone would leave the dots and the visible page
  // disagreeing. A layout effect runs before paint, so the reset is not visible.
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [postId]);
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
  const firstUri = imageUrls[0];
  const seededFirstAspect = useMemo(() => {
    const d = getImageDims(firstUri);
    return d ? d.w / d.h : null;
  }, [firstUri]);
  // Same reasoning as the hero: reset during render, seeded from the remembered
  // size. Previously this had no reset at all, so a recycled carousel computed
  // its shared slide height from the PREVIOUS post's first image.
  const [firstAspect, setFirstAspect] = useRecyclingState<number | null>(
    seededFirstAspect,
    [postId, firstUri],
  );
  const handleFirstLoad = useCallback((e: ImageLoadEventData) => {
    const w = e?.source?.width;
    const h = e?.source?.height;
    if (w && h && w > 0 && h > 0) {
      setFirstAspect(w / h);
      setImageDims(firstUri, w, h);
    }
  }, [firstUri, setFirstAspect]);
  const carouselHeight = useMemo(() => {
    const ratio = firstAspect == null ? PLACEHOLDER_ASPECT_RATIO : clampAspectRatio(firstAspect);
    return Math.min(MAX_IMAGE_HEIGHT, Math.round(slideImgWidth / ratio));
  }, [firstAspect, slideImgWidth]);

  // Page-dot index. `scrollEventThrottle={16}` means this fires ~60×/s while the user
  // drags the carousel, and this component is a FEED ROW — so every dispatch re-rendered
  // a post card mid-gesture. The index only actually changes once per page, roughly once
  // per 300 ms of dragging; the other ~55 dispatches per second set the value it already
  // had. React would still re-run this component for each one, because `setState` only
  // bails on an unchanged value when it can compare it BEFORE scheduling, which is what
  // the functional form below lets it do.
  //
  // Kept as state rather than a shared value on purpose: the dots are a handful of tiny
  // Views whose `width`/`backgroundColor` differ per index, so driving them from the UI
  // thread would mean one `useAnimatedStyle` per dot — more machinery than the ~3 renders
  // per gesture this now costs.
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / imgWidth);
    const next = Math.max(0, Math.min(index, imageUrls.length - 1));
    setActiveIndex((prev) => (prev === next ? prev : next));
  };

  const handlePress = () => { const now = Date.now(); if (now - lastTapRef.current < 300) onDoubleTap(); lastTapRef.current = now; };

  return (
    <View style={{ paddingBottom: 12 }}>
      <ScrollView ref={scrollRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={handleScroll} scrollEventThrottle={16}>
        {imageUrls.map((url, i) => (
          <Pressable key={i} onPress={handlePress} style={{ width: imgWidth, alignItems: 'center' }}>
            {/* Within-card stagger: only the visible (first) image takes
                `heroPriority`; off-screen carousel pages are `low` so iOS
                queues them behind the first page's decode. The first slide
                also reports its dimensions so the shared carousel height
                matches the set's orientation. */}
            <CachedImage uri={url} style={{ width: slideImgWidth, height: carouselHeight, borderRadius: 18, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }} resizeMode="cover" priority={i === 0 ? heroPriority : 'low'} onLoad={i === 0 ? handleFirstLoad : undefined} />
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
