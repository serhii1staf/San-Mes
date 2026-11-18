/**
 * Long-press menu for a post card on a profile, in the same layout as the chat and comment menus.
 *
 * It replaces the bare "Delete?" alert the cards had after the feed was removed, and brings back
 * what the old post menu offered, plus editing:
 *   own post:    Copy · Edit · Delete, then Share and Copy link
 *   someone's:   Copy · Share · Report, then Copy link and Block
 *
 * Report and Block must stay reachable on every post that is not ours (App Review 1.2). Report opens
 * a second card with the reasons, in the same place, rather than a new sheet.
 *
 * Inside a Modal so it covers the tab bar, like the comments menu.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Modal } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { ModalStatusBar } from '../ui/ModalStatusBar';
import { ActionMenu, type ActionMenuAnchor, type ActionMenuHandle, type ActionMenuItem } from '../ui/ActionMenu';
import { useT } from '../../i18n/store';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';
import { openPostShareSheet } from '../../store/shareSheetStore';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';
import { buildPostShareUrl } from '../../utils/appLinks';
import { stripMarkers } from '../../utils/previewText';
import { deletePost } from '../../lib/supabase';
import { submitReport } from '../../services/moderation';
import { invalidateProfilePosts, rememberPostForEdit, type ProfilePost } from '../../services/profilePosts';

type PostAction = 'copy' | 'edit' | 'share' | 'delete' | 'report' | 'link' | 'block';

const REPORT_CATS = ['spam', 'harassment', 'violence', 'misinformation', 'fraud', 'copyright', 'other'] as const;
type ReportCat = (typeof REPORT_CATS)[number];

// The share sheet is a Modal of its own; two RN Modals presented at once on iOS end with the second
// never appearing. So it opens a moment after this one has been dismissed.
const AFTER_MODAL_MS = 350;

export function ProfilePostMenu({
  post,
  anchor,
  isOwn,
  authorName,
  onClose,
}: {
  post: ProfilePost;
  anchor: ActionMenuAnchor | null;
  isOwn: boolean;
  authorName: string;
  onClose: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState<'menu' | 'report'>('menu');
  const nextStep = useRef<'report' | null>(null);
  const menuRef = useRef<ActionMenuHandle>(null);
  const text = useMemo(() => stripMarkers(post.content || '').trim(), [post.content]);

  const { top, items } = useMemo(() => {
    const top: ActionMenuItem<PostAction>[] = [];
    const items: ActionMenuItem<PostAction>[] = [];
    if (text) top.push({ id: 'copy', icon: { set: 'feather', name: 'copy' }, label: t('common.copy') });
    if (isOwn) {
      top.push({ id: 'edit', icon: { set: 'feather', name: 'edit-2' }, label: t('chat.menu.edit_short') });
      top.push({ id: 'delete', icon: { set: 'feather', name: 'trash-2' }, label: t('common.delete'), destructive: true });
      items.push({ id: 'share', icon: { set: 'feather', name: 'send' }, label: t('common.share') });
    } else {
      top.push({ id: 'share', icon: { set: 'feather', name: 'send' }, label: t('common.share') });
      top.push({ id: 'report', icon: { set: 'feather', name: 'flag' }, label: t('chat.menu.report_short'), destructive: true });
    }
    items.push({ id: 'link', icon: { set: 'feather', name: 'link' }, label: t('post_menu.copy_link') });
    if (!isOwn) items.push({ id: 'block', icon: { set: 'feather', name: 'slash' }, label: t('block.action'), destructive: true });
    return { top, items };
  }, [text, isOwn, t]);

  const reasons = useMemo<ActionMenuItem<ReportCat>[]>(
    () => REPORT_CATS.map((key) => ({ id: key, icon: { set: 'feather', name: key === 'other' ? 'more-horizontal' : 'alert-circle' }, label: t(`report.cat.${key}`) })),
    [t],
  );

  const onSelect = useCallback((id: PostAction) => {
    switch (id) {
      case 'copy':
        void Clipboard.setStringAsync(text);
        showToast(t('toast.copied'), 'check');
        break;
      case 'link':
        void Clipboard.setStringAsync(buildPostShareUrl(post.id));
        showToast(t('toast.link_copied'), 'link');
        break;
      case 'share':
        setTimeout(() => openPostShareSheet(post.id, text), AFTER_MODAL_MS);
        break;
      case 'edit':
        // The editor is the new-post screen with `editId`; it saves through PATCH /v1/posts/:id.
        rememberPostForEdit(post);
        setTimeout(() => router.push({ pathname: '/post/new', params: { editId: post.id } } as any), AFTER_MODAL_MS);
        break;
      case 'delete':
        Alert.alert(t('profile.delete_post_title'), t('profile.delete_post_msg'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: async () => {
              const { error } = await deletePost(post.id, post.author_id);
              if (error) {
                showToast(error, 'alert-circle');
                return;
              }
              invalidateProfilePosts(post.author_id);
              showToast(t('toast.post_deleted'), 'check');
            },
          },
        ]);
        break;
      case 'block':
        Alert.alert(t('block.confirm_title', undefined, { username: authorName }), t('block.confirm_msg'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('block.action'),
            style: 'destructive',
            onPress: () => {
              triggerHaptic('medium');
              useBlockedUsersStore.getState().block(post.author_id);
              showToast(t('block.toast.blocked'), 'slash');
            },
          },
        ]);
        break;
      case 'report':
        break;
    }
  }, [text, post.id, post.author_id, authorName, t]);

  // The first card has animated out by the time `onClose` runs. For Report that is the moment to
  // show the reasons card in its place; for everything else the whole menu is done.
  const onFirstClosed = useCallback(() => {
    if (nextStep.current === 'report') {
      nextStep.current = null;
      setStep('report');
      return;
    }
    onClose();
  }, [onClose]);

  // Report has to be known when the card is PRESSED, before its close animation ends and
  // `onFirstClosed` decides what comes next.
  const onWillSelect = useCallback((id: PostAction) => {
    if (id === 'report') nextStep.current = 'report';
  }, []);

  const onReason = useCallback((cat: ReportCat) => {
    triggerHaptic('medium');
    void submitReport({ targetType: 'post', targetId: post.id, category: cat });
    showToast(t('toast.report_sent'), 'flag');
  }, [post.id, t]);

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => menuRef.current?.dismiss()}>
      <ModalStatusBar />
      {step === 'menu' ? (
        <ActionMenu<PostAction>
          key="menu"
          ref={menuRef}
          anchor={anchor}
          // The held card stays lit in a cut-out of the dim (same radius as the card).
          spotlightRadius={28}
          align="left"
          top={top}
          items={items}
          onWillSelect={onWillSelect}
          onSelect={onSelect}
          onClose={onFirstClosed}
        />
      ) : (
        <ActionMenu<ReportCat>
          key="report"
          ref={menuRef}
          anchor={anchor}
          spotlightRadius={28}
          align="left"
          title={t('report.title')}
          items={reasons}
          onSelect={onReason}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
