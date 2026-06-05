import React, { useState, useRef, memo } from 'react';
import { View, Pressable, ViewStyle, Dimensions, ScrollView, NativeSyntheticEvent, NativeScrollEvent, Text as RNText } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { CachedImage } from '../ui/CachedImage';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { UserBadge } from '../ui/UserBadge';
import { FormattedText } from '../ui/FormattedText';
import { SpoilerImage } from '../ui/SpoilerImage';
import { Post } from '../../types';
import { formatTimeAgo } from '../../utils/mockData';
import { triggerHaptic } from '../../utils/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IMAGE_HEIGHT = 280;

interface PostCardProps {
  post: Post;
  currentUserId?: string;
  onLike: (postId: string) => void;
  onComment?: (postId: string) => void;
  onShare?: (postId: string) => void;
  onBookmark?: (postId: string) => void;
  onMenu?: (post: Post) => void;
  onFollow?: (userId: string) => void;
}

export const PostCard = memo(function PostCard({ post, currentUserId, onLike, onComment, onShare, onBookmark, onMenu, onFollow }: PostCardProps) {
  const theme = useTheme();
  const lastTap = useRef<number>(0);

  const handleLike = () => { triggerHaptic('light'); onLike(post.id); };
  const handleDoubleTap = () => { if (!post.isLiked) onLike(post.id); };

  const imageUrls = post.imageUrls && post.imageUrls.length > 0 ? post.imageUrls : post.imageUrl ? [post.imageUrl] : [];
  const hasImages = imageUrls.length > 0 && !post.isSpoilerImage;
  const hasSpoiler = post.isSpoilerImage && imageUrls.length > 0;

  // Card colors — blend with theme background
  const cardBg = theme.isDark ? theme.colors.background.elevated : 'rgba(255,255,255,0.95)';
  const cardBorder = theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  return (
    <View style={{ marginBottom: 12, borderRadius: 28, backgroundColor: cardBg, borderWidth: 1, borderColor: cardBorder, overflow: 'hidden' }}>
      {/* Repost indicator */}
      {post.isRepost && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, gap: 6 }}>
          <Feather name="repeat" size={12} color={theme.colors.text.tertiary} />
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{post.authorName} репостнул(а)</Text>
        </View>
      )}

      {/* Header: avatar + name + username + time + icons */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: post.isRepost ? 8 : 14, paddingBottom: 8 }}>
        <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: post.authorId } })}>
          <Avatar emoji={post.authorEmoji} name={post.authorName} size="sm" />
        </Pressable>
        <View style={{ marginLeft: 10, flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Text weight="bold" variant="body" numberOfLines={1} style={{ fontSize: 15, flexShrink: 1 }}>{post.authorName}</Text>
            {post.authorVerified && <VerifiedBadge size={13} />}
            {post.authorBadge && <UserBadge badge={post.authorBadge} size="sm" />}
          </View>
          <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 12 }}>@{post.authorUsername} · {formatTimeAgo(post.createdAt)}</Text>
        </View>
        {/* Right icons */}
        {currentUserId !== post.authorId && (
          <Pressable onPress={() => { triggerHaptic('light'); onFollow?.(post.authorId); }} hitSlop={8} style={{ padding: 4 }}>
            <Feather name="user-plus" size={16} color={theme.colors.text.tertiary} />
          </Pressable>
        )}
        <Pressable onPress={() => { triggerHaptic('light'); onMenu?.(post); }} hitSlop={8} style={{ padding: 4, marginLeft: 6 }}>
          <Feather name="more-vertical" size={16} color={theme.colors.text.tertiary} />
        </Pressable>
      </View>

      {/* Content text */}
      {post.content ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: hasImages || hasSpoiler ? 10 : 4 }}>
          <FormattedText style={{ fontSize: 14, lineHeight: 20 }}>{post.content}</FormattedText>
        </View>
      ) : null}

      {/* Original post embed (reposts) */}
      {post.isRepost && post.originalPost && (
        <View style={{ marginHorizontal: 16, marginBottom: 10, borderWidth: 1, borderColor: cardBorder, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
            <Avatar emoji={post.originalPost.authorEmoji} size="xs" />
            <Text variant="caption" weight="semibold" numberOfLines={1} style={{ marginLeft: 8, fontSize: 12, flexShrink: 1 }}>{post.originalPost.authorName}</Text>
            {post.originalPost.authorVerified && <VerifiedBadge size={10} />}
          </View>
          {post.originalPost.content && (
            <View style={{ paddingHorizontal: 10, paddingBottom: 10 }}>
              <FormattedText style={{ fontSize: 13 }}>{post.originalPost.content}</FormattedText>
            </View>
          )}
          {post.originalPost.imageUrls && post.originalPost.imageUrls.length > 0 ? (
            <CachedImage uri={post.originalPost.imageUrls[0]} style={{ width: '100%', height: 140 }} resizeMode="cover" />
          ) : post.originalPost.imageUrl ? (
            <CachedImage uri={post.originalPost.imageUrl} style={{ width: '100%', height: 140 }} resizeMode="cover" />
          ) : null}
        </View>
      )}

      {/* Image — fixed height, cover mode, rounded inside card */}
      {hasImages && !post.isRepost && (
        imageUrls.length === 1 ? (
          <Pressable onPress={() => { const now = Date.now(); if (now - lastTap.current < 300) handleDoubleTap(); lastTap.current = now; }}>
            <CachedImage uri={imageUrls[0]} style={{ width: '100%', height: IMAGE_HEIGHT, marginBottom: 0 }} resizeMode="cover" />
          </Pressable>
        ) : (
          <ImageCarousel imageUrls={imageUrls} onDoubleTap={handleDoubleTap} />
        )
      )}

      {hasSpoiler && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <SpoilerImage uri={imageUrls[0]} width="100%" height={IMAGE_HEIGHT} borderRadius={12} isSpoiler={true} />
        </View>
      )}

      {/* Action bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 4 }}>
        {/* Star (like) */}
        <Pressable onPress={handleLike} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
          <Feather name="star" size={16} color={post.isLiked ? theme.colors.accent.primary : theme.colors.text.tertiary} />
          <Text variant="caption" color={post.isLiked ? theme.colors.accent.primary : theme.colors.text.tertiary} style={{ marginLeft: 4, fontSize: 12 }}>{post.likesCount || ''}</Text>
        </Pressable>

        {/* Comments */}
        <Pressable onPress={() => onComment?.(post.id)} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
          <Feather name="message-square" size={16} color={theme.colors.text.tertiary} />
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginLeft: 4, fontSize: 12 }}>{post.commentsCount || ''}</Text>
        </Pressable>

        {/* Repost */}
        <Pressable onPress={() => { triggerHaptic('light'); onShare?.(post.id); }} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
          <Feather name="corner-up-right" size={16} color={theme.colors.text.tertiary} />
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginLeft: 4, fontSize: 12 }}>{post.sharesCount || ''}</Text>
        </Pressable>

        {/* Share */}
        <Pressable onPress={async () => { triggerHaptic('light'); try { const { Share } = require('react-native'); await Share.share({ message: `${post.content || ''}\nhttps://san-m-app.com/post/${post.id}` }); } catch {} }} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Feather name="send" size={15} color={theme.colors.text.tertiary} />
        </Pressable>
      </View>
    </View>
  );
});

// Image carousel for multiple images
function ImageCarousel({ imageUrls, onDoubleTap }: { imageUrls: string[]; onDoubleTap: () => void }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const lastTapRef = useRef<number>(0);
  const imgWidth = SCREEN_WIDTH - 32;

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / imgWidth);
    setActiveIndex(Math.max(0, Math.min(index, imageUrls.length - 1)));
  };

  const handlePress = () => { const now = Date.now(); if (now - lastTapRef.current < 300) onDoubleTap(); lastTapRef.current = now; };

  return (
    <View>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={handleScroll} scrollEventThrottle={16}>
        {imageUrls.map((url, i) => (
          <Pressable key={i} onPress={handlePress}>
            <CachedImage uri={url} style={{ width: imgWidth, height: IMAGE_HEIGHT }} resizeMode="cover" />
          </Pressable>
        ))}
      </ScrollView>
      {imageUrls.length > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 6, gap: 4 }}>
          {imageUrls.map((_, i) => (
            <View key={i} style={{ width: i === activeIndex ? 7 : 5, height: 5, borderRadius: 3, backgroundColor: i === activeIndex ? '#FFFFFF' : 'rgba(255,255,255,0.3)' }} />
          ))}
        </View>
      )}
    </View>
  );
}
