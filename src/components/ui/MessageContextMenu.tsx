import React, { useEffect, useRef } from 'react';
import { View, Pressable, Modal, Animated, Dimensions, ScrollView, StatusBar, Easing } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(40)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(40);
      fade.setValue(0);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = (cb?: () => void) => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 40, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(() => { onClose(); cb?.(); });
  };

  if (!visible || !message) return null;

  const items: { action: MessageAction; icon: string; label: string; destructive?: boolean; show: boolean }[] = [
    { action: 'reply', icon: 'corner-up-left', label: 'Ответить', show: true },
    { action: 'copy', icon: 'copy', label: 'Копировать', show: true },
    { action: 'edit', icon: 'edit-2', label: 'Редактировать', show: isOwn },
    { action: 'delete', icon: 'trash-2', label: 'Удалить', destructive: true, show: isOwn },
  ];

  // Cap the preview so an overly long message never pushes the menu off-screen
  const previewMaxHeight = SCREEN_HEIGHT * 0.4;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => dismiss()} statusBarTranslucent>
      <StatusBar hidden />
      {/* Whole screen is the dismiss target */}
      <Pressable style={{ flex: 1 }} onPress={() => dismiss()}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', opacity: fade }} />

        <Animated.View
          style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: Math.max(insets.bottom, 16), opacity: fade, transform: [{ translateY: slideAnim }] }}
          pointerEvents="box-none"
        >
          {/* Highlighted message preview — capped height + scrollable if huge */}
          <View style={{ marginHorizontal: 16, marginBottom: 8, alignItems: isOwn ? 'flex-end' : 'flex-start' }} pointerEvents="box-none">
            <View style={{
              maxWidth: '85%',
              maxHeight: previewMaxHeight,
              borderRadius: bubbleRadius,
              backgroundColor: bubbleColor,
              borderBottomRightRadius: isOwn ? 4 : bubbleRadius,
              borderBottomLeftRadius: isOwn ? bubbleRadius : 4,
              overflow: 'hidden',
            }}>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10 }} bounces={false}>
                {message.replyToText ? (
                  <View style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.accent.primary, marginBottom: 6 }}>
                    <Text variant="caption" color={isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{message.replyToText}</Text>
                  </View>
                ) : null}
                <FormattedText color={bubbleTextColor} linkColor={isOwn ? '#FFFFFF' : theme.colors.accent.primary} style={{ fontSize: 15 }}>{message.text}</FormattedText>
              </ScrollView>
            </View>
          </View>

          {/* Menu */}
          <View style={{ marginHorizontal: 8, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}>
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
      </Pressable>
    </Modal>
  );
}
