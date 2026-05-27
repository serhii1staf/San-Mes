import React from 'react';
import { View, Pressable, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

  const options = [
    { icon: 'link', label: 'Скопировать ссылку', action: () => { onClose(); } },
    { icon: 'share-2', label: 'Поделиться', action: () => { onClose(); } },
    { icon: 'bookmark', label: 'Сохранить', action: () => { onClose(); } },
    { icon: 'flag', label: 'Пожаловаться', action: () => { onClose(); }, destructive: true },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose}>
        <View style={{ flex: 1 }} />
        <Pressable onPress={(e) => e.stopPropagation()}>
          <View style={{
            backgroundColor: theme.isDark ? '#1C1C1E' : '#FFFFFF',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingTop: 12,
            paddingBottom: insets.bottom + 16,
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
              marginBottom: 20,
            }}>
              <Avatar emoji={post.authorEmoji} size="sm" />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text variant="caption" weight="semibold" numberOfLines={1}>{post.authorName}</Text>
                <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>{post.content || 'Публикация'}</Text>
              </View>
            </View>

            {/* Options */}
            {options.map((opt, i) => (
              <Pressable
                key={i}
                onPress={() => { triggerHaptic('light'); opt.action(); }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 14,
                  borderBottomWidth: i < options.length - 1 ? 0.5 : 0,
                  borderBottomColor: theme.colors.border.light,
                }}
              >
                <Feather name={opt.icon as any} size={20} color={opt.destructive ? '#FF3B30' : theme.colors.text.primary} />
                <Text variant="body" color={opt.destructive ? '#FF3B30' : theme.colors.text.primary} style={{ marginLeft: 14 }}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
