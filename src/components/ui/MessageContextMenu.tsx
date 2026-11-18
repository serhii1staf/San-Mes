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
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import { ActionMenu, type ActionMenuAnchor, type ActionMenuHandle, type ActionMenuItem, type ActionMenuZone } from './ActionMenu';
import type { ChatMessage } from '../../types';
import { useT } from '../../i18n/store';

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
  // Kept for the call site; the menu no longer draws a copy of the bubble.
  bubbleColor?: string;
  bubbleTextColor?: string;
  bubbleRadius?: number;
  linkEmoji?: string;
  imageProxyWidth?: number;
  onClose: () => void;
  /** Runs when the close animation starts (the held bubble settles back while the card collapses). */
  onClosing?: () => void;
  onAction: (action: MessageAction, message: ChatMessage) => void;
  dragActive?: SharedValue<boolean>;
  hoveredAction?: SharedValue<string>;
  actionZones?: SharedValue<ActionZone[]>;
}

export const MessageContextMenu = forwardRef<MessageContextMenuHandle, MessageContextMenuProps>(function MessageContextMenu(
  { visible, message, isOwn, anchor, isPinned, bubbleRadius, onClose, onClosing, onAction, dragActive, hoveredAction, actionZones },
  ref,
) {
  const t = useT();
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
      // The bubble stays lit in a cut-out of the dim (and lifts a little, see useMessageGestures).
      spotlightRadius={bubbleRadius ?? 18}
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
