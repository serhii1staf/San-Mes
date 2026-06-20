import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, FlatList, TextInput, Pressable, Platform, StyleSheet, Alert, Animated, Modal, Dimensions, Keyboard, InteractionManager, type ViewToken } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation, useKeyboardHandler } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle, interpolate, Extrapolation, useSharedValue, withSpring, runOnJS, useAnimatedRef, measure, type SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { proxiedImageUrl } from '../../src/components/ui/CachedImage';
import { ModalStatusBar } from '../../src/components/ui/ModalStatusBar';
import { FormattedText } from '../../src/components/ui/FormattedText';
import { LinkPreview } from '../../src/components/ui/LinkPreview';
import { extractFirstUrl } from '../../src/services/linkPreview';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { MessageContextMenu, MessageAction, type ActionZone, type MessageContextMenuHandle } from '../../src/components/ui/MessageContextMenu';
import { TranslationSheet } from '../../src/components/ui/TranslationSheet';
import { ChatInputBar, ChatInputBarHandle } from '../../src/components/chat/ChatInputBar';
import { EmojiDeleteBurst, EmojiBurstHandle } from '../../src/components/chat/EmojiDeleteBurst';
import { GiphyPicker } from '../../src/components/ui/GiphyPicker';
import { getRealtime, chatChannelName } from '../../src/services/realtime/ably';
import { useContextMenuGuard } from '../../src/hooks/useContextMenuGuard';
import { useChatStore, useEntityStore, useConnectivityStore, useAuthStore } from '../../src/store';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY, DEFAULT_CHAT_SETTINGS } from '../../src/store/chatSettingsStore';
import { useBrowserStore } from '../../src/store/browserStore';
import { ChatBackgroundLayer } from '../../src/components/ui/ChatBackgroundLayer';
import { PixelIcon } from '../../src/components/pixel-icons/PixelIcon';
import { uploadChatImage } from '../../src/lib/supabase';
import { kvGetJSONSync, kvSetJSON, kvWarm } from '../../src/services/kvStore';
import { mockMessages, mockConversations, formatMessageTime } from '../../src/utils/mockData';
import { showToast } from '../../src/store/toastStore';
import { ChatMessage } from '../../src/types';
import { triggerHaptic } from '../../src/utils/haptics';
import { sanitizeUserText } from '../../src/utils/sanitizeText';
import { useT } from '../../src/i18n/store';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useLiquidGlassActive, NativeGlassView, GlassBg } from '../../src/components/ui/LiquidGlass';
import { useScreenCaptureGuard } from '../../src/hooks/useScreenCaptureGuard';
import { ScreenshotShield } from '../../src/components/ui/ScreenshotShield';

const REPLY_THRESHOLD = 60;
const SCREEN_WIDTH = Dimensions.get('window').width;

// ── Legacy relative-sender healing ────────────────────────────────────────
// Older builds stored chat messages with a RELATIVE sentinel senderId:
// 'current' (whoever was logged in when the message was cached) or 'peer'
// (the other side). That made ownership ambiguous the moment the user
// switched accounts on the same device — a message authored by account A
// could render on account B's "own" side. We now persist the REAL author
// uuid on every message and compute ownership at render time.
//
// This heals any legacy-tagged message read from cache. It is reliable
// because the chat-message cache is ACCOUNT-SCOPED (keyed via accountKey):
// within the active account's namespace, 'current' is unambiguously the
// current user and 'peer' is the conversation's other participant. A message
// whose senderId is already a real uuid is returned untouched.
function healLegacySender(
  m: ChatMessage,
  currentUserId?: string,
  participantId?: string,
): ChatMessage {
  if (m.senderId === 'current') {
    return currentUserId ? { ...m, senderId: currentUserId } : m;
  }
  if (m.senderId === 'peer') {
    return participantId ? { ...m, senderId: participantId } : m;
  }
  return m;
}

// Hoisted static atoms for the message bubble. Each visible bubble was
// previously allocating ~10 fresh inline objects per render — for the
// `initialNumToRender: 8` first batch that's ~80 throwaway objects on the
// open-the-chat frame. The remaining truly-dynamic bits (theme colors,
// alignSelf, margins) are still applied as small override objects, which
// React happily diffs without re-walking the whole tree.
const bubbleStyles = StyleSheet.create({
  row: { justifyContent: 'center' },
  swipeIcon: { position: 'absolute', right: 16 },
  swipeIconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bubbleBase: { paddingHorizontal: 14, paddingVertical: 10 },
  replyBlock: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, borderLeftWidth: 2, marginBottom: 6 },
  replyTextWrap: { flex: 1 },
  replyAvatar: { width: 30, height: 30, borderRadius: 6 },
  replyPixel: { borderRadius: 6 },
  replyHeading: { fontSize: 11 },
  replyBody: { fontSize: 11 },
  imagesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  imageSingle: { width: 200, height: 200, borderRadius: 12 },
  imageMulti: { width: 120, height: 120, borderRadius: 12 },
  linkPreviewWrap: { marginTop: 6, width: 280, maxWidth: '100%' },
  timestamp: { marginTop: 3, alignSelf: 'flex-end', fontSize: 10 },
});

// Max bounds for a single sent photo. The container is sized to the image's
// natural aspect ratio (capped to these bounds) so the WHOLE image is visible
// in the bubble — no crop — instead of being squeezed into a fixed square.
const CHAT_IMG_MAX_W = Math.min(Math.round(SCREEN_WIDTH * 0.66), 270);
const CHAT_IMG_MAX_H = 340;

// Single-image bubble that fits its container to the photo's aspect ratio.
// Starts at a neutral square placeholder, then snaps to the real dimensions
// once expo-image reports the decoded source size (onLoad). Own tiny state →
// the memoized MessageBubble around it is untouched.
function SingleChatImage({ uri, isVisible, onPress }: { uri: string; isVisible?: boolean; onPress: () => void }) {
  const theme = useTheme();
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 220, h: 220 });
  const handleLoad = useCallback((e: any) => {
    const s = e?.source;
    if (!s?.width || !s?.height) return;
    const ar = s.width / s.height;
    let w = CHAT_IMG_MAX_W;
    let h = Math.round(w / ar);
    if (h > CHAT_IMG_MAX_H) { h = CHAT_IMG_MAX_H; w = Math.round(h * ar); }
    setSize({ w, h });
  }, []);
  return (
    <Pressable onPress={onPress}>
      <CachedImage
        uri={uri}
        style={{ width: size.w, height: size.h, borderRadius: 12, backgroundColor: theme.colors.background.tertiary }}
        // Container now matches the image aspect ratio, so "cover" shows the
        // full image with no cropping and no letterboxing.
        resizeMode="cover"
        // Pin the proxy width to the bubble's MAX display width instead of
        // letting it track `size.w`. The container animates from the initial
        // 220 px square to the photo's real width (≤ CHAT_IMG_MAX_W) once
        // onLoad reports the source dimensions — if the proxy width tracked
        // that, expo-image would fetch+decode TWICE (once at w≈440 for the
        // 220 px placeholder, again at w≈540 for the final size). Pinning to
        // CHAT_IMG_MAX_W yields ONE stable proxy URL for the whole lifecycle,
        // which also matches the width `messagesPrefetch` warms, so the disk
        // cache actually hits on open. Visual is identical (cover at the same
        // final size, equal-or-sharper bytes).
        proxyWidth={CHAT_IMG_MAX_W}
        priority="low"
        autoplay={isVisible}
        onLoad={handleLoad}
      />
    </Pressable>
  );
}

