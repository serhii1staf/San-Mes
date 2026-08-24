import React, { useEffect, useRef, useState } from 'react';
// `Easing` is gone from this import along with the cubic curves it drove — the open is now a
// spring and the close a plain timing, matching MessageContextMenu.
import { View, Pressable, Modal, Animated, Dimensions, ScrollView } from 'react-native';
import { ModalStatusBar } from './ModalStatusBar';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { FormattedText, hasCodeBlock } from './FormattedText';
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
  // ── SAME OPENING MOTION AS THE CHAT MENU ────────────────────────────────────
  //
  // Reported as: the menu in comments does not open the way the one in chat does, and it should.
  //
  // It did not, and the difference was in two places at once. This started at 40 and eased in
  // with `Easing.out(Easing.cubic)` over 240 ms — a short nudge upward. The chat menu
  // (`MessageContextMenu`) starts at SCREEN_HEIGHT and arrives on a SPRING with
  // `tension: 50, friction: 9` — a full sheet travelling in from off-screen with a little
  // settle at the end. Those read as two different interactions on the same gesture.
  //
  // Matching the chat menu means both values have to match: a spring over 40 pt is
  // imperceptible, and a 240 ms cubic over the full screen height feels mechanical. So the
  // start offset moves to SCREEN_HEIGHT and the curve to the same spring, and the backdrop to
  // the same 200 ms timing.
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
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
      slideAnim.setValue(SCREEN_HEIGHT);
      fade.setValue(0);
      // Identical to MessageContextMenu's open: spring on the sheet, 200 ms timing on the
      // backdrop. Both native-driver, so the whole thing runs off the JS thread.
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
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
    // Matches MessageContextMenu's dismiss exactly: the sheet leaves to SCREEN_HEIGHT over
    // 220 ms and the backdrop fades on the same 220 ms, so the close reads as the reverse of the
    // open rather than as a different gesture. It stays a `timing` rather than a spring on the
    // way out — the chat menu does the same, because a spring on dismissal overshoots past the
    // screen edge and wastes frames animating something already invisible.
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => {
      isTransitioningRef.current = false;
      onClose();
      cb?.();
    });
  };

  if (!visible || !comment) return null;

  const profile = comment.profiles || {};
  const body: string = displayBody ?? comment.content ?? '';
  const link = (!gifUrl && !hasCodeBlock(body)) ? extractFirstUrl(body) : null;

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
      {/* ── WHY THE BACKDROP IS A SIBLING NOW ────────────────────────────────────────────
   
          Reported: in comments the held content inside the menu cannot be scrolled, while in the
          chat it can.
   
          The preview here already had the same `ScrollView` the chat uses. What it did not have was
          a free path to the touch: the ENTIRE sheet was wrapped in `<Pressable onPress={dismiss}>`
          as a dismiss affordance. A Pressable ancestor competes for the responder on every child,
          so the ScrollView's vertical pan was being claimed before it could start — the content was
          scrollable in principle and unscrollable in practice.
   
          The chat menu never had this problem because its backdrop is an `absoluteFill` SIBLING of
          the sheet, not a parent of it (see MessageContextMenu). Same structure here now: the
          dimmed layer owns its own Pressable, the sheet sits above it, and nothing between the
          finger and the ScrollView wants the gesture.
   
          `pointerEvents="box-none"` on the wrapper keeps taps that miss the sheet falling through to
          the backdrop, so tapping outside still dismisses. */}
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', opacity: fade }}>
        <Pressable style={{ flex: 1 }} onPress={() => dismiss()} />
      </Animated.View>

      <View style={{ flex: 1 }} pointerEvents="box-none">
        <Animated.View
          style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: 16, opacity: fade, transform: [{ translateY: slideAnim }] }}
          pointerEvents="box-none"
        >
          {/* Held comment preview — wide so rich previews fit */}
          <View style={{ marginHorizontal: 12, marginBottom: 8, alignItems: 'stretch' }} pointerEvents="box-none">
            <View style={{ borderRadius: 18, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', overflow: 'hidden' }}>
              {/* ALWAYS a ScrollView, no `isLong` branch.
   
                  The branch was the second half of the "cannot scroll" bug. `isLong` is measured on
                  the comment BODY only (`body.length > 220`), but the card's height also comes from
                  the author row, the reply-quote block, a 160 pt GIF and a link-preview card. So a
                  comment with a short body and tall content rendered in the plain `View` branch and
                  had no way to scroll, no matter how far past the cap it overflowed.
   
                  A ScrollView with `maxHeight` shrink-wraps content that fits, so short comments look
                  exactly as before and the branch bought nothing. `nestedScrollEnabled` is required
                  on Android for a ScrollView inside another scrollable ancestor — neither menu set
                  it, which is a second reason Android behaved worse than iOS here. */}
              <ScrollView
                style={{ maxHeight: PREVIEW_MAX_HEIGHT }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}
                bounces={false}
                nestedScrollEnabled
              >
                {previewInner}
              </ScrollView>
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
      </View>
    </Modal>
  );
}
