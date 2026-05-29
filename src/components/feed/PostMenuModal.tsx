import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Modal, Share, Alert, Animated, Dimensions, PanResponder } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { CachedImage } from '../ui/CachedImage';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { UserBadge } from '../ui/UserBadge';
import { Post } from '../../types';
import { triggerHaptic } from '../../utils/haptics';
import { useAuthStore } from '../../store/authStore';
import { useFeedStore } from '../../store/feedStore';
import { deletePost } from '../../lib/supabase';
import { showToast } from '../../store/toastStore';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const REPORT_CATS = ['Спам', 'Насилие', 'Ложная информация', 'Мошенничество', 'Нарушение авторских прав', 'Другое'];

interface PostMenuModalProps {
  visible: boolean;
  post: Post | null;
  onClose: () => void;
}

export function PostMenuModal({ visible, post, onClose }: PostMenuModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { removePost } = useFeedStore();
  const [mode, setMode] = useState<'menu' | 'report'>('menu');

  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const isClosing = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 10,
      onPanResponderMove: (_, g) => { if (g.dy > 0) dragY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) { dismiss(); }
        else { Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 120, friction: 10 }).start(); }
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      isClosing.current = false;
      setMode('menu');
      dragY.setValue(0);
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    if (isClosing.current) return;
    isClosing.current = true;
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(() => {
        setMode('menu');
        onClose();
      }, 30);
    });
  };

  const switchToReport = () => {
    // Animate out, switch mode, animate in
    Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 150, useNativeDriver: true }).start(() => {
      setMode('report');
      dragY.setValue(0);
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }).start();
    });
  };

  if (!post) return null;

  const isOwnPost = user?.id === post.authorId;
  const previewName = post.isRepost && post.originalPost ? post.originalPost.authorName : post.authorName;
  const previewEmoji = post.isRepost && post.originalPost ? post.originalPost.authorEmoji : post.authorEmoji;
  const previewContent = post.isRepost && post.originalPost ? post.originalPost.content : (post.content || 'Публикация');
  const previewImage = post.isRepost && post.originalPost ? post.originalPost.imageUrl : post.imageUrl;

  const handleCopyLink = async () => { triggerHaptic('light'); await Clipboard.setStringAsync(`https://san-mes.vercel.app/post/${post.id}`); showToast('Ссылка скопирована', 'link'); dismiss(); };
  const handleShare = async () => { triggerHaptic('light'); try { await Share.share({ message: `${post.content || ''}\nhttps://san-mes.vercel.app/post/${post.id}` }); } catch {} dismiss(); };
  const handleDelete = () => {
    triggerHaptic('medium');
    Alert.alert('Удалить пост?', 'Это действие нельзя отменить', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: async () => { if (user?.id) { await deletePost(post.id, user.id); removePost(post.id); showToast('Пост удалён', 'trash-2'); } dismiss(); } },
    ]);
  };

  const translateY = Animated.add(slideAnim, dragY);
  const sheetBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        {/* Backdrop */}
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdropAnim }}>
          <Pressable style={{ flex: 1 }} onPress={dismiss} />
        </Animated.View>

        {/* Sheet */}
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View
            style={{ transform: [{ translateY }] }}
            {...panResponder.panHandlers}
          >
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: sheetBg, borderRadius: 28, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}>
          {/* Handle */}
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
          </View>

          {mode === 'menu' ? (
            <>
              {/* Post preview */}
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, marginHorizontal: 12, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', borderRadius: 14, marginBottom: 8 }}>
                <Avatar emoji={previewEmoji} size="sm" />
                <View style={{ marginLeft: 10, flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Text variant="caption" weight="semibold" numberOfLines={1}>{previewName}</Text>
                    {post.authorVerified && <VerifiedBadge size={11} />}
                    {post.authorBadge && <UserBadge badge={post.authorBadge} size="sm" />}
                  </View>
                  <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>{previewContent}</Text>
                </View>
                {previewImage && <CachedImage uri={previewImage} style={{ width: 40, height: 40, borderRadius: 10, marginLeft: 8 }} resizeMode="cover" />}
              </View>
              <MenuItem icon="link" label="Скопировать ссылку" onPress={handleCopyLink} theme={theme} />
              <MenuItem icon="share-2" label="Поделиться" onPress={handleShare} theme={theme} />
              <MenuItem icon="bookmark" label="Сохранить" onPress={() => { triggerHaptic('light'); showToast('Сохранено', 'bookmark'); dismiss(); }} theme={theme} />
              {isOwnPost && <MenuItem icon="trash-2" label="Удалить пост" onPress={handleDelete} theme={theme} destructive />}
              {!isOwnPost && <MenuItem icon="flag" label="Пожаловаться" onPress={() => { triggerHaptic('light'); switchToReport(); }} theme={theme} destructive />}
            </>
          ) : (
            <>
              <Text variant="body" weight="semibold" align="center" style={{ paddingVertical: 10 }}>Причина жалобы</Text>
              {REPORT_CATS.map((cat, i) => (
                <Pressable key={i} onPress={() => { triggerHaptic('medium'); showToast('Жалоба отправлена', 'flag'); dismiss(); }} style={{ paddingVertical: 14, paddingHorizontal: 20, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}>
                  <Text variant="body">{cat}</Text>
                </Pressable>
              ))}
            </>
          )}
          <View style={{ height: 10 }} />
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
