import React from 'react';
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

export function PostMenuModal({ visible, post, onClose }: PostMenuModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  if (!post) return null;

  const handleCopyLink = async () => {
    triggerHaptic('light');
    await Clipboard.setStringAsync(`https://san-mes.app/post/${post.id}`);
    onClose();
  };

  const handleShare = async () => {
    triggerHaptic('light');
    await Share.share({ message: post.content || 'Посмотри этот пост в San!' });
    onClose();
  };

  const handleSave = () => {
    triggerHaptic('light');
    // TODO: implement saved posts
    onClose();
  };

  const handleReport = () => {
    triggerHaptic('light');
    Alert.alert('Жалоба отправлена', 'Спасибо за обращение. Мы рассмотрим его в ближайшее время.');
    onClose();
  };

  const options = [
    { icon: 'link', label: 'Скопировать ссылку', action: handleCopyLink },
    { icon: 'share-2', label: 'Поделиться', action: handleShare },
    { icon: 'bookmark', label: 'Сохранить', action: handleSave },
    { icon: 'flag', label: 'Пожаловаться', action: handleReport, destructive: true },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose}>
        <View style={{ flex: 1 }} />
        <Pressable onPress={(e) => e.stopPropagation()}>
          <View style={{
            marginHorizontal: 12,
            marginBottom: insets.bottom + 12,
            backgroundColor: theme.isDark ? '#1C1C1E' : '#FFFFFF',
            borderRadius: 20,
            paddingTop: 12,
            paddingBottom: 16,
            paddingHorizontal: 20,
          }}>
            {/* Handle */}
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: theme.colors.border.medium }} />
            </View>

            {/* Post preview */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: 12,
              backgroundColor: theme.colors.background.secondary,
              borderRadius: 14,
              marginBottom: 16,
            }}>
              <Avatar emoji={post.authorEmoji} size="sm" />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text variant="caption" weight="semibold" numberOfLines={1}>{post.authorName}</Text>
                <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={2}>{post.content || 'Публикация'}</Text>
              </View>
              {post.imageUrl && (
                <Image source={{ uri: post.imageUrl }} style={{ width: 44, height: 44, borderRadius: 8, marginLeft: 'auto' }} resizeMode="cover" />
              )}
            </View>

            {/* Options */}
            {options.map((opt, i) => (
              <Pressable
                key={i}
                onPress={opt.action}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 13,
                  borderBottomWidth: i < options.length - 1 ? 0.5 : 0,
                  borderBottomColor: theme.colors.border.light,
                }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: (opt as any).destructive ? '#FF3B3015' : theme.colors.background.secondary, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name={opt.icon as any} size={18} color={(opt as any).destructive ? '#FF3B30' : theme.colors.text.primary} />
                </View>
                <Text variant="body" color={(opt as any).destructive ? '#FF3B30' : theme.colors.text.primary} style={{ marginLeft: 12 }}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
