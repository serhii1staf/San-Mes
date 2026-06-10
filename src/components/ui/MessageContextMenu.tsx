import React, { useEffect, useMemo, useRef } from 'react';
import { View, Pressable, Animated, Dimensions, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { FormattedText } from './FormattedText';
import { CachedImage } from './CachedImage';
import { LinkPreview } from './LinkPreview';
import { extractFirstUrl } from '../../services/linkPreview';
import { ChatMessage } from '../../types';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
// Same proportion as CommentContextMenu — works well in practice and keeps the
// preview from ever pushing the action sheet off-screen on tall content.
const PREVIEW_MAX_HEIGHT = SCREEN_HEIGHT * 0.45;
const LONG_TEXT_THRESHOLD = 220;

export type MessageAction = 'reply' | 'copy' | 'edit' | 'delete';

interface MessageContextMenuProps {
  visible: boolean;
  message: ChatMessage | null;
  isOwn: boolean;
  // These were used by the previous bubble-style preview; kept so the chat
  // screen can still pass them but the preview now renders as a neutral
  // Telegram-style card (matches CommentContextMenu) so rich content fits
  // without being clipped or recolored.
  bubbleColor?: string;
  bubbleTextColor?: string;
  bubbleRadius?: number;
  linkEmoji?: string;
  onClose: () => void;
  onAction: (action: MessageAction, message: ChatMessage) => void;
}

// Long-press message menu.
//
// IMPORTANT: in-screen absolute overlay (not a native Modal). The chat screen
// already hosts other native modals (GIF picker, image viewer, video player).
// On Android only one native modal can be on screen at once, so opening this
// while another is mid-transition used to deadlock the view hierarchy. As a
// JS+Animated overlay it can never collide.
//
// Layout: identical pattern to `CommentContextMenu`.
//   - Held content rendered as a neutral elevated card (NOT a colored bubble),
//     so all rich children (LinkPreview videos, image grids, formatted text)
//     fit at their natural size without being recolored or clipped.
//   - For "long" messages (text > LONG_TEXT_THRESHOLD chars) the card uses a
//     ScrollView capped at 45% of screen height. Short messages use a plain
//     View so they shrink-wrap to their content.
//   - Action sheet underneath ALWAYS stays fully on screen — that's what the
//     45% cap guarantees.
export function MessageContextMenu({ visible, message, isOwn, linkEmoji, onClose, onAction }: MessageContextMenuProps) {
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
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => {
      onClose();
      if (cb) setTimeout(cb, 20);
    });
  };

  // Build the action list and return EARLY for the no-data case BEFORE any
  // additional hooks; keeping `useMemo` after the early-return would violate
  // the rules of hooks if `visible` ever flips between renders.
  const items = useMemo(() => {
    if (!message) return [] as { action: MessageAction; icon: string; label: string; destructive?: boolean }[];
    const list: { action: MessageAction; icon: string; label: string; destructive?: boolean }[] = [
      { action: 'reply', icon: 'corner-up-left', label: 'Ответить' },
    ];
    if (message.text) list.push({ action: 'copy', icon: 'copy', label: 'Копировать' });
    if (isOwn && message.text) list.push({ action: 'edit', icon: 'edit-2', label: 'Редактировать' });
    if (isOwn) list.push({ action: 'delete', icon: 'trash-2', label: 'Удалить', destructive: true });
    return list;
  }, [message, isOwn]);

  if (!visible || !message) return null;

  const hasImages = !!message.imageUrls && message.imageUrls.length > 0;
  const imageCount = hasImages ? message.imageUrls!.length : 0;
  const link = !hasImages ? extractFirstUrl(message.text) : null;
  const isLong = (message.text?.length || 0) > LONG_TEXT_THRESHOLD;

  // Image grid sized to fit comfortably inside the preview card. We pick a
  // cell size based on photo count so all photos are visible in a clean grid.
  const renderImages = () => {
    if (!hasImages) return null;
    if (imageCount === 1) {
      return (
        <View style={{ marginBottom: message.text ? 6 : 0 }}>
          <CachedImage uri={message.imageUrls![0]} style={{ width: 220, height: 220, borderRadius: 12 }} resizeMode="cover" />
        </View>
      );
    }
    // Card inner width ≈ (screen − card horizontal margins 24 − card padding 28).
    const containerWidth = Math.min(SCREEN_WIDTH - 24 - 28, 320);
    const gap = 4;
    const cellSize =
      imageCount === 2 ? (containerWidth - gap) / 2
      : imageCount === 3 ? (containerWidth - 2 * gap) / 3
      : (containerWidth - 2 * gap) / 3; // 4–6: 3-column grid auto-wraps to 2 rows
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, marginBottom: message.text ? 6 : 0, width: containerWidth }}>
        {message.imageUrls!.map((uri, idx) => (
          <CachedImage key={idx} uri={uri} style={{ width: cellSize, height: cellSize, borderRadius: 10 }} resizeMode="cover" />
        ))}
      </View>
    );
  };

  const previewInner = (
    <>
      {message.replyToText ? (
        <View style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: theme.colors.accent.primary, marginBottom: 6 }}>
          <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{message.replyToText}</Text>
        </View>
      ) : null}
      {renderImages()}
      {message.text ? (
        <FormattedText color={theme.colors.text.primary} linkColor={theme.colors.accent.primary} style={{ fontSize: 15 }}>{message.text}</FormattedText>
      ) : null}
      {link ? (
        // No fixed height — let the link preview render at its natural size,
        // exactly like in CommentContextMenu. The ScrollView wrapper handles
        // the rare case where a tall video preview + long text exceeds the
        // 45% cap.
        <View style={{ marginTop: 6 }}>
          <LinkPreview url={link} emoji={linkEmoji} static />
        </View>
      ) : null}
    </>
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop — tap to dismiss */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdropAnim }]}>
        <Pressable style={{ flex: 1 }} onPress={() => dismiss()} />
      </Animated.View>

      {/* Sheet */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: Math.max(insets.bottom, 16) }} pointerEvents="box-none">
        <Animated.View style={{ transform: [{ translateY: slideAnim }] }} pointerEvents="box-none">
          {/* Held message preview — neutral elevated card (same pattern as
              CommentContextMenu). Wide enough to fit rich previews; scrolls
              internally only for long-text cases. */}
          <View style={{ marginHorizontal: 12, marginBottom: 8, alignItems: 'stretch' }} pointerEvents="box-none">
            <View style={{ borderRadius: 18, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', overflow: 'hidden' }}>
              {isLong ? (
                <ScrollView
                  style={{ maxHeight: PREVIEW_MAX_HEIGHT }}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}
                  bounces={false}
                >
                  {previewInner}
                </ScrollView>
              ) : (
                <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
                  {previewInner}
                </View>
              )}
            </View>
          </View>

          {/* Action sheet */}
          <View style={{ marginHorizontal: 8, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}>
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
            </View>
            {items.map((item) => {
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
  );
}
