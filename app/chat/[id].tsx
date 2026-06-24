import React, { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { View, FlatList, TextInput, Pressable, Platform, StyleSheet, Alert, Animated, Modal, Dimensions, Keyboard, InteractionManager, ActivityIndicator, type ViewToken } from 'react-native';
import { useReanimatedKeyboardAnimation, useKeyboardHandler } from 'react-native-keyboard-controller';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import Reanimated, { useAnimatedStyle, interpolate, Extrapolation, useSharedValue, withSpring, withTiming, withSequence, withDelay, runOnJS, useAnimatedRef, measure, Easing, type SharedValue } from 'react-native-reanimated';
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
import { MediaPanel } from '../../src/components/chat/MediaPanel';
import { EmojiDeleteBurst, EmojiBurstHandle } from '../../src/components/chat/EmojiDeleteBurst';
import { getRealtime, chatChannelName } from '../../src/services/realtime/ably';
import { useContextMenuGuard } from '../../src/hooks/useContextMenuGuard';
import { useChatStore, useEntityStore, useConnectivityStore, useAuthStore } from '../../src/store';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY, DEFAULT_CHAT_SETTINGS } from '../../src/store/chatSettingsStore';
import { readableTextOn, withOpacity } from '../../src/constants/bubbleColors';
import { useMessageGestures } from '../../src/hooks/useMessageGestures';
import { useChatKeyboardMode } from '../../src/hooks/useChatKeyboardMode';
import { useStaggeredReveal, useStaggeredGifReveal, setRevealScrollPaused } from '../../src/hooks/useStaggeredReveal';
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
import { getRecentEmoji, pushRecentEmoji } from '../../src/services/recentEmoji';
import { getRecentGif, pushRecentGif } from '../../src/services/recentGif';
import { playSendSound } from '../../src/utils/sounds';
import { GiphyItem } from '../../src/services/giphy';
import { useT } from '../../src/i18n/store';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useLiquidGlassActive, NativeGlassView, GlassBg } from '../../src/components/ui/LiquidGlass';
import { useScreenCaptureGuard } from '../../src/hooks/useScreenCaptureGuard';
import { ScreenshotShield } from '../../src/components/ui/ScreenshotShield';

const REPLY_THRESHOLD = 60;
const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;

// ── Telegram-style windowed message loading ───────────────────────────────
// Very long conversations must NOT mount/parse their whole history on open.
// We render only the most-recent `INITIAL_WINDOW` messages and grow the
// window by `WINDOW_CHUNK` as the user scrolls toward the top (which, on an
// INVERTED list, is `onEndReached`). `SEED_CAP` bounds the synchronous
// first-paint parse — the full history is still hydrated into the store off
// the critical path so scroll-up and reply-jump to old messages keep working.
const INITIAL_WINDOW = 40;
const WINDOW_CHUNK = 40;
const SEED_CAP = 60;

// How many of the most-recent messages the chat-open warm prefetches. Bounded
// low (the first screen is only a handful of bubbles) so opening a chat never
// front-loads a burst of image fetches onto the navigation frame. The rest
// stream in lazily on scroll. Was 20 — too many, and a measurable contributor
// to the open-the-chat decode burst.
const WARM_RECENT = 6;

