/**
 * The tabs under a profile header: «Публикации», «Медиа», «Ответы».
 *
 * Publishing lives here and nowhere else: there is no feed. Visitors read someone's posts on their
 * profile and open a post to comment on it; the owner writes a new post from the «Публикации» tab.
 *
 * Rendered inside the profile's ScrollView as plain views (one page of 30 at most), not as a list
 * component: the profile screens are guarded to stay list-free. What keeps a profile cheap is WHEN
 * things mount, not the list type:
 *
 *   • Opening. Only the first few cards are built in the push commit; the rest are added a few per
 *     frame once the push animation has finished (`useTransitionSettled`, not
 *     `runAfterInteractions`, which fires in the middle of a native-stack push).
 *   • Switching tabs. Each pane is built the first time its tab is opened and then kept. Switching
 *     only flips which pane is in the layout. It used to unmount the pane that was left and mount
 *     the other one from scratch, all thirty cards in one commit on every tap, which is the frame
 *     drop seen when tapping quickly between «Публикации» and «Медиа».
 *
 * Hidden panes are taken out of the flow (absolute, so the page height is the visible pane's) and
 * made transparent and untouchable. Not `display: 'none'`: Fabric drops the native views of a
 * hidden subtree, so every switch would rebuild them anyway.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing as RNEasing, Pressable, StyleSheet, View, useWindowDimensions, ActivityIndicator, type LayoutChangeEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import Reanimated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import type { ActionMenuAnchor } from '../ui/ActionMenu';
import { ProfilePostMenu } from './ProfilePostMenu';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { CachedImage } from '../ui/CachedImage';
import { GlassBg, useLiquidGlassActive } from '../ui/LiquidGlass';
import { triggerHaptic } from '../../utils/haptics';
import { useT } from '../../i18n/store';
import { useShortAgo } from '../../utils/shortAgo';
import { parseImageUrls } from '../../lib/supabase';
import { useIsBlocked } from '../../store/blockedUsersStore';
import { useProfileAppearanceStore } from '../../store/profileAppearanceStore';
import { stripMarkers } from '../../utils/previewText';
import { useTransitionSettled } from '../../hooks/useTransitionSettled';
import { ProfilePostCard } from './ProfilePostCard';
import { useRestFlag, type ScrollRest } from './scrollRest';
import { UI_RUNTIME_MAPPERS } from '../../utils/workletGuards';
import {
  useProfilePosts,
  useProfileReplies,
  type ProfilePost,
  type ProfileReply,
} from '../../services/profilePosts';

type TabKey = 'posts' | 'media' | 'replies';
const TAB_KEYS: TabKey[] = ['posts', 'media', 'replies'];

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
 * `ready` (the screen's push animation is over).
 *
 * The first batch is a screenful, so a cached profile is complete in its very first frame (an
 * empty page filling in waves read as "the data reloads every time"). Only cards below the fold
 * are added progressively, where nobody sees them arrive.
 */
function useProgressiveCount(total: number, ready: boolean, first: number, step: number): number {
  const [count, setCount] = useState(first);
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
  /** Where the scroll last came to rest, for pausing the compose row's ticker once it is scrolled away. */
  rest?: ScrollRest;
  top: number;
  bottomPad: number;
  /** Height of what floats over the bottom of the screen (the tab bar on the own profile), or 0. */
  chromeBottom?: number;
}

const STRIP_PAD = 4;
const STRIP_GAP = 4;

