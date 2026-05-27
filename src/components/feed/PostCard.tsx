import React, { useState, useRef } from 'react';
import { View, Image, Pressable, ViewStyle, TextStyle, Dimensions, ActionSheetIOS, Platform, Share } from 'react-native';
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
}

export function PostCard({ post, onLike, onComment, onShare, onBookmark }: PostCardProps) {
  const theme = useTheme();
  const [isBookmarked, setIsBookmarked] = useState(post.isBookmarked);
  const lastTap = useRef<number>(0);

  const handleLike = () => {
    triggerHaptic('light');
    onLike(post.id);
  };

  const handleDoubleTap = () => {
    const now = Date.now();
    const lastTapValue = lastTap.current;
    lastTap.current = now;

    if (now - lastTapValue < 300) {
      if (!post.isLiked) {
        onLike(post.id);
      }
    }
  };

  const handleBookmark = () => {
    triggerHaptic('light');
    setIsBookmarked(!isBookmarked);
    onBookmark?.(post.id);
  };

  const containerStyle: ViewStyle = {
    marginBottom: theme.spacing.base,
  };

  const headerStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.base,
    paddingVertical: theme.spacing.md,
  };

  const actionBarStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.base,
    paddingVertical: theme.spacing.md,
  };

  const actionButtonStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: theme.spacing.lg,
  };

  const imageContainerStyle: ViewStyle = {
    width: '100%',
    aspectRatio: post.imageUrl ? (post.imageUrl.includes('1000') ? 0.8 : 1.33) : undefined,
    position: 'relative',
  };

  return (
    <Card style={containerStyle} padding="sm" shadow="sm">
      {/* Header */}
      <View style={headerStyle}>
        <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: post.authorId } })} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <Avatar emoji={post.authorEmoji} name={post.authorName} size="sm" />
          <View style={{ marginLeft: theme.spacing.md, flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text weight="semibold" variant="body">
                {post.authorName}
              </Text>
            </View>
            <Text variant="caption" color={theme.colors.text.secondary}>
              @{post.authorUsername} · {formatTimeAgo(post.createdAt)}
            </Text>
          </View>
        </Pressable>
        <Pressable onPress={() => {
          triggerHaptic('light');
          if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
              {
                options: ['Скопировать ссылку', 'Поделиться', 'Пожаловаться', 'Отмена'],
                cancelButtonIndex: 3,
                destructiveButtonIndex: 2,
              },
              (buttonIndex) => {
                if (buttonIndex === 0) {
                  // Copy link - noop for now
                } else if (buttonIndex === 1) {
                  Share.share({ message: post.content });
                }
              }
            );
          } else {
            Share.share({ message: post.content });
          }
        }}>
          <Feather name="more-horizontal" size={20} color={theme.colors.text.secondary} />
        </Pressable>
      </View>

      {/* Content */}
      {post.content && (
        <View style={{ paddingHorizontal: theme.spacing.base, paddingBottom: theme.spacing.sm }}>
          <Text variant="body">{post.content}</Text>
        </View>
      )}

      {/* Image */}
      {post.imageUrl && (
        <Pressable onPress={handleDoubleTap} style={imageContainerStyle}>
          <Image
            source={{ uri: post.imageUrl }}
            style={{ width: '100%', height: '100%', borderRadius: theme.borderRadius.md }}
            resizeMode="cover"
          />
        </Pressable>
      )}

      {/* Action Bar */}
      <View style={actionBarStyle}>
        <Pressable onPress={handleLike} style={actionButtonStyle}>
          <Feather
            name="heart"
            size={18}
            color={post.isLiked ? theme.colors.accent.primary : theme.colors.text.secondary}
          />
          <Text
            variant="caption"
            weight="medium"
            color={post.isLiked ? theme.colors.accent.primary : theme.colors.text.secondary}
            style={{ marginLeft: theme.spacing.xs } as TextStyle}
          >
            {post.likesCount}
          </Text>
        </Pressable>

        <Pressable
          style={actionButtonStyle}
          onPress={() => onComment?.(post.id)}
        >
          <Feather name="message-circle" size={18} color={theme.colors.text.secondary} />
          <Text
            variant="caption"
            weight="medium"
            color={theme.colors.text.secondary}
            style={{ marginLeft: theme.spacing.xs } as TextStyle}
          >
            {post.commentsCount}
          </Text>
        </Pressable>

        <Pressable style={actionButtonStyle} onPress={() => onShare?.(post.id)}>
          <Feather name="repeat" size={18} color={theme.colors.text.secondary} />
          <Text
            variant="caption"
            weight="medium"
            color={theme.colors.text.secondary}
            style={{ marginLeft: theme.spacing.xs } as TextStyle}
          >
            {post.sharesCount}
          </Text>
        </Pressable>

        <Pressable style={actionButtonStyle} onPress={() => onShare?.(post.id)}>
          <Feather name="share" size={18} color={theme.colors.text.secondary} />
        </Pressable>

        <View style={{ flex: 1 }} />

        <Pressable onPress={handleBookmark}>
          <Feather
            name="bookmark"
            size={18}
            color={isBookmarked ? theme.colors.accent.tertiary : theme.colors.text.secondary}
          />
        </Pressable>
      </View>
    </Card>
  );
}
