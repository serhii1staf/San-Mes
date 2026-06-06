import React, { useEffect, useRef } from 'react';
import { View, Pressable, Modal, Animated, Dimensions, ScrollView, StatusBar, Easing } from 'react-native';
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
// Above this character count we wrap the preview in a scroll view; short messages render plainly.
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

export function MessageContextMenu({ visible, message, isOwn, bubbleColor, bubbleTextColor, bubbleRadius, linkEmoji, onClose, onAction }: MessageContextMenuProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(40)).current;
  const fade = useRef(new Animated.Value(0)).current;
  // Guard so rapid taps can't start overlapping dismiss animations (which froze the app)
  const dismissing = useRef(false);
  const animatingIn = useRef(false);

  useEffect(() => {
    if (visible) {
      // Ignore a re-trigger while the open animation is already running.
      if (animatingIn.current) return;
      animatingIn.current = true;
      dismissing.current = false;
      slideAnim.setValue(40);
      fade.setValue(0);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start(() => { animatingIn.current = false; });
    } else {
      animatingIn.current = false;
    }
  }, [visible]);

  const dismiss = (cb?: () => void) => {
    if (dismissing.current) return; // ignore repeated taps while closing
    dismissing.current = true;
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 40, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: 170, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(() => { onClose(); cb?.(); });
  };

  if (!visible || !message) return null;

  const items: { action: MessageAction; icon: string; label: string; destructive?: boolean; show: boolean }[] = [
    { action: 'reply', icon: 'corner-up-left', label: 'Ответить', show: true },
    { action: 'copy', icon: 'copy', label: 'Копировать', show: true },
    { action: 'edit', icon: 'edit-2', label: 'Редактировать', show: isOwn },
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
      {(() => {
        const link = (!hasImages) ? extractFirstUrl(message.text) : null;
        return link ? (
          <View style={{ marginTop: 6, width: 280, maxWidth: '100%' }}>
            <LinkPreview url={link} textColor={isOwn ? '#FFFFFF' : undefined} emoji={linkEmoji} />
          </View>
        ) : null;
      })()}
    </>
  );

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
          {/* Highlighted message preview — sizes to content; only scrolls when very long */}
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
      </Pressable>
    </Modal>
  );
}