// Detect an animated GIF by URL. Mirrors the `hasGif` test used by the
// visibility tracker so the warm path and the off-screen-pause path agree on
// what counts as a "heavy animated decode". Animated GIFs are excluded from the
// chat-open warm (they should only ever decode when actually visible).
function isAnimatedImageUrl(u: string): boolean {
  if (!u) return false;
  const low = u.toLowerCase();
  const q = low.indexOf('?');
  const path = q >= 0 ? low.slice(0, q) : low;
  return path.endsWith('.gif') || low.indexOf('giphy') !== -1;
}

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
  // `flexShrink:1 + minWidth:0` (NOT `flex:1`) so the reply preview contributes
  // its INTRINSIC width to the bubble's column: a short message replying to a
  // long one expands the bubble to fit the preview (capped by the bubble's 78%
  // maxWidth), and the one-line reply texts ellipsize at that max width instead
  // of being cut to the narrow message-content width. `minWidth:0` lets the
  // child shrink below its content size so the ellipsis kicks in cleanly.
  replyTextWrap: { flexShrink: 1, minWidth: 0 },
  replyAvatar: { width: 30, height: 30, borderRadius: 6 },
  replyPixel: { borderRadius: 6 },
  replyHeading: { fontSize: 11 },
  replyBody: { fontSize: 11 },
  imagesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  imageSingle: { width: 200, height: 200, borderRadius: 12 },
  // Placeholder box shown for a single-image bubble until `imagesReady` flips
  // (just after the open transition). Sized to `SingleChatImage`'s OWN initial
  // square (220×220) so when the real image mounts it occupies the exact same
  // box — the list never jumps. Once loaded, `SingleChatImage` snaps to the
  // photo's aspect ratio exactly as before.
  imageSinglePlaceholder: { width: 220, height: 220, borderRadius: 12 },
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
  const [loading, setLoading] = useState(true);
  const handleLoad = useCallback((e: any) => {
    setLoading(false);
    const s = e?.source;
    if (!s?.width || !s?.height) return;
    const ar = s.width / s.height;
    let w = CHAT_IMG_MAX_W;
    let h = Math.round(w / ar);
    if (h > CHAT_IMG_MAX_H) { h = CHAT_IMG_MAX_H; w = Math.round(h * ar); }
    setSize({ w, h });
  }, []);
  const handleError = useCallback(() => setLoading(false), []);
  return (
    <Pressable onPress={onPress}>
      {/* Fixed-size rounded container holds the image AND a centered loading
          spinner overlay. The image fills the container (100%×100%) so while it
          uploads/decodes the user sees a spinner over a neutral tile instead of
          a blank box, and there is no second "reload" flash. The container
          still snaps from the neutral square to the photo's real aspect ratio
          once dimensions are known — but the spinner makes that read as
          "loading", which is exactly the affordance requested. */}
      <View style={{ width: size.w, height: size.h, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.background.tertiary }}>
        <CachedImage
          uri={uri}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          proxyWidth={CHAT_IMG_MAX_W}
          priority="low"
          autoplay={isVisible}
          onLoad={handleLoad}
          onError={handleError}
        />
        {loading ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="small" color={theme.colors.accent.primary} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function MessageBubble({ message, isOwn, fontSize, bubbleRadius, fontFamily, linkEmoji, bubbleColors, bubbleOpacity, bubbleTextColor, inColors, inOpacity, inTextColor, highlighted, isVisible, imagesReady, onReply, onReplyJump, onLongPress, onMeasured, onSwipeActive, onImagePress, dragActive, dragFingerY, hoveredAction, actionZones, onFireDragAction }: { message: ChatMessage; isOwn: boolean; fontSize: number; bubbleRadius: number; fontFamily: string; linkEmoji?: string; bubbleColors: string[]; bubbleOpacity: number; bubbleTextColor: string; inColors: string[]; inOpacity: number; inTextColor: string; highlighted?: boolean; isVisible?: boolean; imagesReady?: boolean; onReply: (m: ChatMessage) => void; onReplyJump?: (messageId?: string) => void; onLongPress: (m: ChatMessage) => void; onMeasured?: (id: string, x: number, y: number, w: number, h: number) => void; onSwipeActive: (active: boolean) => void; onImagePress: (images: string[], index: number) => void; dragActive: SharedValue<boolean>; dragFingerY: SharedValue<number>; hoveredAction: SharedValue<string>; actionZones: SharedValue<ActionZone[]>; onFireDragAction: (m: ChatMessage, action: string) => void }) {
  const theme = useTheme();
  const t = useT();
  // Resolve THIS bubble's fill from the per-side style. Outgoing always has a
  // colored fill (custom or theme accent). Incoming is the neutral tertiary
  // surface UNLESS the user set a custom incoming color/gradient. A gradient
  // renders as an absolutely-positioned LinearGradient behind the content
  // (opt-in — solid bubbles never mount one). `coloredBubble` gates whether
  // text/reply/timestamp use the contrast-picked tint vs. the theme defaults.
  let fillColors: string[];
  let fillOpacity: number;
  let sideTextColor: string;
  let coloredBubble: boolean;
  if (isOwn) {
    fillColors = bubbleColors.length ? bubbleColors : [theme.colors.accent.primary];
    fillOpacity = bubbleOpacity;
    sideTextColor = bubbleTextColor;
    coloredBubble = true;
  } else if (inColors.length > 0) {
    fillColors = inColors;
    fillOpacity = inOpacity;
    sideTextColor = inTextColor;
    coloredBubble = true;
  } else {
    fillColors = [theme.colors.background.tertiary];
    fillOpacity = 1;
    sideTextColor = theme.colors.text.primary;
    coloredBubble = false;
  }
  const isGradient = fillColors.length > 1;
  const solidBg = withOpacity(fillColors[0], fillOpacity);
  const gradFill = isGradient ? fillColors.map((c) => withOpacity(c, fillOpacity)) : null;
  const sideTextStrong = sideTextColor === '#FFFFFF' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)';
  const sideTextDim = sideTextColor === '#FFFFFF' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';
  const sideTextFaint = sideTextColor === '#FFFFFF' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)';
  // Reply/heading/body/link/timestamp colors: contrast tint on a colored
  // bubble, theme defaults on the neutral incoming surface.
  const replyBorderColor = coloredBubble ? sideTextDim : theme.colors.accent.primary;
  const replyHeadingColor = coloredBubble ? sideTextStrong : theme.colors.accent.primary;
  const replyBodyColor = coloredBubble ? sideTextDim : theme.colors.text.tertiary;
  const bodyTextColor = coloredBubble ? sideTextColor : theme.colors.text.primary;
  const linkTextColor = coloredBubble ? sideTextColor : theme.colors.accent.primary;
  const timeColor = coloredBubble ? sideTextFaint : theme.colors.text.tertiary;
  // Native iOS-26 liquid glass for the swipe-to-reply pill. iOS-only + opt-in.
  const glassActive = useLiquidGlassActive();
  const fontFamilyStyle = fontFamily === 'mono' ? 'monospace' : fontFamily === 'serif' ? 'serif' : undefined;

  // Swipe-to-reply + press-drag-select gestures and the reply-jump glow are
  // wired by useMessageGestures (extracted for maintainability + testing).
  // Behaviour is identical to the previous inline implementation.
  const { bubbleRef, composedGesture, glowStyle, bubbleAnimStyle, replyIconAnimStyle } = useMessageGestures({
    message,
    highlighted,
    onReply,
    onSwipeActive,
    onLongPress,
    onMeasured,
    onFireDragAction,
    dragActive,
    dragFingerY,
    hoveredAction,
    actionZones,
  });

  // Frame-paced reveal of this bubble's image(s): once the screen flips
  // `imagesReady`, image bubbles no longer all decode on the SAME frame —
  // each waits its turn in a shared one-per-frame queue, so a GIF-heavy chat
  // opening no longer lands ~10 simultaneous decodes as one long task.
  //
  // Animated GIFs additionally go through a WIDER-spaced reveal pump
  // (`useStaggeredGifReveal`): a static photo decodes once and cheaply, but an
  // animated GIF's first decode is ~100-180 ms on weak Android, so spacing GIF
  // reveals only one frame apart still stacks 5-8 overlapping decodes into the
  // recurring ~500 ms long task the perf monitor flagged. The GIF pump spaces
  // decode STARTS wider than one decode takes (≈2 concurrent max) while photos
  // keep the unchanged 1/frame pump. GIFs are always single-image bubbles
  // (sent as `imageUrls:[url]`), but we test every url so a mixed bubble still
  // takes the heavier-gated path. Both hooks are always called (rules of hooks).
  const hasImages = !!(message.imageUrls && message.imageUrls.length > 0);
  const isGifBubble = hasImages && message.imageUrls!.some(isAnimatedImageUrl);
  const photoReveal = useStaggeredReveal(!!imagesReady && hasImages && !isGifBubble);
  const gifReveal = useStaggeredGifReveal(!!imagesReady && hasImages && isGifBubble);
  const imgReveal = isGifBubble ? gifReveal : photoReveal;

  return (
    <View style={bubbleStyles.row}>
      <Reanimated.View style={[bubbleStyles.swipeIcon, replyIconAnimStyle]}>
        {/* Swipe-to-reply icon. Intentionally NOT a NativeGlassView: a glass
            view is a UIVisualEffectView, one of the most expensive native views
            to instantiate, and mounting one PER BUBBLE (this icon exists on
            every message row, just hidden until a swipe) made every row that
            scrolled into view pay that cost on the scroll frame — a primary
            cause of the per-message scroll freeze. The icon is a tiny circle
            shown only mid-swipe, so a flat tinted circle is visually
            indistinguishable and costs ~nothing to mount. */}
        <View style={[bubbleStyles.swipeIconCircle, { backgroundColor: theme.colors.accent.primary + '20' }]}>
          <Feather name="corner-up-left" size={16} color={theme.colors.accent.primary} />
        </View>
      </Reanimated.View>

      <GestureDetector gesture={composedGesture}>
        <Reanimated.View ref={bubbleRef} style={[bubbleAnimStyle, { alignSelf: isOwn ? 'flex-end' : 'flex-start', maxWidth: '78%', marginLeft: isOwn ? 0 : 16, marginRight: isOwn ? 16 : 0, marginBottom: 4 }]}>
        {/* Long-press + drag-select is handled by `composedGesture` on the
            GestureDetector above (UI thread). This wrapper used to be a
            `Pressable onLongPress`; it's now a plain View so the gesture owns
            the hold. A quick tap still falls through to inner Pressables
            (image → viewer), and the menu's own buttons keep tap-to-select. */}
        <View>
          {/* Reply-jump glow — absolute sibling BEHIND the bubble. Negative
              inset + position:absolute means it adds zero layout, so the bubble
              never moves/resizes when highlighted. */}
          <Reanimated.View
            pointerEvents="none"
            style={[
              glowStyle,
              {
                position: 'absolute',
                top: -3, left: -3, right: -3, bottom: -3,
                borderRadius: bubbleRadius + 3,
                borderBottomRightRadius: (isOwn ? 4 : bubbleRadius) + 3,
                borderBottomLeftRadius: (isOwn ? bubbleRadius : 4) + 3,
                backgroundColor: theme.colors.accent.primary + (theme.isDark ? '40' : '33'),
                // iOS soft colored glow (Android ignores colored shadows; the
                // tinted halo above carries the effect there instead).
                shadowColor: theme.colors.accent.primary,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.9,
                shadowRadius: 10,
              },
            ]}
          />
          <View style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: bubbleRadius,
            backgroundColor: isGradient ? 'transparent' : solidBg,
            borderBottomRightRadius: isOwn ? 4 : bubbleRadius,
            borderBottomLeftRadius: isOwn ? bubbleRadius : 4,
            overflow: isGradient ? 'hidden' : undefined,
          }}>
            {isGradient && gradFill ? (
              <LinearGradient
                colors={gradFill as any}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
            ) : null}
            {message.replyToText || message.replyToImage || message.replyPixelIconId ? (
              <Pressable
                onPress={() => onReplyJump?.(message.replyToId)}
                style={[bubbleStyles.replyBlock, { borderLeftColor: replyBorderColor }]}
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
                  <Text variant="caption" weight="semibold" color={replyHeadingColor} numberOfLines={1} style={bubbleStyles.replyHeading}>
                    {message.replyToIsOwn ? t('chat.you') : t('chat.peer')}
                  </Text>
                  <Text variant="caption" color={replyBodyColor} numberOfLines={1} style={bubbleStyles.replyBody}>
                    {message.replyToText || (message.replyToImage ? t('chat.photo') : '')}
                  </Text>
                </View>
              </Pressable>
            ) : null}
            {message.imageUrls && message.imageUrls.length > 0 ? (
              <View style={[bubbleStyles.imagesRow, { marginBottom: message.text ? 6 : 0 }]}>
                {message.imageUrls.length === 1 ? (
                  // Telegram-style deferred decode: until `imagesReady` flips
                  // (one beat AFTER the open transition), render a correctly-
                  // sized placeholder box instead of the real image, so the
                  // navigation frame mounts only text/layout — never a burst of
                  // synchronous image decodes. The placeholder matches
                  // `SingleChatImage`'s initial square so the list doesn't jump
                  // when the real image swaps in. `imgReveal` adds a frame-paced
                  // stagger so multiple image bubbles don't all decode at once.
                  imgReveal ? (
                    <SingleChatImage
                      uri={message.imageUrls[0]}
                      isVisible={isVisible}
                      onPress={() => onImagePress(message.imageUrls!, 0)}
                    />
                  ) : (
                    <Pressable onPress={() => onImagePress(message.imageUrls!, 0)}>
                      <View style={[bubbleStyles.imageSinglePlaceholder, { backgroundColor: theme.colors.background.tertiary }]} />
                    </Pressable>
                  )
                ) : (
                  message.imageUrls.map((uri, idx) => (
                    <Pressable key={idx} onPress={() => onImagePress(message.imageUrls!, idx)}>
                      {imgReveal ? (
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
                      ) : (
                        // Same-sized placeholder until the open transition
                        // settles — keeps the multi-image grid layout identical
                        // while deferring the decode storm off the nav frame.
                        <View style={[bubbleStyles.imageMulti, { backgroundColor: theme.colors.background.tertiary }]} />
                      )}
                    </Pressable>
                  ))
                )}
              </View>
            ) : null}
            {message.text ? (
              <FormattedText color={bodyTextColor} linkColor={linkTextColor} style={{ fontSize, fontFamily: fontFamilyStyle }}>{message.text}</FormattedText>
            ) : null}
            {(() => {
              const link = (!message.imageUrls || message.imageUrls.length === 0) ? extractFirstUrl(message.text) : null;
              return link ? (
                <View style={bubbleStyles.linkPreviewWrap}>
                  <LinkPreview
                    url={link}
                    textColor={coloredBubble ? sideTextColor : undefined}
                    emoji={linkEmoji}
                  />
                </View>
              ) : null;
            })()}
            <Text variant="caption" color={timeColor} style={bubbleStyles.timestamp}>
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
    prev.bubbleColors.join(',') === next.bubbleColors.join(',') &&
    prev.bubbleOpacity === next.bubbleOpacity &&
    prev.bubbleTextColor === next.bubbleTextColor &&
    prev.inColors.join(',') === next.inColors.join(',') &&
    prev.inOpacity === next.inOpacity &&
    prev.inTextColor === next.inTextColor &&
    prev.highlighted === next.highlighted &&
    prev.isVisible === next.isVisible &&
    prev.imagesReady === next.imagesReady
  );
});

