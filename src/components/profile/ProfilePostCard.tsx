/**
 * A post on a profile, in the card design the profile had before posts were removed (#237):
 * a 100 x 100 rounded thumbnail grid on the left, author line, text and counters on the right,
 * a hairline-bordered rounded card on the page background, and the viewer's post decoration
 * (emoji or pixel pattern from «Оформление») faintly behind it.
 *
 * Restored from `src/components/profile/ProfilePostCard.tsx` at c873f4f, without the parts that
 * do not apply any more: the swipe-to-screenshot wrapper (it needed photo-library write access for
 * posts), repost embeds (reposts are not shown on profiles) and FlashList's mapping helper (the
 * profile renders plain views).
 */
import React, { memo, useMemo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { CachedImage } from '../ui/CachedImage';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { UserBadge } from '../ui/UserBadge';
import { FormattedText } from '../ui/FormattedText';
import { LinkPreview } from '../ui/LinkPreview';
import { EmojiPattern } from '../ui/EmojiPattern';
import { PixelIconPattern } from '../pixel-icons/PixelIconPattern';
import { parseDecoration } from '../pixel-icons/decoration';
import { extractFirstUrl } from '../../services/linkPreview';
import { extractInAppCardUrl, isInAppCardUrl, stripInAppCardUrl } from '../../utils/appLinks';
import { parseImageUrls } from '../../lib/supabase';
import { useShortAgo } from '../../utils/shortAgo';
import type { ProfilePost } from '../../services/profilePosts';

export interface ProfilePostCardProps {
  post: ProfilePost;
  authorName: string;
  authorEmoji: string;
  authorVerified?: boolean;
  authorBadge?: string | null;
  /** The viewer's post decoration token (`useProfileAppearanceStore.postEmoji`). */
  postEmoji?: string;
  onPress: (post: ProfilePost) => void;
  onLongPress?: (post: ProfilePost) => void;
}

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
  rightCol: { flex: 1, justifyContent: 'center' },
  rightColMarginWide: { marginLeft: 14 },
  rightColMarginNarrow: { marginLeft: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  authorName: { flexShrink: 1 },
  timeText: { fontSize: 10, flexShrink: 0 },
  bodyText: { fontSize: 12, marginBottom: 6 },
  linkWrap: { marginBottom: 6 },
  metaRow: { flexDirection: 'row', gap: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 11 },
});

// The four tiles of the 2x2 grid differ only by their gutters, a pure function of the index.
const GRID4_TILE_STYLES = [
  { width: 49, height: 49, marginRight: 2, marginBottom: 2 },
  { width: 49, height: 49, marginRight: 0, marginBottom: 2 },
  { width: 49, height: 49, marginRight: 2, marginBottom: 0 },
  { width: 49, height: 49, marginRight: 0, marginBottom: 0 },
] as const;