const TabStrip = memo(function TabStrip({ value, onChange }: { value: TabKey; onChange: (k: TabKey) => void }) {
  const theme = useTheme();
  const t = useT();
  const glassActive = useLiquidGlassActive();
  const reduceMotion = useReducedMotion();
  const scheme = theme.isDark ? 'dark' : 'light';
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'posts', label: t('profile.publications') },
    { key: 'media', label: t('profile.media') },
    { key: 'replies', label: t('profile.replies') },
  ];
  const fill = theme.colors.accent.primary + (glassActive ? '33' : '26');

  // One highlight that slides between the tabs (UI thread), instead of each tab drawing its own.
  const [stripW, setStripW] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setStripW((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
  }, []);
  const itemW = stripW > 0 ? (stripW - STRIP_PAD * 2 - STRIP_GAP * (TAB_KEYS.length - 1)) / TAB_KEYS.length : 0;
  const index = TAB_KEYS.indexOf(value);
  const pos = useSharedValue(index);
  useEffect(() => {
    pos.value = reduceMotion ? index : withTiming(index, { duration: 240, easing: Easing.out(Easing.cubic) });
  }, [index, reduceMotion, pos]);
  // First run on the JS thread: the resting position, without a synchronous read of the UI runtime
  // (see `UI_RUNTIME_MAPPERS`); it mounts during the push.
  const indicatorStyle = useAnimatedStyle(() => {
    if (UI_RUNTIME_MAPPERS && !globalThis._WORKLET) return { transform: [{ translateX: index * (itemW + STRIP_GAP) }] };
    return { transform: [{ translateX: pos.value * (itemW + STRIP_GAP) }] };
  });

  return (
    <View style={[styles.strip, glassActive ? null : { backgroundColor: theme.colors.background.elevated }]} onLayout={onLayout}>
      {/* Liquid glass behind the whole strip where the material exists (iOS 26 with glass on);
          the flat elevated surface everywhere else. */}
      {glassActive ? <GlassBg borderRadius={20} colorScheme={scheme} /> : null}
      {/* A tinted fill, not a second glass view: this strip moves with every scroll frame, and
          each glass view re-samples what is behind it on every one of them. A sibling of the
          glass, so nothing above the glass ever carries an alpha. */}
      {itemW > 0 ? (
        <Reanimated.View pointerEvents="none" style={[styles.indicator, { width: itemW, backgroundColor: fill }, indicatorStyle]} />
      ) : null}
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
              // Until the strip has been measured (its first frame) the active tab draws its own fill.
              active && itemW === 0 ? { backgroundColor: fill } : null,
            ]}
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

// ── «Что нового?» emoji ticker ──────────────────────────────────────────────
// Replaces the photo icon on the compose row: one emoji at a time, cross-fading into the next while
// drifting up a little. It stops when the profile or its pane is not on screen, when the page rests with
// the row scrolled under the pinned tabs, or when Reduce Motion is on.
//
// ── ON THE NATIVE ANIMATED DRIVER, NOT A REANIMATED STYLE ────────────────────
// This runs for as long as the own profile is open, so its per-frame cost is the profile's idle cost.
// A Reanimated style is applied with a shadow-tree commit (layout pass and mount) on every frame;
// Reanimated 4.1 has no faster path for it on iOS. The native driver sets the layer's opacity and
// transform directly and never touches the JS thread or the shadow tree. Same curves as before,
// expressed as interpolation ranges over one value that runs 0 → TICKER.length per cycle.
const TICKER = ['🖼️', '✨', '📸', '🎧', '💭', '🌿', '😊'];
const TICKER_STEP_MS = 2600;
const FADE = 0.25;
const TICKER_RISE = FADE * 24;

