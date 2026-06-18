import React, { useEffect, useMemo, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { View, Pressable, Animated, Dimensions, ScrollView, StyleSheet } from 'react-native';
import Reanimated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { FormattedText } from './FormattedText';
import { CachedImage } from './CachedImage';
import { LinkPreview } from './LinkPreview';
import { extractFirstUrl } from '../../services/linkPreview';
import { openUrl } from '../../utils/openUrl';
import { ChatMessage } from '../../types';
import { useT } from '../../i18n/store';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
// Same proportion as CommentContextMenu — works well in practice and keeps the
// preview from ever pushing the action sheet off-screen on tall content.
const PREVIEW_MAX_HEIGHT = SCREEN_HEIGHT * 0.45;
const LONG_TEXT_THRESHOLD = 220;

export type MessageAction = 'reply' | 'copy' | 'edit' | 'delete' | 'translate';

// Absolute window-space hit-zone for one action row. The bubble's LongPress
// gesture (UI thread) reads this registry to decide which row the finger is
// currently over during a press-drag-release.
export type ActionZone = { id: MessageAction; top: number; bottom: number };

// Imperative handle so the chat screen can replay the existing slide-down
// dismiss animation when an action is fired by RELEASING the drag (instead of
// snapping the menu away).
export interface MessageContextMenuHandle {
  dismiss: (cb?: () => void) => void;
}

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
  // ── Press-drag-release coordination (all UI-thread) ──────────────────
  // Shared values owned by the chat screen and shared with the message
  // bubble's LongPress gesture. The menu only WRITES `actionZones` (once the
  // slide-up settles) and READS `hoveredAction` (to render the highlight).
  // `dragActive` is reset on unmount so a stale value can't linger.
  dragActive?: SharedValue<boolean>;
  hoveredAction?: SharedValue<string>;
  actionZones?: SharedValue<ActionZone[]>;
}

