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
import { PixelIconPattern } from '../pixel-icons/PixelIconPattern';
import { parseDecoration } from '../pixel-icons/decoration';
import { SwipeablePostCard } from '../ui/SwipeablePostCard';
import { extractFirstUrl } from '../../services/linkPreview';
import { triggerHaptic } from '../../utils/haptics';
import { formatTimeAgo } from '../../utils/mockData';
import { useT } from '../../i18n/store';
import { perfMonitor } from '../../services/perfMonitor';
import { useSettingsStore } from '../../store/settingsStore';

// ─── Shared frame-paced hydrate scheduler ───────────────────────────────
// Each card mounts as an empty same-size placeholder and asks a SHARED FIFO
// "reveal permit" scheduler (the module-level singleton below) for
// permission to hydrate its heavy body (FormattedText, LinkPreview,
// EmojiPattern/PixelIconPattern, SwipeablePostCard wrapper, image grid).
//
// Why a shared queue instead of a bare per-card RAF: a plain
// `requestAnimationFrame(() => setHydrated(true))` only delays each card by
// ONE frame — it does NOT serialize cards relative to each other. Every card
// that FlatList mounts in the same virtualization batch schedules its RAF
// for the SAME next frame, so all of their heavy bodies commit together one
// frame later = N × ~11-36 ms of native shadow-tree work stacked into a
// single long task. That was the "~1 second hang" (ui < 30 markers) the perf
// audit flagged when the profile tab mounts/scrolls a batch of cards.
//
// The scheduler below grants hydration to at most REVEAL_CARDS_PER_FRAME
// cards PER animation frame, in mount order (FIFO). A single rAF "pump"
// releases the next waiter(s) each frame and re-arms itself while the queue
// is non-empty. Each card enqueues on mount and REMOVES itself from the queue
// on unmount (cancel-on-unmount), so a fast scroll that recycles cards before
// their turn never hydrates an offscreen card and never leaks queue slots.
// A card that unmounts while queued simply drops its slot; the pump shifts
// the next waiter, so the queue can never deadlock. Mirrors the proven
// `useStaggeredReveal` pump and `scheduleRowArm` one-per-frame pattern.
const __revealQueue: Array<() => void> = [];
let __revealPumpScheduled = false;
// At most this many card bodies hydrate per frame. Two keeps the cascade
// fast (a screenful reveals in a handful of frames) while guaranteeing no
// single frame ever commits more than ~2 full card bodies — so the stacked
// long task is gone whether cards land on cold open or mid-scroll.
const REVEAL_CARDS_PER_FRAME = 2;

function __pumpRevealQueue() {
  __revealPumpScheduled = false;
  // Release up to REVEAL_CARDS_PER_FRAME waiters this frame, in FIFO order.
  for (let i = 0; i < REVEAL_CARDS_PER_FRAME; i++) {
    const fn = __revealQueue.shift();
    if (!fn) break;
    try { fn(); } catch { /* card unmounted between enqueue + pump */ }
  }
  // Re-arm while there is still pending work — one waiter (batch) per frame.
  if (__revealQueue.length > 0) {
    __revealPumpScheduled = true;
    requestAnimationFrame(__pumpRevealQueue);
  }
}

// Enqueue a hydration waiter; returns a canceller that drops this card's slot
// if it unmounts (recycles) before its turn. Safe to call the canceller after
// the waiter already fired — it just finds nothing to remove.
function enqueueReveal(fn: () => void): () => void {
  __revealQueue.push(fn);
  if (!__revealPumpScheduled) {
    __revealPumpScheduled = true;
    requestAnimationFrame(__pumpRevealQueue);
  }
  return () => {
    const i = __revealQueue.indexOf(fn);
    if (i >= 0) __revealQueue.splice(i, 1);
  };
}

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

  // Mount-time diagnostic — only schedules a useEffect at all when the
  // perf-monitor panel is enabled. Previously the effect fired on every
  // card mount unconditionally, paying one Date.now() + microtask per
  // card. With ~40 cards committing per profile-open that's 40 wasted
  // microtasks for users who don't have the panel on (i.e. everyone in
  // production).
  const perfEnabled = useSettingsStore((s) => s.perfMonitorEnabled);
  const renderStart = perfEnabled ? Date.now() : 0;
  useEffect(() => {
    if (!perfEnabled) return;
    perfMonitor.markScreenMount('ProfilePostCard', Date.now() - renderStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfEnabled]);

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
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const cancel = enqueueReveal(() => setHydrated(true));
    return cancel;
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

        {hasImage ? (
          <Pressable onPress={() => onImagePress(imgs[0], post.id, imgs)}>
            <View style={styles.thumbWrap}>
              {imgs.length === 1 ? (
                <CachedImage uri={imgs[0]} style={styles.thumbSingle} resizeMode="cover" proxyWidth={singleProxyWidth} priority="low" skeleton />
              ) : imgs.length === 2 ? (
                <View style={styles.thumbRow}>
                  <CachedImage uri={imgs[0]} style={styles.thumbHalf} resizeMode="cover" proxyWidth={49} priority="low" skeleton />
                  <View style={styles.spacerH} />
                  <CachedImage uri={imgs[1]} style={styles.thumbHalf} resizeMode="cover" proxyWidth={49} priority="low" skeleton />
                </View>
              ) : imgs.length === 3 ? (
                <View style={styles.thumbRow}>
                  <CachedImage uri={imgs[0]} style={styles.thumbHalf} resizeMode="cover" proxyWidth={49} priority="low" skeleton />
                  <View style={styles.spacerH} />
                  <View style={styles.thumbHalfCol}>
                    <CachedImage uri={imgs[1]} style={styles.thumbQuarter} resizeMode="cover" proxyWidth={49} priority="low" skeleton />
                    <View style={styles.spacerV} />
                    <CachedImage uri={imgs[2]} style={styles.thumbQuarter} resizeMode="cover" proxyWidth={49} priority="low" skeleton />
                  </View>
                </View>
              ) : (
                <View style={styles.thumbGrid4}>
                  {imgs.slice(0, 4).map((imgUri, idx) => (
                    <CachedImage key={idx} uri={imgUri} style={{ width: 49, height: 49, marginRight: idx % 2 === 0 ? 2 : 0, marginBottom: idx < 2 ? 2 : 0 }} resizeMode="cover" proxyWidth={49} priority="low" skeleton />
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