// ── ONLY THE CROSSFADES ANIMATE; THE HOLD COSTS NO FRAMES ─────────────────────
//
// Measured on the own profile (Android emulator, the screen left idle): with this ticker running the
// screen drew 125-140 frames a second and its UI thread was busy most of the time; with the ticker off,
// 3 frames a second. The ticker was one linear animation across the whole 18.2 s cycle, so the native
// driver updated all seven glyphs on every frame, including the 1.95 s of each 2.6 s step in which
// nothing on screen changes (one glyph sits still at full opacity).
//
// So the driving value now counts crossfades instead of time: glyph k is shown at u = k, and the
// crossfade from k to k + 1 is u going from k to k + 1. Each step waits TICKER_HOLD_MS on a JS timer
// (`delay`, which starts the native animation only when it fires) and then animates for TICKER_FADE_MS.
// The curves, the timings and the order are the same as before; only the frames during the hold are gone.
//
// The steps run inside `Animated.loop`, which marks each one as looping. That matters on Fabric: a
// native animation that ends outside a loop re-renders every view bound to its value, to copy the end
// value into the shadow tree (Animation.js, `__findAnimatedPropsNodes(...).update()`), which here would
// be seven re-renders and a commit every 2.6 s. Inside a loop only the JS copy of the value is updated.
const TICKER_FADE_MS = Math.round(TICKER_STEP_MS * FADE);
const TICKER_HOLD_MS = TICKER_STEP_MS - TICKER_FADE_MS;
/** The panes' margin under the tab strip (styles.panes), and the compose row's height (styles.compose). */
const PANES_TOP = 12;
const COMPOSE_ROW_H = 58; // 10 + the 36 pt icon + 10, and the 1 pt border twice

/** Interpolation ranges for glyph `index` over u: in at [index - 1, index], out at [index, index + 1]. */
function tickerRanges(index: number) {
  const n = TICKER.length;
  if (index === 0) {
    // Shown at the start of the cycle, fades out first, and fades back in during the last crossfade.
    return {
      input: [0, 1, n - 1, n],
      opacity: [1, 0, 0, 1],
      y: [0, -TICKER_RISE, TICKER_RISE, 0],
      scale: [1, 0.9, 0.9, 1],
    };
  }
  return {
    input: [index - 1, index, index + 1],
    opacity: [0, 1, 0],
    y: [TICKER_RISE, 0, -TICKER_RISE],
    scale: [0.9, 1, 0.9],
  };
}

const TickerGlyph = memo(function TickerGlyph({ glyph, index, v }: { glyph: string; index: number; v: Animated.Value }) {
  const style = useMemo(() => {
    const r = tickerRanges(index);
    return {
      opacity: v.interpolate({ inputRange: r.input, outputRange: r.opacity, extrapolate: 'clamp' }),
      transform: [
        { translateY: v.interpolate({ inputRange: r.input, outputRange: r.y, extrapolate: 'clamp' }) },
        { scale: v.interpolate({ inputRange: r.input, outputRange: r.scale, extrapolate: 'clamp' }) },
      ],
    };
  }, [index, v]);
  return <Animated.Text allowFontScaling={false} style={[styles.tickerGlyph, style]}>{glyph}</Animated.Text>;
});

/** Glyph k to k + 1: hold the shown glyph, then crossfade. */
function tickerStep(v: Animated.Value, k: number): Animated.CompositeAnimation {
  return Animated.timing(v, {
    toValue: k + 1,
    duration: TICKER_FADE_MS,
    delay: TICKER_HOLD_MS,
    easing: RNEasing.linear,
    useNativeDriver: true,
  });
}

/** u = n back to u = 0 in one frame. Both show the first glyph alone, so nothing visible changes. */
function tickerWrap(v: Animated.Value): Animated.CompositeAnimation {
  return Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true });
}

/**
 * Whole cycles starting at glyph `from`: `from` to n, the wrap, 0 to `from`, so each ends where it
 * began. `resetBeforeIteration: false` keeps the loop from setting the value back to 0 first, which is
 * what lets a resumed ticker carry on from the glyph it was paused on.
 */
function tickerLoop(v: Animated.Value, from: number): Animated.CompositeAnimation {
  const n = TICKER.length;
  const steps: Animated.CompositeAnimation[] = [];
  for (let i = 0; i < n; i++) {
    const k = (from + i) % n;
    steps.push(tickerStep(v, k));
    if (k + 1 === n) steps.push(tickerWrap(v));
  }
  return Animated.loop(Animated.sequence(steps), { resetBeforeIteration: false });
}

