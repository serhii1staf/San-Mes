import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { UserBadge } from './UserBadge';
import { CachedImage } from './CachedImage';
import Skeleton from './Skeleton';
import { useEntityStore } from '../../services/entityStore';
import { useT } from '../../i18n/store';
import { kvGetJSONSync, kvSetJSON } from '../../services/kvStore';
import { parseImageUrls, isRepost } from '../../lib/supabase';
import { triggerHaptic } from '../../utils/haptics';

/**
 * A shared post, rendered as the post — author, text, thumbnail, and a button that opens it INSIDE the
 * app.
 *
 * ── WHAT THIS REPLACES ───────────────────────────────────────────────────────
 *
 * The share sheet sends `caption + "\n" + https://san-m-app.com/post/<id>`. Until now the chat matched
 * that against nothing in particular, so it fell through to the generic OG unfurl: a grey row reading
 * "san-m-app.com" with whatever `<meta>` tags the marketing page happened to carry, and a tap that
 * pushed `/browser` — a WebView of our own website, shown to a reader who is already signed in and one
 * screen away from the real thing.
 *
 * ── WHY A URL-SHAPE DISPATCH AND NOT A NEW MESSAGE TYPE ──────────────────────
 *
 * The obvious alternative is to give the message a payload: send `{ kind: 'post', postId }` instead of
 * text. That means a server-side schema change, a migration for the `messages` table, a new branch in
 * every renderer, and — the part that kills it — every post ALREADY shared stays a dead grey link
 * forever, because those rows only ever contained text.
 *
 * Dispatching on the URL's shape fixes the history too. Every share link ever sent starts rendering as
 * a card the moment this ships, with no migration and no server work, because the id was always right
 * there in the text. `MiniAppPreviewCard` established this pattern for `/m/<short>` links and it has
 * held up; this is the same move for `/post/<id>`.
 *
 * ── RESOLUTION: THREE TIERS, CHEAPEST FIRST ─────────────────────────────────
 *
 *   1. `entityStore.posts` — the post is very often already in memory, because the sender was looking
 *      at it in a feed and the recipient may have scrolled past it too. Renders on the first frame,
 *      no request.
 *   2. `kvStore`, 24 h — survives a restart, so re-opening a chat does not re-fetch every card in it.
 *   3. `GET /v1/posts/:id` — one request, once, result written back to tier 2.
 *
 * Read synchronously in both cached tiers (`kvGetJSONSync`) on purpose: an async read would put a
 * spinner frame in front of data we already hold, which is the exact "it flashes and jumps" complaint
 * this whole line of work is about.
 *
 * ── THE CARD RESERVES ITS HEIGHT ────────────────────────────────────────────
 *
 * Loading, missing and resolved states are all sized around the same 56 px thumbnail row, so a card
 * settling from skeleton to content does not change the message bubble's height and shove the
 * transcript. Same reasoning as `MiniAppPreviewCard`'s matched loading row.
 */

interface CachedPost {
  id: string;
  content: string;
  image_url: string | null;
  likes_count: number;
  comments_count: number;
  authorName: string;
  authorUsername: string;
  authorEmoji: string;
  authorVerified: boolean;
  authorBadge: string | null;
}

interface CacheEnvelope {
  t: number;
  d: CachedPost | null;
}

const CACHE_PREFIX = '@san:post-preview:';
const TTL_MS = 24 * 60 * 60 * 1000;

/** Thumbnail edge. Also the height the loading and missing states reserve. */
const THUMB = 56;

