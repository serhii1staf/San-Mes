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
import { useLiquidGlassActive, GlassBg } from './LiquidGlass';
import Skeleton from './Skeleton';
import { VerifiedBadge } from './VerifiedBadge';
import { UserBadge } from './UserBadge';
import { extractFirstUrl } from '../../services/linkPreview';
import { extractInAppCardUrl, isInAppCardUrl, stripInAppCardUrl } from '../../utils/appLinks';
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
  // Parity with MessageContextMenu, which this file already says it mirrors. Two things it did not
  // mirror: the held content rode the same value as the action sheet, so both arrived together from
  // off-screen (reads as  sheet appeared, not 	his comment lifted), and both surfaces were
  // opaque cards while the rest of the app's floating chrome is glass. See the notes there.
  const glassActive = useLiquidGlassActive();
  const liftAnim = useRef(new Animated.Value(0)).current;
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
  // GONE — see the note in MessageContextMenu. The open animations here are native-driver too (the
  // comment three lines down says so explicitly), so the cheap first frame this bought was protecting
  // an animation that JS cannot disturb, at the cost of a Skeleton flash exactly where the user is
  // looking.
  const contentReady = true;

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
      liftAnim.setValue(0);
      fade.setValue(0);
      // Identical to MessageContextMenu's open: spring on the sheet, 200 ms timing on the
      // backdrop. Both native-driver, so the whole thing runs off the JS thread.
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
        // Springier than the sheet so the content settles first: the eye follows what it was already
        // looking at, then the actions arrive under it.
        Animated.spring(liftAnim, { toValue: 1, useNativeDriver: true, tension: 70, friction: 10 }),
      ]).start(() => { isTransitioningRef.current = false; });
    } else {
      // Already closed and idle → no-op (avoid re-entering on redundant flips).
      if (!isOpenRef.current && !isTransitioningRef.current) return;
      isOpenRef.current = false;
      // Close animation runs via internal dismiss(); when `visible` flips false
      // externally (parent cleared it) the modal simply unmounts on the next
      // render and the transition flag is cleared by either dismiss() or the
      // open-animation completion callback above.
    }
  }, [visible]);

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
      Animated.timing(liftAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      isTransitioningRef.current = false;
      onClose();
      cb?.();
    });
  };

  if (!visible || !comment) return null;

  const profile = comment.profiles || {};
  const body: string = displayBody ?? comment.content ?? '';
  // Prefer OUR url over the positional first match, then strip it from the body, so a comment that
  // shares a post shows the card alone instead of the card plus a bare elided link above it.
  //
  // Worth stating plainly: this menu is the ONLY comments surface that renders a link card at all —
  // there is no comment row component with a `LinkPreview` — so this is not being brought in line
  // with a sibling, it is the whole of the comments behaviour.
  const link = (!gifUrl && !hasCodeBlock(body))
    ? extractInAppCardUrl(body) ?? extractFirstUrl(body)
    : null;
  const bodyText = isInAppCardUrl(link) ? stripInAppCardUrl(body, link) : body;

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
          // 220 rather than the inline 160, because a long press is meant to ENLARGE what is already
          // shown. progressive is what keeps that free: the 160 derivative is already decoded from
          // the comment row, so it paints on the first frame while the 220 one loads and replaces it.
          // Without it, asking for a different width would be a different cache key and therefore a
          // cold fetch - see the note in src/services/mediaVariants.ts.
          //
          // No ackgroundColor: it was an opaque slab behind media that may be a transparent
          // cut-out, which is the same defect that was just removed from the chat bubble.
          ? <CachedImage uri={gifUrl} style={{ width: 220, height: 220, borderRadius: 14 }} resizeMode="contain" progressive />
          : <Skeleton width={160} height={160} radius={14} />
      ) : bodyText ? (
        <FormattedText color={theme.colors.text.primary} linkColor={theme.colors.accent.primary} style={{ fontSize: 15 }} onLinkPress={handleLinkPress}>{bodyText}</FormattedText>
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
          // ── NO OPACITY HERE EITHER. SAME GLASS DEFECT AS THE CHAT MENU. ────────────
          //
          // This wrapper carried `opacity: fade` and it is a parent of BOTH `GlassBg` surfaces
          // below — the held-comment card and the action sheet. A glass surface with `opacity: 0`
          // anywhere in its parent chain loses its glass entirely (expo/expo#41024), which is the
          // rule this codebase states in PhotoPickerPanel and on the chat's day-separator chip, and
          // the reason every show/hide here is a translate rather than a fade.
          //
          // Reported as glass being present on one long-press and absent on the next: whether it
          // survived depended on where the animation stood when the native view was first
          // composited, so the same gesture gave different results run to run.
          //
          // `translateY` alone already carries the sheet on and off screen — it travels the full
          // SCREEN_HEIGHT, so the fade was never doing any work the slide was not. The backdrop
          // still fades, and it is a SIBLING (line above), so it is free to animate opacity.
          style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: 16, transform: [{ translateY: slideAnim }] }}
          pointerEvents="box-none"
        >
          {/* Held comment preview — wide so rich previews fit */}
          <Animated.View
            style={{
              marginHorizontal: 12,
              marginBottom: 8,
              alignItems: 'stretch',
              transform: [{ scale: liftAnim.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }],
            }}
            pointerEvents="box-none"
          >
            <View style={{
              borderRadius: 18,
              overflow: 'hidden',
              backgroundColor: glassActive ? 'transparent' : theme.isDark ? theme.colors.background.elevated : '#FFFFFF',
            }}>
              {glassActive ? (
                <GlassBg
                  borderRadius={18}
                  glassStyle="regular"
                  interactive={false}
                  colorScheme={theme.isDark ? 'dark' : 'light'}
                  tintColor={theme.isDark ? 'rgba(28,28,32,0.72)' : 'rgba(255,255,255,0.72)'}
                />
              ) : null}
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
          </Animated.View>

          {/* Action sheet */}
          <View style={{ marginHorizontal: 8, backgroundColor: glassActive ? 'transparent' : theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}>
            {/* Glass on iOS, the opaque elevated surface above on Android. elevation stays set
                either way - inert on iOS, and what gives the Android sheet its Material lift. */}
            {glassActive ? (
              <GlassBg
                borderRadius={28}
                glassStyle="regular"
                interactive={false}
                colorScheme={theme.isDark ? 'dark' : 'light'}
                tintColor={theme.isDark ? 'rgba(28,28,32,0.78)' : 'rgba(255,255,255,0.78)'}
              />
            ) : null}
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
                  {/* 16.5, matching the sticker menu and the chat menu. These are the only labels on
                      an otherwise empty screen and carry none of the size pressure that justifies the
                      default inside a dense list. */}
                  <Text variant="body" color={color} style={{ marginLeft: 14, fontSize: 16.5 }}>{item.label}</Text>
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
