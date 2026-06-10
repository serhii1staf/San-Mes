import React, { useEffect, useRef } from 'react';
import { View, Pressable, Modal, Animated, Share, Alert, Dimensions, StatusBar } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { CachedImage } from './CachedImage';
import { VerifiedBadge } from './VerifiedBadge';
import { UserBadge } from './UserBadge';
import { FormattedText } from './FormattedText';
import { showToast } from '../../store/toastStore';
import { formatTimeAgo } from '../../utils/mockData';
import { Post } from '../../types';
import { sharePost } from '../../utils/sharePost';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface PostContextMenuProps {
  visible: boolean;
  post: Post | null;
  isOwnPost: boolean;
  onClose: () => void;
  onDelete?: (postId: string) => void;
}

export function PostContextMenu({ visible, post, isOwnPost, onClose, onDelete }: PostContextMenuProps) {
  const theme = useTheme();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const dismissing = useRef(false);
  const opened = useRef(false);

  useEffect(() => {
    if (visible) {
      // Reentrancy guard: if the open animation is already running/done, don't
      // restart it on a redundant `visible` flip — restarting mid-animation is
      // what stutters/freezes on rapid long-press bursts.
      if (opened.current) return;
      opened.current = true;
      dismissing.current = false;
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      opened.current = false;
    }
  }, [visible]);

  const dismiss = () => {
    if (dismissing.current) return;
    dismissing.current = true;
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => setTimeout(onClose, 30));
  };

  const handleCopy = async () => {
    if (post) {
      const parts = [];
      parts.push(`${post.authorName} (@${post.authorUsername})`);
      parts.push(formatTimeAgo(post.createdAt));
      if (post.isRepost && post.originalPost) {
        parts.push(`Репост от ${post.originalPost.authorName}`);
        if (post.originalPost.content) parts.push(post.originalPost.content);
        if (post.originalPost.imageUrl) parts.push(post.originalPost.imageUrl);
      }
      if (post.content) parts.push(post.content);
      if (post.imageUrl && !post.isRepost) parts.push(post.imageUrl);
      await Clipboard.setStringAsync(parts.join('\n'));
      showToast('Скопировано', 'copy');
    }
    dismiss();
  };

  const handleShare = async () => {
    if (post) {
      // Share the actual photo + text into other apps, not a link.
      await sharePost(post);
    }
    dismiss();
  };

  const handleDelete = () => {
    if (post && onDelete) {
      Alert.alert('Удалить?', 'Это действие нельзя отменить', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => { onDelete(post.id); dismiss(); } },
      ]);
    }
  };

  if (!visible || !post) return null;

  const imgs = post.imageUrls || (post.imageUrl ? [post.imageUrl] : []);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <StatusBar hidden />
      <View style={{ flex: 1 }}>
        {/* Backdrop */}
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdropAnim }}>
          <Pressable style={{ flex: 1 }} onPress={dismiss} />
        </Animated.View>

        {/* Content */}
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY: slideAnim }] }}>
            {/* Post preview card */}
            <View style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 24, padding: 12, borderWidth: 1, borderColor: theme.colors.border.light }}>
              {/* Repost indicator */}
              {post.isRepost && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <Feather name="repeat" size={12} color={theme.colors.text.tertiary} />
                  <Text variant="caption" color={theme.colors.text.tertiary}>Репост</Text>
                </View>
              )}
              {/* Author */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Avatar emoji={post.authorEmoji} size="sm" />
                <View style={{ marginLeft: 10, flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{post.authorName}</Text>
                    {post.authorVerified && <VerifiedBadge size={10} />}
                    {post.authorBadge && <UserBadge badge={post.authorBadge} size="sm" />}
                  </View>
                  <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 10 }}>@{post.authorUsername} · {formatTimeAgo(post.createdAt)}</Text>
                </View>
              </View>
              {/* Content with formatting */}
              {post.content ? <FormattedText style={{ marginBottom: 8, fontSize: 14 }}>{post.content}</FormattedText> : null}
              {/* Original post for reposts */}
              {post.isRepost && post.originalPost && (
                <View style={{ borderWidth: 1, borderColor: theme.colors.border.light, borderRadius: 14, padding: 10, marginBottom: 8, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 4 }}>
                    <Avatar emoji={post.originalPost.authorEmoji} size="xs" />
                    <Text variant="caption" weight="semibold" numberOfLines={1} style={{ marginLeft: 4, flexShrink: 1 }}>{post.originalPost.authorName}</Text>
                    {post.originalPost.authorVerified && <VerifiedBadge size={9} />}
                  </View>
                  {post.originalPost.content ? <FormattedText style={{ fontSize: 12 }} color={theme.colors.text.secondary}>{post.originalPost.content}</FormattedText> : null}
                  {(post.originalPost.imageUrls?.[0] || post.originalPost.imageUrl) && (
                    <CachedImage uri={post.originalPost.imageUrls?.[0] || post.originalPost.imageUrl || ''} style={{ width: '100%', height: 80, borderRadius: 10, marginTop: 6 }} resizeMode="cover" />
                  )}
                </View>
              )}
              {/* Images */}
              {imgs.length > 0 && !post.isRepost && (
                <CachedImage uri={imgs[0]} style={{ width: '100%', height: 120, borderRadius: 14 }} resizeMode="cover" />
              )}
            </View>

            {/* Menu */}
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}>
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
              </View>
              <MenuItem icon="copy" label="Скопировать" onPress={handleCopy} theme={theme} />
              <MenuItem icon="share-2" label="Поделиться" onPress={handleShare} theme={theme} />
              {isOwnPost && <MenuItem icon="trash-2" label="Удалить" onPress={handleDelete} theme={theme} destructive />}
              <View style={{ height: 8 }} />
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

function MenuItem({ icon, label, onPress, theme, destructive }: { icon: string; label: string; onPress: () => void; theme: any; destructive?: boolean }) {
  const color = destructive ? '#FF3B30' : theme.colors.text.primary;
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: destructive ? '#FF3B3010' : (theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'), alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon as any} size={17} color={color} />
      </View>
      <Text variant="body" color={color} style={{ marginLeft: 14 }}>{label}</Text>
    </Pressable>
  );
}