// Per-row visibility tracker — a tiny external store that replaces the
// `visibleIds`/`viewabilityReady` component state. See `visTrackerRef` in
// ChatScreen for construction.
type VisibilityTracker = {
  // Per-ROW subscription (keyed by message id) so a scroll-pause toggle can
  // notify ONLY the affected rows and, crucially, resume GIFs ONE AT A TIME
  // when the list settles (see the staggered-resume pump in ChatScreen).
  subscribeRow: (id: string, listener: () => void) => () => void;
  isVisible: (id: string) => boolean;
  update: (next: Set<string>) => void;
  // Pause/resume animation globally while the list is actively scrolling — a
  // screenful of animated GIFs decoding every frame DURING a scroll/fling is
  // what tanked UI fps on weak devices.
  setScrolling: (b: boolean) => void;
  // Register/unregister a row as containing an animated image (GIF). The
  // scroll-pause gate ONLY affects registered rows, so toggling `scrolling`
  // re-renders just the GIF bubbles — text/photo bubbles keep a stable
  // `isVisible` snapshot and `useSyncExternalStore` bails them out (no
  // re-render), which is what removes the scroll-start hitch.
  setHasGif: (id: string, hasGif: boolean) => void;
};

// Thin wrapper that subscribes ONLY this row to the visibility tracker, so a
// viewability change re-renders just the bubbles whose on-screen state flips
// instead of churning `renderItem`'s identity (which previously listed
// `visibleIds`/`viewabilityReady` in its deps and forced FlatList to re-run
// for every mounted cell on every viewability event mid-scroll).
// `useSyncExternalStore` returns a boolean snapshot, so it bails out for rows
// whose visibility is unchanged. Behaviour is identical to the old
// `isVisible={!viewabilityReady || visibleIds.has(id)}`: the tracker reports
// everything visible until the first viewable set lands.
type VisibilityBubbleProps = Omit<React.ComponentProps<typeof MemoMessageBubble>, 'isVisible'> & {
  tracker: VisibilityTracker;
};
const VisibilityBubble = React.memo(function VisibilityBubble({ tracker, ...rest }: VisibilityBubbleProps) {
  const id = rest.message.id;
  // Per-row subscription: bind this row's id to the tracker so scroll-pause /
  // staggered-resume can notify just this row. Stable per id so the store
  // subscription isn't torn down on every render.
  const subscribeRow = useCallback((cb: () => void) => tracker.subscribeRow(id, cb), [tracker, id]);
  const isVisible = useSyncExternalStore(subscribeRow, () => tracker.isVisible(id));
  // Does this row contain an animated image (GIF)? Only such rows need to
  // react to the scroll-pause gate, so we register them with the tracker. A
  // text/photo bubble registers `false` and is therefore never re-rendered
  // when scrolling toggles (its `isVisible` snapshot is unaffected) — this is
  // what keeps scroll-start hitch-free on content-heavy chats.
  const hasGif = useMemo(() => {
    const urls = rest.message.imageUrls;
    if (!urls || urls.length === 0) return false;
    return urls.some((u) => {
      const low = u.toLowerCase();
      const q = low.indexOf('?');
      const path = q >= 0 ? low.slice(0, q) : low;
      return path.endsWith('.gif') || low.indexOf('giphy') !== -1;
    });
  }, [rest.message.imageUrls]);
  useEffect(() => {
    tracker.setHasGif(id, hasGif);
    return () => tracker.setHasGif(id, false);
  }, [id, hasGif, tracker]);
  return <MemoMessageBubble isVisible={isVisible} {...rest} />;
});

