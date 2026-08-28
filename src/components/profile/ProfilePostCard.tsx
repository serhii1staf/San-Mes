import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useMappingHelper } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text, Avatar } from '../ui';
import { CachedImage } from '../ui/CachedImage';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { UserBadge } from '../ui/UserBadge';
import { FormattedText } from '../ui/FormattedText';
import { LinkPreview } from '../ui/LinkPreview';
import { EmojiPattern } from '../ui/EmojiPattern';
import { PixelIconPattern } from '../pixel-icons/PixelIconPattern';
import { parseDecoration } from '../pixel-icons/decoration';
import { SwipeablePostCard } from '../ui/SwipeablePostCard';
import { extractFirstUrl } from '../../services/linkPreview';
import { triggerHaptic } from '../../utils/haptics';
import { formatTimeAgo } from '../../utils/mockData';
import { useT } from '../../i18n/store';
import { perfMonitor } from '../../services/perfMonitor';
import { useSettingsStore } from '../../store/settingsStore';
// ── CARD HYDRATION IS FRAME-PACED ───────────────────────────────────────────
//
// A card first commits an empty placeholder and hydrates its heavy body (FormattedText, LinkPreview,
// the emoji/pixel pattern, the SwipeablePostCard wrapper, the image grid) when the shared queue grants
// it a turn — at most two per frame, in mount order.
//
// The queue used to live in this file. It now lives in src/utils/revealQueue.ts, because the OTHER
// post card (src/components/ui/UserProfilePostCard.tsx, used by other people's profiles and the Likes
// tab) had only a bare per-card requestAnimationFrame, and a device snapshot caught what that costs:
// eleven mounts stamped at the same millisecond followed by a 208 ms long task. The full rationale for
// why a shared FIFO beats a per-card rAF is documented there.

