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

// Approximate height of the menu sheet portion (handle + items + paddings).
// We use this to compute a safe preview maxHeight so the highlighted bubble
// never pushes itself off the top of the screen on very long messages.
const MENU_BASE_HEIGHT = 96; // handle (~21) + bottom (~8) + outer paddings/shadows
const MENU_ITEM_HEIGHT = 62; // padding 14*2 + icon row ~34

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

// Long-press message menu.
//
// IMPORTANT: this is an IN-SCREEN absolute overlay, NOT a native <Modal>. The chat
// screen already hosts other native modals (GIF picker, image viewer, video
// player). On Android only one native modal can be presented at a time, so rapidly
// opening this menu while another modal is mid-transition deadlocked the native
// view hierarchy and froze the whole app. Rendering as a sibling absolute layer
// inside the screen removes that contention entirely — open/close is pure JS +
// Animated and can never collide with another modal.
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
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => {
      onClose();
      if (cb) setTimeout(cb, 20);
    });
  };

  // Compute action items + the menu height up-front so we can derive a safe
  // preview maxHeight. This is the key to preventing the bubble preview from
  // overflowing the top of the screen on long/formatted messages with link
  // previews and multiple photos.
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
  const hasLink = !hasImages && !!extractFirstUrl(message.text);

  // Reserve space for: menu sheet + bottom inset + top inset + safety gap.
  const menuHeight = MENU_BASE_HEIGHT + items.length * MENU_ITEM_HEIGHT;
  const previewMaxHeight = Math.max(
    160,
    SCREEN_HEIGHT - menuHeight - insets.top - insets.bottom - 40,
  );

  // Image preview layout:
  //  - 1 photo: large square (up to 220px wide / aspect-friendly)
  //  - 2 photos: two columns of equal width
  //  - 3 photos: three columns, smaller
  //  - 4–6 photos: 3-column grid (wraps to 2 rows automatically)
  //  - 7+: same 3-column grid, but wraps to more rows; ScrollView handles overflow
  // All photos are shown — never sliced — and the surrounding ScrollView
  // makes long stacks scrollable rather than cropped.
  const renderImages = () => {
    if (!hasImages) return null;
    if (imageCount === 1) {
      return (
        <View style={{ marginBottom: message.text ? 6 : 0 }}>
          <CachedImage uri={message.imageUrls![0]} style={{ width: 220, height: 220, borderRadius: 12 }} resizeMode="cover" />
        </View>
      );
    }
    // Multi-image grid sized to the bubble's interior width (bubble maxWidth ~85% of screen, minus 28 padding).
    // Use a sensible cap so the grid never gets visually noisy.
    const containerWidth = Math.min(SCREEN_WIDTH * 0.85 - 28, 320);
    const gap = 4;
    let cols: number;
    let cellSize: number;
    if (imageCount === 2) {
      cols = 2;
      cellSize = (containerWidth - gap) / 2;
    } else if (imageCount === 3) {
      cols = 3;
      cellSize = (containerWidth - 2 * gap) / 3;
    } else {
      cols = 3;
      cellSize = (containerWidth - 2 * gap) / 3;
    }
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, marginBottom: message.text ? 6 : 0, width: containerWidth }}>
        {message.imageUrls!.map((uri, idx) => (
          <CachedImage
            key={idx}
            uri={uri}
            style={{ width: cellSize, height: cellSize, borderRadius: 10 }}
            resizeMode="cover"
          />
        ))}
      </View>
    );
  };

  const previewInner = (
    <>
      {message.replyToText ? (
        <View style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.accent.primary, marginBottom: 6 }}>
          <Text variant="caption" color={isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{message.replyToText}</Text>
        </View>
      ) : null}
      {renderImages()}
      {message.text ? (
        <FormattedText color={bubbleTextColor} linkColor={isOwn ? '#FFFFFF' : theme.colors.accent.primary} style={{ fontSize: 15 }}>{message.text}</FormattedText>
      ) : null}
      {hasLink ? (
        <View style={{ marginTop: 6, width: 280, maxWidth: '100%' }}>
          <LinkPreview url={extractFirstUrl(message.text)!} textColor={isOwn ? '#FFFFFF' : undefined} emoji={linkEmoji} static />
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
          {/* Highlighted message preview — always scrollable so long/multi-photo
              previews never push the bubble off the top of the screen. */}
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
              <ScrollView
                style={{ maxHeight: previewMaxHeight }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10 }}
                bounces={false}
              >
                {previewInner}
              </ScrollView>
            </View>
          </View>

          {/* Menu */}
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
