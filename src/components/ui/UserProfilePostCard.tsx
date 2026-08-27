import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { CachedImage } from './CachedImage';
import { useMappingHelper } from '@shopify/flash-list';
import { VerifiedBadge } from './VerifiedBadge';
import { UserBadge } from './UserBadge';
import { FormattedText } from './FormattedText';
import { LinkPreview } from './LinkPreview';
import { EmojiPattern } from './EmojiPattern';
import { PixelIconPattern } from '../pixel-icons/PixelIconPattern';
import { parseDecoration } from '../pixel-icons/decoration';
import { SwipeablePostCard } from './SwipeablePostCard';
import { extractFirstUrl } from '../../services/linkPreview';
import { triggerHaptic } from '../../utils/haptics';
import { formatTimeAgo } from '../../utils/mockData';
import { useT } from '../../i18n/store';
import { perfMonitor } from '../../services/perfMonitor';
import { useSettingsStore } from '../../store/settingsStore';
import { useIsBlocked } from '../../store/blockedUsersStore';
import { BlockedContentPlaceholder } from '../feed/BlockedContentPlaceholder';

// ─── Per-card lazy hydrate ──────────────────────────────────────────────
// Each card defers its body ONE RAF after its own mount so the FlatList
// commit that lands a freshly-virtualized card carries only an empty
// placeholder, with the heavy subtree (FormattedText, LinkPreview,
// EmojiPattern/PixelIconPattern, SwipeablePostCard wrapper, image grid)
// committing on the NEXT frame.
//
// Why per-card (instead of a module-level "first frame done" latch): the
// previous module-level latch flipped to `true` once the initial 2 cards
// had finished their first paint, which meant every subsequent card —
// including ones mounted DURING SCROLL as FlatList virtualization ran —
// initialized with `hydrated = true` and committed its full body in a
// single frame. With ~11 ms of native shadow-tree work per card body, a
// scroll batch landing 2-3 cards on the same frame storms the UI thread
// — that was the perceived "~1 second hang" users reported when they
// opened the profile tab cold and immediately scrolled. Per-card RAF
// spreads each card's mount across two frames regardless of where it
// lands in the session, so no scroll-induced commit ever carries more
// than a handful of empty placeholders + at most one full body.