// One action row. Split into its own component so the highlight can be driven
// by `useAnimatedStyle` (UI thread) per-row without re-rendering the whole
// menu. The outer Reanimated.View paints the hover tint; the inner Pressable
// keeps the existing tap-to-select behaviour and is the node we measure.
function ActionRow({
  item,
  theme,
  hoveredAction,
  onPress,
  registerRef,
  index,
}: {
  item: { action: MessageAction; icon: string; label: string; destructive?: boolean };
  theme: ReturnType<typeof useTheme>;
  hoveredAction?: SharedValue<string>;
  onPress: () => void;
  registerRef: (index: number, node: any) => void;
  index: number;
}) {
  const color = item.destructive ? '#FF3B30' : theme.colors.text.primary;
  const iconBg = item.destructive ? '#FF3B3010' : (theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)');
  const hoverBg = item.destructive ? '#FF3B3022' : (theme.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)');
  // UI-thread highlight: row tints when the finger is over it during a drag.
  const rowAnimStyle = useAnimatedStyle(() => ({
    backgroundColor: hoveredAction && hoveredAction.value === item.action ? hoverBg : 'transparent',
  }));
  return (
    <Reanimated.View style={rowAnimStyle}>
      <Pressable
        ref={(node) => registerRef(index, node)}
        onPress={onPress}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20 }}
      >
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={item.icon as any} size={17} color={color} />
        </View>
        <Text variant="body" color={color} style={{ marginLeft: 14 }}>{item.label}</Text>
      </Pressable>
    </Reanimated.View>
  );
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
export const MessageContextMenu = forwardRef<MessageContextMenuHandle, MessageContextMenuProps>(function MessageContextMenu({ visible, message, isOwn, linkEmoji, onClose, onAction, dragActive, hoveredAction, actionZones }, ref) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const isClosing = useRef(false);
  // Host-view refs for each action row, keyed by index, used to measure their
  // absolute window rects once the slide-up settles.
  const rowRefs = useRef<any[]>([]);
  const registerRef = useCallback((index: number, node: any) => { rowRefs.current[index] = node; }, []);
  // Latest measure fn, read by the animation-completion callback. Kept in a ref
  // so the open effect doesn't need `items` (declared below) in its deps.
  const measureZonesRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (visible) {
      isClosing.current = false;
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start(() => {
        // Publish the action rows' absolute hit-zones for the drag gesture only
        // AFTER the slide settles — measureInWindow includes the (now-zero)
        // translateY transform, so measuring mid-animation would be wrong.
        measureZonesRef.current();
      });
    }
  }, [visible]);

  // Reset shared coordination state when the menu unmounts so a stale hover /
  // active flag / zone list can never leak into the next open.
  useEffect(() => {
    return () => {
      if (actionZones) actionZones.value = [];
      if (hoveredAction) hoveredAction.value = '';
      if (dragActive) dragActive.value = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Expose the slide-down dismiss so the chat screen can replay it when an
  // action is fired by RELEASING a drag over a row (press-drag-release path),
  // matching the tap path which already animates out before acting.
  useImperativeHandle(ref, () => ({ dismiss }), []);

  // Build the action list and return EARLY for the no-data case BEFORE any
  // additional hooks; keeping `useMemo` after the early-return would violate
  // the rules of hooks if `visible` ever flips between renders.
  const items = useMemo(() => {
    if (!message) return [] as { action: MessageAction; icon: string; label: string; destructive?: boolean }[];
    const list: { action: MessageAction; icon: string; label: string; destructive?: boolean }[] = [
      { action: 'reply', icon: 'corner-up-left', label: t('chat.menu.reply') },
    ];
    if (message.text) list.push({ action: 'copy', icon: 'copy', label: t('chat.menu.copy') });
    // Translate is available for any text message — own or foreign. Tap →
    // closes this overlay, opens the translation sheet (handled in chat).
    if (message.text && message.text.trim().length > 0) {
      list.push({ action: 'translate', icon: 'globe', label: t('chat.menu.translate') });
    }
    // Edit available for any own message — including photo-only and GIF-only
    // attachments. The chat screen's handleMenuAction seeds pendingImages
    // from the existing imageUrls so the user can remove/replace them in
    // place. Gating this on `message.text` (as it briefly was) made
    // attachment-only messages un-editable, which broke a long-standing
    // flow.
    if (isOwn) list.push({ action: 'edit', icon: 'edit-2', label: t('chat.menu.edit') });
    if (isOwn) list.push({ action: 'delete', icon: 'trash-2', label: t('chat.menu.delete'), destructive: true });
    return list;
  }, [message, isOwn, t]);

  // Measure every action row's absolute window rect and publish the hit-zones
  // for the bubble's LongPress gesture to read. Async measureInWindow callbacks
  // are collected by index and written in one shot once all have resolved.
  const measureZones = useCallback(() => {
    if (!actionZones) return;
    const count = items.length;
    if (count === 0) { actionZones.value = []; return; }
    const collected: (ActionZone | undefined)[] = new Array(count);
    let remaining = count;
    const flush = () => {
      remaining -= 1;
      if (remaining <= 0) {
        actionZones.value = collected.filter(Boolean) as ActionZone[];
      }
    };
    items.forEach((item, idx) => {
      const node = rowRefs.current[idx];
      if (!node || typeof node.measureInWindow !== 'function') { flush(); return; }
      node.measureInWindow((x: number, y: number, w: number, h: number) => {
        collected[idx] = { id: item.action, top: y, bottom: y + h };
        flush();
      });
    });
  }, [items, actionZones]);
  // Keep the completion callback pointing at the latest measure fn.
  measureZonesRef.current = measureZones;

  if (!visible || !message) return null;

  const hasImages = !!message.imageUrls && message.imageUrls.length > 0;
  const imageCount = hasImages ? message.imageUrls!.length : 0;
  const link = !hasImages ? extractFirstUrl(message.text) : null;
  const isLong = (message.text?.length || 0) > LONG_TEXT_THRESHOLD;

  // Tapping a link in the held-message preview must dismiss this overlay
  // first. Even though we render as an absolute View (not a Modal), the
  // backdrop + `pointerEvents` setup remains in the chat tree if we
  // navigate to /browser without flipping `visible` off — so on return the
  // user sees a stale 50 %-black backdrop blocking the chat.
  const handleLinkPress = (url: string) => {
    dismiss(() => openUrl(url));
  };

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
        <FormattedText color={theme.colors.text.primary} linkColor={theme.colors.accent.primary} style={{ fontSize: 15 }} onLinkPress={handleLinkPress}>{message.text}</FormattedText>
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
          <View
            style={{ marginHorizontal: 8, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}
            // Re-measure hit-zones whenever the sheet's layout changes (content
            // height differs per message). Cheap and keeps zones accurate.
            onLayout={() => { requestAnimationFrame(() => measureZonesRef.current()); }}
          >
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
            </View>
            {items.map((item, idx) => (
              <ActionRow
                key={item.action}
                item={item}
                index={idx}
                theme={theme}
                hoveredAction={hoveredAction}
                registerRef={registerRef}
                onPress={() => dismiss(() => onAction(item.action, message))}
              />
            ))}
            <View style={{ height: 8 }} />
          </View>
        </Animated.View>
      </View>
    </View>
  );
});
