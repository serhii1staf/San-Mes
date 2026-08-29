import React, { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { View, Pressable, Animated, Dimensions, ScrollView, StyleSheet } from 'react-native';
import Reanimated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { FormattedText, hasCodeBlock } from './FormattedText';
import { CachedImage } from './CachedImage';
import { LinkPreview } from './LinkPreview';
import Skeleton from './Skeleton';
import { extractFirstUrl } from '../../services/linkPreview';
import { extractInAppCardUrl, isInAppCardUrl, stripInAppCardUrl } from '../../utils/appLinks';
import { openUrl } from '../../utils/openUrl';
import { ChatMessage } from '../../types';
import { useT } from '../../i18n/store';
import { isCutoutOnlyMessage } from '../../utils/mediaKind';
import { useLiquidGlassActive, GlassBg } from './LiquidGlass';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
// Same proportion as CommentContextMenu — works well in practice and keeps the
// preview from ever pushing the action sheet off-screen on tall content.
const PREVIEW_MAX_HEIGHT = SCREEN_HEIGHT * 0.45;

/**
 * Distance from the bottom of the screen to the bottom of the sheet.
 *
 * Deliberately a fixed 16 rather than the safe-area inset: this is the value the
 * feed's `PostMenuModal` uses, and both are the same long-press action sheet, so
 * they must sit at the same height. Using the inset here put this menu ~26 pt higher
 * than the post menu on devices with a home indicator.
 */
const SHEET_BOTTOM_GAP = 16;

export type MessageAction = 'reply' | 'copy' | 'copyImage' | 'edit' | 'delete' | 'translate';

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
  /**
   * Proxy width the CHAT BUBBLE already requested for this message's photos.
   *
   * Passing it makes the preview below request the byte-identical proxied URL,
   * so the image the user is holding is served straight from expo-image's memory
   * cache instead of being re-fetched and re-decoded at a menu-specific size.
   * Without it the menu asked for its own display width (220 px / grid cell),
   * which is a DIFFERENT cache key — that is why holding a photo looked like it
   * was "loading from the server again".
   */
  imageProxyWidth?: number;
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
//   - The card is ALWAYS a ScrollView capped at 45% of screen height. It used to
//     switch to a plain View for short text, gated on a character count — but the
//     card's height also comes from photos, the reply quote and a link preview, so
//     a photo-only message (no text at all) always took the non-scrolling branch
//     and could overflow the cap unreachably. A ScrollView shrink-wraps content
//     that fits, so the branch bought nothing.
//   - Action sheet underneath ALWAYS stays fully on screen — that's what the
//     45% cap guarantees.
export const MessageContextMenu = forwardRef<MessageContextMenuHandle, MessageContextMenuProps>(function MessageContextMenu({ visible, message, isOwn, linkEmoji, imageProxyWidth, onClose, onAction, dragActive, hoveredAction, actionZones }, ref) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // iOS-26 liquid glass when available and enabled; false on Android by construction, which lands every
  // surface below on its opaque elevated branch. See the note at the preview card.
  const glassActive = useLiquidGlassActive();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  // ── THE HELD CONTENT GROWS; IT DOES NOT ARRIVE ────────────────────────────
  //
  // Asked for as Telegram's behaviour: hold something and the thing you are holding gets bigger and is
  // singled out — it is not replaced by a new panel that slides in from somewhere else.
  //
  // Previously the preview travelled on `slideAnim` together with the action sheet, so both entered as
  // one object from off-screen. That reads as "a sheet appeared", not as "this message lifted". The
  // preview now has its own value and scales from 0.88 in place while the action sheet keeps sliding
  // up, which is the split Telegram uses and the reason its long-press feels attached to the content.
  //
  // Same value drives both platforms — the motion IS the shared logic. Only the SURFACE branches
  // (liquid glass on iOS, an elevated Material surface on Android), further down.
  const liftAnim = useRef(new Animated.Value(0)).current;
  const isClosing = useRef(false);
  // Host-view refs for each action row, keyed by index, used to measure their
  // absolute window rects once the slide-up settles.
  const rowRefs = useRef<any[]>([]);
  const registerRef = useCallback((index: number, node: any) => { rowRefs.current[index] = node; }, []);
  // Latest measure fn, read by the animation-completion callback. Kept in a ref
  // so the open effect doesn't need `items` (declared below) in its deps.
  const measureZonesRef = useRef<() => void>(() => {});
  // Defer the heavy preview leaves (CachedImage photos / image grid,
  // LinkPreview) by one paint after open. They mount behind same-size
  // Skeleton placeholders so the slide-up frame stays light and the
  // open animation never janks (mirrors the CommentContextMenu fix).
  // ── GONE ──────────────────────────────────────────────────────────────────
  //
  // Every animation in the open sequence below is `useNativeDriver: true`, which means it runs on the
  // UI thread and a busy JS thread cannot make it jank. The frame this gate was keeping "light" was
  // never at risk. What it did produce was visible on every long-press: the menu slides up showing
  // Skeleton rectangles where the photo and the link preview belong, then swaps them for the real
  // thing two frames later. The user is looking directly at that area — it is the thing they
  // long-pressed — so it is the most-noticed placeholder in the app.
  const contentReady = true;

  useEffect(() => {
    if (visible) {
      isClosing.current = false;
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
      liftAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        // Slightly springier than the sheet so the content settles first — the eye follows what it was
        // already looking at, then the actions arrive under it.
        Animated.spring(liftAnim, { toValue: 1, useNativeDriver: true, tension: 70, friction: 10 }),
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
      // Shrinks back into the thread rather than riding away with the sheet, mirroring the open.
      Animated.timing(liftAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
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
    // Copy image to the system clipboard so it can be pasted into any app
    // (Telegram-style). Available whenever the message carries photos.
    if (message.imageUrls && message.imageUrls.length > 0) {
      list.push({ action: 'copyImage', icon: 'image', label: t('chat.menu.copy_image') });
    }
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
  // Prefer OUR url over the positional first match, then strip it from the preview body — the same
  // rule the bubble itself uses. This menu renders a COPY of the held message, so leaving it out
  // meant holding a shared post showed the bare link that the bubble one layer below had removed.
  const link = (!hasImages && !hasCodeBlock(message.text))
    ? extractInAppCardUrl(message.text) ?? extractFirstUrl(message.text)
    : null;
  const bodyText = isInAppCardUrl(link) ? stripInAppCardUrl(message.text, link) : (message.text || '');
  // A sticker held on its own gets NO card. Same rule the bubble uses, from the same function, for the
  // same reason: this menu was painting `#FFFFFF` behind a cut-out, so holding a sticker put it on a
  // white rectangle — the exact defect that was just removed from the thread, reappearing on long-press.
  const cutoutOnly = isCutoutOnlyMessage(message);

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
      // ── ENLARGED, NOT RE-FETCHED ──────────────────────────────────────────
      //
      // `proxyWidth={imageProxyWidth}` is the load-bearing part: the chat screen passes the SAME width
      // the bubble already requested, so this resolves to a byte-identical proxied URL and comes out of
      // expo-image's memory cache. Ask for a menu-specific size and it is a different cache key, which
      // is a fresh download — that is what "long-press re-downloads the picture" was.
      //
      // A cut-out gets `contain` and no radius: `cover` CROPS to fill, so a 512-square sticker whose
      // subject stops short of the edges loses its transparent margin and has its artwork pushed to the
      // bleed. It also gets a larger box, because it has no card around it to give it presence — this is
      // the "enlarge the content you are already showing" half of the request.
      const box = cutoutOnly ? 260 : 220;
      // Spacing keys off `bodyText`, not `message.text`: a message that was nothing but our own share
      // link renders no text at all now, and the gap below the image should go with it.
      return (
        <View style={{ marginBottom: bodyText ? 6 : 0, alignItems: cutoutOnly ? 'center' : 'flex-start' }}>
          {contentReady ? (
            <CachedImage
              uri={message.imageUrls![0]}
              // Radius unconditional, for the same reason as the bubble: a cut-out has no opaque pixels
              // at its corners, so rounding costs it nothing, while squaring it off is what made media
              // read as having no container. Only the SURFACE behind it branches.
              style={{ width: box, height: box, borderRadius: 12 }}
              resizeMode={cutoutOnly ? 'contain' : 'cover'}
              proxyWidth={imageProxyWidth}
              progressive
            />
          ) : cutoutOnly ? (
            // Reserve the space with nothing in it. The shimmer is an opaque slab, so on a cut-out it
            // paints the very rectangle this branch exists to avoid, one frame before the sticker
            // arrives without one.
            <View style={{ width: box, height: box }} />
          ) : (
            <Skeleton width={box} height={box} radius={12} />
          )}
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
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, marginBottom: bodyText ? 6 : 0, width: containerWidth }}>
        {message.imageUrls!.map((uri, idx) => (
          contentReady ? (
            <CachedImage key={idx} uri={uri} style={{ width: cellSize, height: cellSize, borderRadius: 10 }} resizeMode="cover" proxyWidth={imageProxyWidth} />
          ) : (
            <Skeleton key={idx} width={cellSize} height={cellSize} radius={10} />
          )
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
      {bodyText ? (
        <FormattedText color={theme.colors.text.primary} linkColor={theme.colors.accent.primary} style={{ fontSize: 15 }} onLinkPress={handleLinkPress}>{bodyText}</FormattedText>
      ) : null}
      {link ? (
        // No fixed height — let the link preview render at its natural size,
        // exactly like in CommentContextMenu. The ScrollView wrapper handles
        // the rare case where a tall video preview + long text exceeds the
        // 45% cap.
        <View style={{ marginTop: 6 }}>
          {contentReady ? (
            <LinkPreview url={link} emoji={linkEmoji} static />
          ) : (
            <Skeleton width={'100%'} height={64} radius={12} />
          )}
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
      {/* Bottom spacing matches the feed's PostMenuModal exactly (`marginBottom: 16`,
          no safe-area padding). This menu used `Math.max(insets.bottom, 16)`, which
          on a device with a home indicator is ~34 pt — so it sat roughly 26 pt
          higher than the post menu and read as floating too far up the screen. The
          two menus are the same interaction and must land at the same height. */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: SHEET_BOTTOM_GAP }} pointerEvents="box-none">
        <Animated.View style={{ transform: [{ translateY: slideAnim }] }} pointerEvents="box-none">
          {/* Held message preview — neutral elevated card (same pattern as
              CommentContextMenu). Wide enough to fit rich previews; scrolls
              internally only for long-text cases. */}
          <Animated.View
            style={{
              marginHorizontal: 12,
              marginBottom: 8,
              alignItems: 'stretch',
              // ── NO OPACITY HERE. IT WAS KILLING THE GLASS. ──────────────────────
              //
              // Reported: with liquid glass on, holding a message shows the glass "there, gone,
              // there, gone" — inconsistent between one long-press and the next.
              //
              // This line was `opacity: liftAnim`, and it is a parent of the `GlassBg` below. The
              // rule is already written down twice in this codebase, in PhotoPickerPanel and on the
              // chat's day-separator chip: a glass surface with `opacity: 0` anywhere in its PARENT
              // chain loses its glass entirely (expo/expo#41024), which is why every show/hide in
              // this app is a translate or a size change and never a fade. This surface was the one
              // place that broke its own rule.
              //
              // It also explains the intermittency exactly. Whether the glass survived depended on
              // where the animation happened to be when the native view was first composited, so the
              // same gesture produced a different result run to run — which is what "sometimes it is
              // there" means.
              //
              // The scale alone still reads as a lift, which was the point of the animation: the
              // message grows in place rather than a panel being summoned. The backdrop fade
              // underneath supplies the sense of arrival, and it is a sibling, so it is free to
              // animate opacity.
              transform: [{ scale: liftAnim.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }],
            }}
            pointerEvents="box-none"
          >
            {/* ── THE SURFACE IS THE ONLY THING THAT BRANCHES BY PLATFORM ──────────
   
                The behaviour above — what is held, how it scales, which actions appear, how they are
                measured and dragged over — is identical on both platforms, which is what was asked for.
                What differs is the material the card is made of:
   
                  iOS   liquid glass, matching every other floating surface in the app.
                  Android  an opaque elevated surface, which is what Material specifies and what the
                           BlurView fallback already gives every other sheet here.
   
                And a cut-out gets NO surface at all on either platform. Holding a sticker used to put it
                on `#FFFFFF`; a sticker has no background in the thread and must not acquire one here. */}
            <View style={{
              borderRadius: 18,
              overflow: 'hidden',
              backgroundColor: cutoutOnly
                ? 'transparent'
                : glassActive
                  ? 'transparent'
                  : theme.isDark ? theme.colors.background.elevated : '#FFFFFF',
            }}>
              {!cutoutOnly && glassActive ? (
                <GlassBg
                  borderRadius={18}
                  glassStyle="regular"
                  interactive={false}
                  colorScheme={theme.isDark ? 'dark' : 'light'}
                  tintColor={theme.isDark ? 'rgba(28,28,32,0.72)' : 'rgba(255,255,255,0.72)'}
                />
              ) : null}
              {/* ALWAYS a ScrollView — the `isLong` branch is gone here too.
   
                  Same latent bug the comments menu had: `isLong` only measures `message.text`, but a
                  held message's card height also comes from the reply quote, an image GRID of up to
                  six 220 pt photos, and a link-preview card. A photo-only message has no text at
                  all, so it always took the non-scrolling branch and could overflow the 45 % cap
                  with no way to reach the rest.
   
                  A ScrollView with `maxHeight` shrink-wraps content that fits, so short messages are
                  unchanged. `nestedScrollEnabled` for Android, which needs it explicitly. */}
              <ScrollView
                style={{ maxHeight: PREVIEW_MAX_HEIGHT }}
                showsVerticalScrollIndicator={false}
                // No inset for a cut-out: the padding exists to keep text and quotes off the card edge,
                // and there is no card here to be off the edge of. Left in place it just shrank the
                // sticker for no reason.
                contentContainerStyle={cutoutOnly ? undefined : { paddingHorizontal: 14, paddingVertical: 12 }}
                bounces={false}
                nestedScrollEnabled
              >
                {previewInner}
              </ScrollView>
            </View>
          </Animated.View>

          {/* Action sheet */}
          <View
            style={{
              marginHorizontal: 8,
              backgroundColor: glassActive ? 'transparent' : theme.isDark ? theme.colors.background.elevated : '#FFFFFF',
              borderRadius: 28,
              overflow: 'hidden',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.12,
              shadowRadius: 16,
              elevation: 10,
            }}
            // Re-measure hit-zones whenever the sheet's layout changes (content
            // height differs per message). Cheap and keeps zones accurate.
            onLayout={() => { requestAnimationFrame(() => measureZonesRef.current()); }}
          >
            {/* Glass on iOS, the opaque elevated surface above on Android. `elevation` stays set either
                way — it is inert on iOS and is what gives the Android sheet its Material lift. */}
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
