import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Modal, Animated, Dimensions, ScrollView, Easing } from 'react-native';
import { ModalStatusBar } from './ModalStatusBar';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { FormattedText } from './FormattedText';
import { LinkPreview } from './LinkPreview';
import { CachedImage } from './CachedImage';
import Skeleton from './Skeleton';
import { VerifiedBadge } from './VerifiedBadge';
import { UserBadge } from './UserBadge';
import { extractFirstUrl } from '../../services/linkPreview';
import { openUrl } from '../../utils/openUrl';
import { useT } from '../../i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PREVIEW_MAX_HEIGHT = SCREEN_HEIGHT * 0.45;
const LONG_TEXT_THRESHOLD = 220;

export type CommentAction = 'reply' | 'copy' | 'edit' | 'delete' | 'report';

interface CommentContextMenuProps {
  visible: boolean;
  comment: any | null;
  isOwn: boolean;
  // Pre-parsed display body + quote (so the preview matches the list exactly)
  displayBody?: string;
  replyUser?: string;
  replyText?: string;
  gifUrl?: string | null;
  onClose: () => void;
  onAction: (action: CommentAction, comment: any) => void;
}

// Long-press menu for comments — same smooth slide-up + fade as the chat /
// main-feed context menus. Shows a live preview of the held comment (including
// any link/video preview) above the action sheet. The preview is wide so rich
// previews (link/video cards) fit without being clipped.
export function CommentContextMenu({ visible, comment, isOwn, displayBody, replyUser, replyText, gifUrl, onClose, onAction }: CommentContextMenuProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const slideAnim = useRef(new Animated.Value(40)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const dismissing = useRef(false);
  // Reentrancy guard refs (Task 6.3 / Property 6):
  //   - isOpenRef: menu is currently open (open animation finished or in progress)
  //   - isTransitioningRef: an open or close animation is currently running
  // Together they guarantee countActiveMenuInstances() ≤ 1 even when the parent
  // debounces `visible` (true→false→true bursts from rapid long-press).
  const isOpenRef = useRef(false);
  const isTransitioningRef = useRef(false);
  // Defer the heavy preview leaves (GIF decode via CachedImage, LinkPreview
  // unfurl) by one paint after open so the open-animation frame stays cheap.
  // Same-size Skeletons hold their boxes meanwhile (no layout jump).
  const [contentReady, setContentReady] = useState(false);
  // RAF handles for the deferred reveal — cancelled on cleanup / re-close.
  const rafA = useRef<number | null>(null);
  const rafB = useRef<number | null>(null);

  useEffect(() => {
    if (visible) {
      // Already open or mid-transition (open OR close anim running) → no-op.
      // Restarting the open animation mid-flight is what stutters/freezes on
      // rapid long-press bursts.
      if (isOpenRef.current || isTransitioningRef.current) return;
      isOpenRef.current = true;
      isTransitioningRef.current = true;
      dismissing.current = false;
      slideAnim.setValue(40);
      fade.setValue(0);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start(() => { isTransitioningRef.current = false; });
      // Reveal the heavy preview leaves one paint after kicking off the open
      // animation, keeping the first (open) frame cheap.
      rafA.current = requestAnimationFrame(() => {
        rafB.current = requestAnimationFrame(() => setContentReady(true));
      });
    } else {
      // Already closed and idle → no-op (avoid re-entering on redundant flips).
      if (!isOpenRef.current && !isTransitioningRef.current) return;
      isOpenRef.current = false;
      setContentReady(false);
      // Close animation runs via internal dismiss(); when `visible` flips false
      // externally (parent cleared it) the modal simply unmounts on the next
      // render and the transition flag is cleared by either dismiss() or the
      // open-animation completion callback above.
    }
  }, [visible]);

  // Cancel any pending deferred-reveal RAFs on unmount so they don't fire
  // against an unmounted component.
  useEffect(() => () => {
    if (rafA.current != null) { cancelAnimationFrame(rafA.current); rafA.current = null; }
    if (rafB.current != null) { cancelAnimationFrame(rafB.current); rafB.current = null; }
  }, []);

  const dismiss = (cb?: () => void) => {
    if (dismissing.current) return;
    dismissing.current = true;
    isOpenRef.current = false;
    isTransitioningRef.current = true;
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 40, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: 170, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(() => {
      isTransitioningRef.current = false;
      onClose();
      cb?.();
    });
  };

  if (!visible || !comment) return null;

  const profile = comment.profiles || {};
  const body: string = displayBody ?? comment.content ?? '';
  const link = !gifUrl ? extractFirstUrl(body) : null;
  const isLong = body.length > LONG_TEXT_THRESHOLD;

  // Tapping a link from inside the modal must close THIS modal first, else
  // the modal (with `<StatusBar hidden />` and full-screen backdrop) stays
  // mounted while the in-app browser pushes on top — on return, the host
  // screen reads as "frozen" with the system status bar gone.
  const handleLinkPress = (url: string) => {
    dismiss(() => openUrl(url));
  };

  const items: { action: CommentAction; icon: string; label: string; destructive?: boolean; show: boolean }[] = [
    { action: 'reply', icon: 'corner-up-left', label: t('comments.reply'), show: true },
    { action: 'copy', icon: 'copy', label: t('common.copy'), show: !!body && !gifUrl },
    { action: 'edit', icon: 'edit-2', label: t('common.edit'), show: isOwn && !gifUrl },
    { action: 'delete', icon: 'trash-2', label: t('common.delete'), destructive: true, show: isOwn },
    { action: 'report', icon: 'flag', label: t('common.report'), destructive: true, show: !isOwn },
  ];

  const previewInner = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <Avatar emoji={profile.emoji || '😊'} size="xs" />
        <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{profile.display_name || 'User'}</Text>
        {profile.is_verified && <VerifiedBadge size={10} />}
        {profile.badge && <UserBadge badge={profile.badge} size="sm" />}
      </View>
      {/* Quoted comment this one replies to */}
      {replyUser ? (
        <View style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: theme.colors.accent.primary, marginBottom: 6 }}>
          <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} numberOfLines={1} style={{ fontSize: 11 }}>@{replyUser}</Text>
          {replyText ? <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{replyText}</Text> : null}
        </View>
      ) : null}
      {gifUrl ? (
        contentReady
          ? <CachedImage uri={gifUrl} style={{ width: 160, height: 160, borderRadius: 14, backgroundColor: theme.colors.background.secondary }} resizeMode="cover" />
          : <Skeleton width={160} height={160} radius={14} />
      ) : body ? (
        <FormattedText color={theme.colors.text.primary} linkColor={theme.colors.accent.primary} style={{ fontSize: 15 }} onLinkPress={handleLinkPress}>{body}</FormattedText>
      ) : null}
      {link ? (
        <View style={{ marginTop: 6 }}>
          {contentReady
            ? <LinkPreview url={link} static />
            : <Skeleton width={'100%'} height={64} radius={12} />}
        </View>
      ) : null}
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => dismiss()} statusBarTranslucent>
      <ModalStatusBar />
      <Pressable style={{ flex: 1 }} onPress={() => dismiss()}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', opacity: fade }} />

        <Animated.View
          style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: Math.max(insets.bottom, 16), opacity: fade, transform: [{ translateY: slideAnim }] }}
          pointerEvents="box-none"
        >
          {/* Held comment preview — wide so rich previews fit */}
          <View style={{ marginHorizontal: 12, marginBottom: 8, alignItems: 'stretch' }} pointerEvents="box-none">
            <View style={{ borderRadius: 18, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', overflow: 'hidden' }}>
              {isLong ? (
                <ScrollView style={{ maxHeight: PREVIEW_MAX_HEIGHT }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }} bounces={false}>
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
            {items.filter(i => i.show).map((item) => {
              const color = item.destructive ? '#FF3B30' : theme.colors.text.primary;
              return (
                <Pressable key={item.action} onPress={() => dismiss(() => onAction(item.action, comment))} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20 }}>
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
