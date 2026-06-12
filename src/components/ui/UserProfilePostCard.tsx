import React, { memo, useEffect } from 'react';
import { View, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { CachedImage } from './CachedImage';
import { VerifiedBadge } from './VerifiedBadge';
import { UserBadge } from './UserBadge';
import { FormattedText } from './FormattedText';
import { LinkPreview } from './LinkPreview';
import { SwipeablePostCard } from './SwipeablePostCard';
import { extractFirstUrl } from '../../services/linkPreview';
import { triggerHaptic } from '../../utils/haptics';
import { formatTimeAgo } from '../../utils/mockData';
import { useT } from '../../i18n/store';
import { perfMonitor } from '../../services/perfMonitor';
import { useSettingsStore } from '../../store/settingsStore';

interface UserProfilePostCardProps {
  post: any;
  authorName: string;
  authorUsername: string;
  authorEmoji: string;
  authorVerified?: boolean;
  authorBadge?: string | null;
  authorId: string;
  onLongPress: (enrichedPost: any) => void;
  onImagePress: (uri: string, postId: string, allImages: string[]) => void;
}

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
  onLongPress,
  onImagePress,
}: UserProfilePostCardProps) {
  const theme = useTheme();
  const t = useT();

  // Mount-time diagnostic — captures render→commit latency on the JS thread.
  // Surfaces as `mount UserProfilePostCard <ms>` in the perf monitor's event
  // log so SLOW frames on profile screens have actionable context. The
  // setting check runs once at commit, not on every render — keeps this
  // ~free in production for users who turned the bubble off.
  const renderStart = Date.now();
  useEffect(() => {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    perfMonitor.mark('mount UserProfilePostCard', Date.now() - renderStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const postImages: string[] = post.imageUrls && post.imageUrls.length > 0
    ? post.imageUrls
    : post.imageUrl
      ? [post.imageUrl]
      : [];
  const hasImage = postImages.length > 0;
  const isRepostPost = post.isRepost;
  const origPost = post.originalPost;

  // Enrich the post with author info before bubbling up to the menu, matching
  // the prior inline behavior in app/profile/[id].tsx.
  const enrichLongPress = () => {
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
  };

  return (
    <SwipeablePostCard>
      <Pressable
        onPress={() => router.push({ pathname: '/comments/[id]', params: { id: post.id } })}
        onLongPress={enrichLongPress}
        delayLongPress={400}
        style={{ flexDirection: 'row', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.75)', borderRadius: 28, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.4)', overflow: 'hidden' }}
      >
        {/* Left: Image grid thumbnail */}
        {hasImage ? (
          <Pressable onPress={() => onImagePress(postImages[0], post.id, postImages)}>
            <View style={{ width: 100, height: 100, borderRadius: 20, overflow: 'hidden' }}>
              {postImages.length === 1 ? (
                <CachedImage uri={postImages[0]} style={{ width: 100, height: 100 }} resizeMode="cover" />
              ) : postImages.length === 2 ? (
                <View style={{ flexDirection: 'row', width: 100, height: 100 }}>
                  <CachedImage uri={postImages[0]} style={{ width: 49, height: 100 }} resizeMode="cover" />
                  <View style={{ width: 2 }} />
                  <CachedImage uri={postImages[1]} style={{ width: 49, height: 100 }} resizeMode="cover" />
                </View>
              ) : postImages.length === 3 ? (
                <View style={{ flexDirection: 'row', width: 100, height: 100 }}>
                  <CachedImage uri={postImages[0]} style={{ width: 49, height: 100 }} resizeMode="cover" />
                  <View style={{ width: 2 }} />
                  <View style={{ width: 49, height: 100 }}>
                    <CachedImage uri={postImages[1]} style={{ width: 49, height: 49 }} resizeMode="cover" />
                    <View style={{ height: 2 }} />
                    <CachedImage uri={postImages[2]} style={{ width: 49, height: 49 }} resizeMode="cover" />
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: 100, height: 100 }}>
                  {postImages.slice(0, 4).map((imgUri: string, idx: number) => (
                    <CachedImage key={idx} uri={imgUri} style={{ width: 49, height: 49, marginRight: idx % 2 === 0 ? 2 : 0, marginBottom: idx < 2 ? 2 : 0 }} resizeMode="cover" />
                  ))}
                </View>
              )}
              {isRepostPost && (
                <View style={{ position: 'absolute', top: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Feather name="repeat" size={8} color="#FFFFFF" />
                </View>
              )}
            </View>
          </Pressable>
        ) : isRepostPost ? (
          <View style={{ width: 100, height: 100, borderRadius: 20, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="repeat" size={24} color={theme.colors.text.tertiary} />
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 9, marginTop: 4 }}>{t('post.repost_label')}</Text>
          </View>
        ) : null}

        {/* Right: Info */}
        <View style={{ flex: 1, marginLeft: (hasImage || isRepostPost) ? 14 : 4, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Avatar emoji={authorEmoji} size="xs" />
            <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{authorName}</Text>
            {authorVerified && <VerifiedBadge size={11} />}
            {authorBadge && <UserBadge badge={authorBadge} size="sm" />}
            <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 10, flexShrink: 0 }}>· {formatTimeAgo(post.createdAt)}</Text>
          </View>
          {isRepostPost && origPost && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <Feather name="repeat" size={10} color={theme.colors.accent.primary} />
              <Text variant="caption" color={theme.colors.accent.primary} numberOfLines={1} style={{ fontSize: 10, flexShrink: 1 }}>{t('post.reposted_from', undefined, { name: origPost.authorName })}</Text>
            </View>
          )}
          {(post.content || origPost?.content) ? (
            <FormattedText style={{ fontSize: 12, marginBottom: 6 }} color={theme.colors.text.secondary}>
              {post.content || origPost?.content || ''}
            </FormattedText>
          ) : null}
          {/* Link preview when the post has no image (Telegram-style, instant from cache) */}
          {!hasImage && (() => {
            const link = extractFirstUrl(post.content || origPost?.content || '');
            return link ? (
              <Pressable onLongPress={enrichLongPress} delayLongPress={400} style={{ marginBottom: 6 }}>
                <LinkPreview url={link} static />
              </Pressable>
            ) : null;
          })()}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Feather name="heart" size={12} color={theme.colors.text.tertiary} />
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{post.likesCount}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Feather name="message-circle" size={12} color={theme.colors.text.tertiary} />
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{post.commentsCount}</Text>
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
  prev.onLongPress === next.onLongPress &&
  prev.onImagePress === next.onImagePress
);
