import React, { useState, useRef } from 'react';
import { View, Image, Pressable, ViewStyle, TextStyle, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { Card } from '../ui/Card';
import { Post } from '../../types';
import { formatTimeAgo } from '../../utils/mockData';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface PostCardProps {
  post: Post;
  onLike: (postId: string) => void;
  onComment?: (postId: string) => void;
  onShare?: (postId: string) => void;
  onBookmark?: (postId: string) => void;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PostCard({ post, onLike, onComment, onShare, onBookmark }: PostCardProps) {
  const theme = useTheme();
  const [isBookmarked, setIsBookmarked] = useState(post.isBookmarked);

  const heartScale = useSharedValue(1);
  const heartOpacity = useSharedValue(0);
  const bookmarkScale = useSharedValue(1);
  // Issue 6: Use useRef instead of useSharedValue for JS-thread double-tap detection
  const lastTap = useRef<number>(0);

  const heartAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  const doubleTapHeartStyle = useAnimatedStyle(() => ({
    opacity: heartOpacity.value,
    transform: [{ scale: heartOpacity.value }],
  }));

  const bookmarkAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: bookmarkScale.value }],
  }));

  const handleLike = () => {
    heartScale.value = withSequence(
      withSpring(1.3, { damping: 10, stiffness: 400 }),
      withSpring(1, { damping: 15, stiffness: 300 })
    );
    onLike(post.id);
  };

  const handleDoubleTap = () => {
    const now = Date.now();
    const lastTapValue = lastTap.current;
    lastTap.current = now;

    if (now - lastTapValue < 300) {
      heartOpacity.value = withSequence(
        withTiming(1, { duration: 100 }),
        withTiming(1, { duration: 600 }),
        withTiming(0, { duration: 300 })
      );
      if (!post.isLiked) {
        onLike(post.id);
      }
    }
  };

  const handleBookmark = () => {
    bookmarkScale.value = withSequence(
      withSpring(1.3, { damping: 10, stiffness: 400 }),
      withSpring(1, { damping: 15, stiffness: 300 })
    );
    setIsBookmarked(!isBookmarked);
    onBookmark?.(post.id);
  };

  const containerStyle: ViewStyle = {
    marginBottom: theme.spacing.base,
    overflow: 'hidden',
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
        <Avatar source={post.authorAvatar} name={post.authorName} size="sm" />
        <View style={{ marginLeft: theme.spacing.md, flex: 1 }}>
          <Text weight="semibold" variant="body">
            {post.authorName}
          </Text>
          <Text variant="caption" color={theme.colors.text.secondary}>
            {formatTimeAgo(post.createdAt)}
          </Text>
        </View>
        <Pressable>
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
          <Animated.View
            style={[
              doubleTapHeartStyle,
              {
                position: 'absolute',
                top: '50%',
                left: '50%',
                marginTop: -40,
                marginLeft: -40,
              },
            ]}
          >
            <Feather name="heart" size={80} color={theme.colors.accent.primary} />
          </Animated.View>
        </Pressable>
      )}

      {/* Action Bar */}
      <View style={actionBarStyle}>
        <AnimatedPressable onPress={handleLike} style={[actionButtonStyle, heartAnimatedStyle]}>
          {/* Issue 5: Feather icons do not have a filled heart variant.
              We use color to indicate liked state and apply fill via style.
              The filled visual is achieved by rendering the icon in the accent color. */}
          <Feather
            name="heart"
            size={20}
            color={post.isLiked ? theme.colors.accent.primary : theme.colors.text.secondary}
            style={post.isLiked ? { fill: theme.colors.accent.primary } as TextStyle : undefined}
          />
          <Text
            variant="caption"
            weight="medium"
            color={post.isLiked ? theme.colors.accent.primary : theme.colors.text.secondary}
            style={{ marginLeft: theme.spacing.xs } as TextStyle}
          >
            {post.likesCount}
          </Text>
        </AnimatedPressable>

        <Pressable
          style={actionButtonStyle}
          onPress={() => onComment?.(post.id)}
        >
          <Feather name="message-circle" size={20} color={theme.colors.text.secondary} />
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
          <Feather name="send" size={18} color={theme.colors.text.secondary} />
        </Pressable>

        <View style={{ flex: 1 }} />

        <AnimatedPressable onPress={handleBookmark} style={bookmarkAnimatedStyle}>
          {/* Issue 5: Feather does not have a filled bookmark. Color change indicates state. */}
          <Feather
            name="bookmark"
            size={20}
            color={isBookmarked ? theme.colors.accent.tertiary : theme.colors.text.secondary}
          />
        </AnimatedPressable>
      </View>
    </Card>
  );
}
