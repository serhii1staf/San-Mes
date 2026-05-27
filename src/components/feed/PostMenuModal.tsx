import React, { useState } from 'react';
import { View, Pressable, Modal, Share, Image, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { Post } from '../../types';
import { triggerHaptic } from '../../utils/haptics';

interface PostMenuModalProps {
  visible: boolean;
  post: Post | null;
  onClose: () => void;
}

const REPORT_CATEGORIES = [
  'Спам',
  'Насилие или опасные организации',
  'Ложная информация',
  'Мошенничество',
  'Нарушение авторских прав',
  'Другое',
];

export function PostMenuModal({ visible, post, onClose }: PostMenuModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [showReport, setShowReport] = useState(false);

  if (!post) return null;

  const handleCopyLink = async () => {
    triggerHaptic('light');
    await Clipboard.setStringAsync(`san-mes://post/${post.id}`);
    onClose();
  };

  const handleShare = async () => {
    triggerHaptic('light');
    try {
      await Share.share({ message: post.content || 'Посмотри этот пост в San!' });
    } catch (e) {}
    onClose();
  };

  const handleReport = (category: string) => {
    triggerHaptic('medium');
    setShowReport(false);
    onClose();
  };

  // Report categories modal
  if (showReport) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { setShowReport(false); onClose(); }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={() => { setShowReport(false); onClose(); }}>
          <View style={{ flex: 1 }} />
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={{ marginHorizontal: 12, marginBottom: insets.bottom + 12, backgroundColor: theme.isDark ? '#1C1C1E' : '#FFFFFF', borderRadius: 20, paddingTop: 12, paddingBottom: 16, paddingHorizontal: 20 }}>
              <View style={{ alignItems: 'center', marginBottom: 14 }}>
                <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: theme.colors.border.medium }} />
              </View>
              <Text variant="body" weight="semibold" align="center" style={{ marginBottom: 16 }}>Причина жалобы</Text>
              {REPORT_CATEGORIES.map((cat, i) => (
                <Pressable key={i} onPress={() => handleReport(cat)} style={{ paddingVertical: 13, borderBottomWidth: i < REPORT_CATEGORIES.length - 1 ? 0.5 : 0, borderBottomColor: theme.colors.border.light }}>
                  <Text variant="body">{cat}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose}>
        <View style={{ flex: 1 }} />
        <Pressable onPress={(e) => e.stopPropagation()}>
          <View style={{ marginHorizontal: 12, marginBottom: insets.bottom + 12, backgroundColor: theme.isDark ? '#1C1C1E' : '#FFFFFF', borderRadius: 20, paddingTop: 12, paddingBottom: 16, paddingHorizontal: 20 }}>
            {/* Handle */}
            <View style={{ alignItems: 'center', marginBottom: 14 }}>
              <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: theme.colors.border.medium }} />
            </View>

            {/* Post preview with image */}
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: theme.colors.background.secondary, borderRadius: 14, marginBottom: 16 }}>
              <Avatar emoji={post.authorEmoji} size="sm" />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text variant="caption" weight="semibold" numberOfLines={1}>{post.authorName}</Text>
                <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>{post.content || 'Публикация'}</Text>
              </View>
              {post.imageUrl && <Image source={{ uri: post.imageUrl }} style={{ width: 44, height: 44, borderRadius: 8, marginLeft: 8 }} resizeMode="cover" />}
            </View>

            {/* Options */}
            <Pressable onPress={handleCopyLink} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.colors.background.secondary, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="link" size={18} color={theme.colors.text.primary} />
              </View>
              <Text variant="body" style={{ marginLeft: 12 }}>Скопировать ссылку</Text>
            </Pressable>

            <Pressable onPress={handleShare} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.colors.background.secondary, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="share-2" size={18} color={theme.colors.text.primary} />
              </View>
              <Text variant="body" style={{ marginLeft: 12 }}>Поделиться</Text>
            </Pressable>

            <Pressable onPress={() => { triggerHaptic('light'); onClose(); }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.colors.background.secondary, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="bookmark" size={18} color={theme.colors.text.primary} />
              </View>
              <Text variant="body" style={{ marginLeft: 12 }}>Сохранить</Text>
            </Pressable>

            <Pressable onPress={() => { triggerHaptic('light'); setShowReport(true); }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#FF3B3015', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="flag" size={18} color="#FF3B30" />
              </View>
              <Text variant="body" color="#FF3B30" style={{ marginLeft: 12 }}>Пожаловаться</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
