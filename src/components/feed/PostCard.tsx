import React, { useState, useRef, memo } from 'react';
import { View, Image, Pressable, ViewStyle, TextStyle, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { Card } from '../ui/Card';
import { Post } from '../../types';
import { formatTimeAgo } from '../../utils/mockData';
import { triggerHaptic } from '../../utils/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface PostCardProps {
  post: Post;
  onLike: (postId: string) => void;
  onComment?: (postId: string) => void;
  onShare?: (postId: string) => void;
  onBookmark?: (postId: string) => void;
  onMenu?: (post: Post) => void;
}

export const PostCard = memo(function PostCard({ post, onLike, onComment, onShare, onBookmark, onMenu }: PostCardProps) {
  const theme = useTheme();
  const [isBookmarked, setIsBookmarked] = useState(post.isBookmarked);
  const lastTap = useRef<number>(0);

  const handleLike = () => {
    triggerHaptic('light');
    onLike(post.id);
  };

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (!post.isLiked) onLike(post.id);
    }
    lastTap.current = now;
  };

  const handleBookmark = () => {
    triggerHaptic('light');
    setIsBookmarked(!isBookmarked);
    onBookmark?.(post.id);
  };

  const containerStyle: ViewStyle = { marginBottom: theme.spacing.base };
  const headerStyle: ViewStyle = { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.base, paddingVertical: theme.spacing.md };
  const actionBarStyle: ViewStyle = { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.base, paddingVertical: theme.spacing.md };
  const actionButtonStyle: ViewStyle = { flexDirection: 'row', alignItems: 'center', marginRight: theme.spacing.lg };

  return (
    <Card style={containerStyle} padding="sm" shadow="sm">
      {/* Repost indicator */}
      {post.isRepost && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.base, paddingTop: theme.spacing.sm, gap: 6 }}>
          <Feather name="repeat" size={13} color={theme.colors.text.tertiary} />
          <Text variant="caption" color={theme.colors.text.tertiary}>{post.authorName} репостнул(а)</Text>
        </View>
      )}

      {/* Header */}
      <View style={headerStyle}>
        <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: post.authorId } })} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <Avatar emoji={post.authorEmoji} name={post.authorName} size="sm" />
          <View style={{ marginLeft: theme.spacing.md, flex: 1 }}>
            <Text weight="semibold" variant="body">{post.authorName}</Text>
            <Text variant="caption" color={theme.colors.text.secondary}>@{post.authorUsername} · {formatTimeAgo(post.createdAt)}</Text>
          </View>
        </Pressable>
        <Pressable onPress={() => { triggerHaptic('light'); onMenu?.(post); }}>
          <Feather name="more-horizontal" size={20} color={theme.colors.text.secondary} />
        </Pressable>
      </View>

      {/* Content - show repost comment if any */}
      {post.content && !post.isRepost && (
        <View style={{ paddingHorizontal: theme.spacing.base, paddingBottom: theme.spacing.sm }}>
          <Text variant="body">{post.content}</Text>
        </View>
      )}
      {post.isRepost && post.content && (
        <View style={{ paddingHorizontal: theme.spacing.base, paddingBottom: theme.spacing.sm }}>
          <Text variant="body">{post.content}</Text>
        </View>
      )}

      {/* Original post embed (for reposts) */}
      {post.isRepost && post.originalPost && (
        <View style={{ marginHorizontal: theme.spacing.base, marginBottom: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border.light, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
            <Avatar emoji={post.originalPost.authorEmoji} size="xs" />
            <Text variant="caption" weight="semibold" style={{ marginLeft: 8 }}>{post.originalPost.authorName}</Text>
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginLeft: 4 }}>@{post.originalPost.authorUsername}</Text>
          </View>
          {post.originalPost.content && (
            <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
              <Text variant="body" numberOfLines={4}>{post.originalPost.content}</Text>
            </View>
          )}
          {post.originalPost.imageUrl && (
            <Image source={{ uri: post.originalPost.imageUrl }} style={{ width: '100%', height: 150 }} resizeMode="cover" />
          )}
        </View>
      )}

      {/* Image (non-repost) */}
      {!post.isRepost && post.imageUrl && (
        <Pressable onPress={handleDoubleTap} style={{ width: '100%', aspectRatio: 1.33, position: 'relative' }}>
          <Image source={{ uri: post.imageUrl }} style={{ width: '100%', height: '100%', borderRadius: theme.borderRadius.md }} resizeMode="cover" />
        </Pressable>
      )}

      {/* Action Bar */}
      <View style={actionBarStyle}>
        <Pressable onPress={handleLike} style={actionButtonStyle}>
          <Feather name="heart" size={18} color={post.isLiked ? theme.colors.accent.primary : theme.colors.text.secondary} />
          <Text variant="caption" weight="medium" color={post.isLiked ? theme.colors.accent.primary : theme.colors.text.secondary} style={{ marginLeft: theme.spacing.xs } as TextStyle}>{post.likesCount}</Text>
        </Pressable>

        <Pressable style={actionButtonStyle} onPress={() => onComment?.(post.id)}>
          <Feather name="message-circle" size={18} color={theme.colors.text.secondary} />
          <Text variant="caption" weight="medium" color={theme.colors.text.secondary} style={{ marginLeft: theme.spacing.xs } as TextStyle}>{post.commentsCount}</Text>
        </Pressable>

        <Pressable style={actionButtonStyle} onPress={() => { triggerHaptic('light'); onShare?.(post.id); }}>
          <Feather name="repeat" size={18} color={theme.colors.text.secondary} />
          <Text variant="caption" weight="medium" color={theme.colors.text.secondary} style={{ marginLeft: theme.spacing.xs } as TextStyle}>{post.sharesCount}</Text>
        </Pressable>

        <Pressable style={actionButtonStyle} onPress={async () => {
          triggerHaptic('light');
          try {
            const { Share } = require('react-native');
            await Share.share({ message: `${post.content || ''}\n\nhttps://san-mes.vercel.app/post/${post.id}` });
          } catch {}
        }}>
          <Feather name="share" size={18} color={theme.colors.text.secondary} />
        </Pressable>

        <View style={{ flex: 1 }} />

        <Pressable onPress={handleBookmark}>
          <Feather name="bookmark" size={18} color={isBookmarked ? theme.colors.accent.tertiary : theme.colors.text.secondary} />
        </Pressable>
      </View>
    </Card>
  );
});
