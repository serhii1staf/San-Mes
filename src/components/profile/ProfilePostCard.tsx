import React, { memo } from 'react';
import { View, Pressable } from 'react-native';
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
import { SwipeablePostCard } from '../ui/SwipeablePostCard';
import { extractFirstUrl } from '../../services/linkPreview';
import { triggerHaptic } from '../../utils/haptics';
import { formatTimeAgo } from '../../utils/mockData';
import { useT } from '../../i18n/store';

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

// Memoized profile post card. Extracted + memoized so switching profile tabs (or
// re-rendering the screen) does NOT rebuild every card — only cards whose data
// actually changed re-render. This removes the freeze on the "Posts" tab.
function ProfilePostCardBase({ post, authorName, authorEmoji, authorVerified, authorBadge, shareText, postEmoji, onLongPress, onImagePress }: ProfilePostCardProps) {
  const theme = useTheme();
  const t = useT();
  const origPost = post.originalPost;
  const imgs: string[] = post.imageUrls && post.imageUrls.length > 0 ? post.imageUrls : post.imageUrl ? [post.imageUrl] : (origPost?.imageUrls && origPost.imageUrls.length > 0 ? origPost.imageUrls : origPost?.imageUrl ? [origPost.imageUrl] : []);
  const hasImage = imgs.length > 0;
  const isRepostPost = post.isRepost;
  const link = !hasImage ? extractFirstUrl(post.content || origPost?.content || '') : null;

  return (
    <SwipeablePostCard shareText={shareText}>
      <Pressable
        onPress={() => router.push({ pathname: '/comments/[id]', params: { id: post.id } })}
        onLongPress={() => { triggerHaptic('medium'); onLongPress(post); }}
        delayLongPress={400}
        style={{ flexDirection: 'row', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.75)', borderRadius: 28, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.4)', overflow: 'hidden' }}
      >
        {postEmoji ? <EmojiPattern emoji={postEmoji} opacity={theme.isDark ? 0.12 : 0.10} /> : null}

        {hasImage ? (
          <Pressable onPress={() => onImagePress(imgs[0], post.id, imgs)}>
            <View style={{ width: 100, height: 100, borderRadius: 20, overflow: 'hidden' }}>
              {imgs.length === 1 ? (
                <CachedImage uri={imgs[0]} style={{ width: 100, height: 100 }} resizeMode="cover" />
              ) : imgs.length === 2 ? (
                <View style={{ flexDirection: 'row', width: 100, height: 100 }}>
                  <CachedImage uri={imgs[0]} style={{ width: 49, height: 100 }} resizeMode="cover" />
                  <View style={{ width: 2 }} />
                  <CachedImage uri={imgs[1]} style={{ width: 49, height: 100 }} resizeMode="cover" />
                </View>
              ) : imgs.length === 3 ? (
                <View style={{ flexDirection: 'row', width: 100, height: 100 }}>
                  <CachedImage uri={imgs[0]} style={{ width: 49, height: 100 }} resizeMode="cover" />
                  <View style={{ width: 2 }} />
                  <View style={{ width: 49, height: 100 }}>
                    <CachedImage uri={imgs[1]} style={{ width: 49, height: 49 }} resizeMode="cover" />
                    <View style={{ height: 2 }} />
                    <CachedImage uri={imgs[2]} style={{ width: 49, height: 49 }} resizeMode="cover" />
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: 100, height: 100 }}>
                  {imgs.slice(0, 4).map((imgUri, idx) => (
                    <CachedImage key={idx} uri={imgUri} style={{ width: 49, height: 49, marginRight: idx % 2 === 0 ? 2 : 0, marginBottom: idx < 2 ? 2 : 0 }} resizeMode="cover" />
                  ))}
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
          {isRepostPost && !origPost && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}><Feather name="repeat" size={10} color={theme.colors.accent.primary} /><Text variant="caption" color={theme.colors.accent.primary} style={{ fontSize: 10 }}>{t('post.repost_label')}</Text></View>}
          {(post.content || origPost?.content) ? <FormattedText style={{ fontSize: 12, marginBottom: 6 }} color={theme.colors.text.secondary}>{post.content || origPost?.content || ''}</FormattedText> : null}
          {link ? (
            <Pressable onLongPress={() => { triggerHaptic('medium'); onLongPress(post); }} delayLongPress={400} style={{ marginBottom: 6 }}>
              <LinkPreview url={link} static />
            </Pressable>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Feather name="heart" size={12} color={theme.colors.text.tertiary} /><Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{post.likesCount}</Text></View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Feather name="message-circle" size={12} color={theme.colors.text.tertiary} /><Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{post.commentsCount}</Text></View>
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