function ProfilePostCardBase({ post, authorName, authorEmoji, authorVerified, authorBadge, postEmoji, onPress, onLongPress }: ProfilePostCardProps) {
  const theme = useTheme();
  const ago = useShortAgo();
  const imgs = useMemo(() => parseImageUrls(post.image_url), [post.image_url]);
  const hasImage = imgs.length > 0;
  const content = post.content || '';
  // Our own link wins the preview slot and leaves the body; with an image there is no preview.
  const link = useMemo(
    () => (!hasImage ? extractInAppCardUrl(content) ?? extractFirstUrl(content) : null),
    [hasImage, content],
  );
  const bodyText = useMemo(
    () => (isInAppCardUrl(link) ? stripInAppCardUrl(content, link) : content),
    [content, link],
  );
  const decoration = useMemo(() => parseDecoration(postEmoji), [postEmoji]);
  const themedContainer = useMemo(
    () => ({ backgroundColor: 'transparent', borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }),
    [theme.isDark],
  );
  const themedThumbWrap = useMemo(
    () => ({ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }),
    [theme.isDark],
  );
  const tertiary = theme.colors.text.tertiary;

  return (
    <Pressable
      onPress={() => onPress(post)}
      onLongPress={onLongPress ? () => onLongPress(post) : undefined}
      delayLongPress={400}
      style={({ pressed }) => [styles.container, themedContainer, pressed ? { opacity: 0.85 } : null]}
    >
      {decoration.kind === 'emoji' ? (
        <EmojiPattern emoji={decoration.value} opacity={theme.isDark ? 0.12 : 0.1} />
      ) : decoration.kind === 'pixel' ? (
        <PixelIconPattern id={decoration.id} opacity={theme.isDark ? 0.18 : 0.14} />
      ) : null}

      {/* `autoplay={false}`: a 100 pt thumbnail must not decode a GIF every frame for as long as
          the profile is open. */}
      {hasImage ? (
        <View style={[styles.thumbWrap, themedThumbWrap]}>
          {imgs.length === 1 ? (
            <CachedImage uri={imgs[0]} style={styles.thumbSingle} resizeMode="cover" proxyWidth={100} autoplay={false} />
          ) : imgs.length === 2 ? (
            <View style={styles.thumbRow}>
              <CachedImage uri={imgs[0]} style={styles.thumbHalf} resizeMode="cover" proxyWidth={49} autoplay={false} />
              <View style={styles.spacerH} />
              <CachedImage uri={imgs[1]} style={styles.thumbHalf} resizeMode="cover" proxyWidth={49} autoplay={false} />
            </View>
          ) : imgs.length === 3 ? (
            <View style={styles.thumbRow}>
              <CachedImage uri={imgs[0]} style={styles.thumbHalf} resizeMode="cover" proxyWidth={49} autoplay={false} />
              <View style={styles.spacerH} />
              <View style={styles.thumbHalfCol}>
                <CachedImage uri={imgs[1]} style={styles.thumbQuarter} resizeMode="cover" proxyWidth={49} autoplay={false} />
                <View style={styles.spacerV} />
                <CachedImage uri={imgs[2]} style={styles.thumbQuarter} resizeMode="cover" proxyWidth={49} autoplay={false} />
              </View>
            </View>
          ) : (
            <View style={styles.thumbGrid4}>
              {imgs.slice(0, 4).map((uri, idx) => (
                <CachedImage key={uri} uri={uri} style={GRID4_TILE_STYLES[idx]} resizeMode="cover" proxyWidth={49} autoplay={false} />
              ))}
            </View>
          )}
        </View>
      ) : null}

      <View style={[styles.rightCol, hasImage ? styles.rightColMarginWide : styles.rightColMarginNarrow]}>
        <View style={styles.headerRow}>
          <Avatar emoji={authorEmoji} size="xs" />
          <Text variant="caption" weight="semibold" numberOfLines={1} style={styles.authorName}>{authorName}</Text>
          {authorVerified ? <VerifiedBadge size={11} /> : null}
          {authorBadge ? <UserBadge badge={authorBadge} size="sm" /> : null}
          <Text variant="caption" color={tertiary} numberOfLines={1} style={styles.timeText}>· {ago(post.created_at)}</Text>
        </View>
        {bodyText ? (
          <FormattedText style={styles.bodyText} color={theme.colors.text.secondary} numberOfLines={6}>
            {bodyText}
          </FormattedText>
        ) : null}
        {link ? (
          // Non-interactive so the card owns press and long-press across its whole area.
          <View style={styles.linkWrap} pointerEvents="none">
            <LinkPreview url={link} static />
          </View>
        ) : null}
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Feather name="heart" size={12} color={tertiary} />
            <Text variant="caption" color={tertiary} style={styles.metaText}>{post.likes_count || 0}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export const ProfilePostCard = memo(ProfilePostCardBase, (prev, next) =>
  prev.post.id === next.post.id &&
  prev.post.content === next.post.content &&
  prev.post.image_url === next.post.image_url &&
  prev.post.likes_count === next.post.likes_count &&
  prev.post.created_at === next.post.created_at &&
  prev.postEmoji === next.postEmoji &&
  prev.authorName === next.authorName &&
  prev.authorEmoji === next.authorEmoji &&
  prev.authorVerified === next.authorVerified &&
  prev.authorBadge === next.authorBadge &&
  prev.onPress === next.onPress &&
  prev.onLongPress === next.onLongPress,
);