function cacheGet(id: string): CacheEnvelope | null {
  try {
    const entry = kvGetJSONSync<CacheEnvelope | null>(CACHE_PREFIX + id, null);
    if (!entry) return null;
    if (Date.now() - entry.t > TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

function cachePut(id: string, value: CachedPost | null): void {
  try {
    kvSetJSON(CACHE_PREFIX + id, { t: Date.now(), d: value });
  } catch {
    // A cache write failing must never break the card.
  }
}

/** Normalise the API row (whose `profiles` may be an object OR a one-element array) into our shape. */
function fromRow(row: any): CachedPost | null {
  if (!row || typeof row.id !== 'string') return null;
  const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.id,
    content: typeof row.content === 'string' ? row.content : '',
    image_url: row.image_url ?? null,
    likes_count: Number(row.likes_count) || 0,
    comments_count: Number(row.comments_count) || 0,
    authorName: p?.display_name || p?.username || 'User',
    authorUsername: p?.username || '',
    authorEmoji: p?.emoji || '😊',
    authorVerified: !!p?.is_verified,
    authorBadge: p?.badge ?? null,
  };
}

/**
 * A repost's stored `content` is a marker plus the reposter's comment, not readable text. Show the
 * comment when there is one and fall back to a label when the repost was bare, rather than printing
 * `::repost::<uuid>` into a chat bubble.
 */
function displayText(content: string, repostLabel: string): string {
  const info = isRepost(content || '');
  if (!info.isRepost) return content || '';
  return (info.comment || '').trim() || repostLabel;
}

interface PostPreviewCardProps {
  postId: string;
  /** Light text colour when the card is rendered inside the sender's own (accent-filled) bubble. */
  textColor?: string;
  /** Suppress navigation when the card is rendered inside a context menu snapshot. */
  static?: boolean;
}

export const PostPreviewCard = React.memo(function PostPreviewCard({
  postId,
  textColor,
  static: isStatic,
}: PostPreviewCardProps) {
  const theme = useTheme();
  const t = useT();

  // ── Tier 1: memory ────────────────────────────────────────────────────────
  //
  // TWO NARROW SELECTORS, NOT `s => s.posts`.
  //
  // Selecting the whole map would re-render this card on every unrelated upsert — and a chat with a
  // handful of shared posts in it would then re-render all of them every time the feed syncs. Zustand's
  // docs are explicit that strict-equality picks of atomic values are the efficient shape and that a
  // selector returning a container re-renders on every replacement of it.
  // https://github.com/pmndrs/zustand#selecting-multiple-state-slices
  const storePost = useEntityStore((s) => s.posts[postId]);
  const storeProfile = useEntityStore((s) => (storePost ? s.profiles[storePost.author_id] : undefined));

  const fromStore = React.useMemo<CachedPost | null>(() => {
    if (!storePost) return null;
    return {
      id: storePost.id,
      content: storePost.content || '',
      image_url: storePost.image_url ?? null,
      likes_count: storePost.likes_count || 0,
      comments_count: storePost.comments_count || 0,
      authorName: storeProfile?.display_name || storeProfile?.username || 'User',
      authorUsername: storeProfile?.username || '',
      authorEmoji: storeProfile?.emoji || '😊',
      authorVerified: !!storeProfile?.is_verified,
      authorBadge: storeProfile?.badge ?? null,
    };
  }, [storePost, storeProfile]);

  // ── Tier 2: disk, read once during the first render ───────────────────────
  const fromCacheRef = React.useRef<CachedPost | null | undefined>(undefined);
  if (fromCacheRef.current === undefined) {
    fromCacheRef.current = fromStore ? null : (cacheGet(postId)?.d ?? null);
  }

  const [resolved, setResolved] = useState<CachedPost | null>(fromStore || fromCacheRef.current);
  const [missing, setMissing] = useState(false);

  // The store can gain the post AFTER this card mounts (a sync tick lands, or the reader opens the
  // feed in another tab). Prefer it over whatever we resolved earlier — it is the freshest copy of the
  // counts.
  useEffect(() => {
    if (fromStore) {
      setResolved(fromStore);
      setMissing(false);
    }
  }, [fromStore]);

  // ── Tier 3: network, once ─────────────────────────────────────────────────
  useEffect(() => {
    if (resolved) return;
    let cancelled = false;
    void (async () => {
      try {
        const { apiGet } = await import('../../services/apiClient');
        const { data, error } = await apiGet<any>(`/v1/posts/${encodeURIComponent(postId)}`);
        if (cancelled) return;
        const row = error ? null : fromRow(data);
        if (row) {
          setResolved(row);
          cachePut(postId, row);
        } else {
          // Negative result is cached too. A deleted post must not re-request on every chat open.
          setMissing(true);
          cachePut(postId, null);
        }
      } catch {
        if (!cancelled) setMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId, resolved]);

  const accent = theme.colors.accent.primary;
  const titleColor = textColor || theme.colors.text.primary;
  const subColor = textColor || theme.colors.text.tertiary;
  const bg = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.025)';
  const railColor = textColor ? 'rgba(255,255,255,0.6)' : accent;

  const open = () => {
    if (isStatic) return;
    triggerHaptic('light');
    // `/comments/[id]` IS the post screen — see the note in `src/utils/appLinks.ts`. Object form so an
    // id can never be reinterpreted as a path.
    router.push({ pathname: '/comments/[id]', params: { id: postId } });
  };

  if (!resolved && !missing) {
    return (
      <View style={[styles.row, { backgroundColor: bg, borderLeftColor: railColor }]}>
        <Skeleton width={THUMB} height={THUMB} radius={12} />
        <View style={styles.body}>
          <ActivityIndicator size="small" color={accent} />
        </View>
      </View>
    );
  }

  if (missing || !resolved) {
    return (
      <View style={[styles.row, { backgroundColor: bg, borderLeftColor: railColor }]}>
        <View style={[styles.missingIcon, { width: THUMB, height: THUMB }]}>
          <Feather name="alert-circle" size={18} color={subColor} />
        </View>
        <View style={styles.body}>
          <Text variant="caption" color={subColor} numberOfLines={2} style={styles.missingText}>
            {t('post.preview.unavailable', 'Публикация недоступна')}
          </Text>
        </View>
      </View>
    );
  }

  const images = parseImageUrls(resolved.image_url);
  const body = displayText(resolved.content, t('post.preview.repost', 'Репост'));

  return (
    <Pressable
      onPress={open}
      // The whole card is the target as well as the button. A reader who taps the text of a post card
      // means "open this post"; requiring the small chip would be a hit-area trap.
      style={[styles.card, { backgroundColor: bg, borderLeftColor: railColor }]}
      accessibilityRole="button"
      accessibilityLabel={t('post.preview.open_a11y', 'Открыть публикацию')}
    >
      <View style={styles.authorRow}>
        <Avatar emoji={resolved.authorEmoji} name={resolved.authorName} size="xs" tint />
        <Text
          variant="caption"
          weight="semibold"
          color={titleColor}
          numberOfLines={1}
          style={styles.authorName}
        >
          {resolved.authorName}
        </Text>
        {resolved.authorVerified ? <VerifiedBadge size={10} /> : null}
        {resolved.authorBadge ? <UserBadge badge={resolved.authorBadge} size="sm" /> : null}
        {resolved.authorUsername ? (
          <Text variant="caption" color={subColor} numberOfLines={1} style={styles.handle}>
            @{resolved.authorUsername}
          </Text>
        ) : null}
      </View>

      <View style={styles.contentRow}>
        {images.length > 0 ? (
          <CachedImage
            uri={images[0]}
            style={styles.thumb}
            resizeMode="cover"
            proxyWidth={THUMB * 2}
            // Decorative chrome inside a message bubble, so it must not compete with the bubble's own
            // images for decode slots. `CachedImage` already sets expo-image's `recyclingKey` to the
            // uri internally, which is what stops a recycled chat cell painting the PREVIOUS card's
            // thumbnail while this one loads.
            // https://docs.expo.dev/versions/v54.0.0/sdk/image/
            priority="low"
            // "Must not compete for decode slots" applies even harder to the
            // ONGOING cost than to the one-off one. At 56x56 this is chrome, and
            // an animated source would decode every frame for as long as the
            // chat keeps the bubble — competing with the bubble's real media for
            // the entire time the conversation is open, not just at load.
            autoplay={false}
          />
        ) : null}
        <View style={styles.textCol}>
          {body ? (
            <Text variant="caption" color={titleColor} numberOfLines={images.length > 0 ? 2 : 3} style={styles.bodyText}>
              {body}
            </Text>
          ) : (
            <Text variant="caption" color={subColor} numberOfLines={1} style={styles.bodyText}>
              {images.length > 0 ? t('post.preview.photo', 'Фото') : t('post.preview.empty', 'Публикация')}
            </Text>
          )}
          <View style={styles.metaRow}>
            <Feather name="heart" size={10} color={subColor} />
            <Text variant="caption" color={subColor} style={styles.metaText}>{resolved.likes_count}</Text>
            <Feather name="message-circle" size={10} color={subColor} style={styles.metaGap} />
            <Text variant="caption" color={subColor} style={styles.metaText}>{resolved.comments_count}</Text>
          </View>
        </View>
      </View>

      {/* The button the user asked for by name. Accent-filled so it takes the theme's colour rather
          than a hardcoded one — inside an own-bubble (where `textColor` is set) the accent IS the
          bubble, so it flips to a translucent white chip to stay visible against it. */}
      <View
        style={[
          styles.openBtn,
          { backgroundColor: textColor ? 'rgba(255,255,255,0.22)' : accent },
        ]}
      >
        <Text variant="caption" weight="semibold" color="#FFFFFF" style={styles.openLabel}>
          {t('post.preview.open', 'Открыть')}
        </Text>
        <Feather name="arrow-right" size={12} color="#FFFFFF" />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderLeftWidth: 2,
    paddingLeft: 10,
    paddingRight: 10,
    paddingVertical: 9,
    gap: 7,
    overflow: 'hidden',
  },
  // Loading / missing states: same padding and the same THUMB-tall row, so the card does not change
  // height when it resolves.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderLeftWidth: 2,
    paddingLeft: 10,
    paddingRight: 10,
    paddingVertical: 9,
    overflow: 'hidden',
  },
  body: { flex: 1 },
  missingIcon: { alignItems: 'center', justifyContent: 'center' },
  missingText: { fontSize: 12 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  authorName: { fontSize: 12.5, flexShrink: 1 },
  handle: { fontSize: 11, flexShrink: 1 },
  contentRow: { flexDirection: 'row', gap: 10 },
  thumb: { width: THUMB, height: THUMB, borderRadius: 12 },
  textCol: { flex: 1, justifyContent: 'center', gap: 4 },
  bodyText: { fontSize: 12.5, lineHeight: 17 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 10.5 },
  metaGap: { marginLeft: 6 },
  openBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  openLabel: { fontSize: 12 },
});
