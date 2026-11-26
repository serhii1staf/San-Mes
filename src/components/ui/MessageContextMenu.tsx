/**
 * Long-press menu for a chat message, in the layout of the mock the owner sent: the message stays
 * where it is in the thread, a frosted card opens right under it (or above it when there is no room),
 * with Copy / Edit or Translate / Delete or Report as three icon cells on top and Reply / Pin /
 * Forward as a list under them.
 *
 * The card itself is `ActionMenu`. This file only decides which actions a message gets.
 *
 * Still an in-screen overlay, not a native Modal: the chat hosts other native modals (GIF picker,
 * image viewer, video player), and on Android only one native modal can be on screen at once.
 *
 * Press-drag-release still works: the bubble's LongPress gesture (useMessageGestures) reads the
 * zones `ActionMenu` publishes and writes `hoveredAction`. The top cells sit side by side, so their
 * zones carry left/right as well as top/bottom.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { SharedValue } from 'react-native-reanimated';
import { ActionMenu, type ActionMenuAnchor, type ActionMenuHandle, type ActionMenuItem, type ActionMenuZone } from './ActionMenu';
import { CachedImage } from './CachedImage';
import { FormattedText } from './FormattedText';
import type { ChatMessage } from '../../types';
import { useT } from '../../i18n/store';
import { useTheme } from '../../theme';
import { useBrowserBandHeight } from '../../lib/browserWidget';

/** Characters of a long message the copy lays out at most: about twice a screenful. */
const COPY_MAX_CHARS = 1600;
const COPY_MAX_LINES = 48;

/**
 * The start of `text`, enough to fill the copy and no more: laying out a 20,000-character message in
 * full to show its first screenful is the cost the copy exists to avoid. Cut at a space or a line
 * break where there is one near the limit, so a word or a link is not cut in half.
 */
function copyText(text: string): string {
  let s = text;
  const lines = s.split('\n');
  if (lines.length > COPY_MAX_LINES) s = lines.slice(0, COPY_MAX_LINES).join('\n');
  if (s.length <= COPY_MAX_CHARS) return s;
  const cut = s.slice(0, COPY_MAX_CHARS);
  const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return at > COPY_MAX_CHARS * 0.8 ? cut.slice(0, at) : cut;
}

/** `color` fully transparent, for the fade at the copy's end. */
function clearOf(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return `${color}00`;
  if (/^#[0-9a-f]{8}$/i.test(color)) return `${color.slice(0, 7)}00`;
  return 'transparent';
}

/**
 * A long message as the menu shows it (see `longPreview` in ActionMenu): the bubble's colour, radius
 * and text, its first photos as thumbnails, clipped to `maxHeight` with a fade where it is cut.
 */
function LongMessageCopy({
  message, maxHeight, color, textColor, radius, fontSize, imageProxyWidth,
}: {
  message: ChatMessage;
  maxHeight: number;
  color: string;
  textColor: string;
  radius: number;
  fontSize: number;
  imageProxyWidth?: number;
}) {
  const text = message.text ? copyText(message.text) : '';
  const images = message.imageUrls || [];
  return (
    <View style={[copyStyles.bubble, { maxHeight, borderRadius: radius, backgroundColor: color }]}>
      {images.length > 0 ? (
        <View style={[copyStyles.thumbs, text ? copyStyles.thumbsAboveText : null]}>
          {images.slice(0, 3).map((u, i) => (
            // The bubble's own proxy width, so these come from the decoded-image cache the bubble
            // filled rather than being fetched again at a menu size.
            <CachedImage key={`${i}:${u}`} uri={u} style={copyStyles.thumb} resizeMode="cover" proxyWidth={imageProxyWidth} autoplay={false} />
          ))}
        </View>
      ) : null}
      {text ? (
        <FormattedText color={textColor} linkColor={textColor} style={{ fontSize }}>{text}</FormattedText>
      ) : null}
      <LinearGradient colors={[clearOf(color), color]} style={copyStyles.fade} pointerEvents="none" />
    </View>
  );
}

const copyStyles = StyleSheet.create({
  bubble: { overflow: 'hidden', paddingHorizontal: 14, paddingVertical: 10 },
  thumbs: { flexDirection: 'row', gap: 4 },
  thumbsAboveText: { marginBottom: 8 },
  thumb: { width: 72, height: 72, borderRadius: 10 },
  // Only over the bottom edge: a copy that fits shows its end as it is, under a short fade.
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 44 },
});

export type MessageAction = 'reply' | 'copy' | 'copyImage' | 'edit' | 'delete' | 'translate' | 'report' | 'pin' | 'forward';

/** Window-space hit zone of one action, read by the bubble's press-drag-release gesture. */
export type ActionZone = ActionMenuZone;

export interface MessageContextMenuHandle {
  dismiss: (cb?: () => void) => void;
}

interface MessageContextMenuProps {
  visible: boolean;
  message: ChatMessage | null;
  isOwn: boolean;
  /** Window rect of the held bubble (measured by its long-press gesture). */
  anchor?: ActionMenuAnchor | null;
  isPinned?: boolean;
  // The bubble's look, for the copy of a message too long to be shown whole (`LongMessageCopy`).
  bubbleColor?: string;
  bubbleTextColor?: string;
  bubbleRadius?: number;
  /** The chat's text size, so the copy reads like the bubble. */
  bubbleFontSize?: number;
  linkEmoji?: string;
  imageProxyWidth?: number;
  onClose: () => void;
  /** Runs when the close animation starts (the held bubble settles back while the card collapses). */
  onClosing?: () => void;
  onAction: (action: MessageAction, message: ChatMessage) => void;
  dragActive?: SharedValue<boolean>;
  hoveredAction?: SharedValue<string>;
  actionZones?: SharedValue<ActionZone[]>;
  /** Window band between the chat header and the composer; the lit cut-out is clipped to it. */
  visibleBounds?: { top: number; bottom: number };
  /** The held bubble's view, for a snapshot when it cannot be shown whole (see `ActionMenu`). */
  captureHeld?: () => unknown;
  /** The snapshot's progress, with the held message's id (see `ActionMenu.onHeldPreview`). */
  onHeldPreview?: (state: 'planned' | 'shown' | 'failed' | 'gone' | 'still', messageId: string) => void;
}

