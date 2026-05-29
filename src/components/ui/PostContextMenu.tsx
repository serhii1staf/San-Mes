import React, { useEffect, useRef } from 'react';
import { View, Pressable, Modal, Animated, Share, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { showToast } from '../../store/toastStore';
import { triggerHaptic } from '../../utils/haptics';
import * as Clipboard from 'expo-clipboard';

interface PostContextMenuProps {
  visible: boolean;
  post: { id: string; content?: string; imageUrl?: string; authorName?: string } | null;
  isOwnPost: boolean;
  onClose: () => void;
  onDelete?: (postId: string) => void;
}

export function PostContextMenu({ visible, post, isOwnPost, onClose, onDelete }: PostContextMenuProps) {
  const theme = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    if (visible) {
      fadeAnim.setValue(0);
      slideAnim.setValue(40);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 40, duration: 150, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  const handleCopy = async () => {
    if (post?.content) {
      await Clipboard.setStringAsync(post.content);
      showToast('Скопировано', 'copy');
    }
    dismiss();
  };

  const handleShare = async () => {
    if (post) {
      try {
        await Share.share({ message: `${post.content || ''}\nhttps://san-mes.vercel.app/post/${post.id}` });
      } catch {}
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

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', opacity: fadeAnim }}>
        <Pressable style={{ flex: 1 }} onPress={dismiss} />
      </Animated.View>
      {/* Menu at bottom */}
      <Animated.View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, transform: [{ translateY: slideAnim }] }}>
        <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 20, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 8 }}>
          <MenuItem icon="copy" label="Скопировать" onPress={handleCopy} theme={theme} />
          <MenuItem icon="share-2" label="Поделиться" onPress={handleShare} theme={theme} />
          {isOwnPost && <MenuItem icon="trash-2" label="Удалить" onPress={handleDelete} theme={theme} destructive />}
        </View>
      </Animated.View>
    </Modal>
  );
}

function MenuItem({ icon, label, onPress, theme, destructive }: { icon: string; label: string; onPress: () => void; theme: any; destructive?: boolean }) {
  const color = destructive ? '#FF3B30' : theme.colors.text.primary;
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20 }}>
      <Feather name={icon as any} size={18} color={color} style={{ marginRight: 14 }} />
      <Text variant="body" color={color}>{label}</Text>
    </Pressable>
  );
}