function EmojiTicker({ visible }: { visible: boolean }) {
  const focused = useIsFocused();
  const reduceMotion = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  const running = focused && visible && !reduceMotion;
  useEffect(() => {
    if (!running) {
      v.stopAnimation();
      return;
    }
    // Carry on from what is showing, so a pause (another tab, the row scrolled away) does not snap back
    // to the first glyph. The value is read back from the native side; it is 0 on the first start.
    let anim: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    v.stopAnimation((value) => {
      if (cancelled) return;
      const n = TICKER.length;
      const u = Number.isFinite(value) ? Math.min(n, Math.max(0, value)) : 0;
      const k = Math.floor(u + 1e-3);
      const parts: Animated.CompositeAnimation[] = [];
      let from = k % n;
      if (u - k > 1e-3) {
        // Paused in the middle of a crossfade: finish it at its own speed, then hold as usual.
        parts.push(
          Animated.timing(v, {
            toValue: k + 1,
            duration: Math.round(TICKER_FADE_MS * (k + 1 - u)),
            easing: RNEasing.linear,
            useNativeDriver: true,
          }),
        );
        if (k + 1 === n) parts.push(tickerWrap(v));
        from = (k + 1) % n;
      } else if (k === n) {
        parts.push(tickerWrap(v));
      }
      parts.push(tickerLoop(v, from));
      anim = parts.length === 1 ? parts[0] : Animated.sequence(parts);
      anim.start();
    });
    return () => {
      cancelled = true;
      anim?.stop();
    };
  }, [running, v]);
  return (
    <View style={styles.ticker} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      {TICKER.map((g, i) => <TickerGlyph key={g} glyph={g} index={i} v={v} />)}
    </View>
  );
}

function Empty({ icon, text }: { icon: React.ComponentProps<typeof Feather>['name']; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Feather name={icon} size={26} color={theme.colors.text.tertiary} />
      <Text variant="caption" color={theme.colors.text.tertiary} align="center">{text}</Text>
    </View>
  );
}

/** A kept-alive tab page: in the layout while its tab is selected, transparent and inert otherwise. */
function Pane({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <View
      style={active ? null : styles.paneHidden}
      pointerEvents={active ? 'auto' : 'none'}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    >
      {children}
    </View>
  );
}

const PostsPane = memo(function PostsPane({
  posts, loading, isOwn, tickerOn, ready, authorName, authorEmoji, authorVerified, authorBadge, onLongPressPost,
}: {
  posts: ProfilePost[];
  loading: boolean;
  isOwn: boolean;
  /** The compose row is on screen: this pane is the selected one and the row is not scrolled away. */
  tickerOn: boolean;
  ready: boolean;
  authorName: string;
  authorEmoji: string;
  authorVerified?: boolean;
  authorBadge?: string | null;
  onLongPressPost: (p: ProfilePost, anchor: ActionMenuAnchor | null) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const postEmoji = useProfileAppearanceStore((s) => s.postEmoji);
  // One card per frame after the first four, not three: each card is an image or two, formatted text,
  // a link preview, an avatar and a badge, and three of them made back-to-back long frames right when
  // the reader starts to scroll. Smaller commits leave the frames in between to the scroll.
  const shown = useProgressiveCount(posts.length, ready, 4, 1);
  const hairline = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const onPressPost = useCallback((p: ProfilePost) => openPost(p.id), []);
  const compose = useCallback(() => {
    triggerHaptic('light');
    router.push('/post/new' as any);
  }, []);
  return (
    <>
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
          <EmojiTicker visible={tickerOn} />
        </Pressable>
      ) : null}
      {loading && posts.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 28 }} color={theme.colors.text.tertiary} />
      ) : posts.length === 0 ? (
        <Empty icon="file-text" text={t('profile.no_posts')} />
      ) : (
        posts.slice(0, shown).map((p) => (
          <ProfilePostCard
            key={p.id}
            post={p}
            authorName={authorName}
            authorEmoji={authorEmoji}
            authorVerified={authorVerified}
            authorBadge={authorBadge}
            postEmoji={postEmoji}
            onPress={onPressPost}
            onLongPress={onLongPressPost}
          />
        ))
      )}
    </>
  );
});

