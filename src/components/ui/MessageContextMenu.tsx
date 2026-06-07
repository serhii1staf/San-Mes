import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Modal, Animated, Dimensions, ScrollView, StatusBar } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { FormattedText } from './FormattedText';
import { CachedImage } from './CachedImage';
import { LinkPreview } from './LinkPreview';
import { extractFirstUrl } from '../../services/linkPreview';
import { ChatMessage } from '../../types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PREVIEW_MAX_HEIGHT = SCREEN_HEIGHT * 0.4;
const LONG_TEXT_THRESHOLD = 220;

export type MessageAction = 'reply' | 'copy' | 'edit' | 'delete';

interface MessageContextMenuProps {
  visible: boolean;
  message: ChatMessage | null;
  isOwn: boolean;
  bubbleColor: string;
  bubbleTextColor: string;
  bubbleRadius: number;
  linkEmoji?: string;
  onClose: () => void;
  onAction: (action: MessageAction, message: ChatMessage) => void;
}

// Long-press message menu. Uses the SAME proven animation structure as the feed's
// three-dots menu (PostMenuModal): spring slide-up from the bottom, a separate
// 0.4 backdrop, an `isClosing` guard, and a short delay before onClose. This
// structure is freeze-proof under rapid open/close because:
//   - the heavy preview content is only mounted once `visible` is true,
//   - a single `isClosing` ref serializes the close animation,
//   - the backdrop and the sheet are siblings (no full-screen Pressable wrapping
//     the animated sheet, which previously caused gesture/animation contention).
export function MessageContextMenu({ visible, message, isOwn, bubbleColor, bubbleTextColor, bubbleRadius, linkEmoji, onClose, onAction }: MessageContextMenuProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const isClosing = useRef(false);

  useEffect(() => {
    if (visible) {
      isClosing.current = false;
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = (cb?: () => void) => {
    if (isClosing.current) return;
    isClosing.current = true;
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(() => { onClose(); cb?.(); }, 30);
    });
  };

  if (!message) return null;

  const items: { action: MessageAction; icon: string; label: string; destructive?: boolean; show: boolean }[] = [
    { action: 'reply', icon: 'corner-up-left', label: 'Ответить', show: true },
    { action: 'copy', icon: 'copy', label: 'Копировать', show: !!message.text },
    { action: 'edit', icon: 'edit-2', label: 'Редактировать', show: isOwn && !!message.text },
    { action: 'delete', icon: 'trash-2', label: 'Удалить', destructive: true, show: isOwn },
  ];

  const hasImages = !!message.imageUrls && message.imageUrls.length > 0;
  const isLong = (message.text?.length || 0) > LONG_TEXT_THRESHOLD;
  const hasLink = !hasImages && !!extractFirstUrl(message.text);

  const previewInner = (
    <>
      {message.replyToText ? (
        <View style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.accent.primary, marginBottom: 6 }}>
          <Text variant="caption" color={isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{message.replyToText}</Text>
        </View>
      ) : null}
      {hasImages ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: message.text ? 6 : 0 }}>
          {message.imageUrls!.slice(0, 4).map((uri, idx) => (
            <CachedImage key={idx} uri={uri} style={{ width: message.imageUrls!.length === 1 ? 160 : 76, height: message.imageUrls!.length === 1 ? 160 : 76, borderRadius: 10 }} resizeMode="cover" />
          ))}
        </View>
      ) : null}
      {message.text ? (
        <FormattedText color={bubbleTextColor} linkColor={isOwn ? '#FFFFFF' : theme.colors.accent.primary} style={{ fontSize: 15 }}>{message.text}</FormattedText>
      ) : null}
      {hasLink ? (
        <View style={{ marginTop: 6, width: 280, maxWidth: '100%' }}>
          <LinkPreview url={extractFirstUrl(message.text)!} textColor={isOwn ? '#FFFFFF' : undefined} emoji={linkEmoji} />
        </View>
      ) : null}
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => dismiss()} statusBarTranslucent>
      <StatusBar hidden />
      <View style={{ flex: 1 }}>
        {/* Backdrop (separate sibling — tap to dismiss) */}
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdropAnim }}>
          <Pressable style={{ flex: 1 }} onPress={() => dismiss()} />
        </Animated.View>

        {/* Sheet */}
        <View style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: Math.max(insets.bottom, 16) }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY: slideAnim }] }} pointerEvents="box-none">
            {/* Highlighted message preview */}
            <View style={{ marginHorizontal: 12, marginBottom: 8, alignItems: isOwn ? 'flex-end' : 'flex-start' }} pointerEvents="box-none">
              <View style={{
                maxWidth: hasLink ? '94%' : '85%',
                minWidth: hasLink ? '80%' : undefined,
                borderRadius: bubbleRadius,
                backgroundColor: bubbleColor,
                borderBottomRightRadius: isOwn ? 4 : bubbleRadius,
                borderBottomLeftRadius: isOwn ? bubbleRadius : 4,
                overflow: 'hidden',
              }}>
                {isLong ? (
                  <ScrollView style={{ maxHeight: PREVIEW_MAX_HEIGHT }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10 }} bounces={false}>
                    {previewInner}
                  </ScrollView>
                ) : (
                  <View style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
                    {previewInner}
                  </View>
                )}
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
        </View>
      </View>
    </Modal>
  );
}