interface ProfilePostCardProps {
  post: any;
  authorName: string;
  authorEmoji: string;
  authorVerified?: boolean;
  authorBadge?: string | null;
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

// The four tiles of the 2x2 grid differ only by their gutter margins, and which margins they get is a
// pure function of the index. This was an inline `{ width, height, marginRight: idx % 2 === 0 ? 2 : 0,
// marginBottom: idx < 2 ? 2 : 0 }` built inside a `.map()`, so a four-image row minted four style
// objects on every commit. There are exactly four possible values; here they are.
const GRID4_TILE_STYLES = [
  { width: 49, height: 49, marginRight: 2, marginBottom: 2 },
  { width: 49, height: 49, marginRight: 0, marginBottom: 2 },
  { width: 49, height: 49, marginRight: 2, marginBottom: 0 },
  { width: 49, height: 49, marginRight: 0, marginBottom: 0 },
] as const;

// Memoized profile post card. Extracted + memoized so switching profile tabs (or
// re-rendering the screen) does NOT rebuild every card — only cards whose data
// actually changed re-render. This removes the freeze on the "Posts" tab.
function ProfilePostCardBase({ post, authorName, authorEmoji, authorVerified, authorBadge, postEmoji, onLongPress, onImagePress }: ProfilePostCardProps) {
  const theme = useTheme();
  const t = useT();

  // Lazy-hydrate the WHOLE card body past the first paint via the SHARED
  // frame-paced reveal scheduler (module-level, top of file). On mount this
  // card joins the FIFO queue; the pump flips `hydrated` to true on the
  // card's staggered turn (≤ REVEAL_CARDS_PER_FRAME cards per frame, in mount
  // order). The placeholder fallback below keeps the initial commit to a
  // single empty View, and the shared queue guarantees that even when a whole
  // FlatList batch mounts on one frame their bodies commit a few-per-frame
  // instead of all-at-once — eliminating the stacked long-task hang.
  //
  // Cancel-on-unmount: if this card recycles (fast scroll) before its turn,
  // the canceller drops its queue slot so it never hydrates offscreen and
  // never leaks. Empty deps → enqueue exactly once per mount.
  // ── THE GATE IS GONE ──────────────────────────────────────────────────────
  //
  // See the long note in src/components/feed/PostCard.tsx for the full argument. Short version: the
  // queue fragmented one commit into four, which is more total work and reads as the screen assembling
  // itself in front of the user. The `listReady` deletion in app/chat/[id].tsx is the precedent.
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
  //
  // The span was still wrong for a batch, which is how these cards always arrive. React renders every
  // card in the commit, commits, then flushes the effects together, so the first card's number
  // contains all the later ones and the last card's is near zero. Eight marks in one millisecond
  // reading 120/109/102/85/75/63/50/25 were one interval measured eight times, and `avgMountMs` was
  // summing them. `noteBatchRender` + `markBatchCommit` measure the commit once and report the batch
  // size with it — see their note in perfMonitor.ts.
  // The ref keeps `count` equal to "cards newly mounting in this commit". Noting on every render let a
  // plain re-render stamp a start no effect would drain, which is how this route reported a
  // `worstMountMs` of 3528 ms — a span across idle time, not a commit.
  const perfEnabled = useSettingsStore((s) => s.perfMonitorEnabled);
  const perfNotedRef = useRef(false);
  if (perfEnabled && hydrated && !perfNotedRef.current) {
    perfNotedRef.current = true;
    perfMonitor.noteBatchRender('ProfilePostCard.body');
  }
  useEffect(() => {
    if (!perfEnabled || !hydrated) return;
    perfMonitor.markBatchCommit('ProfilePostCard.body');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfEnabled, hydrated]);

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
  // A repost embed's image comes from the ORIGINAL post (`origPost`), which
  // the feed already rendered through the weserv proxy at its default width
  // (≈800 px). The thumbnail here is only 100 px, so requesting the image at
  // proxyWidth=100 produces a DIFFERENT proxy URL — and therefore a different
  // expo-image cache key — than the feed used, missing the already-decoded
  // bytes and showing an empty container until a fresh fetch lands (the
  // reported bug). When the image is sourced from the repost original,
  // request the feed-aligned width (proxyWidth=400 → w=800 after DPR) so the
  // cached bytes are reused and the thumbnail paints instantly. Own-post
  // thumbnails (often a just-uploaded local URI that bypasses the proxy)
  // keep the tighter 100 px width.
  const imgFromRepostOriginal =
    isRepostPost && !(post.imageUrls && post.imageUrls.length) && !post.imageUrl;
  const singleProxyWidth = imgFromRepostOriginal ? 400 : 100;
  // Skip the URL-extraction regex entirely when the post has an image
  // (the image is already the cover; the link preview would not show)
  // AND skip until hydration so the regex never runs on the placeholder
  // commit.
  const link = useMemo(
    () => (!hasImage && hydrated ? extractFirstUrl(content) : null),
    [hasImage, hydrated, content],
  );
  const timeAgo = useMemo(() => formatTimeAgo(post.createdAt), [post.createdAt]);

  // Parse the decoration ONCE per emoji input instead of re-walking the
  // prefix logic inside an IIFE on every commit. `parseDecoration` is cheap
  // per call, but with a screenful of cards re-rendering (theme flip, sibling
  // updates) it added up to needless work on the hot commit path. Keyed on
  // the raw `postEmoji` string so it only recomputes when the emoji changes.
  const decoration = useMemo(() => parseDecoration(postEmoji), [postEmoji]);

  // ── KEYS FOR THE 4-UP THUMBNAIL GRID ──────────────────────────────────────
  //
  // The grid below used `key={idx}`. FlashList v2 ships `useMappingHelper` for exactly this
  // situation, and it is what the list is now driven by, so the card uses it.
  //
  // Worth being precise about what it does, because the migration brief claimed the old `key={idx}`
  // was silently killing recycling and that is not what the helper's source says. `getMappingKey`
  // returns the INDEX when the component renders inside a FlashList cell, and the item key only
  // outside one. Inside the list, index keys are the desired behaviour: a recycled cell keeps the
  // same four child slots and React updates their props in place instead of unmounting four
  // CachedImages and mounting four more. So the old code was already producing the right key inside
  // the list — this change makes the intent explicit and keeps the card correct if it is ever
  // rendered outside a FlashList (where keying by URI is what React wants).
  const { getMappingKey } = useMappingHelper();

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
  // ── ONE FLAT FILL INSTEAD OF UP TO FOUR SHIMMERS ──────────────────────────
  //
  // Every thumbnail in the grid below used to pass `skeleton`, which mounts a `Skeleton`: a container
  // View, a Reanimated.View, a `LinearGradient` with a five-stop shader, a shared value, a worklet and
  // a `useSyncExternalStore` subscription — per thumbnail. A four-image row therefore carried twelve
  // extra native views, four gradient shaders and four animated-style mappers, all to decorate boxes
  // that are 49 x 49 points. At that size the sweep is not a loading affordance, it is noise.
  //
  // Worse, the shimmer does not stop when the row leaves the viewport. Skeleton's clock is shared and
  // reference-counted so there is only ONE animation driver, but each instance still keeps its own
  // `useAnimatedStyle` mapper, and FlashList holds recycled cells mounted within `drawDistance`. So
  // off-screen thumbnails were still having their sweep transform recomputed on the UI thread every
  // frame, during the scroll.
  //
  // The feed already reached this conclusion for its hero image and wrote it down: a flat theme-aware
  // fill is "far cheaper than the old `skeleton` shimmer (LinearGradient + Reanimated loop) that
  // FlashList had to mount/unmount for every recycled cell during scroll". This applies the same
  // treatment here, and does it ONCE on the 100 x 100 wrapper rather than per thumbnail — the images
  // sit on top of it, so a not-yet-loaded tile shows the fill and nothing shifts when it arrives.
  const themedThumbWrap = useMemo(
    () => ({ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }),
    [theme.isDark],
  );

  // First-paint placeholder — outer dimensions match the real card so the
  // layout doesn't jump when the body commits one RAF later. No children,
  // no SwipeablePostCard wrapper, no EmojiPattern/PixelIconPattern, no
  // FormattedText/LinkPreview, no Avatar/CachedImage. This collapses each
  // card's initial mount from ~11ms of native shadow-tree work to ~1ms.
  // 120 ≈ thumb 100 + container padding 10*2; right column matches because
  // the real card's content height tracks the thumb on most posts.
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
        onLongPress={() => { triggerHaptic('medium'); onLongPress(post); }}
        delayLongPress={400}
        style={[styles.container, themedContainer]}
      >
        {/* Decoration: parsed from the postEmoji string (memoized above as
            `decoration` so the prefix logic isn't re-walked per commit).
            Legacy raw emoji ("🌸") and explicit "emoji:🌸" both render as
            EmojiPattern; "pixel:<id>" routes to PixelIconPattern.
            Keeps the store schema unchanged while supporting both. */}
        {decoration.kind === 'emoji' ? (
          <EmojiPattern emoji={decoration.value} opacity={theme.isDark ? 0.12 : 0.10} />
        ) : decoration.kind === 'pixel' ? (
          <PixelIconPattern id={decoration.id} opacity={theme.isDark ? 0.18 : 0.14} />
        ) : null}

        {/* ── ANIMATED THUMBNAILS ARE A CONTINUOUS UI-THREAD COST ──────────────
            `autoplay={false}` on every tile below. An animated GIF/WebP in a
            100x100 (or 49x49) thumbnail decodes EVERY FRAME for as long as the
            list retains the cell, off-screen ones included. That is a permanent
            drain, not a mount spike, which is why (tabs)/profile measured
            SUSTAINED worstFps 25 / jankCount 3 / pendingDecodes 16 with giphy
            hosts in the IMG log.

            Same defect chat and comments already fixed; they use a visibility
            tracker because a full-width GIF in a message should animate once the
            list settles. A profile tile this small should never animate, so the
            static first frame is the correct fix here, consistent with the dense
            grids in GifPanel.tsx / settings/stickers.tsx / MediaPanel.tsx.
            See the longer note in src/components/ui/UserProfilePostCard.tsx. */}
        {hasImage ? (
          <Pressable onPress={() => onImagePress(imgs[0], post.id, imgs)}>
            <View style={[styles.thumbWrap, themedThumbWrap]}>
              {imgs.length === 1 ? (
                <CachedImage uri={imgs[0]} style={styles.thumbSingle} resizeMode="cover" proxyWidth={singleProxyWidth} priority="low" autoplay={false} />
              ) : imgs.length === 2 ? (
                <View style={styles.thumbRow}>
                  <CachedImage uri={imgs[0]} style={styles.thumbHalf} resizeMode="cover" proxyWidth={49} priority="low" autoplay={false} />
                  <View style={styles.spacerH} />
                  <CachedImage uri={imgs[1]} style={styles.thumbHalf} resizeMode="cover" proxyWidth={49} priority="low" autoplay={false} />
                </View>
              ) : imgs.length === 3 ? (
                <View style={styles.thumbRow}>
                  <CachedImage uri={imgs[0]} style={styles.thumbHalf} resizeMode="cover" proxyWidth={49} priority="low" autoplay={false} />
                  <View style={styles.spacerH} />
                  <View style={styles.thumbHalfCol}>
                    <CachedImage uri={imgs[1]} style={styles.thumbQuarter} resizeMode="cover" proxyWidth={49} priority="low" autoplay={false} />
                    <View style={styles.spacerV} />
                    <CachedImage uri={imgs[2]} style={styles.thumbQuarter} resizeMode="cover" proxyWidth={49} priority="low" autoplay={false} />
                  </View>
                </View>
              ) : (
                <View style={styles.thumbGrid4}>
                  {imgs.slice(0, 4).map((imgUri, idx) => (
                    <CachedImage key={getMappingKey(imgUri, idx)} uri={imgUri} style={GRID4_TILE_STYLES[idx]} resizeMode="cover" proxyWidth={49} priority="low" autoplay={false} />
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
            // Plain non-interactive View (NOT a nested Pressable): the OUTER
            // card Pressable then owns long-press uniformly across the whole
            // card. The previous inner Pressable only caught long-press over
            // the preview's exact bounds, so on link-only posts the menu
            // opened "only in certain spots / not first try". `pointerEvents
            // none` guarantees the preview never steals the touch.
            <View style={styles.linkWrap} pointerEvents="none">
              <LinkPreview url={link} static />
            </View>
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