export const MessageContextMenu = forwardRef<MessageContextMenuHandle, MessageContextMenuProps>(function MessageContextMenu(
  {
    visible, message, isOwn, anchor, isPinned, bubbleRadius, onClose, onClosing, onAction, dragActive, hoveredAction,
    actionZones, visibleBounds, captureHeld, onHeldPreview, bubbleColor, bubbleTextColor, bubbleFontSize, imageProxyWidth,
  },
  ref,
) {
  const t = useT();
  const theme = useTheme();
  // The chat is drawn above the minimized-session bar when it shows; the card stays above it.
  const bandH = useBrowserBandHeight();
  // Only drawn when the menu decides the message is too long to be shown whole.
  const longPreview = useCallback(
    (maxHeight: number) =>
      message ? (
        <LongMessageCopy
          message={message}
          maxHeight={maxHeight}
          color={bubbleColor || theme.colors.background.tertiary}
          textColor={bubbleTextColor || theme.colors.text.primary}
          radius={bubbleRadius ?? 18}
          fontSize={bubbleFontSize ?? 16}
          imageProxyWidth={imageProxyWidth}
        />
      ) : null,
    [message, bubbleColor, bubbleTextColor, bubbleRadius, bubbleFontSize, imageProxyWidth, theme],
  );
  const menuRef = useRef<ActionMenuHandle>(null);
  useImperativeHandle(ref, () => ({
    dismiss: (cb?: () => void) => {
      if (menuRef.current) menuRef.current.dismiss(cb);
      else {
        onClose();
        cb?.();
      }
    },
  }), [onClose]);

  // A stale drag flag must never outlive the menu.
  useEffect(() => () => {
    if (dragActive) dragActive.value = false;
  }, [dragActive]);

  const { top, items } = useMemo(() => {
    const top: ActionMenuItem<MessageAction>[] = [];
    const items: ActionMenuItem<MessageAction>[] = [];
    if (!message) return { top, items };
    const hasText = !!message.text && message.text.trim().length > 0;
    const hasImages = !!message.imageUrls && message.imageUrls.length > 0;
    const copy: ActionMenuItem<MessageAction> | null = hasText
      ? { id: 'copy', icon: { set: 'feather', name: 'copy' }, label: t('chat.menu.copy') }
      : hasImages
        ? { id: 'copyImage', icon: { set: 'feather', name: 'image' }, label: t('chat.menu.copy') }
        : null;
    if (copy) top.push(copy);
    // Edit is offered for every own message, attachment-only ones included: the chat seeds the
    // composer with the existing photos so they can be replaced in place.
    // Short labels in the top cells: three of them share the card's width.
    if (isOwn) top.push({ id: 'edit', icon: { set: 'feather', name: 'edit-2' }, label: t('chat.menu.edit_short') });
    else if (hasText) top.push({ id: 'translate', icon: { set: 'feather', name: 'globe' }, label: t('chat.menu.translate') });
    if (isOwn) top.push({ id: 'delete', icon: { set: 'feather', name: 'trash-2' }, label: t('chat.menu.delete'), destructive: true });
    // Someone else's message can always be reported (App Review 1.2: chat is the app's UGC).
    else top.push({ id: 'report', icon: { set: 'feather', name: 'flag' }, label: t('chat.menu.report_short'), destructive: true });

    items.push({ id: 'reply', icon: { set: 'feather', name: 'corner-up-left' }, label: t('chat.menu.reply') });
    items.push({
      id: 'pin',
      icon: { set: 'mci', name: isPinned ? 'pin-off-outline' : 'pin-outline' },
      label: isPinned ? t('chat.menu.unpin') : t('chat.menu.pin'),
    });
    if (hasText) items.push({ id: 'forward', icon: { set: 'feather', name: 'corner-up-right' }, label: t('chat.menu.forward') });
    if (isOwn && hasText) items.push({ id: 'translate', icon: { set: 'feather', name: 'globe' }, label: t('chat.menu.translate') });
    if (hasText && hasImages) items.push({ id: 'copyImage', icon: { set: 'feather', name: 'image' }, label: t('chat.menu.copy_image') });
    return { top, items };
  }, [message, isOwn, isPinned, t]);

  if (!visible || !message) return null;
  return (
    <ActionMenu<MessageAction>
      ref={menuRef}
      anchor={anchor ?? null}
      // The bubble stays lit in a cut-out of the dim (and lifts a little, see useMessageGestures),
      // or, when it cannot be seen whole where it is, is shown as a snapshot.
      spotlightRadius={bubbleRadius ?? 18}
      spotlightBounds={visibleBounds}
      spotlightLift={1.04}
      captureHeld={captureHeld}
      onHeldPreview={onHeldPreview ? (state) => onHeldPreview(state, message.id) : undefined}
      longPreview={longPreview}
      bottomReserve={bandH}
      align={isOwn ? 'right' : 'left'}
      top={top}
      items={items}
      onSelect={(id) => onAction(id, message)}
      onClosing={onClosing}
      onClose={onClose}
      zones={actionZones}
      hovered={hoveredAction}
    />
  );
});
