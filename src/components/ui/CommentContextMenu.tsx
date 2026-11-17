/**
 * Long-press menu for a comment, in the same layout as the chat's message menu (the owner's mock):
 * the comment stays in the list, a frosted card opens under it (or above it near the bottom), with
 * the main actions as icon cells on top and Reply as a row under them.
 *
 * The card is `ActionMenu`; this file only picks the actions. It stays inside a `Modal`, as before,
 * so it covers the comments screen's own header and composer.
 *
 * The row's window rect is measured by `CommentRow` on long-press and handed over through
 * `commentMenuAnchors` (keyed by comment id), so the card can open next to the comment.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Modal } from 'react-native';
import { ModalStatusBar } from './ModalStatusBar';
import { ActionMenu, type ActionMenuAnchor, type ActionMenuHandle, type ActionMenuItem } from './ActionMenu';
import { useT } from '../../i18n/store';

export type CommentAction = 'reply' | 'copy' | 'edit' | 'delete' | 'report';

/** Window rects of recently held comments, written by the row just before it asks for the menu. */
export const commentMenuAnchors = new Map<string, ActionMenuAnchor>();

export function rememberCommentAnchor(id: string, rect: ActionMenuAnchor): void {
  commentMenuAnchors.set(id, rect);
  // Only the latest few matter.
  if (commentMenuAnchors.size > 12) {
    const first = commentMenuAnchors.keys().next().value;
    if (first !== undefined) commentMenuAnchors.delete(first);
  }
}

interface CommentContextMenuProps {
  visible: boolean;
  comment: any | null;
  isOwn: boolean;
  // Pre-parsed display body + quote, as the list shows them.
  displayBody?: string;
  replyUser?: string;
  replyText?: string;
  gifUrl?: string | null;
  onClose: () => void;
  onAction: (action: CommentAction, comment: any) => void;
}

export function CommentContextMenu({ visible, comment, isOwn, displayBody, gifUrl, onClose, onAction }: CommentContextMenuProps) {
  const t = useT();
  const menuRef = useRef<ActionMenuHandle>(null);
  const body: string = displayBody ?? comment?.content ?? '';

  const { top, items } = useMemo(() => {
    const top: ActionMenuItem<CommentAction>[] = [];
    const items: ActionMenuItem<CommentAction>[] = [];
    if (body && !gifUrl) top.push({ id: 'copy', icon: { set: 'feather', name: 'copy' }, label: t('common.copy') });
    if (isOwn && !gifUrl) top.push({ id: 'edit', icon: { set: 'feather', name: 'edit-2' }, label: t('chat.menu.edit_short') });
    if (isOwn) top.push({ id: 'delete', icon: { set: 'feather', name: 'trash-2' }, label: t('common.delete'), destructive: true });
    // Report stays one tap away on every comment that is not ours (App Review 1.2).
    else top.push({ id: 'report', icon: { set: 'feather', name: 'flag' }, label: t('chat.menu.report_short'), destructive: true });
    items.push({ id: 'reply', icon: { set: 'feather', name: 'corner-up-left' }, label: t('comments.reply') });
    return { top, items };
  }, [body, gifUrl, isOwn, t]);

  // Android back: let the card animate out instead of the Modal vanishing.
  const close = () => {
    if (menuRef.current) menuRef.current.dismiss();
    else onClose();
  };

  // The anchor belongs to this open only.
  const anchor = comment ? commentMenuAnchors.get(String(comment.id)) ?? null : null;
  useEffect(() => {
    if (!visible && comment) commentMenuAnchors.delete(String(comment.id));
  }, [visible, comment]);

  if (!visible || !comment) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <ModalStatusBar />
      <ActionMenu<CommentAction>
        ref={menuRef}
        anchor={anchor ? { ...anchor, x: anchor.x + 12, width: Math.max(0, anchor.width - 24) } : null}
        align="left"
        top={top}
        items={items}
        onSelect={(id) => onAction(id, comment)}
        onClose={onClose}
      />
    </Modal>
  );
}
