import React, { useState, useRef, memo } from 'react';
import { View, Pressable, ViewStyle, TextStyle, Dimensions, ScrollView, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { Card } from '../ui/Card';
import { CachedImage } from '../ui/CachedImage';
import { Post } from '../../types';
import { formatTimeAgo } from '../../utils/mockData';
import { triggerHaptic } from '../../utils/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CAROUSEL_HEIGHT = 300;

interface ImageCarouselProps {
  imageUrls: string[];
  onDoubleTap: () => void;
  cardWidth: number;
}

function ImageCarousel({ imageUrls, onDoubleTap, cardWidth }: ImageCarouselProps) {
  const theme = useTheme();
  const [activeIndex, setActiveIndex] = useState(0);
  const lastTapRef = useRef<number>(0);
  const imageWidth = cardWidth * 0.85;
  const snapInterval = imageWidth + 8; // image width + gap

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / snapInterval);
    setActiveIndex(Math.max(0, Math.min(index, imageUrls.length - 1)));
  };

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      onDoubleTap();
    }
    lastTapRef.current = now;
  };

  if (imageUrls.length === 1) {
    return (
      <Pressable onPress={handlePress} style={{ paddingHorizontal: 12 }}>
        <CachedImage
          uri={imageUrls[0]}
          style={{
            width: '100%',
            height: CAROUSEL_HEIGHT,
            borderRadius: theme.borderRadius.md,
          }}
          resizeMode="cover"
        />
      </Pressable>
    );
  }

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={snapInterval}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {imageUrls.map((url, index) => (
          <Pressable key={index} onPress={handlePress}>
            <CachedImage
              uri={url}
              style={{
                width: imageWidth,
                height: CAROUSEL_HEIGHT,
                borderRadius: theme.borderRadius.md,
              }}
              resizeMode="cover"
            />
          </Pressable>
        ))}
      </ScrollView>
      {/* Dots indicator */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8, gap: 5 }}>
        {imageUrls.map((_, index) => (
          <View
            key={index}
            style={{
              width: index === activeIndex ? 7 : 5,
              height: index === activeIndex ? 7 : 5,
              borderRadius: 4,
              backgroundColor: index === activeIndex
                ? theme.colors.accent.primary
                : theme.colors.text.tertiary + '40',
            }}
          />
        ))}
      </View>
    </View>
  );
}

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
    if (!post.isLiked) onLike(post.id);
  };

  const handleBookmark = () => {
    triggerHaptic('light');
    setIsBookmarked(!isBookmarked);
    onBookmark?.(post.id);
  };

  // Get image URLs - prefer imageUrls array, fall back to imageUrl
  const imageUrls = post.imageUrls && post.imageUrls.length > 0
    ? post.imageUrls
    : post.imageUrl
      ? [post.imageUrl]
      : [];

  const cardWidth = SCREEN_WIDTH - 32; // approximate card width after padding

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
          {post.originalPost?.authorEmoji && (
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', alignItems: 'center', justifyContent: 'center', marginLeft: 2 }}>
              <Text style={{ fontSize: 10 }}>{post.originalPost.authorEmoji}</Text>
            </View>
          )}
        </View>
      )}

      {/* Header */}
      <View style={headerStyle}>
        <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: post.authorId } })} style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
          <Avatar emoji={post.authorEmoji} name={post.authorName} size="sm" />
          <View style={{ marginLeft: theme.spacing.md, flex: 1 }}>
            <Text weight="semibold" variant="body" numberOfLines={1}>{post.authorName}</Text>
            <Text variant="caption" color={theme.colors.text.secondary} numberOfLines={1}>@{post.authorUsername} · {formatTimeAgo(post.createdAt)}</Text>
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
          {post.originalPost.imageUrls && post.originalPost.imageUrls.length > 0 ? (
            <CachedImage uri={post.originalPost.imageUrls[0]} style={{ width: '100%', height: 150 }} resizeMode="cover" />
          ) : post.originalPost.imageUrl ? (
            <CachedImage uri={post.originalPost.imageUrl} style={{ width: '100%', height: 150 }} resizeMode="cover" />
          ) : null}
        </View>
      )}

      {/* Image carousel (non-repost) */}
      {!post.isRepost && imageUrls.length > 0 && (
        <ImageCarousel
          imageUrls={imageUrls}
          onDoubleTap={handleDoubleTap}
          cardWidth={cardWidth}
        />
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