function MessageBubble({ message, isOwn, fontSize, bubbleRadius, fontFamily, linkEmoji, highlighted, isVisible, onReply, onReplyJump, onLongPress, onMeasured, onSwipeActive, onImagePress, dragActive, dragFingerY, hoveredAction, actionZones, onFireDragAction }: { message: ChatMessage; isOwn: boolean; fontSize: number; bubbleRadius: number; fontFamily: string; linkEmoji?: string; highlighted?: boolean; isVisible?: boolean; onReply: (m: ChatMessage) => void; onReplyJump?: (messageId?: string) => void; onLongPress: (m: ChatMessage) => void; onMeasured?: (id: string, x: number, y: number, w: number, h: number) => void; onSwipeActive: (active: boolean) => void; onImagePress: (images: string[], index: number) => void; dragActive: SharedValue<boolean>; dragFingerY: SharedValue<number>; hoveredAction: SharedValue<string>; actionZones: SharedValue<ActionZone[]>; onFireDragAction: (m: ChatMessage, action: string) => void }) {
  const theme = useTheme();
  const t = useT();
  // Animated ref so the LongPress gesture can measure this bubble's window rect
  // on the UI thread — used to spawn the emoji "dissolve" burst at the right
  // spot when the message is deleted.
  const bubbleRef = useAnimatedRef<Reanimated.View>();
  // Native iOS-26 liquid glass for the swipe-to-reply pill. iOS-only + opt-in.
  const glassActive = useLiquidGlassActive();
  const fontFamilyStyle = fontFamily === 'mono' ? 'monospace' : fontFamily === 'serif' ? 'serif' : undefined;

  // ── Swipe-to-reply: UI-thread gesture (RNGH + Reanimated) ──────────────
  // Previous implementation was a JS-thread `PanResponder` writing into an RN
  // `Animated.Value` (non-native-driver — gesture writes have to bridge per
  // frame). On weak Android 10 the JS thread regularly missed frames during
  // a swipe (FlatList scroll responder + image decode + selectors), and the
  // bridged writes blended with the spring-back animation, producing the
  // "snap back-and-forth" twitch the user reported.
  //
  // The new implementation runs ENTIRELY on the UI thread:
  //   • `Gesture.Pan()` from RNGH dispatches gesture events on the UI thread.
  //   • `useSharedValue` + `useAnimatedStyle` apply the transform without
  //     ever crossing the bridge.
  //   • `withSpring` on release is also UI-thread native.
  //   • `runOnJS` is used ONCE per phase (start/end) to flip the parent's
  //     scroll lock and to fire the haptic — never per frame.
  // JS frame drops can no longer affect the swipe.
  const translateXSV = useSharedValue(0);
  // One-shot guard so the haptic fires the moment we cross REPLY_THRESHOLD,
  // and exactly once per gesture. Reset back to false on release/cancel.
  const gateFiredHapticSV = useSharedValue(false);
  // Mirror of "is this gesture currently active?" — used by `onFinalize`
  // to know whether to clean up state (it fires on EVERY pan termination,
  // including ones where activation criteria were never met).
  const swipeActiveSV = useSharedValue(false);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Activation gate: only horizontal LEFT motion. `activeOffsetX`
        // requires the finger to move ≥12 px LEFT before the pan
        // activates; the +9999 cap means right-direction motion never
        // activates this. `failOffsetY` makes any vertical motion ≥10 px
        // (in either direction) FAIL the pan, handing the gesture back
        // to the FlatList scroll responder. So vertical scrolls always
        // win and horizontal swipes never fight them.
        .activeOffsetX([-12, 9999])
        .failOffsetY([-10, 10])
        .onStart(() => {
          'worklet';
          swipeActiveSV.value = true;
          // Notify parent ONCE on activate so it can disable FlatList
          // scrolling while the swipe is in flight. Not per-frame.
          runOnJS(onSwipeActive)(true);
        })
        .onUpdate((e) => {
          'worklet';
          // Clamp translateX to [-80, 0] — only swipe LEFT, capped at 80 px.
          // Whole pixel for predictable rendering on Android.
          const dx = Math.max(Math.min(Math.round(e.translationX), 0), -80);
          translateXSV.value = dx;
          // One-shot threshold haptic. Fired from the worklet via runOnJS
          // exactly once per gesture; the gate flag prevents storms when
          // the finger lingers near the threshold.
          if (!gateFiredHapticSV.value && dx <= -REPLY_THRESHOLD) {
            gateFiredHapticSV.value = true;
            runOnJS(triggerHaptic)('light');
          }
        })
        .onEnd((e) => {
          'worklet';
          // Trigger reply when the user RELEASED past the threshold —
          // matches the pre-existing behaviour exactly.
          if (e.translationX <= -REPLY_THRESHOLD) {
            runOnJS(onReply)(message);
          }
        })
        .onFinalize(() => {
          'worklet';
          // Always run on EVERY pan termination (success or failure). Spring
          // back to 0 with a UI-thread native spring; reset the haptic gate
          // and the active flag; notify parent ONCE on end.
          translateXSV.value = withSpring(0, {
            damping: 20,
            stiffness: 220,
            mass: 0.8,
          });
          gateFiredHapticSV.value = false;
          if (swipeActiveSV.value) {
            swipeActiveSV.value = false;
            runOnJS(onSwipeActive)(false);
          }
        }),
    // Stable across renders — message id doesn't change for a given bubble,
    // and the callbacks are stabilised at the screen level via useCallback.
    [message, onReply, onSwipeActive, translateXSV, gateFiredHapticSV, swipeActiveSV],
  );

  // ── Press-drag-release: UI-thread LongPress + drag-to-select ───────────
  // Replaces the old JS-thread `Pressable onLongPress`. Holding the bubble for
  // 300 ms opens the context menu (same as before). The LARGE maxDistance means
  // dragging the still-held finger DOWN onto the action rows never cancels the
  // long press — instead `onTouchesMove` tracks the finger's absolute Y on the
  // UI thread and writes which registered row it's over into `hoveredAction`
  // (the menu reads that shared value to paint the highlight). Releasing over a
  // row fires that action; releasing over nothing leaves the menu open so the
  // existing tap-to-select still works. `runOnJS` is used at most once per
  // phase (open on start, optional gated haptic on hover-change, fire on end).
  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(300)
        // `maxDistance` only gates ACTIVATION (RNGH cancels the long press only
        // if the finger travels past this BEFORE the 300 ms fires). Once
        // activated, the finger may drag freely down onto the action rows — that
        // post-activation travel is never restricted. So we keep a SMALL value:
        // a real vertical scroll (which moves far inside 300 ms) cancels the
        // long press and stays a scroll, while a still-hold with minor finger
        // jitter still opens the menu. A huge value here would let a slow
        // scroll-and-hold accidentally pop the menu.
        .maxDistance(20)
        .onStart(() => {
          'worklet';
          dragActive.value = true;
          dragFingerY.value = -1;
          hoveredAction.value = '';
          // Measure this bubble's window rect on the UI thread so a later
          // delete can spawn the emoji burst exactly here. Cheap, fires once.
          if (onMeasured) {
            const m = measure(bubbleRef);
            if (m) runOnJS(onMeasured)(message.id, m.pageX, m.pageY, m.width, m.height);
          }
          // Open the menu + medium haptic — exactly once, on activation.
          runOnJS(triggerHaptic)('medium');
          runOnJS(onLongPress)(message);
        })
        .onTouchesMove((e) => {
          'worklet';
          if (!dragActive.value) return;
          const touch = e.allTouches[0];
          if (!touch) return;
          const y = touch.absoluteY;
          dragFingerY.value = y;
          // Resolve which registered action row the finger is currently over.
          const zones = actionZones.value;
          let found = '';
          for (let i = 0; i < zones.length; i++) {
            if (y >= zones[i].top && y <= zones[i].bottom) { found = zones[i].id; break; }
          }
          // Fire a light haptic only when the hovered row CHANGES — gated by the
          // equality check so it can never storm while the finger lingers.
          if (found !== hoveredAction.value) {
            hoveredAction.value = found;
            if (found !== '') runOnJS(triggerHaptic)('light');
          }
        })
        .onEnd(() => {
          'worklet';
          // Release over a highlighted row → fire its action (once).
          const action = hoveredAction.value;
          if (action !== '') runOnJS(onFireDragAction)(message, action);
        })
        .onFinalize(() => {
          'worklet';
          // Always clean up, on success OR cancel.
          dragActive.value = false;
          dragFingerY.value = -1;
          hoveredAction.value = '';
        }),
    [message, onLongPress, onMeasured, bubbleRef, onFireDragAction, dragActive, dragFingerY, hoveredAction, actionZones],
  );

  // Compose with the swipe pan via Race: whichever activates FIRST wins and
  // cancels the other. A clear horizontal swipe (≥12 px left) activates the pan
  // → reply, unchanged. A still-hold (300 ms) activates the long press → menu.
  // They can never both be active, so the drag-select can't fight the swipe.
  const composedGesture = useMemo(() => Gesture.Race(pan, longPress), [pan, longPress]);

  // UI-thread style for the bubble's translateX.
  const bubbleAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateXSV.value }],
  }));
  // Reply-icon opacity ramp from -24 → -REPLY_THRESHOLD (matches the legacy
  // implementation's interpolation), evaluated entirely on the UI thread.
  const replyIconAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateXSV.value,
      [-REPLY_THRESHOLD, -24, 0],
      [1, 0, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <View style={bubbleStyles.row}>
      <Reanimated.View style={[bubbleStyles.swipeIcon, replyIconAnimStyle]}>
        {glassActive ? (
          <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} tintColor={theme.colors.accent.primary + '40'} style={bubbleStyles.swipeIconCircle}>
            <Feather name="corner-up-left" size={16} color={theme.colors.accent.primary} />
          </NativeGlassView>
        ) : (
          <View style={[bubbleStyles.swipeIconCircle, { backgroundColor: theme.colors.accent.primary + '20' }]}>
            <Feather name="corner-up-left" size={16} color={theme.colors.accent.primary} />
          </View>
        )}
      </Reanimated.View>

      <GestureDetector gesture={composedGesture}>
        <Reanimated.View ref={bubbleRef} style={[bubbleAnimStyle, { alignSelf: isOwn ? 'flex-end' : 'flex-start', maxWidth: '78%', marginLeft: isOwn ? 0 : 16, marginRight: isOwn ? 16 : 0, marginBottom: 4 }]}>
        {/* Long-press + drag-select is handled by `composedGesture` on the
            GestureDetector above (UI thread). This wrapper used to be a
            `Pressable onLongPress`; it's now a plain View so the gesture owns
            the hold. A quick tap still falls through to inner Pressables
            (image → viewer), and the menu's own buttons keep tap-to-select. */}
        <View>
          <View style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: bubbleRadius,
            backgroundColor: isOwn ? theme.colors.accent.primary : theme.colors.background.tertiary,
            borderBottomRightRadius: isOwn ? 4 : bubbleRadius,
            borderBottomLeftRadius: isOwn ? bubbleRadius : 4,
            borderWidth: highlighted ? 2 : 0,
            borderColor: highlighted ? theme.colors.accent.primary : 'transparent',
          }}>
            {message.replyToText || message.replyToImage || message.replyPixelIconId ? (
              <Pressable
                onPress={() => onReplyJump?.(message.replyToId)}
                style={[bubbleStyles.replyBlock, { borderLeftColor: isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.accent.primary }]}
              >
                {message.replyToImage ? (
                  <CachedImage uri={message.replyToImage} style={bubbleStyles.replyAvatar} resizeMode="cover" />
                ) : null}
                {/* Pixel icon attached to the reply via the chat-level
                    setting. Renders alongside the text/image preview —
                    additive, never replaces the existing avatar. Small
                    so it reads as a decoration rather than the primary
                    affordance. */}
                {message.replyPixelIconId ? (
                  <PixelIcon id={message.replyPixelIconId} size={22} style={bubbleStyles.replyPixel} />
                ) : null}
                <View style={bubbleStyles.replyTextWrap}>
                  <Text variant="caption" weight="semibold" color={isOwn ? 'rgba(255,255,255,0.9)' : theme.colors.accent.primary} numberOfLines={1} style={bubbleStyles.replyHeading}>
                    {message.replyToIsOwn ? t('chat.you') : t('chat.peer')}
                  </Text>
                  <Text variant="caption" color={isOwn ? 'rgba(255,255,255,0.7)' : theme.colors.text.tertiary} numberOfLines={1} style={bubbleStyles.replyBody}>
                    {message.replyToText || (message.replyToImage ? t('chat.photo') : '')}
                  </Text>
                </View>
              </Pressable>
            ) : null}
            {message.imageUrls && message.imageUrls.length > 0 ? (
              <View style={[bubbleStyles.imagesRow, { marginBottom: message.text ? 6 : 0 }]}>
                {message.imageUrls.length === 1 ? (
                  <SingleChatImage
                    uri={message.imageUrls[0]}
                    isVisible={isVisible}
                    onPress={() => onImagePress(message.imageUrls!, 0)}
                  />
                ) : (
                  message.imageUrls.map((uri, idx) => (
                    <Pressable key={idx} onPress={() => onImagePress(message.imageUrls!, idx)}>
                      <CachedImage
                        uri={uri}
                        style={bubbleStyles.imageMulti}
                        resizeMode="cover"
                        // Decode at low priority so a heavy GIF/photo never
                        // competes with the chat-open transition or scroll
                        // frames on weak devices.
                        priority="low"
                        // Pause GIF animation while this bubble is scrolled
                        // off-screen — no UI-thread frame decoding for content
                        // the user can't see.
                        autoplay={isVisible}
                      />
                    </Pressable>
                  ))
                )}
              </View>
            ) : null}
            {message.text ? (
              <FormattedText color={isOwn ? '#FFFFFF' : theme.colors.text.primary} linkColor={isOwn ? '#FFFFFF' : theme.colors.accent.primary} style={{ fontSize, fontFamily: fontFamilyStyle }}>{message.text}</FormattedText>
            ) : null}
            {(() => {
              const link = (!message.imageUrls || message.imageUrls.length === 0) ? extractFirstUrl(message.text) : null;
              return link ? (
                <View style={bubbleStyles.linkPreviewWrap}>
                  <LinkPreview
                    url={link}
                    textColor={isOwn ? '#FFFFFF' : undefined}
                    emoji={linkEmoji}
                  />
                </View>
              ) : null;
            })()}
            <Text variant="caption" color={isOwn ? 'rgba(255,255,255,0.6)' : theme.colors.text.tertiary} style={bubbleStyles.timestamp}>
              {formatMessageTime(message.createdAt)}
            </Text>
          </View>
        </View>
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

const MemoMessageBubble = React.memo(MessageBubble, (prev, next) => {
  // Callbacks are stabilized with useCallback in the screen, so we compare only
  // the data that actually affects this bubble's output. This stops the whole
  // list from re-rendering when unrelated state (typing, scroll, search) changes.
  const pm = prev.message;
  const nm = next.message;
  return (
    pm.id === nm.id &&
    pm.text === nm.text &&
    pm.createdAt === nm.createdAt &&
    pm.replyToText === nm.replyToText &&
    pm.replyToImage === nm.replyToImage &&
    pm.replyToIsOwn === nm.replyToIsOwn &&
    pm.replyPixelIconId === nm.replyPixelIconId &&
    (pm.imageUrls === nm.imageUrls ||
      (pm.imageUrls?.length === nm.imageUrls?.length &&
        (pm.imageUrls || []).every((u, i) => u === nm.imageUrls?.[i]))) &&
    prev.isOwn === next.isOwn &&
    prev.fontSize === next.fontSize &&
    prev.bubbleRadius === next.bubbleRadius &&
    prev.fontFamily === next.fontFamily &&
    prev.linkEmoji === next.linkEmoji &&
    prev.highlighted === next.highlighted &&
    prev.isVisible === next.isVisible
  );
});