const MediaPane = memo(function MediaPane({ posts, loading, ready }: { posts: ProfilePost[]; loading: boolean; ready: boolean }) {
  const theme = useTheme();
  const t = useT();
  const { width } = useWindowDimensions();
  const media = useMemo(() => {
    const out: { url: string; postId: string }[] = [];
    for (const p of posts) {
      for (const u of parseImageUrls(p.image_url)) {
        if (!isAnimated(u)) out.push({ url: u, postId: p.id });
      }
    }
    return out;
  }, [posts]);
  const shown = useProgressiveCount(media.length, ready, 12, 12);
  const cell = Math.floor((width - 32 - 3 * 2) / 3);
  if (loading && posts.length === 0) return <ActivityIndicator style={{ marginTop: 28 }} color={theme.colors.text.tertiary} />;
  if (media.length === 0) return <Empty icon="image" text={t('profile.media_posts_empty')} />;
  return (
    <View style={styles.mediaGrid}>
      {media.slice(0, shown).map((m) => (
        <Pressable key={m.url} onPress={() => openPost(m.postId)} style={[styles.mediaCell, { width: cell, height: cell, backgroundColor: theme.colors.background.elevated }]}>
          {/* The display width, not twice it: `proxiedImageUrl` doubles for density itself, so
              `cell * 2` asked for four times the cell's width (and 16x its pixels) in the URL. */}
          <CachedImage uri={m.url} style={{ width: cell, height: cell }} resizeMode="cover" proxyWidth={cell} />
        </Pressable>
      ))}
    </View>
  );
});

/** Built the first time «Ответы» is opened, which is also when its request is made. */
const RepliesPane = memo(function RepliesPane({ profileId, ready }: { profileId: string; ready: boolean }) {
  const theme = useTheme();
  const t = useT();
  const { replies, loading } = useProfileReplies(profileId);
  const shown = useProgressiveCount(replies.length, ready, 5, 5);
  if (loading && replies.length === 0) return <ActivityIndicator style={{ marginTop: 28 }} color={theme.colors.text.tertiary} />;
  if (replies.length === 0) return <Empty icon="message-square" text={t('profile.replies_empty')} />;
  return <>{replies.slice(0, shown).map((r) => <ReplyRow key={r.id} reply={r} />)}</>;
});

