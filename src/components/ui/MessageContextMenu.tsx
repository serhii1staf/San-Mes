import React, { useEffect, useRef } from 'react';
import { View, Pressable, Modal, Animated, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { FormattedText } from './FormattedText';
import { ChatMessage } from '../../types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export type MessageAction = 'reply' | 'copy' | 'edit' | 'delete';

interface MessageContextMenuProps {
  visible: boolean;
  message: ChatMessage | null;
  isOwn: boolean;
  bubbleColor: string;
  bubbleTextColor: string;
  bubbleRadius: number;
  onClose: () => void;
  onAction: (action: MessageAction, message: ChatMessage) => void;
}

export function MessageContextMenu({ visible, message, isOwn, bubbleColor, bubbleTextColor, bubbleRadius, onClose, onAction }: MessageContextMenuProps) {
  const theme = useTheme();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 60, friction: 10 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = (cb?: () => void) => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => setTimeout(() => { onClose(); cb?.(); }, 20));
  };

  if (!visible || !message) return null;

  const items: { action: MessageAction; icon: string; label: string; destructive?: boolean; show: boolean }[] = [
    { action: 'reply', icon: 'corner-up-left', label: 'Ответить', show: true },
    { action: 'copy', icon: 'copy', label: 'Копировать', show: true },
    { action: 'edit', icon: 'edit-2', label: 'Редактировать', show: isOwn },
    { action: 'delete', icon: 'trash-2', label: 'Удалить', destructive: true, show: isOwn },
  ];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => dismiss()} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdropAnim }}>
          <Pressable style={{ flex: 1 }} onPress={() => dismiss()} />
        </Animated.View>

        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY: slideAnim }] }}>
            {/* Highlighted message preview */}
            <View style={{ marginHorizontal: 16, marginBottom: 8, alignItems: isOwn ? 'flex-end' : 'flex-start' }}>
              <View style={{
                maxWidth: '85%',
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: bubbleRadius,
                backgroundColor: bubbleColor,
                borderBottomRightRadius: isOwn ? 4 : bubbleRadius,
                borderBottomLeftRadius: isOwn ? bubbleRadius : 4,
              }}>
                {message.replyToText ? (
                  <View style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.accent.primary, marginBottom: 6 }}>
                    <Text variant="caption" color={isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{message.replyToText}</Text>
                  </View>
                ) : null}
                <FormattedText color={bubbleTextColor} linkColor={isOwn ? '#FFFFFF' : theme.colors.accent.primary} style={{ fontSize: 15 }}>{message.text}</FormattedText>
              </View>
            </View>

            {/* Menu */}
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}>
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
              </View>
              {items.filter(i => i.show).map((item) => {
                const color = item.destructive ? '#FF3B30' : theme.colors.text.primary;
                return (
                  <Pressable key={item.action} onPress={() => dismiss(() => onAction(item.action, message))} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20 }}>
                    <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: item.destructive ? '#FF3B3010' : (theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'), alignItems: 'center', justifyContent: 'center' }}>
                      <Feather name={item.icon as any} size={17} color={color} />
                    </View>
                    <Text variant="body" color={color} style={{ marginLeft: 14 }}>{item.label}</Text>
                  </Pressable>
                );
              })}
              <View style={{ height: 8 }} />
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}