export default function ChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Native iOS-26 liquid glass for the chat chrome (header / search / scroll
  // button). iOS-only and gated on the user toggle; false everywhere else, so
  // all the fallback paths below render exactly as before. Read once, reused.
  const glassActive = useLiquidGlassActive();
  const { id, participantId: paramParticipantId } = useLocalSearchParams<{ id: string; participantId?: string }>();
  // ── Canonical conversation id (peers-on-different-channels fix) ────────
  // The route `id` is EITHER a real conversation id (messages-list
  // navigation, which also passes `participantId`) OR a peer USER id
  // (profile navigation, which passes only `id`). We must resolve it to the
  // canonical conversation id BEFORE subscribing to Ably so both peers
  // converge on `chat:<convId>` from the first frame — otherwise A (who
  // opened the chat from B's profile) subscribes to `chat:<B-userId>` while
  // B (who opened from their messages list) subscribes to `chat:<convId>`,
  // and live messages exchanged between two open screens never meet.
  //
  // `conversationId` defaults to the route id and updates once the
  // idempotent create-or-get (`POST /v1/conversations`) returns. The whole
  // message-data pipeline keys off it (selector, optimistic sends,
  // persistence, realtime channel + publishes), while `participantId` (the
  // OTHER user's id) stays separate for display + notification routing.
  const [conversationId, setConversationId] = useState<string>(() => id || '');
  // Mount-time marker — captures how long the chat screen took to commit
  // its first render so the perf-monitor panel can attribute open-the-chat
  // freezes. Reads `Date.now()` once at first render via useRef so the
  // measurement starts at the start of the render, not at commit time.
  // Skipped at the call site when the monitor is off.
  const mountStart = useRef(Date.now()).current;
  const perfEnabled = useSettingsStore((s) => s.perfMonitorEnabled);
  useEffect(() => {
    if (!perfEnabled) return;
    perfMonitor.markScreenMount('chat/[id]', Date.now() - mountStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfEnabled]);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  // Long-press menu opener — see useContextMenuGuard for the rate-limit/raf
  // semantics that prevent rapid long-press storms from freezing the JS thread.
  const { target: actionMessage, open: openMenu, close: closeMenu } = useContextMenuGuard<ChatMessage>({ lockMs: 500, closeLockMs: 350 });

  // Long-pressing a message should dismiss the keyboard so the slide-up
  // action menu doesn't end up half-covered by it. iOS's
  // `keyboardDismissMode="interactive"` only handles the drag gesture, not
  // a programmatic open of an overlay, so we wrap the open with an
  // explicit dismiss here.
  const onMessageLongPress = useCallback(
    (m: ChatMessage) => {
      Keyboard.dismiss();
      openMenu(m);
    },
    [openMenu],
  );

  // ── Press-drag-release coordination (all UI-thread) ────────────────────
  // Created once and shared with BOTH the message bubbles' LongPress gesture
  // (writes finger Y + hovered row) and the MessageContextMenu (writes the
  // measured row hit-zones, reads hovered row to highlight). Stable identities,
  // so passing them through memoized bubbles never breaks memoization.
  const dragActiveSV = useSharedValue(false);
  const dragFingerYSV = useSharedValue(-1);
  const hoveredActionSV = useSharedValue('');
  const actionZonesSV = useSharedValue<ActionZone[]>([]);
  // Imperative handle to replay the menu's slide-down when a drag fires an action.
  const menuRef = useRef<MessageContextMenuHandle>(null);
  // Emoji "dissolve" burst overlay + the per-message window rect captured on
  // long-press (so a delete can spawn the burst exactly where the bubble was).
  const burstRef = useRef<EmojiBurstHandle>(null);
  const deleteRectsRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());
  const stashBubbleRect = useCallback((id: string, x: number, y: number, w: number, h: number) => {
    const map = deleteRectsRef.current;
    map.set(id, { x, y, w, h });
    // Bound the map — only the most-recently long-pressed bubbles matter.
    if (map.size > 12) {
      const firstKey = map.keys().next().value;
      if (firstKey !== undefined) map.delete(firstKey);
    }
  }, []);
  const [pendingImages, setPendingImages] = useState<string[]>([]);  const [uploading, setUploading] = useState(false);

  // Defer the ChatBackgroundLayer mount past the navigation slide-in. When a
  // user has set a custom chat wallpaper, the layer mounts a CachedImage that
  // synchronously decodes a full-bleed bitmap on the open-chat frame — that
  // landed on the same RAF as the slide-in transition and contributed to the
  // ~120 ms long task users were seeing the moment they tapped a conversation.
  // Showing a flat bgColor for the first ~300 ms is identical to what users
  // see with no wallpaper set, so the visual delta is imperceptible.
  const [chromeReady, setChromeReady] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setChromeReady(true));
    return () => handle.cancel();
  }, []);
  const [viewerImages, setViewerImages] = useState<{ images: string[]; index: number } | null>(null);
  const [gifPickerVisible, setGifPickerVisible] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [searchActiveIdx, setSearchActiveIdx] = useState(0);
  // Individual selectors — destructuring `useChatStore()` subscribes to the
  // whole store and re-renders this (already heavy) chat on any unrelated
  // store change. Selecting each field independently keeps re-renders tied
  // to the data this screen actually reads.
  // Narrow the messages selector to ONLY this chat's array — the previous
  // `s.messages` selector exposed the whole `chatId -> messages[]` map, so
  // every unrelated chat's background sync re-rendered this entire screen
  // (including its 5–8 mounted bubbles). Subscribing to the slice for `id`
  // means a background sync to another chat becomes a no-op for this screen.
  const myStoreMessages = useChatStore((s) => (conversationId ? s.messages[conversationId] : undefined));
  const setMessages = useChatStore((s) => s.setMessages);
  const addMessage = useChatStore((s) => s.addMessage);
  // The REAL uuid of the logged-in account. Message ownership (which side a
  // bubble sits on, whether the action menu shows "edit/delete") is computed
  // at RENDER time against this — never from a value baked into the message at
  // receive time. This is what makes a single device with several accounts
  // render the same conversation correctly after switching accounts: the
  // messages keep their real `senderId` (the author's uuid) and only the
  // comparison target (`currentUserId`) changes per account.
  const currentUserId = useAuthStore((s) => s.user?.id);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<ChatInputBarHandle>(null);

  const { progress, height: keyboardHeight } = useReanimatedKeyboardAnimation();

  // Memoize the conversation lookup so the linear scan over `mockConversations`
  // doesn't run on every parent render — typing in the input bar (when local
  // state was hoisted) and every keyboard frame would otherwise re-walk this.
  const conversation = useMemo(() => mockConversations.find((c) => c.id === id), [id]);
  const [profileData, setProfileData] = useState<any>(null);

  const entityConversations = useEntityStore((s) => s.conversations);
  const entityConv = useMemo(
    () => entityConversations.find((c) => c.id === id),
    [entityConversations, id],
  );
  const participantId = paramParticipantId || entityConv?.participantId || (conversation as any)?.participantId || id;

  // Synchronously read this chat's cached messages ONCE so the very first render
  // already has content (no blank frame). Memoized per id so it's a single MMKV
  // read, not on every render.
  const seedMessages = useMemo<ChatMessage[]>(() => {
    if (!conversationId) return [];
    // One-shot read at chat-open time. We deliberately use getState() instead
    // of subscribing — the seed only matters for the first render frame, and
    // the live `myStoreMessages` selector below feeds subsequent updates.
    const fromStore = useChatStore.getState().messages[conversationId];
    if (fromStore && fromStore.length > 0) return fromStore as ChatMessage[];
    try {
      const cached = kvGetJSONSync<ChatMessage[]>(`chat_messages:${conversationId}`, []);
      if (cached.length > 0) return cached.map((m) => healLegacySender(m, currentUserId, participantId));
      if (mockMessages[conversationId]) return mockMessages[conversationId] as ChatMessage[];
    } catch {}
    return [];
  }, [conversationId, currentUserId, participantId]);

  // Use the store value when present, else the synchronous seed — so the list is
  // never empty on the first frame if a cache exists.
  const storeChat = (myStoreMessages || []) as ChatMessage[];
  const chatMessages = storeChat.length > 0 ? storeChat : seedMessages;

  // Push the seed into the store once (after paint) so edits/sends work normally.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId) return;
    if (seededRef.current === conversationId) return;
    seededRef.current = conversationId;
    // Deferred past the open-chat transition because pushing the seed into
    // the store synchronously triggers the chat-message selector and would
    // re-render the FlatList on the same frame as the navigation slide-in.
    // First-paint content is already provided by `seedMessages` (read
    // directly into `chatMessages` above when the store is empty), so the
    // store hydration can wait one tick without any visible delta.
    const handle = InteractionManager.runAfterInteractions(() => {
      if ((useChatStore.getState().messages[conversationId] || []).length === 0 && seedMessages.length > 0) {
        setMessages(conversationId, seedMessages as any);
      }
    });
    return () => handle.cancel();
  }, [conversationId, seedMessages]);

  // Narrow the chat-settings subscription to only the two slices this chat
  // actually reads — global defaults and this chat's own overrides. The
  // previous selector (`s => s.settings`) returned the entire chatId→settings
  // map, which meant any other chat's settings change re-rendered THIS chat
  // (and its 5 mounted message bubbles). Two atomic selectors with shallow
  // equality keep references stable across unrelated updates.
  const globalSettings = useChatSettingsStore((s) => s.settings[GLOBAL_CHAT_SETTINGS_KEY]);
  const specificSettings = useChatSettingsStore((s) => s.settings[id || '']);
  const chatSettings = useMemo(() => {
    return { ...DEFAULT_CHAT_SETTINGS, ...globalSettings, ...specificSettings };
  }, [globalSettings, specificSettings]);

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;
  const inputBarBottomPad = Math.max(insets.bottom, 12);

  // Gradient backdrop is now rendered as a STATIC absolute-positioned
  // element pinned to the bottom of the screen (see the JSX further down)
  // — it no longer rides up with the keyboard. Removing the
  // keyboard-driven opacity animation here means the fade always reads as
  // a fixed chrome element behind the input bar; previously it was
  // wrapped in a `KeyboardStickyView` and faded out as the keyboard rose,
  // which felt like the gradient was "sticking" to the input bar.

  // Input row bottom padding: safe-area when keyboard closed → small gap when open (UI thread)
  const inputRowStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(progress.value, [0, 1], [inputBarBottomPad, 8], Extrapolation.CLAMP),
  }));

  // Compensate the KeyboardStickyView's `offset.opened` for the bottom-
  // docked browser widget. When the band is active it lives INSIDE the
  // root flex column as a 56-px-tall sibling of the Stack wrapper, which
  // squeezes every screen (including this chat) so its bottom edge is
  // 56 px above the actual screen bottom. The chat input sticks to the
  // chat-screen bottom, and KSV translates the sticky surface upward by
  // the keyboard height when the keyboard appears — but because the
  // chat screen is already 56 px above the screen bottom, the input
  // ends up 56 px ABOVE the keyboard top instead of right on it. The
  // user perceives this as an unexpectedly large gap between the input
  // bar and the keyboard whenever a browser widget is docked at the
  // bottom. Adding `BAND_HEIGHT` to KSV's `translateY` when the
  // keyboard is open pushes the input back down into the band's
  // overlapped region (the keyboard hides the band anyway), so the
  // input lands flush against the keyboard top in both states.
  const minimizedUrl = useBrowserStore((s) => s.minimizedUrl);
  const browserWidgetPosition = useSettingsStore((s) => s.browserWidgetPosition);
  const stickyOpenedOffset = !!minimizedUrl && browserWidgetPosition === 'bottom' ? 56 : 0;
  const stickyOffset = useMemo(
    () => ({ closed: 0, opened: stickyOpenedOffset }),
    [stickyOpenedOffset],
  );

  // Shift the entire message list upward by exactly the keyboard height when
  // it rises. We drive the translation from `useKeyboardHandler.onMove`
  // — the same lowest-level event source `KeyboardStickyView` uses for the
  // input bar — so the list lifts in lock-step with the input bar instead
  // of occasionally desyncing into a snap when the JS thread is briefly
  // busy on the first chat open. `e.height` is the live keyboard height in
  // pixels, fed to translateY as a negative offset.
  //
  // `onInteractive` mirrors the same height during an iOS interactive
  // dismiss gesture (when the user drags the keyboard down with a finger):
  // without it the list stayed pinned at the keyboard-up position while
  // the input bar followed the finger, leaving a phantom strip where the
  // last message used to sit. Now both follow the finger together.
  const listShiftY = useSharedValue(0);
  useKeyboardHandler(
    {
      onMove: (e) => {
        'worklet';
        listShiftY.value = -e.height;
      },
      onInteractive: (e) => {
        'worklet';
        listShiftY.value = -e.height;
      },
      onEnd: (e) => {
        'worklet';
        listShiftY.value = -e.height;
      },
    },
    [],
  );
  const listShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: listShiftY.value }],
  }));

  // List bottom spacer matches the input bar's real height so the newest
  // message keeps a comfortable gap above the input. We deliberately keep
  // this STATIC (no keyboardHeight in the layout) — animating the spacer's
  // height on every keyboard frame caused the FlatList to relayout mid-
  // scroll, which manifested as the content jumping up/down when the user
  // tapped the input field while the list was still in motion. The input
  // bar itself rides KeyboardStickyView, so it always stays above the
  // keyboard regardless of this constant.
  const INPUT_BAR_HEIGHT = 60;
  const LIST_FOOTER_HEIGHT = INPUT_BAR_HEIGHT + inputBarBottomPad + 12;

  const cachedProfile = useEntityStore((s) => (participantId ? s.profiles[participantId] : undefined));

  useEffect(() => {
    if (conversation) return;
    if (cachedProfile) { setProfileData(cachedProfile); return; }
    if (!participantId) return;
    // Skip the network call when offline so it can't hang and congest the JS thread
    if (!useConnectivityStore.getState().isOnline) return;
    // Defer the profile fetch past the navigation transition — the network
    // request setup (URL build, fetch dispatch, response parse) was landing
    // on the same frame as first paint and contributing to the 60→40 fps
    // drop when opening a chat with no cached profile.
    const handle = InteractionManager.runAfterInteractions(() => {
      // Phase 5: profile fetch goes through the Worker.
      import('../../src/services/apiClient').then(({ apiGet }) =>
        apiGet<any>(`/v1/profiles/${encodeURIComponent(participantId)}`).then(({ data }) => {
          if (data) setProfileData(data);
        }).catch(() => {})
      );
    });
    return () => handle.cancel();
  }, [participantId, conversation, cachedProfile]);

  // Per-account screenshot lock for the CHAT PARTNER. The flag rides along on
  // the partner's profile (cached entity store or the fetched profileData), so
  // there's no polling — we read it once with the profile. When the partner
  // turned screenshots off, protect this chat (Android blocks capture incl.
  // over the long-press message menu; iOS blocks recording + flashes 🙈).
  const partnerScreenshotsOff = !!(
    (cachedProfile as any)?.screenshots_disabled ?? (profileData as any)?.screenshots_disabled
  );
  const { screenshotDetected } = useScreenCaptureGuard(
    partnerScreenshotsOff,
    `chat-${participantId || conversationId}`,
  );

  // Fallback for devices without MMKV: warm the AsyncStorage mirror, then hydrate
  // if the synchronous seed above found nothing.
  useEffect(() => {
    if (!conversationId) return;
    if ((useChatStore.getState().messages[conversationId] || []).length > 0) return;
    // Deferred past the open-chat transition because `kvWarm` (which
    // touches the AsyncStorage MMKV mirror) plus the subsequent
    // `kvGetJSONSync` + `setMessages` cascade was firing on the mount
    // frame and re-rendering the FlatList while the navigation slide-in
    // was still in flight. The synchronous `seedMessages` already covers
    // first-paint when MMKV is available; this effect only matters on
    // devices where MMKV is unavailable and we need the AsyncStorage
    // fallback. One tick of latency is invisible there too.
    const cacheKey = `chat_messages:${conversationId}`;
    const handle = InteractionManager.runAfterInteractions(() => {
      kvWarm([cacheKey]).then(() => {
        const cached = kvGetJSONSync<ChatMessage[]>(cacheKey, []);
        if (cached.length > 0 && (useChatStore.getState().messages[conversationId] || []).length === 0) {
          setMessages(conversationId, cached.map((m) => healLegacySender(m, currentUserId, participantId)) as any);
        } else if (cached.length === 0 && mockMessages[conversationId] && (useChatStore.getState().messages[conversationId] || []).length === 0) {
          setMessages(conversationId, mockMessages[conversationId]);
        }
      }).catch(() => {});
    });
    return () => handle.cancel();
  }, [conversationId]);

  // Persist messages to KV cache whenever THIS chat's messages change.
  // `myStoreMessages` (above) already narrows the subscription to this chat,
  // so the array reference is stable across other chats' background syncs.
  const myMessages = myStoreMessages;

  // Warm the image cache for the most recent messages so they appear instantly
  // (no black flash) when the chat opens — Telegram-style. Deferred past the
  // navigation transition: the dynamic `import('CachedImage')` + Image.prefetch
  // dispatch was landing on the same frame as the FlatList's initial bubble
  // mount and was a measurable contributor to the open-the-chat fps drop.
  useEffect(() => {
    if (!myMessages || myMessages.length === 0) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      const recent = myMessages.slice(-20);
      const uris: string[] = [];
      for (const m of recent) {
        if ((m as any).imageUrls) for (const u of (m as any).imageUrls) uris.push(u);
      }
      if (uris.length) {
        import('../../src/components/ui/CachedImage')
          .then(({ prefetchImages }) => prefetchImages(uris, CHAT_IMG_MAX_W))
          .catch(() => {});
      }
    });
    return () => handle.cancel();
  }, [conversationId]);  useEffect(() => {
    if (!conversationId) return;
    if (myMessages && myMessages.length > 0) {
      kvSetJSON(`chat_messages:${conversationId}`, myMessages);
    }
  }, [conversationId, myMessages]);

  const chatLocalName = specificSettings?.localName;
  const displayName = chatLocalName || conversation?.participantName || profileData?.display_name || entityConv?.participantName || t('chat.fallback_name');
  const displayEmoji = (conversation as any)?.participantEmoji || profileData?.emoji || entityConv?.participantEmoji || '😊';
  const displayVerified = profileData?.is_verified || cachedProfile?.is_verified || (entityConv as any)?.participantVerified || false;
  const displayBadge = profileData?.badge || cachedProfile?.badge || (entityConv as any)?.participantBadge || null;
  const profileId = participantId;

  // ── Canonical conversation reconciliation (Bug 3) ─────────────────────
  // A chat opened from a profile carries the OTHER user's id as the route
  // `id`, not a conversation id. The conversation is created lazily on the
  // first send (POST /v1/conversations is idempotent — create-or-get). Once
  // the server hands back the canonical conversation id we must converge the
  // whole local picture onto it, otherwise the messages tab (keyed by the
  // real conversation id from the server) and this screen (keyed by the user
  // id) drift apart — the conversation then either duplicates or goes missing
  // from the list. This helper:
  //   1) upserts the conversation row in the entity store, deduped by the
  //      stable participant user id (matching RealtimeAccountBridge);
  //   2) migrates any optimistic messages from the user-id bucket into the
  //      canonical conversation-id bucket;
  //   3) rewrites the route param so `id` becomes the canonical id, which
  //      re-keys the realtime channel, the message selector and the reopen
  //      path with zero extra plumbing.
  const reconcileConversation = useCallback(
    (convId: string | null, lastMessage: string) => {
      if (!convId) return;
      try {
        const store = useEntityStore.getState();
        const existing = store.conversations || [];
        const idx = existing.findIndex(
          (c) => c.id === convId || (!!participantId && c.participantId === participantId),
        );
        const row = {
          id: convId,
          participantId: participantId || '',
          participantName: displayName || t('chat.fallback_name'),
          participantUsername: '',
          participantEmoji: displayEmoji,
          lastMessage,
          lastMessageAt: new Date().toISOString(),
        };
        if (idx >= 0) {
          const merged = [...existing];
          merged[idx] = { ...existing[idx], ...row };
          store.setConversations(merged as any);
        } else {
          store.setConversations([row as any, ...existing]);
        }
      } catch {}

      if (convId !== id) {
        try {
          const cs = useChatStore.getState();
          const fromOld = cs.messages[id] || [];
          if (fromOld.length > 0) {
            const intoNew = cs.messages[convId] || [];
            const seen = new Set(intoNew.map((m: any) => m.id));
            const mergedMsgs = [...intoNew, ...fromOld.filter((m: any) => !seen.has(m.id))];
            setMessages(convId, mergedMsgs as any);
          }
        } catch {}
        try {
          router.setParams({ id: convId, participantId: participantId || '' } as any);
        } catch {}
      }
    },
    [id, participantId, displayName, displayEmoji, setMessages, t],
  );

  // Inverted list: the newest message is at scroll offset 0, so "scroll to end"
  // (newest) = scroll to offset 0. No manual scroll needed on open.
  const scrollToEnd = useCallback((_animated = true) => {
    requestAnimationFrame(() => { try { flatListRef.current?.scrollToOffset({ offset: 0, animated: _animated }); } catch {} });
  }, []);

  // ── Resolve the canonical conversation id up front ────────────────────
  // Runs on mount (and if the route id changes). Decides whether the route
  // `id` is already a conversation id or a peer user id, and in the latter
  // case calls the idempotent create-or-get so our realtime subscription
  // lands on `chat:<convId>` from the first frame — converging with a peer
  // who opened the same chat from their messages list. We only fall back to
  // the raw route id when offline (so the screen still works locally).
  useEffect(() => {
    if (!id) return;

    // (a) Messages-list navigation passes an explicit `participantId` that
    //     differs from the route id → the route id is already canonical.
    if (paramParticipantId && paramParticipantId !== id) {
      setConversationId((prev) => (prev === id ? prev : id));
      return;
    }
    // (b) The route id matches a known conversation row → already canonical.
    if (useEntityStore.getState().conversations.some((c) => c.id === id)) {
      setConversationId((prev) => (prev === id ? prev : id));
      return;
    }
    // (c) Otherwise the route id is a peer USER id (opened from a profile).
    //     Resolve the canonical 1:1 conversation. Offline → keep the raw id
    //     as a best-effort local fallback.
    if (!useConnectivityStore.getState().isOnline) return;

    let cancelled = false;
    import('../../src/services/apiClient')
      .then(({ apiPost }) =>
        apiPost<{ conversation_id: string }>('/v1/conversations', { otherUserId: id }),
      )
      .then(({ data }) => {
        const convId = data?.conversation_id;
        if (cancelled || !convId || convId === id) return;
        // Deferred past the open-chat transition because the migration
        // here writes through `cs.setMessages(convId, ...)` and
        // `setConversationId(convId)`, both of which cascade re-renders
        // through the chat-message selector and the channel-subscription
        // effect's dep array. On weak Android the navigation slide-in
        // can still be in flight when this `.then` fires, so dropping
        // the work past `runAfterInteractions` keeps the open frame
        // clean. Cancellation is double-checked inside since the
        // unmount path may have run while we were waiting.
        InteractionManager.runAfterInteractions(() => {
          if (cancelled) return;
          // Migrate any optimistic/seed messages parked under the user-id
          // bucket into the canonical bucket so nothing is orphaned when the
          // selector re-keys onto `convId`.
          try {
            const cs = useChatStore.getState();
            const fromOld = cs.messages[id] || [];
            if (fromOld.length > 0) {
              const intoNew = cs.messages[convId] || [];
              const seen = new Set(intoNew.map((m: any) => m.id));
              cs.setMessages(convId, [...intoNew, ...fromOld.filter((m: any) => !seen.has(m.id))] as any);
            }
          } catch {}
          setConversationId(convId);
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id, paramParticipantId]);

  // ── Realtime channel: incoming messages from the other participant ─────────
  //
  // Both sides of a chat use the same `id` route param when navigating to the
  // chat screen, so they end up subscribed to the same Ably channel. When the
  // peer publishes a new message we add it to the local store; we deliberately
  // skip publishes from our own user id because the optimistic addMessage in
  // handleSend / sendGif already put the message on screen.
  //
  // The connection itself is opened lazily via getRealtime() — the wrapper
  // pulls a 1-hour token from /api/ably-token and reuses one client across
  // every chat the user opens. We only subscribe / unsubscribe to the
  // per-chat channel here, not the connection.
  //
  // Three event types:
  //   - 'msg'        → new message from peer
  //   - 'msg.edit'   → peer edited a message they sent earlier
  //   - 'msg.delete' → peer deleted a message
  useEffect(() => {
    if (!conversationId) return;
    const realtime = getRealtime();
    if (!realtime) return; // Not authenticated yet, or no deviceKey — degrade silently.
    const channel = realtime.channels.get(chatChannelName(conversationId));
    const ownUserId = useAuthStore.getState().user?.id;

    const onNewMessage = (msg: { data?: any }) => {
      const payload = msg?.data;
      if (!payload || typeof payload !== 'object') return;
      // Skip our own publishes — the optimistic addMessage already showed
      // the message; receiving it again would dupe it.
      if (payload.senderId && ownUserId && payload.senderId === ownUserId) return;
      // Dedupe by id against the current store snapshot. Messages from the
      // peer are tagged with a stable client-side id by the publisher, so
      // a quick subscribe-after-publish race won't add the same row twice.
      const existing = useChatStore.getState().messages[conversationId] || [];
      if (existing.some((m) => m.id === payload.id)) return;
      // Translate the wire payload into our ChatMessage shape. We persist the
      // REAL author uuid (`payload.senderId`, published as the sender's
      // `user.id`) so ownership is computed correctly at render time on any
      // account — never the relative 'peer' sentinel. An incoming message is
      // by definition not ours, so a missing senderId still renders left.
      const incoming: ChatMessage = {
        id: payload.id,
        conversationId,
        senderId: String(payload.senderId || ''),
        text: payload.text || '',
        createdAt: payload.createdAt || new Date().toISOString(),
        isRead: false,
        replyToId: payload.replyToId,
        replyToText: payload.replyToText,
        replyToIsOwn: payload.replyToIsOwn === true ? false : payload.replyToIsOwn === false ? true : undefined,
        replyToImage: payload.replyToImage,
        replyPixelIconId: payload.replyPixelIconId,
        imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls : undefined,
      };
      addMessage(conversationId, incoming);
    };

    // Edit — peer changed text / images of a message we already have.
    // Match by id; if not found (e.g. message loaded from Supabase has a
    // different UUID-form id), the update is a silent no-op.
    const onEdit = (msg: { data?: any }) => {
      const payload = msg?.data;
      if (!payload || typeof payload !== 'object' || !payload.id) return;
      const current = useChatStore.getState().messages[conversationId] || [];
      const next = current.map((m) =>
        m.id === payload.id
          ? { ...m, text: typeof payload.text === 'string' ? payload.text : m.text, imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls : m.imageUrls }
          : m,
      );
      setMessages(conversationId, next as any);
    };

    // Delete — peer removed a message. We just filter it out of the local
    // list; no Supabase round-trip required because the peer already did
    // (or will, when DB-side delete lands).
    const onDelete = (msg: { data?: any }) => {
      const payload = msg?.data;
      if (!payload || typeof payload !== 'object' || !payload.id) return;
      const current = useChatStore.getState().messages[conversationId] || [];
      setMessages(conversationId, current.filter((m) => m.id !== payload.id) as any);
    };

    void channel.subscribe('msg', onNewMessage);
    void channel.subscribe('msg.edit', onEdit);
    void channel.subscribe('msg.delete', onDelete);
    return () => {
      try { channel.unsubscribe('msg', onNewMessage); } catch {}
      try { channel.unsubscribe('msg.edit', onEdit); } catch {}
      try { channel.unsubscribe('msg.delete', onDelete); } catch {}
    };
  }, [conversationId, addMessage, setMessages]);

  // ── Message search ──────────────────────────────────────────────────────────
  const openSearch = useCallback(() => {
    triggerHaptic('light');
    setSearchMode(true);
  }, []);

  const closeSearch = useCallback(() => {
    // Dismiss the keyboard first so the bottom input bar doesn't get stuck at the
    // keyboard's last position when it re-mounts (KeyboardStickyView).
    Keyboard.dismiss();
    setSearchQuery('');
    setSearchMatches([]);
    setSearchActiveIdx(0);
    // Exit search after the keyboard has had a frame to start closing.
    setTimeout(() => setSearchMode(false), 50);
  }, []);

  // Search match indices are in original order; map to the inverted list index.
  const scrollToIndex = useCallback((index: number) => {
    if (index < 0 || index >= chatMessages.length) return;
    const invIndex = chatMessages.length - 1 - index;
    try {
      flatListRef.current?.scrollToIndex({ index: invIndex, animated: true, viewPosition: 0.5 });
    } catch {}
  }, [chatMessages.length]);

  // Recompute matches when the query changes; jump to the most recent match
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) { setSearchMatches([]); setSearchActiveIdx(0); return; }
    const matches: number[] = [];
    chatMessages.forEach((m, i) => {
      if (m.text && m.text.toLowerCase().includes(q)) matches.push(i);
    });
    setSearchMatches(matches);
    if (matches.length > 0) {
      const last = matches.length - 1;
      setSearchActiveIdx(last);
      scrollToIndex(matches[last]);
    }
  }, [searchQuery, chatMessages, scrollToIndex]);

  const goToPrevMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const next = (searchActiveIdx - 1 + searchMatches.length) % searchMatches.length;
    setSearchActiveIdx(next);
    scrollToIndex(searchMatches[next]);
    triggerHaptic('light');
  }, [searchMatches, searchActiveIdx, scrollToIndex]);

  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const next = (searchActiveIdx + 1) % searchMatches.length;
    setSearchActiveIdx(next);
    scrollToIndex(searchMatches[next]);
    triggerHaptic('light');
  }, [searchMatches, searchActiveIdx, scrollToIndex]);

  const startReply = useCallback((message: ChatMessage) => {
    setEditing(null);
    setReplyTo(message);
    triggerHaptic('light');
  }, []);

  const pickImages = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 6,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    triggerHaptic('light');

    // Downscale picked images immediately to a display-friendly size so rendering
    // (thumbnails, context-menu preview, viewer) stays smooth even offline, and the
    // eventual upload is light. GIFs are left untouched to preserve animation.
    const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
    const processed = await Promise.all(result.assets.map(async (a) => {
      const isGif = (a.uri.split('.').pop() || '').toLowerCase() === 'gif';
      if (isGif) return a.uri;
      try {
        const r = await manipulateAsync(a.uri, [{ resize: { width: 1280 } }], { compress: 0.6, format: SaveFormat.JPEG });
        return r.uri;
      } catch {
        return a.uri;
      }
    }));
    setPendingImages((prev) => [...prev, ...processed].slice(0, 6));
  }, []);

  // Paste an image from the system clipboard into the composer (Telegram-style:
  // copy a photo anywhere → long-press the attach button here → it's pasted in,
  // ready to send). Re-encodes the clipboard data URI to a local JPEG file so
  // the existing upload path works. Fully guarded — failures just toast.
  const pasteImageFromClipboard = useCallback(async () => {
    try {
      const has = await Clipboard.hasImageAsync();
      if (!has) { showToast(t('toast.no_clipboard_image'), 'image'); return; }
      const img = await Clipboard.getImageAsync({ format: 'png' });
      if (!img?.data) return;
      const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
      const out = await manipulateAsync(img.data, [{ resize: { width: 1280 } }], { compress: 0.8, format: SaveFormat.JPEG });
      if (out.uri) {
        triggerHaptic('light');
        setPendingImages((prev) => [...prev, out.uri].slice(0, 6));
      }
    } catch {
      showToast(t('toast.error_generic'), 'alert-circle');
    }
  }, [t]);

  // Add already-resolved local image URIs (from the native paste handler) to
  // the composer. Resizes non-GIFs the same way pickImages does. Capped at 6.
  const addPastedImages = useCallback(async (uris: string[]) => {
    if (!uris?.length) return;
    try {
      const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
      const processed = await Promise.all(uris.slice(0, 6).map(async (u) => {
        const isGif = (u.split('?')[0].split('.').pop() || '').toLowerCase() === 'gif';
        if (isGif) return u;
        try {
          const r = await manipulateAsync(u, [{ resize: { width: 1280 } }], { compress: 0.8, format: SaveFormat.JPEG });
          return r.uri;
        } catch { return u; }
      }));
      triggerHaptic('light');
      setPendingImages((prev) => [...prev, ...processed].slice(0, 6));
    } catch {
      showToast(t('toast.error_generic'), 'alert-circle');
    }
  }, [t]);

  const openImageViewer = useCallback((images: string[], index: number) => {
    setViewerImages({ images, index });
  }, []);

  // Send a GIF (from GIPHY) as a message. We store the remote GIF URL directly in
  // imageUrls — no upload to our storage (zero server load), and it renders +
  // animates through the existing image path (expo-image animates GIFs).
  const sendGif = useCallback((url: string) => {
    if (!id || !url) return;
    triggerHaptic('light');
    const currentReply = replyTo;
    setReplyTo(null);
    const newMessage: ChatMessage = {
      id: 'm-' + Date.now(),
      conversationId,
      senderId: currentUserId || 'current',
      text: '',
      createdAt: new Date().toISOString(),
      isRead: true,
      replyToId: currentReply?.id,
      replyToText: currentReply?.text || (currentReply?.imageUrls && currentReply.imageUrls.length > 0 ? t('chat.photo') : undefined),
      replyToIsOwn: currentReply ? (currentReply.senderId === currentUserId || currentReply.senderId === 'current') : undefined,
      replyToImage: currentReply?.imageUrls?.[0],
      // Per-chat decorative pixel icon stamped onto reply messages.
      // Only set when this message is actually a reply — otherwise
      // there's no reply-block to render the icon in. Read directly
      // off the merged settings object so it picks up the latest
      // pick from the picker without a re-render dependency.
      replyPixelIconId: currentReply ? chatSettings.replyPixelIcon : undefined,
      imageUrls: [url],
    };
    addMessage(conversationId, newMessage);
    scrollToEnd();

    // Persist to the DB (best-effort) using the same image marker scheme.
    if (!useConnectivityStore.getState().isOnline) return;
    (async () => {
      try {
        const { useAuthStore } = await import('../../src/store');
        const user = useAuthStore.getState().user;
        if (!user) return;
        const { apiPost } = await import('../../src/services/apiClient');
        // Idempotent: returns existing 1:1 conversation if one already
        // exists between this pair, otherwise creates and returns the new id.
        const { data: convData } = await apiPost<{ conversation_id: string }>(
          '/v1/conversations',
          { otherUserId: participantId },
        );
        const convId = convData?.conversation_id || null;
        if (convId) {
          const { data: sentGifData } = await apiPost<{ id: string }>(
            `/v1/conversations/${encodeURIComponent(convId)}/messages`,
            { text: `::img::${url}::` },
          );
          // Reconcile optimistic id → server id so a later history fetch
          // dedupes instead of duplicating the GIF (same fix as handleSend).
          const serverGifId = sentGifData?.id || newMessage.id;
          if (serverGifId !== newMessage.id) {
            setMessages(
              conversationId,
              (useChatStore.getState().messages[conversationId] || []).map((m) =>
                m.id === newMessage.id ? { ...m, id: serverGifId } : m,
              ) as any,
            );
          }
          // Realtime publish — same pattern as handleSend. The peer sees
          // the GIF instantly via subscribe-on-mount. Publish on the
          // canonical conversation channel so a profile-initiated chat
          // reaches a peer who opened the chat from their messages tab.
          try {
            const realtime = getRealtime();
            if (realtime && id) {
              const channel = realtime.channels.get(chatChannelName(convId));
              void channel.publish('msg', {
                id: serverGifId,
                senderId: user.id,
                text: '',
                createdAt: newMessage.createdAt,
                imageUrls: [url],
                replyToId: newMessage.replyToId,
                replyToText: newMessage.replyToText,
                replyToIsOwn: newMessage.replyToIsOwn,
                replyToImage: newMessage.replyToImage,
                replyPixelIconId: newMessage.replyPixelIconId,
              });
            }
            // Peer notification (conversation row + preview on the
            // recipient's messages tab) is published SERVER-SIDE by the
            // Worker after POST /messages — it holds the Ably root key and
            // can write to `user:<peer>:notifications`. The client token is
            // scoped to `chat:*` + `user:<self>:*` only, so a client-side
            // publish here just throws a 40160 capability error. Removed.
          } catch {}

          // Converge local state onto the canonical conversation id (Bug 3)
          // so a GIF-first chat started from a profile shows up in the
          // messages list and reopens to the same thread.
          reconcileConversation(convId, '📷');
        }
      } catch {}
    })();
  }, [id, conversationId, replyTo, addMessage, scrollToEnd, participantId, t, reconcileConversation]);

  // Translation sheet state — receives source text on demand and animates
  // up. Reset to '' when closed so the next open re-fetches (the service
  // hits its 7-day MMKV cache so this is essentially free).
  const [translateText, setTranslateText] = useState<string>('');

  const handleMenuAction = useCallback((action: MessageAction, message: ChatMessage) => {
    if (action === 'copy') {
      Clipboard.setStringAsync(message.text);
      showToast(t('toast.copied'), 'check');
    } else if (action === 'copyImage') {
      // Copy the (first) photo to the system clipboard so it can be pasted into
      // any other app. Images are served via the weserv proxy (WebP) and cached
      // by expo-image under the PROXIED url — so we resolve that, prefer the
      // already-downloaded local cache file, then re-encode to a clipboard-safe
      // JPEG. Resized + compressed so the base64 payload stays small enough for
      // the Android clipboard. Fully guarded — failures just toast.
      const raw = message.imageUrls?.[0];
      if (raw) {
        (async () => {
          try {
            const isGif = (raw.split('?')[0].split('.').pop() || '').toLowerCase() === 'gif';
            const proxied = isGif ? raw : proxiedImageUrl(raw, 1080);
            let srcUri = proxied;
            // Prefer the local cache file expo-image already downloaded.
            try {
              const { Image: ExpoImage } = await import('expo-image');
              const cached = await ExpoImage.getCachePathAsync(proxied);
              if (cached) srcUri = cached.startsWith('file') ? cached : 'file://' + cached;
            } catch {}
            const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
            const out = await manipulateAsync(srcUri, [{ resize: { width: 1080 } }], { base64: true, compress: 0.85, format: SaveFormat.JPEG });
            if (out.base64) {
              await Clipboard.setImageAsync(out.base64);
              showToast(t('toast.image_copied'), 'check');
            } else {
              showToast(t('toast.error_generic'), 'alert-circle');
            }
          } catch {
            showToast(t('toast.error_generic'), 'alert-circle');
          }
        })();
      }
    } else if (action === 'reply') {
      startReply(message);
    } else if (action === 'translate') {
      // Open the translation sheet with the source message text. The sheet
      // does the LibreTranslate fetch + result UI itself.
      if (message.text && message.text.trim()) setTranslateText(message.text);
    } else if (action === 'edit') {
      setReplyTo(null);
      setEditing(message);
      // Use `?? ''` so attachment-only messages (GIF / photo, where
      // `text` is empty or undefined) don't propagate undefined into the
      // TextInput — they should open the editor with a blank text field
      // and the existing media pre-loaded for replace/remove.
      inputRef.current?.setText(message.text ?? '');
      // Load existing photos / GIF URLs so they can be removed or replaced
      // via the existing pendingImages flow (× to remove, image picker to
      // add a new photo, GIF button to swap to a new GIF).
      setPendingImages(message.imageUrls || []);
    } else if (action === 'delete') {
      Alert.alert(t('chat.delete_message_title'), '', [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'), style: 'destructive', onPress: () => {
            if (!conversationId) return;
            // Emoji "dissolve" burst at the bubble's last-measured position
            // (captured on the long-press that opened this menu). Fire BEFORE
            // removing the row so it visually erupts from where the message was.
            const rect = deleteRectsRef.current.get(message.id);
            if (rect) {
              burstRef.current?.burst(rect.x, rect.y, rect.w, rect.h);
              deleteRectsRef.current.delete(message.id);
            }
            // Read the latest snapshot from getState() rather than from the
            // closed-over selector — avoids the callback being recreated on
            // every store update (and rebuilding all bubbles' onLongPress).
            const current = useChatStore.getState().messages[conversationId] || [];
            setMessages(conversationId, current.filter((m) => m.id !== message.id) as any);
            triggerHaptic('medium');
            // Sync delete to the peer in realtime — so when this user
            // deletes a message on their side, it disappears from the
            // peer's open chat too. Telegram-style "delete for both".
            try {
              const realtime = getRealtime();
              if (realtime && conversationId) {
                const channel = realtime.channels.get(chatChannelName(conversationId));
                void channel.publish('msg.delete', { id: message.id });
              }
            } catch {}
          },
        },
      ]);
    }
  }, [conversationId, setMessages, startReply, t]);

  // Fired (once) when the user RELEASES a press-drag over a highlighted action
  // row. Routes through the SAME path as tap-to-select (`handleMenuAction`),
  // replaying the menu's slide-down dismiss first so it doesn't snap away.
  const fireDragAction = useCallback((message: ChatMessage, action: string) => {
    const run = () => handleMenuAction(action as MessageAction, message);
    if (menuRef.current) {
      menuRef.current.dismiss(run); // dismiss() also calls onClose → closeMenu
    } else {
      run();
      closeMenu();
    }
  }, [handleMenuAction, closeMenu]);

  const handleSend = async (rawText: string) => {
    const hasImages = pendingImages.length > 0;
    if ((!rawText.trim() && !hasImages) || !conversationId) return;
    triggerHaptic('medium');
    // Strip dangerous invisible / control / bidi-override chars; keep
    // decorative Unicode + emoji. sanitizeUserText also trims.
    const text = sanitizeUserText(rawText);

    if (editing) {
      // Re-upload any newly added local images (those that aren't already remote URLs)
      let finalImages: string[] | undefined = pendingImages.length > 0 ? pendingImages : undefined;
      const localOnes = pendingImages.filter((u) => !u.startsWith('http'));
      setEditing(null);
      setPendingImages([]);
      setMessages(conversationId, (useChatStore.getState().messages[conversationId] || []).map((m) => (m.id === editing.id ? { ...m, text, imageUrls: finalImages } : m)) as any);
      if (localOnes.length > 0) {
        const results = await Promise.all(pendingImages.map((u) => u.startsWith('http') ? Promise.resolve({ url: u, error: null }) : uploadChatImage(u)));
        const urls = results.map((r) => r.url).filter(Boolean) as string[];
        setMessages(conversationId, (useChatStore.getState().messages[conversationId] || []).map((m) => (m.id === editing.id ? { ...m, imageUrls: urls.length ? urls : undefined } : m)) as any);
        finalImages = urls.length ? urls : undefined;
      }
      // Sync the edit to the peer's open chat. The receiver's subscription
      // handler updates the message in place by id. Same caveats as
      // realtime delete — only matches by message.id, so peers viewing
      // history loaded from Supabase (which has its own UUIDs) won't see
      // the edit; but anyone who received the message via the live Ably
      // stream WILL.
      try {
        const realtime = getRealtime();
        if (realtime && conversationId) {
          const channel = realtime.channels.get(chatChannelName(conversationId));
          void channel.publish('msg.edit', {
            id: editing.id,
            text,
            imageUrls: finalImages,
          });
        }
      } catch {}
      return;
    }

    const currentReply = replyTo;
    setReplyTo(null);

    const localImages = pendingImages;
    setPendingImages([]);

    const newMessage: ChatMessage = {
      id: 'm-' + Date.now(),
      conversationId,
      senderId: currentUserId || 'current',
      text,
      createdAt: new Date().toISOString(),
      isRead: true,
      replyToId: currentReply?.id,
      replyToText: currentReply?.text || (currentReply?.imageUrls && currentReply.imageUrls.length > 0 ? (currentReply.imageUrls.length > 1 ? t('chat.photos_count', undefined, { n: currentReply.imageUrls.length }) : t('chat.photo')) : undefined),
      replyToIsOwn: currentReply ? (currentReply.senderId === currentUserId || currentReply.senderId === 'current') : undefined,
      replyToImage: currentReply?.imageUrls?.[0],
      // See sendGif — same per-chat pixel-icon stamp on outgoing
      // replies. Stays out of non-reply messages so memoized
      // bubbles don't re-render unnecessarily.
      replyPixelIconId: currentReply ? chatSettings.replyPixelIcon : undefined,
      imageUrls: localImages.length > 0 ? localImages : undefined,
    };
    addMessage(conversationId, newMessage);
    scrollToEnd();

    // Upload images in the background, then swap local URIs for remote URLs.
    // Skip all network work when offline so the JS thread / keyboard stay smooth.
    if (!useConnectivityStore.getState().isOnline) return;

    let uploadedUrls: string[] = [];
    if (localImages.length > 0) {
      setUploading(true);
      try {
        const results = await Promise.all(localImages.map((uri) => uploadChatImage(uri)));
        uploadedUrls = results.map((r) => r.url).filter(Boolean) as string[];
        if (uploadedUrls.length > 0) {
          setMessages(conversationId, (useChatStore.getState().messages[conversationId] || []).map((m) =>
            m.id === newMessage.id ? { ...m, imageUrls: uploadedUrls } : m
          ) as any);
        }
      } catch {}
      setUploading(false);
    }

    try {
      const { useAuthStore } = await import('../../src/store');
      const user = useAuthStore.getState().user;
      if (!user) return;

      const { apiPost } = await import('../../src/services/apiClient');
      const { data: convData } = await apiPost<{ conversation_id: string }>(
        '/v1/conversations',
        { otherUserId: participantId },
      );
      const convId = convData?.conversation_id || null;

      if (convId) {
        // Encode attached images into the stored text with a marker so it
        // round-trips without schema changes.
        const imageMarker = uploadedUrls.length > 0 ? `::img::${uploadedUrls.join('|')}::` : '';
        const { data: sentData } = await apiPost<{ id: string }>(
          `/v1/conversations/${encodeURIComponent(convId)}/messages`,
          { text: imageMarker + text },
        );
        // Reconcile the optimistic row's id with the server's canonical id.
        // The optimistic message was added with a client id (`m-<ts>`), but
        // the Worker stores it under a fresh uuid. Without this, a later
        // history fetch (which carries the server uuid) fails to dedupe
        // against the optimistic row and renders a SECOND copy — the chat
        // message-duplication bug. We rewrite the local id to the server id
        // here, and publish that same id so the peer dedupes too.
        const serverMessageId = sentData?.id || newMessage.id;
        if (serverMessageId !== newMessage.id) {
          setMessages(
            conversationId,
            (useChatStore.getState().messages[conversationId] || []).map((m) =>
              m.id === newMessage.id ? { ...m, id: serverMessageId } : m,
            ) as any,
          );
        }

        // Publish to the realtime channel so the peer's chat screen picks
        // up this message instantly. The channel name is `chat:<id>` (the
        // route param), so both sides see the same channel as long as they
        // navigated through the same conversation entry. We deliberately
        // publish AFTER the Supabase insert resolved — that guarantees the
        // peer's optimistic addMessage maps to a real DB row, so when they
        // re-open the chat the message persists.
        //
        // We ALSO publish to the peer's personal `user:<peerId>:notifications`
        // channel so the message + the conversation entry appear in their
        // messages-tab list before they open the chat at all (Telegram-style
        // "new chat appears with first message"). RealtimeAccountBridge
        // subscribes to this channel app-wide.
        try {
          const realtime = getRealtime();
          if (realtime) {
            const messageBody = {
              id: serverMessageId,
              senderId: user.id,
              text,
              createdAt: newMessage.createdAt,
              imageUrls: uploadedUrls.length > 0 ? uploadedUrls : undefined,
              replyToId: newMessage.replyToId,
              replyToText: newMessage.replyToText,
              replyToIsOwn: newMessage.replyToIsOwn,
              replyToImage: newMessage.replyToImage,
              replyPixelIconId: newMessage.replyPixelIconId,
            };
            if (id) {
              const chatChan = realtime.channels.get(chatChannelName(convId));
              void chatChan.publish('msg', messageBody);
            }
            // Peer notification (messages-tab row + preview) is published
            // SERVER-SIDE by the Worker after POST /messages using the Ably
            // root key. The client token is scoped to `chat:*` + `user:<self>:*`
            // only, so publishing to `user:<peer>:notifications` from here just
            // throws a 40160 capability error. Removed — see messages.ts.
          }
        } catch {}
      }

      // Converge the local picture onto the canonical conversation id the
      // server just handed back (Bug 3) — upserts the list row deduped by
      // participant, migrates optimistic messages, and re-keys the route.
      reconcileConversation(convId, text || (uploadedUrls.length > 0 ? '📷' : ''));
    } catch {}
  };

  const handleSwipeActive = useCallback((active: boolean) => {
    // Ref-based scroll lock — replaces the old `setScrollEnabled` state
    // toggle. The state-driven version was a contributor to the swipe
    // jitter the user reported: every grant/release re-rendered this
    // entire screen (it's the parent of the FlatList), the FlatList
    // re-evaluated its `scrollEnabled` prop, and on weak Android that
    // re-evaluation could briefly take the responder back from the
    // bubble's swipe gesture mid-stream. `setNativeProps` writes the
    // flag straight to the underlying ScrollView with zero React work,
    // so the bubble keeps the gesture for the whole interaction. Now
    // that the swipe gesture itself runs on the UI thread (RNGH), this
    // is also the only JS-thread work per swipe — fired ONCE on
    // activate and ONCE on end, never per frame.
    try { (flatListRef.current as any)?.setNativeProps?.({ scrollEnabled: !active }); } catch {}
  }, []);

  // Parse the ::img::url1|url2:: marker for messages coming from the DB, and
  // heal any legacy relative senderId ('current'/'peer') to a real uuid so
  // ownership compares correctly at render time.
  const parseMessage = useCallback((m: ChatMessage): ChatMessage => {
    const healed = healLegacySender(m, currentUserId, participantId);
    if (healed.imageUrls || !healed.text?.startsWith('::img::')) return healed;
    const end = healed.text.indexOf('::', 7);
    if (end === -1) return healed;
    const urls = healed.text.slice(7, end).split('|').filter(Boolean);
    return { ...healed, imageUrls: urls.length ? urls : undefined, text: healed.text.slice(end + 2) };
  }, [currentUserId, participantId]);

  const activeMatchIndex = searchMatches.length > 0 ? searchMatches[searchActiveIdx] : -1;
  const activeMatchId = activeMatchIndex >= 0 && activeMatchIndex < chatMessages.length ? chatMessages[activeMatchIndex]?.id : null;

  // Inverted data: render newest-first so the FlatList's natural bottom is the
  // newest message — no auto-scroll-to-end needed.
  // latest message (no scrolling needed). Memoized to avoid re-reversing on every
  // keystroke / re-render.
  const invertedMessages = useMemo(() => {
    const arr = chatMessages.slice();
    arr.reverse();
    return arr;
  }, [chatMessages]);

  // Tap-a-reply-to-jump: scroll to the message a reply is quoting and flash it.
  // `replyToId` is stored on every reply message (see sendText/sendGif). The
  // FlatList data IS `invertedMessages`, so the found index maps 1:1 to the row.
  const [jumpHighlightId, setJumpHighlightId] = useState<string | null>(null);
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollToMessageId = useCallback((messageId?: string) => {
    if (!messageId) return;
    const idx = invertedMessages.findIndex((mm) => mm.id === messageId);
    if (idx < 0) return; // original not loaded in the current window
    try {
      flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
    } catch {}
    triggerHaptic('selection');
    setJumpHighlightId(messageId);
    if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current);
    jumpTimerRef.current = setTimeout(() => setJumpHighlightId(null), 1600);
  }, [invertedMessages]);
  useEffect(() => () => { if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current); }, []);

  // Guard against the freeze caused by rapid long-presses / taps while a menu is
  // opening or closing — see `useContextMenuGuard` (declared above with the
  // other hooks) for the time-lock + requestAnimationFrame defer.

  // ── GIF off-screen pause (viewability tracking) ───────────────────────
  // Track which message rows are actually on screen so animated images
  // (GIFs) only decode frames while visible. `viewabilityReady` guards the
  // window before FlatList has reported its first viewable set — until then
  // we treat everything as visible so nothing is paused incorrectly on open.
  // Both config + handler are ref-stable: FlatList warns (and can crash on
  // some RN versions) if either identity changes between renders.
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => new Set());
  const [viewabilityReady, setViewabilityReady] = useState(false);
  // Deferred past the open-chat transition: FlatList fires its first
  // viewability callback the instant the initial cells lay out, which
  // landed on the same frame as the navigation slide-in and triggered an
  // immediate re-render of all five mounted bubbles (state write to
  // `visibleIds`). The 250 ms gate skips that first burst — the list is
  // already rendering everything visible (initialNumToRender=5), so
  // nothing is paused incorrectly during the gate.
  const viewabilityArmedRef = useRef(false);
  useEffect(() => {
    const handle = setTimeout(() => { viewabilityArmedRef.current = true; }, 250);
    return () => clearTimeout(handle);
  }, []);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 35 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    // Skip viewability-driven state writes until the open-chat transition
    // has settled. See `viewabilityArmedRef` declaration above.
    if (!viewabilityArmedRef.current) return;
    const next = new Set<string>();
    for (const v of viewableItems) {
      if (v.isViewable && v.item?.id) next.add(v.item.id as string);
    }
    setViewabilityReady(true);
    setVisibleIds((prev) => {
      // Skip the state write (and the consequent re-render) when the
      // viewable set is unchanged — avoids churn on tiny scroll jitters.
      if (prev.size === next.size) {
        let same = true;
        for (const id of next) if (!prev.has(id)) { same = false; break; }
        if (same) return prev;
      }
      return next;
    });
  }).current;

  const renderItem = useCallback(({ item }: { item: ChatMessage; index: number }) => {
    const m = parseMessage(item);
    return (
      <MemoMessageBubble
        message={m}
        isOwn={m.senderId === currentUserId}
        fontSize={chatSettings.fontSize}
        bubbleRadius={chatSettings.bubbleRadius}
        fontFamily={chatSettings.fontFamily}
        linkEmoji={chatSettings.linkEmoji}
        highlighted={item.id === activeMatchId || item.id === jumpHighlightId}
        isVisible={!viewabilityReady || visibleIds.has(item.id)}
        onReply={startReply}
        onReplyJump={scrollToMessageId}
        onLongPress={onMessageLongPress}
        onMeasured={stashBubbleRect}
        onSwipeActive={handleSwipeActive}
        onImagePress={openImageViewer}
        dragActive={dragActiveSV}
        dragFingerY={dragFingerYSV}
        hoveredAction={hoveredActionSV}
        actionZones={actionZonesSV}
        onFireDragAction={fireDragAction}
      />
    );
  }, [chatSettings.fontSize, chatSettings.bubbleRadius, chatSettings.fontFamily, chatSettings.linkEmoji, startReply, scrollToMessageId, handleSwipeActive, openImageViewer, parseMessage, activeMatchId, jumpHighlightId, onMessageLongPress, currentUserId, visibleIds, viewabilityReady, dragActiveSV, dragFingerYSV, hoveredActionSV, actionZonesSV, fireDragAction]);

  // Stable callback refs for FlatList — without these, every parent render
  // hands FlatList fresh function identities and breaks its row recycling
  // shortcuts. Both functions only close over `flatListRef.current`, so they
  // never need to change.
  const chatKeyExtractor = useCallback((item: ChatMessage) => item.id, []);
  const onScrollToIndexFailedCb = useCallback((info: { index: number; averageItemLength: number; highestMeasuredFrameIndex: number }) => {
    setTimeout(() => {
      try { flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }); } catch {}
    }, 120);
  }, []);

  // ── Scroll-to-bottom button ────────────────────────────────────────────
  // Telegram-style floating affordance that appears when the user has
  // scrolled away from the newest message. The chat list is INVERTED, so
  // newest = offset 0 and "scrolled up = away from newest" maps to
  // `contentOffset.y > THRESHOLD`. Visibility is throttled state +
  // native-driver opacity tween so the show/hide is free on the JS thread.
  // Per-chat toggle in `chatSettings.scrollToBottomButton` (default true)
  // gates rendering at the JSX level, so an opted-out user pays nothing.
  const SCROLL_BTN_THRESHOLD = 120;
  const [scrollBtnVisible, setScrollBtnVisible] = useState(false);
  const scrollBtnOpacity = useRef(new Animated.Value(0)).current;
  // Last-event throttle. RN's `scrollEventThrottle={32}` already caps the
  // call rate at ~30 Hz on iOS; the JS-side guard here is belt-and-suspenders
  // so a chatty Android scroll listener can't churn `setState` either.
  const lastScrollEventAt = useRef(0);
  const onChatScroll = useCallback((e: any) => {
    const now = Date.now();
    if (now - lastScrollEventAt.current < 32) return;
    lastScrollEventAt.current = now;
    const y = e?.nativeEvent?.contentOffset?.y ?? 0;
    const next = y > SCROLL_BTN_THRESHOLD;
    setScrollBtnVisible((prev) => (prev === next ? prev : next));
  }, []);
  useEffect(() => {
    Animated.timing(scrollBtnOpacity, {
      toValue: scrollBtnVisible ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [scrollBtnVisible, scrollBtnOpacity]);
  const onScrollBtnTap = useCallback(() => {
    triggerHaptic('light');
    try { flatListRef.current?.scrollToOffset({ offset: 0, animated: true }); } catch {}
  }, []);

  const banner = editing || replyTo;
  const menuIsOwn = actionMessage ? (actionMessage.senderId === currentUserId || actionMessage.senderId === 'current') : false;

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {chromeReady && chatSettings.backgroundImage && (
        <ChatBackgroundLayer uri={chatSettings.backgroundImage} style={StyleSheet.absoluteFill} />
      )}

      {/* Inverted list — newest message sits at the bottom with NO scrolling
          needed (exactly like the AI chat). This removes the open-at-top-then-
          jump-to-bottom behaviour entirely and makes keyboard handling trivial.
          The whole list is wrapped in a Reanimated.View whose translateY is
          driven by the keyboard frame on the UI thread, so when the keyboard
          rises every message rides up with it (last message stays visible
          above the input bar) without triggering FlatList layout. */}
      <Reanimated.View style={[StyleSheet.absoluteFill, listShiftStyle]} pointerEvents="box-none">
      <FlatList
        ref={flatListRef}
        data={invertedMessages}
        style={StyleSheet.absoluteFill}
        keyExtractor={chatKeyExtractor}
        renderItem={renderItem}
        inverted
        contentContainerStyle={{ paddingBottom: 8 }}
        ListHeaderComponent={<View style={{ height: LIST_FOOTER_HEIGHT }} />}
        ListFooterComponent={<View style={{ height: headerContentHeight + 8 }} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        removeClippedSubviews={true}
        // Tuned for iPhone 12 / weak Android: ~4 bubbles fit the visible
        // window above the input bar (the 5th was usually clipped under
        // the gradient anyway). Each bubble allocates a `Reanimated`
        // shared value, a `LinkPreview` slot, and a `Gesture.Pan()`
        // builder for swipe-to-reply — the more we mount on the first
        // commit, the longer the navigation transition fights for the
        // JS thread. Cutting the initial batch by one and the per-batch
        // budget by one buys ~5–10 ms on weak Android 10 (Telegram-grade
        // target device). The pan gesture itself runs ON THE UI THREAD
        // (RNGH + Reanimated worklets), so once the bubbles are mounted
        // they don't compete with subsequent JS work.
        initialNumToRender={4}
        maxToRenderPerBatch={3}
        windowSize={5}
        // Larger update batching window — keeps cell mounting from competing
        // with scroll gestures on weak devices. Default is 50 ms; bumping to
        // 80 ms is invisible to the user and lets scroll frames win.
        updateCellsBatchingPeriod={80}
        onScrollToIndexFailed={onScrollToIndexFailedCb}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        // Scroll-to-bottom button visibility tracker. Throttled to ~30 Hz
        // via `scrollEventThrottle={32}` plus a JS-side guard inside
        // `onChatScroll`, and the handler only writes state when the
        // visibility flag actually flips — so steady scrolling is free.
        onScroll={onChatScroll}
        scrollEventThrottle={32}
      />
      </Reanimated.View>

      {/* Static under-input gradient. Pinned to the bottom of the screen
          and intentionally OUTSIDE `KeyboardStickyView` so it does NOT
          ride up with the keyboard — when the user types, the input bar
          animates above the keyboard while this fade stays anchored at
          the screen bottom, reading as a fixed chrome element. Z-order
          here matters: rendered after the FlatList wrapper (so it paints
          over the message list) but before the `KeyboardStickyView`
          below (so the input bar paints over it). Three-stop fade
          mirrors the top-header gradient so messages scrolling past
          ghost into the chrome rather than being hard-clipped. Static
          height, no animation — it simply sits there. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: LIST_FOOTER_HEIGHT }}
      >
        <LinearGradient
          colors={[bgTransparent, bgColor + 'B3', bgColor]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Scroll-to-bottom button. Rendered ABOVE the gradient (so the
          chevron is fully readable, not ghosted into the fade) but BELOW
          the input bar in z-order. Anchored to the bottom of the screen
          with a static offset (`LIST_FOOTER_HEIGHT - 36` parks it just
          barely above the input bar's top edge, so it visually anchors
          to the input rather than floating in the chat area), and the
          entire wrapper is a Reanimated.View driven by `listShiftStyle`
          so it rides up with the input bar when the keyboard rises —
          `listShiftY` already tracks the live keyboard height (driven
          by `useKeyboardHandler.onMove`), so reusing the same shared
          value keeps the button perfectly in lockstep with the input
          bar across both keyboard-up and interactive-dismiss frames.

          Gated entirely on `chatSettings.scrollToBottomButton`: when off,
          nothing mounts (no scroll listener cost, no opacity animator). */}
      {chatSettings.scrollToBottomButton && (
        <Reanimated.View
          pointerEvents="box-none"
          style={[
            // Offset chosen so the button sits noticeably above the input
            // bar with a small visible gap (~28 px between bottom of button
            // and top of input bar). `LIST_FOOTER_HEIGHT - 8` puts the
            // button BOTTOM 8 px below the input bar's top, and the button
            // is 36 px tall, so the top edge sits ~28 px above the input
            // bar — easy to reach without crowding the bar itself.
            { position: 'absolute', right: 16, bottom: LIST_FOOTER_HEIGHT - 8 },
            listShiftStyle,
          ]}
        >
          <Animated.View
            // Native-driver opacity fade. `pointerEvents` follows the
            // visibility flag so the button is non-interactive while
            // hidden — prevents a "hidden but tappable" footgun where a
            // mis-targeted tap near the input bar fires `scrollToOffset`
            // unexpectedly.
            pointerEvents={scrollBtnVisible ? 'auto' : 'none'}
            style={{ opacity: scrollBtnOpacity }}
          >
            {glassActive ? (
              // Glass capsule via the GlassBg BACKGROUND pattern (the documented
              // correct way to glass a button). The previous version put the
              // chevron INSIDE an interactive GlassView, which rendered fully
              // transparent in this absolutely-positioned overlay (same class of
              // bug as the Dynamic Island). Now the glass is an absolute-fill
              // sibling BEHIND the chevron, clipped to the circle, with a faint
              // tint so it always reads as a button even where the backdrop is
              // the plain fade. The opacity fade stays on the wrapper above.
              <Pressable
                onPress={onScrollBtnTap}
                hitSlop={6}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  overflow: 'hidden',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: theme.colors.border.light,
                  backgroundColor: theme.isDark ? 'rgba(40,40,45,0.45)' : 'rgba(255,255,255,0.45)',
                }}
              >
                <GlassBg borderRadius={18} glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} interactive={false} />
                <Feather name="chevron-down" size={20} color={theme.colors.text.primary} />
              </Pressable>
            ) : (
              <Pressable
                onPress={onScrollBtnTap}
                hitSlop={6}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: theme.colors.background.elevated,
                  borderWidth: 1,
                  borderColor: theme.colors.border.light,
                  alignItems: 'center',
                  justifyContent: 'center',
                  // Soft elevation so the button reads as floating chrome
                  // rather than blending into the fade beneath it. Same
                  // shadow recipe as the existing header pills.
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.15,
                  shadowRadius: 4,
                  elevation: 3,
                }}
              >
                <Feather name="chevron-down" size={20} color={theme.colors.text.primary} />
              </Pressable>
            )}
          </Animated.View>
        </Reanimated.View>
      )}

      {/* Input bar sticks to the keyboard top; hidden while searching */}
      {!searchMode && (
      <KeyboardStickyView offset={stickyOffset} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        {banner && (
          <View style={[{ marginHorizontal: 12, marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden' }, glassActive ? null : { backgroundColor: theme.colors.background.elevated, borderWidth: 1, borderColor: theme.colors.border.light }]}>
            {glassActive ? <GlassBg borderRadius={12} glassStyle="regular" interactive={false} colorScheme={theme.isDark ? 'dark' : 'light'} tintColor={theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)'} /> : null}
            <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: theme.colors.accent.primary }} />
            <Feather name={editing ? 'edit-2' : 'corner-up-left'} size={15} color={theme.colors.accent.primary} />
            {banner.imageUrls && banner.imageUrls.length > 0 ? (
              <CachedImage uri={banner.imageUrls[0]} style={{ width: 32, height: 32, borderRadius: 6 }} resizeMode="cover" />
            ) : null}
            <View style={{ flex: 1 }}>
              <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} style={{ fontSize: 12 }}>{editing ? t('chat.editing') : t('chat.replying')}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 12 }}>{banner.text || (banner.imageUrls && banner.imageUrls.length > 0 ? `📷 ${banner.imageUrls.length > 1 ? t('chat.photos_count', undefined, { n: banner.imageUrls.length }) : t('chat.photo')}` : '')}</Text>
            </View>
            {/* Pixel-icon picker entry — only relevant on a reply
                compose, not on edit. Shows the currently-selected
                icon (per-chat) so the user can see at a glance what
                will be stamped onto the outgoing reply. Opens the
                picker bound to this chat. */}
            {!editing ? (
              <Pressable
                onPress={() => {
                  triggerHaptic('light');
                  router.push({ pathname: '/settings/pixel-icons', params: { purpose: 'chat-reply', chatId: id || '' } });
                }}
                hitSlop={8}
                style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
              >
                {chatSettings.replyPixelIcon ? (
                  <PixelIcon id={chatSettings.replyPixelIcon} size={22} />
                ) : (
                  <Feather name="image" size={18} color={theme.colors.text.tertiary} />
                )}
              </Pressable>
            ) : null}
            <Pressable onPress={() => { setReplyTo(null); setEditing(null); inputRef.current?.clear(); }} hitSlop={8}>
              <Feather name="x" size={18} color={theme.colors.text.tertiary} />
            </Pressable>
          </View>
        )}

        {/* Pending image attachments preview */}
        {pendingImages.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
            {pendingImages.map((uri, idx) => (
              <View key={idx} style={{ position: 'relative' }}>
                <CachedImage uri={uri} style={{ width: 60, height: 60, borderRadius: 10 }} resizeMode="cover" />
                <Pressable onPress={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))} style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="x" size={13} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <ChatInputBar
          ref={inputRef}
          isEditing={!!editing}
          hasPendingImages={pendingImages.length > 0}
          onSend={handleSend}
          onPickImages={pickImages}
          onPasteImage={pasteImageFromClipboard}
          onPasteImages={addPastedImages}
          onOpenGif={() => setGifPickerVisible(true)}
          inputRowStyle={inputRowStyle}
        />
      </KeyboardStickyView>
      )}

      {/* Gradient fade header — three stops with a translucent middle so
          content scrolling under the header reads as a soft ghost rather
          than being abruptly clipped by a solid bg slab. The chrome
          (back / name / avatar) sits ON TOP of the gradient, so it stays
          fully readable; only the message list behind it fades through
          the dimming zone. */}
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient
          colors={[bgColor, bgColor + 'B3', bgTransparent]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        {searchMode ? (
          <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
            {glassActive ? (
              <NativeGlassView glassStyle="regular" colorScheme={theme.isDark ? 'dark' : 'light'} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingHorizontal: 14, height: 40 }}>
                <Feather name="search" size={16} color={theme.colors.text.tertiary} />
                <TextInput
                  autoFocus
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={t('chat.search_placeholder')}
                  placeholderTextColor={theme.colors.text.tertiary}
                  style={{ flex: 1, marginLeft: 8, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular }}
                />
                {searchQuery.length > 0 && (
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 12, marginRight: 4 }}>
                    {searchMatches.length > 0 ? `${searchActiveIdx + 1}/${searchMatches.length}` : '0'}
                  </Text>
                )}
              </NativeGlassView>
            ) : (
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 20, borderWidth: 1, borderColor: theme.colors.border.light, paddingHorizontal: 14, height: 40 }}>
                <Feather name="search" size={16} color={theme.colors.text.tertiary} />
                <TextInput
                  autoFocus
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={t('chat.search_placeholder')}
                  placeholderTextColor={theme.colors.text.tertiary}
                  style={{ flex: 1, marginLeft: 8, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular }}
                />
                {searchQuery.length > 0 && (
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 12, marginRight: 4 }}>
                    {searchMatches.length > 0 ? `${searchActiveIdx + 1}/${searchMatches.length}` : '0'}
                  </Text>
                )}
              </View>
            )}
            {searchMatches.length > 0 && (
              <View style={{ flexDirection: 'row', marginLeft: 6 }}>
                {glassActive ? (
                  <Pressable onPress={goToPrevMatch} style={{ borderRadius: 18 }}>
                    <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.headerCircleGlass}>
                      <Feather name="chevron-up" size={18} color={theme.colors.text.primary} />
                    </NativeGlassView>
                  </Pressable>
                ) : (
                  <Pressable onPress={goToPrevMatch} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
                    <Feather name="chevron-up" size={18} color={theme.colors.text.primary} />
                  </Pressable>
                )}
                {glassActive ? (
                  <Pressable onPress={goToNextMatch} style={{ borderRadius: 18, marginLeft: 6 }}>
                    <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.headerCircleGlass}>
                      <Feather name="chevron-down" size={18} color={theme.colors.text.primary} />
                    </NativeGlassView>
                  </Pressable>
                ) : (
                  <Pressable onPress={goToNextMatch} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, marginLeft: 6 }]}>
                    <Feather name="chevron-down" size={18} color={theme.colors.text.primary} />
                  </Pressable>
                )}
              </View>
            )}
            {glassActive ? (
              <Pressable onPress={closeSearch} style={{ borderRadius: 18, marginLeft: 6 }}>
                <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.headerCircleGlass}>
                  <Feather name="x" size={20} color={theme.colors.text.primary} />
                </NativeGlassView>
              </Pressable>
            ) : (
              <Pressable onPress={closeSearch} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, marginLeft: 6 }]}>
                <Feather name="x" size={20} color={theme.colors.text.primary} />
              </Pressable>
            )}
          </View>
        ) : (
          <View style={[styles.headerContent, { paddingTop: insets.top }]} pointerEvents="auto">
            {glassActive ? (
              <Pressable onPress={() => router.back()} style={{ borderRadius: 18 }}>
                <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.headerCircleGlass}>
                  <Feather name="chevron-left" size={22} color={theme.colors.text.primary} />
                </NativeGlassView>
              </Pressable>
            ) : (
              <Pressable onPress={() => router.back()} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
                <Feather name="chevron-left" size={22} color={theme.colors.text.primary} />
              </Pressable>
            )}
            <View style={{ flex: 1, alignItems: 'center' }}>
              {glassActive ? (
                <Pressable
                  onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId, fromChat: '1' } })}
                  onLongPress={openSearch}
                  delayLongPress={300}
                  style={{ borderRadius: 18 }}
                >
                  {/* The name Text + badges are CHILDREN of the interactive
                      glass; with no fixed width the children drive the pill's
                      width and the liquid surface morphs outward on touch. */}
                  <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.headerPillGlass}>
                    <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{displayName}</Text>
                    {displayVerified && <VerifiedBadge size={12} />}
                    {displayBadge && <UserBadge badge={displayBadge} size="sm" />}
                  </NativeGlassView>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId, fromChat: '1' } })}
                  onLongPress={openSearch}
                  delayLongPress={300}
                  style={[styles.headerPill, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}
                >
                  <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{displayName}</Text>
                  {displayVerified && <VerifiedBadge size={12} />}
                  {displayBadge && <UserBadge badge={displayBadge} size="sm" />}
                </Pressable>
              )}
            </View>
            <Pressable onPress={() => router.push({ pathname: '/profile/[id]', params: { id: profileId, fromChat: '1' } })} style={[styles.headerCircle, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, overflow: 'hidden' }]}>
              <Avatar emoji={displayEmoji} name={displayName} size="xs" />
            </Pressable>
          </View>
        )}
      </View>

      {/* Long-press message menu — in-screen overlay (not a native Modal) so it
          can never deadlock with the GIF/image/video modals. High zIndex keeps it
          above the input bar and header. */}
      {!!actionMessage && (
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
          <MessageContextMenu
            ref={menuRef}
            visible={!!actionMessage}
            message={actionMessage}
            isOwn={menuIsOwn}
            bubbleColor={menuIsOwn ? theme.colors.accent.primary : theme.colors.background.tertiary}
            bubbleTextColor={menuIsOwn ? '#FFFFFF' : theme.colors.text.primary}
            bubbleRadius={chatSettings.bubbleRadius}
            linkEmoji={chatSettings.linkEmoji}
            dragActive={dragActiveSV}
            hoveredAction={hoveredActionSV}
            actionZones={actionZonesSV}
            onClose={closeMenu}
            onAction={handleMenuAction}
          />
        </View>
      )}

      {/* GIF picker (GIPHY) */}
      <GiphyPicker visible={gifPickerVisible} onClose={() => setGifPickerVisible(false)} onSelect={sendGif} />

      {/* Translation sheet — opens when the user picks "Translate" from
          the long-press menu. Source text is the message body; target is
          the app's UI locale. */}
      <TranslationSheet
        visible={!!translateText}
        text={translateText}
        onClose={() => setTranslateText('')}
      />

      {/* Fullscreen image viewer */}
      <Modal visible={!!viewerImages} transparent animationType="fade" onRequestClose={() => setViewerImages(null)} statusBarTranslucent>
        <ModalStatusBar />
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' }}>
          <Pressable onPress={() => setViewerImages(null)} style={{ position: 'absolute', top: insets.top + 12, right: 16, zIndex: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="x" size={20} color="#FFFFFF" />
          </Pressable>
          {viewerImages && (
            <FlatList
              data={viewerImages.images}
              horizontal
              pagingEnabled
              initialScrollIndex={viewerImages.index}
              getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
              keyExtractor={(uri, i) => uri + i}
              showsHorizontalScrollIndicator={false}
              style={{ flex: 1 }}
              renderItem={({ item }) => (
                <View style={{ width: SCREEN_WIDTH, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                  <CachedImage uri={item} style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH }} resizeMode="contain" />
                </View>
              )}
            />
          )}
        </View>
      </Modal>
      <ScreenshotShield visible={screenshotDetected} />
      {/* Emoji "dissolve" burst overlay — renders nothing until a delete fires.
          pointerEvents none, native-driver particles. */}
      <EmojiDeleteBurst ref={burstRef} />
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  headerCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  headerPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: 16 },
  // Interactive-glass shape variants: same geometry as the flat chrome but with
  // NO border and NO overflow clipping, so the liquid glass can morph OUTWARD
  // over content on touch. The icon/content lives INSIDE the glass as children.
  headerCircleGlass: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerPillGlass: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 36, borderRadius: 18, paddingHorizontal: 16 },
});