export function ProfileContentTabs({ profileId, isOwn, author, sticky }: { profileId: string; isOwn: boolean; author: ProfileAuthor; sticky?: ProfileStickyTabs }) {
  const theme = useTheme();
  const t = useT();
  const { height: winHeight } = useWindowDimensions();
  const settled = useTransitionSettled();
  const [tab, setTab] = useState<TabKey>('posts');
  const [opened, setOpened] = useState<Record<TabKey, boolean>>({ posts: true, media: false, replies: false });
  const selectTab = useCallback((k: TabKey) => {
    setTab(k);
    setOpened((o) => (o[k] ? o : { ...o, [k]: true }));
  }, []);

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
  // The strip's own height, for the post menu's visible band. A ref: read only when a menu opens.
  const stripHRef = useRef(48);
  const onStripLayout = useCallback((e: LayoutChangeEvent) => {
    stripHRef.current = e.nativeEvent.layout.height;
  }, []);
  const scrollY = sticky?.scrollY;
  const stickyTop = sticky?.top ?? 0;
  const stickAt = stripY === null ? null : Math.max(0, stripY - stickyTop);
  // The compose row (the first thing in «Публикации») is under the pinned strip once the page rests
  // with the row's bottom above the strip's: stripY + strip + PANES_TOP + row - y <= top + strip.
  const composeAway = useRestFlag(
    sticky?.rest,
    (y) => stripY !== null && y >= stripY + PANES_TOP + COMPOSE_ROW_H - stickyTop,
  );
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
  const { posts, loading } = useProfilePosts(blocked ? undefined : profileId);

  // Every post gets the long-press menu: own posts for copy / share / delete, everyone else's for
  // copy / share / report / block (report and block are required on UGC by App Review 1.2).
  const [menuFor, setMenuFor] = useState<{ post: ProfilePost; anchor: ActionMenuAnchor | null } | null>(null);
  const onLongPressPost = useCallback((p: ProfilePost, anchor: ActionMenuAnchor | null) => {
    triggerHaptic('medium');
    setMenuFor({ post: p, anchor });
  }, []);
  const closeMenu = useCallback(() => setMenuFor(null), []);

  if (blocked) {
    return (
      <View style={[styles.wrap, wrapMinHeight ? { minHeight: wrapMinHeight } : null]}>
        <Empty icon="slash" text={t('profile.blocked_content')} />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, wrapMinHeight ? { minHeight: wrapMinHeight } : null]} onLayout={sticky ? onWrapLayout : undefined}>
      <Animated.View onLayout={onStripLayout} style={[styles.stickyLayer, stickTranslate ? { transform: [{ translateY: stickTranslate }] } : null]}>
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
        <TabStrip value={tab} onChange={selectTab} />
      </Animated.View>

      <View style={styles.panes}>
        <Pane active={tab === 'posts'}>
          <PostsPane
            posts={posts}
            loading={loading}
            isOwn={isOwn}
            tickerOn={tab === 'posts' && !composeAway}
            ready={settled}
            authorName={author.name}
            authorEmoji={author.emoji}
            authorVerified={author.verified}
            authorBadge={author.badge}
            onLongPressPost={onLongPressPost}
          />
        </Pane>
        {opened.media ? (
          <Pane active={tab === 'media'}>
            <MediaPane posts={posts} loading={loading} ready={settled} />
          </Pane>
        ) : null}
        {opened.replies ? (
          <Pane active={tab === 'replies'}>
            <RepliesPane profileId={profileId} ready={settled} />
          </Pane>
        ) : null}
      </View>

      {menuFor ? (
        <ProfilePostMenu
          post={menuFor.post}
          anchor={menuFor.anchor}
          isOwn={isOwn}
          authorName={author.name}
          onClose={closeMenu}
          // A card scrolled partly under the pinned tabs (or the tab bar) must not light them up
          // through the menu's cut-out. Cards never sit above the strip, so its pinned position is
          // the top of the band whether or not it is pinned right now.
          visibleBounds={
            sticky
              ? { top: stickyTop + stripHRef.current, bottom: winHeight - (sticky.chromeBottom ?? 0) }
              : undefined
          }
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, marginTop: 18 },
  // Above the cards that slide under it while pinned.
  stickyLayer: { zIndex: 10 },
  scrim: { position: 'absolute', left: -16, right: -16 },
  strip: { flexDirection: 'row', borderRadius: 20, padding: STRIP_PAD, gap: STRIP_GAP, overflow: 'hidden' },
  stripItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 16, overflow: 'hidden' },
  indicator: { position: 'absolute', top: STRIP_PAD, bottom: STRIP_PAD, left: STRIP_PAD, borderRadius: 16 },
  panes: { marginTop: PANES_TOP },
  // Out of the flow, so the page is as tall as the visible pane; kept mounted, so coming back is free.
  paneHidden: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
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
  // A little in from the edge, where the photo icon used to sit flush.
  ticker: { width: 28, height: 28, marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  tickerGlyph: { position: 'absolute', fontSize: 20, lineHeight: 26, textAlign: 'center', includeFontPadding: false },
  replyCard: { borderRadius: 24, borderWidth: 1, padding: 12, marginBottom: 12 },
  quote: { borderLeftWidth: 3, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  mediaCell: { borderRadius: 10, overflow: 'hidden' },
});