export default function ChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Android: while focused, stop the OS window resize so ONLY this screen's
  // existing JS-driven lift moves content (kills the first-focus jump).
  // Purely additive — does not touch the input-bar lift/swallow, liftSV/
  // panelSlide, MediaPanel slide, or message-bubble gestures. No-op on iOS.
  useChatKeyboardMode();
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
  // Float this chat to the top of the messages list when opened. We stamp the
  // open time in the persisted chat-settings store (kept separate from the
  // conversation's lastMessageAt so a sync can't clobber it); the messages
  // list sorts by max(lastMessageAt, openedAt). Stamps on mount (route id) and
  // again once the canonical conversationId resolves (profile-entry path), so
  // whichever id the list row uses gets bumped.
  //
  // Deferred past the navigation transition. `markChatOpened` writes
  // `openedAt[conversationId]` into the persisted chat-settings store, and the
  // STILL-MOUNTED (tabs)/messages tab subscribes to `openedAt` (it's a
  // dependency of the conversation-list `filtered`/sort memo). Firing this
  // synchronously on chat mount re-filtered + re-sorted the whole conversation
  // list, re-rendered its FlatList and ran the MMKV persist write — all on the
  // chat-open slide-in frame, which is the dominant `LONG ~150 ms @
  // (tabs)/messages` the perf monitor flagged on every chat open. Pushing it
  // behind `runAfterInteractions` lands the bump (and the resulting list
  // re-sort) one beat AFTER the transition completes — imperceptible to the
  // user, the chat still floats to the top exactly as before, and it matches
  // the deferral chat/ai.tsx + chat/music.tsx already apply to their
  // `markOpened` writes for the same reason.
  useEffect(() => {
    if (!conversationId) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      try { useChatSettingsStore.getState().markChatOpened(conversationId); } catch {}
    });
    return () => handle.cancel();
  }, [conversationId]);
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
  // Defer the message-list mount itself past the open slide-in. Mounting the
  // FlatList + its first batch of HEAVY bubbles (each carries gestures +
  // several Reanimated layers) on the navigation frame is the dominant
  // ~150-190 ms `LONG @ (tabs)/messages` long task that fires on EVERY chat
  // open (perf snapshots). Holding the list back one InteractionManager tick
  // lets the slide-in animation complete smoothly, THEN mounts the list — the
  // heavy work no longer lands on the transition frame, so opening a chat no
  // longer freezes. The keyboard/composer chrome stays mounted immediately so
  // the screen never looks empty-broken; only the scrollback defers ~1 frame.
  const [listReady, setListReady] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setListReady(true));
    return () => handle.cancel();
  }, []);

  // ── Telegram-style deferred image decode (open-frame protection) ───────
  // On open, message bubbles render TEXT + correctly-sized placeholder boxes
  // only — no `CachedImage`, so the navigation transition frame never fires a
  // burst of concurrent image decodes (the i.ytimg / r2.dev / giphy / file
  // cluster the perf snapshot caught landing right after `NAV chat/[id]`).
  // Once the open transition has settled we flip `imagesReady`, and the
  // mounted bubbles swap their placeholders for the real images a beat later —
  // off the critical frame. The extra RAF after `runAfterInteractions`
  // guarantees the first text-only layout has committed before we mount the
  // decode-heavy images, so the work can never share the transition frame.
  const [imagesReady, setImagesReady] = useState(false);
  useEffect(() => {
    let raf = 0;
    const handle = InteractionManager.runAfterInteractions(() => {
      raf = requestAnimationFrame(() => setImagesReady(true));
    });
    return () => { handle.cancel(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  const [viewerImages, setViewerImages] = useState<{ images: string[]; index: number } | null>(null);
  // ── Inline emoji / GIF panels ─────────────────────────────────────────────
  // `emojiOpen` / `gifOpen` drive the two docked panels (mutually exclusive),
  // and the composer's GIF↔keyboard icon swap. `keepLifted` keeps the input bar
  // lifted while the keyboard rises BACK after a panel closes, so the bar never
  // drops to the bottom and snaps up. The panel height tracks the last real
  // keyboard height (captured below). Both panels share the SAME lift mechanism.
  const [panelTab, setPanelTab] = useState<'emoji' | 'gif' | null>(null);
  // Derived booleans so all existing references keep working unchanged.
  const emojiOpen = panelTab === 'emoji';
  const gifOpen = panelTab === 'gif';
  const [recentEmoji, setRecentEmoji] = useState<string[]>(() => getRecentEmoji());
  const [recentGif, setRecentGif] = useState<GiphyItem[]>(() => getRecentGif());
  const [keepLifted, setKeepLifted] = useState(false);
  const [emojiPanelHeight, setEmojiPanelHeight] = useState(300);
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
  const flatListRef = useRef<FlashListRef<ChatMessage>>(null);
  const inputRef = useRef<ChatInputBarHandle>(null);
  // Retry counter shared by every programmatic scroll-to-index path (reply
  // jump + search jump). `onScrollToIndexFailed` backs off with an increasing
  // delay using this, and each jump resets it to 0 before issuing the scroll.
  const jumpAttemptRef = useRef(0);

  const { progress, height: keyboardHeight } = useReanimatedKeyboardAnimation();

  // Last real keyboard height — captured at the end of each keyboard-open
  // settle (see `useKeyboardHandler.onEnd` below) so the emoji panel can match
  // the exact space the keyboard vacated. Falls back to ~300 if the keyboard
  // never opened in this session.
  const lastKbHeightRef = useRef(0);
  const captureKbHeight = useCallback((h: number) => {
    if (h > 1) lastKbHeightRef.current = h;
  }, []);
  // UI-thread mirrors of the panel state used by the animated styles below.
  // `liftSV` = 1 while the input bar must stay lifted above the panel (panel
  // open OR keyboard re-rising after a close). `emojiPanelSV` carries the
  // panel height so the list shift can match it on the UI thread.
  const liftSV = useSharedValue(0);
  const emojiPanelSV = useSharedValue(300);

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
      if (cached.length > 0) {
        // First-paint parse bound: heal only the most-recent `SEED_CAP`
        // messages (the cache is oldest→newest, so the tail is newest). The
        // FULL history is hydrated into the store off the critical path (see
        // the deferred effect below), so scroll-up and reply-jump to older
        // messages still work — we just don't parse/hold all of it on the
        // open-the-chat frame.
        const tail = cached.length > SEED_CAP ? cached.slice(cached.length - SEED_CAP) : cached;
        return tail.map((m) => healLegacySender(m, currentUserId, participantId));
      }
      if (mockMessages[conversationId]) return mockMessages[conversationId] as ChatMessage[];
    } catch {}
    return [];
  }, [conversationId, currentUserId, participantId]);

  // Use the store value when present, else the synchronous seed — so the list is
  // never empty on the first frame if a cache exists.
  const storeChat = (myStoreMessages || []) as ChatMessage[];
  const chatMessages = storeChat.length > 0 ? storeChat : seedMessages;

  // ── Lazy full-history hydration ────────────────────────────────────────
  // The open path deliberately holds only the bounded `SEED_CAP` tail (see
  // `seedMessages`) so a very long chat never parses + heals + reverses its
  // ENTIRE history on the navigation frame (the ~571 ms long task). The full
  // history is pulled from cache ON DEMAND the first time the user actually
  // needs it: scrolling toward the top (`onEndReached`), a reply-jump or
  // search-jump that targets a message older than the loaded window, or the
  // first mutation that must be persisted safely. Once hydrated it stays
  // hydrated for the session.
  //
  // `historyHydratedRef` records the conversation whose full history is in the
  // store. `seededArrayRef` records the exact bounded-seed array we pushed, so
  // the persistence effect can tell "untouched seed" (already on disk — skip)
  // from "store diverged" (a real change — hydrate the full array so the
  // mirror can't truncate the older history still on disk).
  const historyHydratedRef = useRef<string | null>(null);
  const seededArrayRef = useRef<ChatMessage[] | null>(null);
  const hydrateFullHistory = useCallback((): ChatMessage[] | null => {
    if (!conversationId) return null;
    if (historyHydratedRef.current === conversationId) return null;
    let full: ChatMessage[];
    try {
      full = kvGetJSONSync<ChatMessage[]>(`chat_messages:${conversationId}`, []);
    } catch {
      return null;
    }
    historyHydratedRef.current = conversationId;
    if (full.length === 0) return null;
    const healed = full.map((m) => healLegacySender(m, currentUserId, participantId));
    // Merge any in-store messages the cache doesn't have yet (optimistic
    // sends / realtime appends / edits that happened since open) so hydration
    // never DROPS them: existing ids are overwritten in place (keep the latest
    // edit), unknown ids are appended (they're always newer → correct order on
    // an oldest→newest array).
    const store = useChatStore.getState().messages[conversationId] || [];
    if (store.length > 0) {
      const idx = new Map(healed.map((m, i) => [m.id, i] as const));
      for (const sm of store as ChatMessage[]) {
        const at = idx.get(sm.id);
        if (at === undefined) { healed.push(sm); idx.set(sm.id, healed.length - 1); }
        else { healed[at] = sm; }
      }
    }
    setMessages(conversationId, healed as any);
    return healed;
  }, [conversationId, currentUserId, participantId, setMessages]);
  // Always-current ref so handlers living in long-lived subscription effects
  // (e.g. the Ably `msg.delete` listener) can invoke the latest hydrator
  // without being added to those effects' dep arrays (which would churn the
  // channel subscription).
  const hydrateFullHistoryRef = useRef(hydrateFullHistory);
  hydrateFullHistoryRef.current = hydrateFullHistory;

  // Push the bounded SEED into the store once (after paint) so edits/sends
  // work normally. We deliberately seed ONLY the `SEED_CAP` tail here — NOT
  // the full history — so opening a long chat never parses/heals/holds the
  // whole conversation on (or just after) the navigation frame. The full
  // history is hydrated lazily on demand (scroll-up / reply-jump / search /
  // first persist) via `hydrateFullHistory`. First-paint content is already
  // provided by `seedMessages` (read directly into `chatMessages` above when
  // the store is empty), so this store push is invisible.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId) return;
    if (seededRef.current === conversationId) return;
    seededRef.current = conversationId;
    const handle = InteractionManager.runAfterInteractions(() => {
      if ((useChatStore.getState().messages[conversationId] || []).length === 0) {
        if (seedMessages.length > 0) {
          // Remember the exact seed array reference so the persistence effect
          // can distinguish "untouched seed" (skip — already on disk) from a
          // genuine divergence that must trigger a safe full-history mirror.
          seededArrayRef.current = seedMessages;
          setMessages(conversationId, seedMessages as any);
        }
      }
    });
    return () => handle.cancel();
  }, [conversationId, seedMessages, setMessages]);

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

  // Outgoing-message style: a user-chosen solid/gradient + opacity (app-wide)
  // or the theme accent when unset (default). Memoized into stable arrays so
  // MemoMessageBubble re-renders only when the style actually changes.
  const chatBubble = useSettingsStore((s) => s.chatBubble);
  const chatBubbleIn = useSettingsStore((s) => s.chatBubbleIn);
  const bubbleColors = useMemo<string[]>(
    () => (chatBubble && chatBubble.colors.length > 0 ? chatBubble.colors : [theme.colors.accent.primary]),
    [chatBubble, theme.colors.accent.primary],
  );
  const bubbleOpacity = chatBubble?.opacity ?? 1;
  const bubbleTextColor = chatBubble && chatBubble.colors.length > 0 ? readableTextOn(chatBubble.colors) : '#FFFFFF';
  const bubbleColorsKey = bubbleColors.join(',');
  // Incoming side: empty array = neutral default surface (no custom color).
  const inColors = useMemo<string[]>(
    () => (chatBubbleIn && chatBubbleIn.colors.length > 0 ? chatBubbleIn.colors : []),
    [chatBubbleIn],
  );
  const inOpacity = chatBubbleIn?.opacity ?? 1;
  const inTextColor = inColors.length > 0 ? readableTextOn(inColors) : theme.colors.text.primary;
  const inColorsKey = inColors.join(',');

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
  const inputRowStyle = useAnimatedStyle(() => {
    const base = interpolate(progress.value, [0, 1], [inputBarBottomPad, 8], Extrapolation.CLAMP);
    // While the emoji panel holds the bar lifted (keyboard down), keep the
    // small open-state padding so the bar doesn't gain the safe-area padding
    // back and visually shift. Purely additive — no effect when liftSV === 0.
    return { paddingBottom: liftSV.value > 0.5 ? 8 : base };
  });

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

  // ── Input-bar lift: robust max() of keyboard height and panel height ──
  // The bar's distance from the screen bottom = max(liveKeyboardHeight,
  // panelLiftHeight). Because it's a MAX of the two, the bar position is
  // MONOTONIC across the keyboard↔panel handoff — it can never dip and snap
  // back, which is exactly the "jump to the top / settle" the spacer approach
  // suffered from (that relied on two animations cancelling frame-for-frame).
  //   • Typing:        kb≈300, panelLift=0      → lift=300 (sits on keyboard)
  //   • Open emoji:    kb 300→0, panelLift=300  → lift stays 300 (no move)
  //   • Back to kb:    kb 0→300, panelLift=300  → lift stays 300 (no move)
  // `keyboardHeight` from useReanimatedKeyboardAnimation animates smoothly on
  // the UI thread (same source KeyboardStickyView used), so the follow is just
  // as smooth — we simply read it ourselves to fold in the max().
  const barWrapStyle = useAnimatedStyle(() => {
    const raw = keyboardHeight.value;
    const kb = raw < 0 ? -raw : raw; // library reports height as 0 → -kbHeight
    const panelLift = liftSV.value * emojiPanelSV.value;
    const lift = Math.max(kb, panelLift);
    // Browser-band compensation: historically the sticky view pushed the bar
    // DOWN by the band height while the keyboard was open (the chat screen
    // bottom sits `band` px above the real screen bottom). Preserve that.
    const band = kb > 1 ? stickyOpenedOffset : 0;
    return { transform: [{ translateY: -(lift - band) }] };
  });

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
        // Capture the settled keyboard height (once per transition) so the
        // emoji panel can match it. Guarded to ignore the close (height 0).
        runOnJS(captureKbHeight)(e.height);
      },
    },
    [],
  );
  const listShiftStyle = useAnimatedStyle(() => ({
    // While the emoji panel is up (or the keyboard is rising back after a
    // close), shift the list by the panel height instead of the live keyboard
    // height so the newest messages stay visible above the panel. We blend the
    // two with min() (both are ≤ 0) so the list rises in lock-step with the bar
    // during the animated open (keyboard-down case) instead of snapping at a
    // 0.5 threshold. Additive: when liftSV === 0 this is exactly the original
    // keyboard-driven shift.
    transform: [{ translateY: Math.min(listShiftY.value, -liftSV.value * emojiPanelSV.value) }],
  }));

  // Slide the media panel itself up/down in sync with the bar lift. At
  // liftSV === 0 it is pushed fully below the screen (translateY = +panelH);
  // at liftSV === 1 it rests in place (translateY = 0). In the keyboard-down
  // open case liftSV animates 0→1 so the panel rises smoothly with the bar; in
  // the keyboard-up case liftSV is set to 1 instantly so the panel already
  // sits in place and the keyboard's descent reveals it (no double-animation).
  const panelSlideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - liftSV.value) * emojiPanelSV.value }],
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

  // ── Emoji panel control ───────────────────────────────────────────────
  // Visible gap (px) between the input bar and the top of the emoji panel.
  const EMOJI_GAP = 8;

  // Keep the UI-thread lift mirror in sync with the JS panel state.
  // IMPORTANT: when a panel is OPENING, the rise is owned by openEmoji/openGif
  // (they may animate liftSV 0→1 for a smooth rise when the keyboard is down).
  // This effect must NOT clobber that animation by force-setting liftSV = 1.
  // It only (a) re-arms the lift while returning to the keyboard (keepLifted)
  // and (b) animates the lift back down on a full close.
  useEffect(() => {
    if (emojiOpen || gifOpen || keepLifted) {
      if (keepLifted) liftSV.value = 1;
    } else {
      liftSV.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
    }
  }, [emojiOpen, gifOpen, keepLifted, liftSV]);
  // While returning to the keyboard, hold the bar lifted until the keyboard
  // has actually risen — then release the lift with no jump (at that point the
  // sticky view is fully keyboard-driven). Safety timeout in case the show
  // event never fires (e.g. focus race).
  useEffect(() => {
    if (!keepLifted) return;
    const sub = Keyboard.addListener('keyboardDidShow', () => setKeepLifted(false));
    const tid = setTimeout(() => setKeepLifted(false), 650);
    return () => { sub.remove(); clearTimeout(tid); };
  }, [keepLifted]);

  // Open the panel: snapshot the panel height from the last real keyboard
  // height, lift the bar (via stickyOffset/liftSV), then dismiss the keyboard.
  // The keyboard slides down to REVEAL the panel already sitting beneath it.
  const openEmoji = useCallback(() => {
    const h = lastKbHeightRef.current > 0 ? lastKbHeightRef.current : 300;
    emojiPanelSV.value = h;
    setEmojiPanelHeight(h);
    setKeepLifted(false);
    // Mount the panel NOW. While liftSV is still 0 it is parked fully below the
    // screen (panelSlideStyle translateY = +panelH), so the heavy emoji/GIF
    // grid mounts + lays out OFF-SCREEN — the user sees nothing move yet.
    setPanelTab('emoji');
    const kbUp = Math.abs(keyboardHeight.value) > 1;
    if (kbUp) {
      // CRITICAL (keyboard UP): arm the lift mirror SYNCHRONOUSLY so the
      // keyboard's descent REVEALS the panel with zero bar movement (the spacer
      // grows frame-for-frame as `progress` falls 1→0). No translate animation.
      liftSV.value = 1;
      requestAnimationFrame(() => Keyboard.dismiss());
    } else {
      // Keyboard already DOWN: nothing animates the reveal for us. Wait two
      // frames so the panel mount + first layout pass have committed, THEN run
      // the lift on the UI thread. Deferring past the mount keeps the rise a
      // pure compositor transform — no concurrent JS/layout work stalling it
      // (the "freezes then jerks up" jank on weak Android).
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          liftSV.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
        }),
      );
    }
  }, [emojiPanelSV, liftSV, keyboardHeight]);

  // Open the GIF panel — twin of openEmoji. Mutually exclusive with emoji.
  const openGif = useCallback(() => {
    const h = lastKbHeightRef.current > 0 ? lastKbHeightRef.current : 300;
    emojiPanelSV.value = h;
    setEmojiPanelHeight(h);
    setKeepLifted(false);
    setPanelTab('gif');
    const kbUp = Math.abs(keyboardHeight.value) > 1;
    if (kbUp) {
      liftSV.value = 1;
      requestAnimationFrame(() => Keyboard.dismiss());
    } else {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          liftSV.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
        }),
      );
    }
  }, [emojiPanelSV, liftSV, keyboardHeight]);

  // Switch tab WITHOUT touching the keyboard/lift — the panel is already open
  // and the keyboard is already down, so this is a pure horizontal slide.
  const switchPanel = useCallback((tab: 'emoji' | 'gif') => {
    setPanelTab(tab);
  }, []);

  // Return to the keyboard: hide the panel, keep the bar lifted, and focus the
  // field so the keyboard rises back into the same space.
  const closeEmojiToKeyboard = useCallback(() => {
    // Keep the lift armed synchronously so the bar doesn't drop for a frame
    // between hiding the panel and the keyboard rising back.
    liftSV.value = 1;
    setPanelTab(null);
    setKeepLifted(true);
    inputRef.current?.focus();
  }, [liftSV]);

  // Dismiss the panel ENTIRELY (no keyboard) — the panel + bar slide back down.
  // Fired by a tap on the message-list region while a panel is open, mirroring
  // the way a tap outside dismisses the keyboard. The lift mirror effect
  // animates liftSV → 0 (bar + panel descend together) once the state clears.
  const dismissPanel = useCallback(() => {
    setPanelTab(null);
    setKeepLifted(false);
  }, []);

  // Tap-to-dismiss for the media panel that does NOT block scrolling. A Tap
  // gesture is recognised only when the finger stays put — the instant it
  // moves (a scroll), the tap FAILS and the FlatList scroll wins. Enabled only
  // while a panel is open, so normal chat gestures are untouched otherwise.
  // This lets the list scroll freely with the panel open (Telegram-style) and
  // a plain tap on the messages still dismisses the panel.
  const panelDismissTap = useMemo(
    () =>
      Gesture.Tap()
        .enabled(!!panelTab)
        .maxDuration(250)
        .maxDistance(10)
        .onEnd((_e, success) => {
          'worklet';
          if (success) runOnJS(dismissPanel)();
        }),
    [panelTab, dismissPanel],
  );

  // Insert a picked emoji into the composer; panel stays open for multi-pick.
  // Also record it in the recently-used list (shown at the top of the panel).
  const onPickEmoji = useCallback((e: string) => {
    inputRef.current?.insert(e);
    setRecentEmoji(pushRecentEmoji(e));
  }, []);

  // ── Recents hydration (emoji + GIF) ───────────────────────────────────────
  // `recentEmoji`/`recentGif` are seeded ONCE via the useState initializers
  // (`getRecentEmoji()`/`getRecentGif()`), which read synchronously. In the
  // AsyncStorage-fallback path (MMKV native module unavailable) those keys are
  // never warmed into the in-memory mirror — `kvWarm` is called for
  // `chat_messages:*` but NOT for the recents — so that first sync read misses
  // persisted data and recents never reappear after an app restart. Warm the
  // two keys once on mount, then re-read so the lists hydrate. (No-op when MMKV
  // is available — the initializer read already had the data.)
  useEffect(() => {
    let cancelled = false;
    kvWarm(['recent_emoji', 'recent_gif'])
      .then(() => {
        if (cancelled) return;
        setRecentEmoji(getRecentEmoji());
        setRecentGif(getRecentGif());
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Whenever the media panel opens, refresh the recents from storage so the
  // grid always reflects the latest persisted MRU (e.g. GIFs sent earlier this
  // session, or items that hydrated after the initial mount read). Additive —
  // does not touch the lift/slide/switch mechanics.
  useEffect(() => {
    if (!panelTab) return;
    setRecentEmoji(getRecentEmoji());
    setRecentGif(getRecentGif());
  }, [panelTab]);

  // Entering search mode tears down the input bar, so drop any panel state to
  // keep the lift offsets sane.
  useEffect(() => {
    if (searchMode && (emojiOpen || gifOpen || keepLifted)) {
      setPanelTab(null);
      setKeepLifted(false);
    }
  }, [searchMode, emojiOpen, gifOpen, keepLifted]);

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
          // Seed only the bounded `SEED_CAP` tail (newest), mirroring the
          // synchronous `seedMessages` path — the full history loads lazily on
          // demand. Record the seed reference for the persistence guard.
          const tail = cached.length > SEED_CAP ? cached.slice(cached.length - SEED_CAP) : cached;
          const healedTail = tail.map((m) => healLegacySender(m, currentUserId, participantId));
          seededArrayRef.current = healedTail;
          setMessages(conversationId, healedTail as any);
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
  //
  // Two deliberate bounds keep this off the open-frame critical path:
  //   • Only the few MOST-RECENT messages (`WARM_RECENT`) are warmed. The old
  //     `slice(-20)` front-loaded up to 20 fetches the instant the chat
  //     opened; the user only ever sees the last handful first, so warming 6
  //     covers the first screen and the rest stream in lazily on scroll.
  //   • Animated GIFs are EXCLUDED. GIFs are the heaviest decodes and warming
  //     them (even disk-only) wastes the budget on content that should only
  //     ever decode when actually visible. They load on render via the normal
  //     `autoplay={isVisible}` path.
  //   • Warm policy is `'disk'` (network round-trip only, NO decode) so the
  //     warm never kicks off an off-screen decode storm — the decode happens
  //     lazily when a visible bubble mounts the real `CachedImage`.
  useEffect(() => {
    if (!myMessages || myMessages.length === 0) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      const recent = myMessages.slice(-WARM_RECENT);
      const uris: string[] = [];
      for (const m of recent) {
        if ((m as any).imageUrls) for (const u of (m as any).imageUrls) {
          if (isAnimatedImageUrl(u)) continue; // skip GIFs — decode on render
          uris.push(u);
        }
      }
      if (uris.length) {
        import('../../src/components/ui/CachedImage')
          .then(({ prefetchImages }) => prefetchImages(uris, CHAT_IMG_MAX_W, 'disk'))
          .catch(() => {});
      }
    });
    return () => handle.cancel();
  }, [conversationId]);

  // Persist messages to KV cache whenever THIS chat's messages change.
  // CRITICAL: the store now holds only the bounded SEED on open (full history
  // loads lazily), so a naive `kvSetJSON(store)` would TRUNCATE the older
  // history still on disk. Guarded:
  //   • Full history hydrated → the store IS the complete authoritative array
  //     → safe to mirror wholesale.
  //   • Store is still the untouched seed we pushed (reference-equal) → those
  //     messages are already on disk → nothing to persist.
  //   • Store diverged from the seed (a send / edit / delete) → hydrate the
  //     full history FIRST (it MERGES the divergent store in), so the resulting
  //     store change re-runs this effect on the hydrated branch and mirrors the
  //     COMPLETE array. Deferred so it never blocks the input frame. With no
  //     cached history (brand-new chat) the store is the whole truth → write it.
  useEffect(() => {
    if (!conversationId) return;
    if (!myMessages || myMessages.length === 0) return;
    if (historyHydratedRef.current === conversationId) {
      kvSetJSON(`chat_messages:${conversationId}`, myMessages);
      return;
    }
    if (myMessages === seededArrayRef.current) return; // untouched seed — already on disk
    const handle = InteractionManager.runAfterInteractions(() => {
      if (historyHydratedRef.current === conversationId) return;
      const merged = hydrateFullHistory();
      if (!merged) {
        kvSetJSON(`chat_messages:${conversationId}`, useChatStore.getState().messages[conversationId] || myMessages);
      }
    });
    return () => handle.cancel();
  }, [conversationId, myMessages, hydrateFullHistory]);

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

  // Non-inverted list: newest is at the END, so "scroll to newest" = scrollToEnd.
  const scrollToEnd = useCallback((_animated = true) => {
    requestAnimationFrame(() => { try { flatListRef.current?.scrollToEnd({ animated: _animated }); } catch {} });
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
      // Ensure the FULL history is in the store before removing, so the delete
      // can't be "resurrected" when the lazy hydrate-merge later runs (the
      // merge overlays the store onto the cached full array by id — a message
      // only deleted from the bounded seed would otherwise survive in cache).
      hydrateFullHistoryRef.current();
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
    // Search must cover the WHOLE conversation, not just the loaded seed
    // window — hydrate the full history (once) when the user opens search.
    // Deferred so opening the search bar stays snappy; the match recompute
    // re-runs when `chatMessages` grows.
    if (historyHydratedRef.current !== conversationId) {
      InteractionManager.runAfterInteractions(() => { hydrateFullHistory(); });
    }
    setSearchMode(true);
  }, [conversationId, hydrateFullHistory]);

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

  // Non-inverted list: data IS `chatMessages` (oldest→newest), so a search-match
  // index maps DIRECTLY to the list index — no inversion, no window remap.
  const scrollToIndex = useCallback((index: number) => {
    if (index < 0 || index >= chatMessages.length) return;
    jumpAttemptRef.current = 0;
    requestAnimationFrame(() => {
      try { flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 }); } catch {}
    });
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
        const r = await manipulateAsync(a.uri, [{ resize: { width: 1600 } }], { compress: 0.85, format: SaveFormat.JPEG });
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
    playSendSound();
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

  // Pick a GIF from the inline panel: send it, then close the panel and let the
  // input bar settle back down (GIFs are one-and-done, not multi-pick).
  const onPickGif = useCallback((item: GiphyItem) => {
    sendGif(item.sendUrl);
    setRecentGif(pushRecentGif(item));
    setPanelTab(null);
    setKeepLifted(false);
    // liftSV is animated back to 0 by the lift mirror effect (smooth descent)
    // now that panelTab/keepLifted are cleared — no instant snap here.
  }, [sendGif]);
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
              // Clamp the spawn rect to the visible viewport so the burst is
              // ALWAYS on screen. A VERY LONG message has a tall bubble whose
              // measured window rect can start above the screen (negative y)
              // and/or extend far below it — feeding that raw rect spawned the
              // particles off-screen (the bug). We take the visible vertical
              // slice of the bubble, cap its height so the particle spread
              // stays tight, and center the spawn band inside that slice; width
              // is clamped to the screen. This only changes WHERE the burst
              // originates — EmojiDeleteBurst's pooled, native-driver perf
              // model is untouched.
              const top = Math.max(rect.y, 0);
              const bottom = Math.min(rect.y + rect.h, SCREEN_HEIGHT);
              const visibleH = Math.max(bottom - top, 24);
              const spawnH = Math.min(visibleH, 200);
              const spawnY = top + (visibleH - spawnH) / 2;
              const spawnX = Math.max(Math.min(rect.x, SCREEN_WIDTH - 24), 0);
              const spawnW = Math.min(rect.w, SCREEN_WIDTH);
              burstRef.current?.burst(spawnX, spawnY, spawnW, spawnH);
              deleteRectsRef.current.delete(message.id);
            }
            // Read the latest snapshot from getState() rather than from the
            // closed-over selector — avoids the callback being recreated on
            // every store update (and rebuilding all bubbles' onLongPress).
            // Ensure the FULL history is loaded first so the delete persists
            // correctly (the lazy hydrate-merge would otherwise resurrect a
            // message removed only from the bounded seed window).
            hydrateFullHistoryRef.current();
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
    playSendSound();
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

  // ── Media-panel long-press actions (Task B) ───────────────────────────────
  // Additive callbacks wired down through MediaPanel → Emoji/Gif panels. A
  // normal tap keeps its existing behavior (insert emoji / send GIF); a
  // long-press opens a small preview popup whose buttons call these.
  //
  // Send an emoji as its own chat message (reuses the full send pipeline,
  // including reply context). Distinct from onPickEmoji, which only inserts
  // into the composer for multi-pick.
  const onSendEmojiMessage = useCallback((emoji: string) => {
    if (!emoji) return;
    void handleSend(emoji);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Copy a single emoji to the system clipboard.
  const onCopyEmoji = useCallback((emoji: string) => {
    if (!emoji) return;
    Clipboard.setStringAsync(emoji);
    showToast(t('toast.copied'), 'check');
  }, [t]);

  // Copy a GIF. The GIF lives as a remote URL (we never re-host it), so the
  // cheap, reliable action is to copy that URL string — pasteable into any
  // chat/app that resolves GIPHY links.
  const onCopyGif = useCallback((item: GiphyItem) => {
    if (!item?.sendUrl) return;
    Clipboard.setStringAsync(item.sendUrl);
    showToast(t('toast.copied'), 'check');
  }, [t]);

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
  //
  // Memoized by RAW item ref via a WeakMap so a given message is parsed at
  // most once (re-parsing only when the store hands us a NEW object for that
  // id — i.e. the message actually changed). This keeps the parsed `m` object
  // identity stable across renders, so `MemoMessageBubble`'s `imageUrls` ref
  // check and the FlatList cell bail-outs hold during scroll instead of
  // allocating a fresh object on every `renderItem` call. The cache is rebuilt
  // (cleared) whenever the identity inputs (`currentUserId`/`participantId`)
  // change, so healed ownership can never go stale.
  const parseCache = useMemo(() => new WeakMap<ChatMessage, ChatMessage>(), [currentUserId, participantId]);
  const parseMessage = useCallback((m: ChatMessage): ChatMessage => {
    const cached = parseCache.get(m);
    if (cached) return cached;
    const healed = healLegacySender(m, currentUserId, participantId);
    let result: ChatMessage;
    if (healed.imageUrls || !healed.text?.startsWith('::img::')) {
      result = healed;
    } else {
      const end = healed.text.indexOf('::', 7);
      if (end === -1) {
        result = healed;
      } else {
        const urls = healed.text.slice(7, end).split('|').filter(Boolean);
        result = { ...healed, imageUrls: urls.length ? urls : undefined, text: healed.text.slice(end + 2) };
      }
    }
    parseCache.set(m, result);
    return result;
  }, [currentUserId, participantId, parseCache]);

  const activeMatchIndex = searchMatches.length > 0 ? searchMatches[searchActiveIdx] : -1;
  const activeMatchId = activeMatchIndex >= 0 && activeMatchIndex < chatMessages.length ? chatMessages[activeMatchIndex]?.id : null;

  // Non-inverted FlashList: data stays in natural order (oldest→newest) and the
  // list renders from the BOTTOM (newest) via maintainVisibleContentPosition's
  // `startRenderingFromBottom`. FlashList RECYCLES cells, so we feed it the
  // whole loaded set directly — no manual window cap or index remapping needed
  // (the old inverted FlatList needed both). The newest message sits at the
  // bottom with no manual scroll; prepending OLDER messages at the top keeps
  // the viewport pinned (mvcp's core job).
  const windowedMessages = chatMessages;

  // Load OLDER history when the user reaches the TOP (oldest) of the list.
  // Only fires the heavy full-history hydrate once, and defers the parse OFF
  // the active scroll frame (a long, legacy-format chat otherwise stalls the
  // gesture). FlashList + mvcp keeps the scroll position stable when the older
  // messages prepend.
  const onStartReached = useCallback(() => {
    if (historyHydratedRef.current !== conversationId) {
      InteractionManager.runAfterInteractions(() => { hydrateFullHistory(); });
    }
  }, [conversationId, hydrateFullHistory]);

  // Tap-a-reply-to-jump: scroll to the message a reply is quoting and flash it.
  // `replyToId` is stored on every reply message (see sendText/sendGif). The
  // FlatList data IS `invertedMessages`, so the found index maps 1:1 to the row.
  const [jumpHighlightId, setJumpHighlightId] = useState<string | null>(null);
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollToMessageId = useCallback((messageId?: string) => {
    if (!messageId) return;
    let idx = chatMessages.findIndex((mm) => mm.id === messageId);
    if (idx < 0) {
      // Reply target is older than the loaded seed. Lazily hydrate the FULL
      // history from cache, then find it in the (oldest→newest) array — the
      // list data IS that array, so the index maps directly.
      const healed = historyHydratedRef.current === conversationId ? null : hydrateFullHistory();
      if (healed && healed.length > 0) {
        idx = healed.findIndex((mm) => mm.id === messageId);
        if (idx < 0) return;
      } else {
        return; // genuinely not in this conversation
      }
    }
    triggerHaptic('selection');
    setJumpHighlightId(messageId);
    if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current);
    jumpTimerRef.current = setTimeout(() => setJumpHighlightId(null), 1600);
    // Defer one frame so a freshly hydrated array can commit before we scroll.
    // If the target row still isn't measured, `onScrollToIndexFailed` retries.
    jumpAttemptRef.current = 0;
    requestAnimationFrame(() => {
      try { flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 }); } catch {}
    });
  }, [chatMessages, conversationId, hydrateFullHistory]);
  useEffect(() => () => { if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current); }, []);

  // Guard against the freeze caused by rapid long-presses / taps while a menu is
  // opening or closing — see `useContextMenuGuard` (declared above with the
  // other hooks) for the time-lock + requestAnimationFrame defer.

  // ── GIF off-screen pause (viewability tracking) ───────────────────────
  // Track which message rows are actually on screen so animated images
  // (GIFs) only decode frames while visible. The visible set lives in a tiny
  // external store (`visTracker`) rather than component state: each bubble
  // subscribes to it individually (via `VisibilityBubble`), so a viewability
  // change re-renders ONLY the rows whose on-screen state flips — `renderItem`
  // no longer depends on the visible set, so its identity stays stable across
  // scroll and FlatList isn't forced to re-run for every mounted cell on each
  // viewability event. `ready` guards the window before FlatList reports its
  // first viewable set — until then everything is treated as visible so
  // nothing is paused incorrectly on open. Both config + handler are
  // ref-stable: FlatList warns (and can crash on some RN versions) if either
  // identity changes between renders.
  const visTrackerRef = useRef<VisibilityTracker | null>(null);
  if (!visTrackerRef.current) {
    let visibleSet = new Set<string>();
    let ready = false;
    let scrolling = false;
    // Ids of rows that contain an animated image (GIF). Only these rows are
    // affected by the scroll-pause gate.
    const gifIds = new Set<string>();
    // Per-row listeners keyed by message id. Keying by id (instead of one flat
    // Set) lets us notify ONLY the rows that change AND release GIFs one at a
    // time on scroll-settle (see `held` + the staggered pump below).
    const rowListeners = new Map<string, Set<() => void>>();
    const notify = (itemId: string) => {
      const set = rowListeners.get(itemId);
      if (set) set.forEach((fn) => fn());
    };
    const notifyAll = () => { rowListeners.forEach((set) => set.forEach((fn) => fn())); };

    // ── Staggered GIF resume ────────────────────────────────────────────
    // Pausing GIFs while scrolling is cheap and correct. The problem was the
    // RESUME: when the list settled we flipped EVERY visible GIF back to
    // autoplay on one frame, so expo-image kicked off ~10+ fresh decodes at
    // once → a ~500 ms long task / fps→0 on weak devices (perf monitor caught
    // ~14 giphy decodes inside a 19 ms window). Fix, per the same proven
    // one-per-interval pattern already used for first-reveal: hold all visible
    // GIFs paused when scrolling stops, then release ONE every
    // RESUME_INTERVAL_MS so at most ~2 decode concurrently. A generation
    // counter + clearResume() abort an in-flight stagger the instant a new
    // scroll begins.
    const RESUME_INTERVAL_MS = 90;
    const held = new Set<string>();
    let resumeGen = 0;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const clearResume = () => { if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; } };

    visTrackerRef.current = {
      subscribeRow(itemId, l) {
        let set = rowListeners.get(itemId);
        if (!set) { set = new Set(); rowListeners.set(itemId, set); }
        set.add(l);
        return () => {
          const s = rowListeners.get(itemId);
          if (s) { s.delete(l); if (s.size === 0) rowListeners.delete(itemId); }
        };
      },
      // A row's media animates only when it's on-screen. GIF rows are
      // additionally gated: paused for the whole active scroll, then held
      // paused until their staggered resume turn after the scroll settles.
      // Text/photo rows ignore both gates (their snapshot never changes when
      // scrolling toggles) so `useSyncExternalStore` bails them out.
      isVisible(itemId) {
        const onScreen = !ready || visibleSet.has(itemId);
        if (!onScreen) return false;
        if (gifIds.has(itemId) && (scrolling || held.has(itemId))) return false;
        return true;
      },
      update(next) {
        // Skip the listener fan-out when the viewable set is unchanged —
        // mirrors the old `setVisibleIds` dedupe so tiny scroll jitter is free.
        if (ready && next.size === visibleSet.size) {
          let same = true;
          for (const itemId of next) if (!visibleSet.has(itemId)) { same = false; break; }
          if (same) return;
        }
        visibleSet = next;
        ready = true;
        notifyAll();
      },
      setScrolling(b) {
        if (b === scrolling) return;
        scrolling = b;
        if (gifIds.size === 0) { clearResume(); held.clear(); return; }
        if (b) {
          // Scroll started → pause GIFs immediately (the `scrolling` flag does
          // it). Drop any pending resume + hold marks, and notify only the
          // VISIBLE GIF rows so just they re-render to stopAnimating(). Non-GIF
          // and off-screen rows have an unchanged snapshot → no re-render →
          // hitch-free scroll start.
          clearResume();
          held.clear();
          gifIds.forEach((gid) => { if (!ready || visibleSet.has(gid)) notify(gid); });
        } else {
          // Scroll settled → hold every currently-visible GIF, then release one
          // per RESUME_INTERVAL_MS. No notify on hold: the snapshot is already
          // `false` from the scroll, so nothing re-renders until its release.
          clearResume();
          const pending = [...gifIds].filter((gid) => (!ready || visibleSet.has(gid)));
          pending.forEach((gid) => held.add(gid));
          const gen = ++resumeGen;
          const step = () => {
            if (gen !== resumeGen) return; // a new scroll superseded this stagger
            const nextId = pending.shift();
            if (nextId === undefined) { resumeTimer = null; return; }
            held.delete(nextId);
            notify(nextId);
            resumeTimer = setTimeout(step, RESUME_INTERVAL_MS);
          };
          step();
        }
      },
      setHasGif(itemId, hasGif) {
        if (hasGif) gifIds.add(itemId); else { gifIds.delete(itemId); held.delete(itemId); }
      },
    };
  }
  const visTracker = visTrackerRef.current;
  // Deferred past the open-chat transition: FlatList fires its first
  // viewability callback the instant the initial cells lay out, which
  // landed on the same frame as the navigation slide-in and triggered an
  // immediate re-render of all five mounted bubbles. The 250 ms gate skips
  // that first burst — the list is already rendering everything visible
  // (initialNumToRender=5), so nothing is paused incorrectly during the gate.
  const viewabilityArmedRef = useRef(false);
  useEffect(() => {
    const handle = setTimeout(() => { viewabilityArmedRef.current = true; }, 250);
    return () => clearTimeout(handle);
  }, []);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 35 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    // Skip viewability-driven updates until the open-chat transition has
    // settled. See `viewabilityArmedRef` declaration above.
    if (!viewabilityArmedRef.current) return;
    const next = new Set<string>();
    for (const v of viewableItems) {
      if (v.isViewable && v.item?.id) next.add(v.item.id as string);
    }
    visTrackerRef.current?.update(next);
  }).current;

  const renderItem = useCallback(({ item }: { item: ChatMessage; index: number }) => {
    const m = parseMessage(item);
    return (
      <VisibilityBubble
        tracker={visTracker}
        message={m}
        isOwn={m.senderId === currentUserId}
        fontSize={chatSettings.fontSize}
        bubbleRadius={chatSettings.bubbleRadius}
        fontFamily={chatSettings.fontFamily}
        linkEmoji={chatSettings.linkEmoji}
        bubbleColors={bubbleColors}
        bubbleOpacity={bubbleOpacity}
        bubbleTextColor={bubbleTextColor}
        inColors={inColors}
        inOpacity={inOpacity}
        inTextColor={inTextColor}
        highlighted={item.id === activeMatchId || item.id === jumpHighlightId}
        imagesReady={imagesReady}
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
  }, [chatSettings.fontSize, chatSettings.bubbleRadius, chatSettings.fontFamily, chatSettings.linkEmoji, bubbleColorsKey, bubbleColors, bubbleOpacity, bubbleTextColor, inColorsKey, inColors, inOpacity, inTextColor, startReply, scrollToMessageId, handleSwipeActive, openImageViewer, parseMessage, activeMatchId, jumpHighlightId, onMessageLongPress, currentUserId, dragActiveSV, dragFingerYSV, hoveredActionSV, actionZonesSV, fireDragAction, visTracker, imagesReady]);

  // Stable callback refs for FlatList — without these, every parent render
  // hands FlatList fresh function identities and breaks its row recycling
  // shortcuts. Both functions only close over `flatListRef.current`, so they
  // never need to change.
  const chatKeyExtractor = useCallback((item: ChatMessage) => item.id, []);
  const onScrollToIndexFailedCb = useCallback((info: { index: number; averageItemLength: number; highestMeasuredFrameIndex: number }) => {
    // Far/unmeasured target (no getItemLayout + variable heights): grow the
    // render window to include the target, then retry with an INCREASING delay
    // so the rows between the current position and the target get a chance to
    // mount/measure on each pass. Capped so a genuinely unreachable index can't
    // loop forever. Each failed `scrollToIndex` re-invokes this callback, which
    // is what drives the loop forward until the row lands.
    const attempt = jumpAttemptRef.current++;
    if (attempt > 12) return;
    const delay = 80 + attempt * 80;
    setTimeout(() => {
      try { flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }); } catch {}
    }, delay);
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
  // Idle timer that releases the GIF-animation pause shortly after the last
  // scroll event (covers both drag and momentum/fling uniformly).
  const scrollIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChatScroll = useCallback((e: any) => {
    // Pause GIF animation for the duration of the scroll: arm on every scroll
    // event (no-op once already paused), and release 180 ms after the last
    // one. Cheap — `setScrolling` only fans out to the bubbles on a true
    // change (scroll start / scroll settle).
    visTrackerRef.current?.setScrolling(true);
    // Halt ALL media decode (photos + GIFs) while scrolling so no bitmap decode
    // lands on a scroll frame — the per-image "freeze when it scrolls into view".
    setRevealScrollPaused(true);
    if (scrollIdleRef.current) clearTimeout(scrollIdleRef.current);
    scrollIdleRef.current = setTimeout(() => {
      visTrackerRef.current?.setScrolling(false);
      setRevealScrollPaused(false);
    }, 180);
    const now = Date.now();
    if (now - lastScrollEventAt.current < 32) return;
    lastScrollEventAt.current = now;
    const ne = e?.nativeEvent;
    const y = ne?.contentOffset?.y ?? 0;
    const layoutH = ne?.layoutMeasurement?.height ?? 0;
    const contentH = ne?.contentSize?.height ?? 0;
    // Non-inverted list: the newest message is at the BOTTOM. Show the
    // scroll-to-bottom button when the user has scrolled UP away from it.
    const distanceFromBottom = contentH - (y + layoutH);
    const next = distanceFromBottom > SCROLL_BTN_THRESHOLD;
    setScrollBtnVisible((prev) => (prev === next ? prev : next));
  }, []);
  useEffect(() => () => { if (scrollIdleRef.current) clearTimeout(scrollIdleRef.current); setRevealScrollPaused(false); }, []);
  useEffect(() => {
    Animated.timing(scrollBtnOpacity, {
      toValue: scrollBtnVisible ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [scrollBtnVisible, scrollBtnOpacity]);
  const onScrollBtnTap = useCallback(() => {
    triggerHaptic('light');
    try { flatListRef.current?.scrollToEnd({ animated: true }); } catch {}
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
      <GestureDetector gesture={panelDismissTap}>
      {listReady ? (
      <FlashList
        ref={flatListRef}
        data={windowedMessages}
        keyExtractor={chatKeyExtractor}
        renderItem={renderItem}
        // FlashList v2 (cell recycling). No `inverted` (removed in v2): instead
        // maintainVisibleContentPosition.startRenderingFromBottom puts the
        // NEWEST message at the bottom, and prepending OLDER messages at the top
        // keeps the viewport pinned. Recycling replaces every FlatList
        // virtualization knob — and it's exactly what removes the heavy
        // per-bubble mount-on-scroll cost (gestures + Reanimated layers) that
        // FlatList re-paid on every row scrolling into view.
        maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
        contentContainerStyle={{ paddingBottom: 8 }}
        // Non-inverted: ListHeaderComponent is the TOP (oldest) spacer under the
        // header gradient; ListFooterComponent is the BOTTOM spacer above the
        // input bar. (Swapped from the old inverted layout.)
        ListHeaderComponent={<View style={{ height: headerContentHeight + 8 }} />}
        ListFooterComponent={<View style={{ height: LIST_FOOTER_HEIGHT }} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onScrollToIndexFailed={onScrollToIndexFailedCb}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        // Load OLDER history when the user nears the TOP (oldest) of the list.
        onStartReached={onStartReached}
        onStartReachedThreshold={0.5}
        // Scroll-to-bottom button visibility — onChatScroll computes distance
        // from the bottom (newest) from the scroll event.
        onScroll={onChatScroll}
        scrollEventThrottle={32}
      />
      ) : (
        <View style={StyleSheet.absoluteFill} />
      )}
      </GestureDetector>
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
            // Reveal animation. `pointerEvents` follows the visibility flag so
            // the button is non-interactive while hidden — prevents a "hidden
            // but tappable" footgun where a mis-targeted tap near the input bar
            // fires `scrollToOffset` unexpectedly.
            //
            // GLASS-SAFE: when liquid glass is on we must NOT animate `opacity`
            // on this wrapper — an animated/non-1 opacity on a parent stops the
            // native UIVisualEffectView from drawing, which is exactly why the
            // glass capsule below was rendering as just a dark bordered circle.
            // So we drive a `scale` transform (0→1) instead, which the native
            // driver supports and which leaves glass intact. Non-glass keeps
            // the lighter opacity fade.
            pointerEvents={scrollBtnVisible ? 'auto' : 'none'}
            style={glassActive ? { transform: [{ scale: scrollBtnOpacity }] } : { opacity: scrollBtnOpacity }}
          >
            {glassActive ? (
              // SAME proven glass pattern as the chat header circles
              // (`headerCircleGlass`): the icon lives INSIDE an interactive
              // NativeGlassView with NO backgroundColor / border / overflow so
              // the real liquid surface renders and morphs on touch. The
              // previous GlassBg-background version sat behind a semi-opaque
              // dark fill, so the glass sampled that dark fill and just looked
              // like a flat dark circle — which is what showed up as "no glass".
              // The wrapper above animates `scale` (not opacity), so the native
              // UIVisualEffectView keeps drawing.
              <Pressable onPress={onScrollBtnTap} hitSlop={6} style={{ borderRadius: 18 }}>
                <NativeGlassView
                  glassStyle="regular"
                  isInteractive
                  colorScheme={theme.isDark ? 'dark' : 'light'}
                  style={styles.headerCircleGlass}
                >
                  <Feather name="chevron-down" size={20} color={theme.colors.text.primary} />
                </NativeGlassView>
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

      {/* Input bar — manually keyboard-stuck via `barWrapStyle` (translateY =
          -max(keyboardHeight, panelHeight)). Replaces KeyboardStickyView so we
          can fold in the emoji-panel lift as a MONOTONIC max(), eliminating the
          handoff jump. Hidden while searching. */}
      {!searchMode && (
      <Reanimated.View style={[{ position: 'absolute', left: 0, right: 0, bottom: 0 }, barWrapStyle]}>
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
          onOpenGif={openGif}
          inputRowStyle={inputRowStyle}
          emojiOpen={emojiOpen}
          gifOpen={gifOpen}
          onOpenEmoji={openEmoji}
          onToggleEmoji={closeEmojiToKeyboard}
        />
      </Reanimated.View>
      )}

      {/* Inline media panel — bottom-anchored in the space the keyboard
          vacated. One surface hosting BOTH the emoji grid and the GIF grid on
          a horizontal slide track, a shared recently-used-emoji row at the top,
          and a Telegram-style bottom GIF/Эмодзи switcher. Mounted while open so
          the keyboard's slide-down REVEALS it; rendered AFTER the input bar so
          it paints on top and receives scroll/touch. */}
      {!searchMode && panelTab && (
        <Reanimated.View
          pointerEvents="box-none"
          style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, height: emojiPanelHeight }, panelSlideStyle]}
        >
          <View style={{ flex: 1, paddingTop: EMOJI_GAP }}>
            <MediaPanel
              height={emojiPanelHeight - EMOJI_GAP}
              tab={panelTab}
              onTabChange={switchPanel}
              onSelectEmoji={onPickEmoji}
              onSelectGif={onPickGif}
              onBackspace={() => inputRef.current?.backspace()}
              recentEmoji={recentEmoji}
              recentGifs={recentGif}
              theme={theme}
              bottomInset={insets.bottom}
              labels={{ gif: t('media.tab.gif'), emoji: t('media.tab.emoji'), copy: t('media.action.copy'), send: t('media.action.send') }}
              onSendEmoji={onSendEmojiMessage}
              onCopyEmoji={onCopyEmoji}
              onSendGif={onPickGif}
              onCopyGif={onCopyGif}
            />
          </View>
        </Reanimated.View>
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
            bubbleColor={menuIsOwn ? withOpacity(bubbleColors[0], bubbleOpacity) : theme.colors.background.tertiary}
            bubbleTextColor={menuIsOwn ? bubbleTextColor : theme.colors.text.primary}
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