interface UserProfilePostCardProps {
  post: any;
  authorName: string;
  authorUsername: string;
  authorEmoji: string;
  authorVerified?: boolean;
  authorBadge?: string | null;
  authorId: string;
  /** Viewer-side decoration (own profile-appearance preference).
   *  Applied to every card the viewer sees, regardless of author —
   *  matches the existing `ProfilePostCard` semantics. Optional so
   *  callers that don't care can omit it. */
  postEmoji?: string;
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
  postEmoji,
  onLongPress,
  onImagePress,
}: UserProfilePostCardProps) {
  const theme = useTheme();
  const t = useT();

  // Block-awareness — read the viewer's block state for this profile up
  // front. The actual early return (block placeholder swap) MUST happen
  // AFTER every other hook in this component has been called. React's
  // rules of hooks require a stable hook-count per render: returning
  // before subsequent useState/useEffect/useMemo/useCallback calls would
  // crash with "Rendered fewer hooks than expected" → WatchdogTermination
  // on the false→true transition (the moment the user blocks someone).
  const isAuthorBlocked = useIsBlocked(authorId);

  // Lazy-hydrate the WHOLE card body past the first paint. Each card runs
  // its OWN RAF after mounting — see the header comment for the full
  // rationale. The placeholder fallback below collapses an initial-mount
  // commit from a full subtree to a single empty View, which is what
  // gives each scroll-induced card mount one cheap "warm-up" frame
  // before the real subtree commits.
  // ── SHARED FRAME-PACED QUEUE, NOT A BARE RAF ──────────────────────────────
  //
  // This was `requestAnimationFrame(() => setHydrated(true))`, and a device snapshot showed exactly
  // what that costs on this card: ELEVEN mounts stamped at the same millisecond, immediately followed
  // by a 208 ms long task, and a burst of fourteen image loads whose durations climbed 202 → 219 ms in
  // lockstep because they all started together.
  //
  // A per-card rAF delays each card by one frame but does NOT serialise cards against each other.
  // Every card the list mounts in the same virtualization batch schedules its callback for the SAME
  // next frame, so all of their bodies commit together — the delay moves the storm rather than
  // breaking it up.
  //
  // `enqueueReveal` releases at most two bodies per frame, in mount order, and returns a canceller so
  // a card recycled by a fast scroll before its turn never hydrates off-screen. The own-profile card
  // has used this scheduler for a while; it lived inside that file, which is why this one never got
  // it. It is a shared module now.
  // ── THE GATE IS GONE ──────────────────────────────────────────────────────
  //
  // See the long note in src/components/feed/PostCard.tsx. The 208 ms long task described above was
  // real; so is the cost of spreading it, which on this card is what the user sees when opening
  // someone's profile — 29 mounts assembling two per frame instead of one populated screen.
  const hydrated = true;

  // ── THIS MARK USED TO MEASURE THE WRONG COMMIT ────────────────────────────
  //
  // The effect's deps were [perfEnabled], so it fired after the FIRST commit. On that commit
  // hydrated is false and this component returns a single empty placeholder View. So the number
  // it reported was the span from this render function starting to React flushing effects for a
  // commit that contained almost nothing of this card — which is dominated by whatever ELSE React
  // committed in the same batch.
  //
  // That is why a snapshot showed four cards at 23/22/21/21 ms stamped in the SAME millisecond:
  // they were one commit, and their start timestamps differed only by their own trivial render
  // time. It reads as four expensive cards; it is one batch measured four times.
  //
  // I tuned maxToRenderPerBatch and updateCellsBatchingPeriod against those numbers, and the
  // comment block in app/(tabs)/profile.tsx still cites them as the attribution. The batch size
  // does multiply real per-card cost, so that change was not harmful, but it was not grounded in
  // what I thought it was.
  //
  // Deps are [perfEnabled, hydrated] now and the clock starts on the render where hydrated is
  // already true, so the span covers the commit that actually mounts the body: SwipeablePostCard,
  // the decoration pattern, the thumbnails, FormattedText, LinkPreview, the avatar. That commit
  // was never instrumented at all. The label carries .body so old and new numbers cannot be
  // silently compared.
  const perfEnabled = useSettingsStore((s) => s.perfMonitorEnabled);
  const bodyRenderStart = perfEnabled && hydrated ? Date.now() : 0;
  useEffect(() => {
    if (!perfEnabled || !hydrated) return;
    perfMonitor.markScreenMount('UserProfilePostCard.body', Date.now() - bodyRenderStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfEnabled, hydrated]);

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
  // and skip until hydration so the regex doesn't run on the placeholder.
  const link = useMemo(
    () => (!hasImage && hydrated ? extractFirstUrl(content) : null),
    [hasImage, hydrated, content],
  );
  const timeAgo = useMemo(() => formatTimeAgo(post.createdAt), [post.createdAt]);

  // Parsed once per emoji input. ProfilePostCard hoisted this into a memo a while ago; this card kept
  // running `parseDecoration` inside an IIFE in its JSX, so the prefix logic re-walked on every commit
  // of every row — including the rapid re-renders a scroll drives.
  const decoration = useMemo(() => parseDecoration(postEmoji), [postEmoji]);

  // Keys for the 4-up thumbnail grid, via FlashList v2's documented helper. Same reasoning as the
  // note in src/components/profile/ProfilePostCard.tsx: `getMappingKey` yields the index inside a
  // FlashList cell (so a recycled cell updates its four CachedImages in place rather than remounting
  // them) and the item key outside one. This card renders on the own-profile Likes tab, on
  // app/profile/[id].tsx and in the feed, so it needs to behave in both contexts.
  const { getMappingKey } = useMappingHelper();

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

  // ─── All hooks called above. Conditional early returns below.

  // Block-aware short circuit: if the viewer has blocked this profile's
  // owner, every post on this profile screen is rendered as the placeholder
  // card. This keeps the user from accidentally seeing content from a
  // blocked author when they navigate into that profile (e.g. via a
  // pre-block bookmark or a deep link). The unblock affordance lives on
  // the placeholder itself.
  if (isAuthorBlocked) {
    return <BlockedContentPlaceholder blockedUserId={authorId} username={authorUsername} variant="card" />;
  }

  // First-paint placeholder — outer dimensions match the real card so the
  // layout doesn't jump when the body commits one RAF later. No children,
  // no SwipeablePostCard wrapper, no decoration patterns, no FormattedText/
  // LinkPreview, no Avatar/CachedImage. Initial-mount cost drops from a
  // full subtree to a single empty View.
  if (!hydrated) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: 'transparent', borderColor: 'transparent', height: 120 },
        ]}
      />
    );
  }

  return (
    <SwipeablePostCard>
      <Pressable
        onPress={() => router.push({ pathname: '/comments/[id]', params: { id: post.id } })}
        onLongPress={enrichLongPress}
        delayLongPress={400}
        style={[styles.container, themedContainer]}
      >
        {/* Decoration: viewer-side preference. Same prefix-aware
            parsing as ProfilePostCard so the same picker writes
            apply on both surfaces. */}
        {decoration.kind === 'emoji' ? (
          <EmojiPattern emoji={decoration.value} opacity={theme.isDark ? 0.12 : 0.10} />
        ) : decoration.kind === 'pixel' ? (
          <PixelIconPattern id={decoration.id} opacity={theme.isDark ? 0.18 : 0.14} />
        ) : null}
        {/* Left: Image grid thumbnail */}
        {hasImage ? (
          <Pressable onPress={() => onImagePress(postImages[0], post.id, postImages)}>
            <View style={styles.thumbWrap}>
              {postImages.length === 1 ? (
                <CachedImage uri={postImages[0]} style={styles.thumbSingle} resizeMode="cover" priority="low" skeleton />
              ) : postImages.length === 2 ? (
                <View style={styles.thumbRow}>
                  <CachedImage uri={postImages[0]} style={styles.thumbHalf} resizeMode="cover" priority="low" skeleton />
                  <View style={styles.spacerH} />
                  <CachedImage uri={postImages[1]} style={styles.thumbHalf} resizeMode="cover" priority="low" skeleton />
                </View>
              ) : postImages.length === 3 ? (
                <View style={styles.thumbRow}>
                  <CachedImage uri={postImages[0]} style={styles.thumbHalf} resizeMode="cover" priority="low" skeleton />
                  <View style={styles.spacerH} />
                  <View style={styles.thumbHalfCol}>
                    <CachedImage uri={postImages[1]} style={styles.thumbQuarter} resizeMode="cover" priority="low" skeleton />
                    <View style={styles.spacerV} />
                    <CachedImage uri={postImages[2]} style={styles.thumbQuarter} resizeMode="cover" priority="low" skeleton />
                  </View>
                </View>
              ) : (
                <View style={styles.thumbGrid4}>
                  {postImages.slice(0, 4).map((imgUri: string, idx: number) => (
                    <CachedImage key={getMappingKey(imgUri, idx)} uri={imgUri} style={{ width: 49, height: 49, marginRight: idx % 2 === 0 ? 2 : 0, marginBottom: idx < 2 ? 2 : 0 }} resizeMode="cover" priority="low" skeleton />
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
          {/* Link preview when the post has no image (Telegram-style, instant from cache).
              Non-interactive View so the OUTER card Pressable owns long-press
              uniformly — fixes link-only posts where the menu opened only over
              the preview's exact bounds. */}
          {link ? (
            <View style={styles.linkWrap} pointerEvents="none">
              <LinkPreview url={link} static />
            </View>
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
  prev.postEmoji === next.postEmoji &&
  prev.onLongPress === next.onLongPress &&
  prev.onImagePress === next.onImagePress
);
