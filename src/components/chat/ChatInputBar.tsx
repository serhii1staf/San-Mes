import React, { memo, useState, useImperativeHandle, forwardRef, useCallback, useRef, useEffect } from 'react';
import { View, TextInput, Pressable, Platform, StyleSheet, Text, LayoutAnimation, UIManager, Animated, Easing } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { perfMonitor } from '../../services/perfMonitor';
import { useLiquidGlassActive, NativeGlassView } from '../ui/LiquidGlass';

// Enable LayoutAnimation on Android (no-op on iOS where it's always on).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Width of the photo/attach button slot. When the field expands (multiline),
// the field slides LEFT over this slot so the growing input swallows it.
const PHOTO_SLOT = 44;
const GAP = 8;
// How far the field's left edge travels to reach the photo button's left edge.
const SWALLOW_DX = PHOTO_SLOT + GAP; // 52
const BASE_PAD_LEFT = 14;

// Isolated chat input bar.
//
// Performance: this component owns the text-input state LOCALLY. Typing therefore
// re-renders only this small bar — never the parent ChatScreen or the message
// FlatList. That removes the keystroke lag that came from re-reconciling the whole
// message tree on every character.
//
// The parent drives "edit/reply prefill" and "clear" imperatively via the ref so
// it still never needs to hold the live text value.
//
// Visual: flat capsules (background.elevated + border.light). The earlier
// Liquid-Glass treatment was reverted on user request — it didn't read well
// against chat content and added a BlurView per child surface, which is the
// kind of stacking pattern we want to avoid near the keyboard.

export interface ChatInputBarHandle {
  setText: (text: string) => void;
  clear: () => void;
  getText: () => string;
}

interface ChatInputBarProps {
  isEditing: boolean;
  hasPendingImages: boolean;
  onSend: (text: string) => void;
  onPickImages: () => void;
  onPasteImage?: () => void;
  // Native paste (expo-paste-input): fires with the local file:// URIs of
  // images/stickers/GIFs the user pasted via the OS paste menu or keyboard.
  // Only wired on builds that include the native module (see lazy load below).
  onPasteImages?: (uris: string[]) => void;
  onOpenGif: () => void;
  inputRowStyle: any; // Reanimated animated style (paddingBottom)
}

export const ChatInputBar = memo(forwardRef<ChatInputBarHandle, ChatInputBarProps>(function ChatInputBar(
  { isEditing, hasPendingImages, onSend, onPickImages, onPasteImage, onPasteImages, onOpenGif, inputRowStyle },
  ref,
) {
  const theme = useTheme();
  const t = useT();
  // Native iOS-26 liquid glass for the input chrome. iOS-only and only when the
  // user enabled it — everywhere else this is false and the existing flat
  // capsules render unchanged (Android always hits the cheap fallback). Native
  // glass is far cheaper than the BlurView-per-child attempt that was reverted.
  const glassActive = useLiquidGlassActive();
  const [text, setText] = useState('');
  // Whether the field has grown past a single line. Drives the "field expands
  // left and swallows the photo button" layout. Tracked via a ref too so the
  // (stable) content-size callback can read the latest value without deps.
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);

  // ── Swallow animation (Animated.Value, like the AI/Music "Commands" pill) ─
  // A single value 0→1 drives the photo button sliding under the field AND the
  // field's matching left-padding, with a smooth timed ease. It only runs on
  // the collapse↔expand TOGGLE (≈once per message), NOT per keystroke, so it's
  // cheap even though layout props can't use the native driver. Because the
  // photo's negative margin and the field's padding interpolate from the SAME
  // value, the text column stays pinned at every frame → no re-wrap, no jitter.
  const swallow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(swallow, {
      toValue: expanded ? 1 : 0,
      duration: 240,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [expanded, swallow]);

  const photoMarginRight = swallow.interpolate({ inputRange: [0, 1], outputRange: [GAP, -PHOTO_SLOT] });
  const fieldPadLeft = swallow.interpolate({ inputRange: [0, 1], outputRange: [BASE_PAD_LEFT, BASE_PAD_LEFT + SWALLOW_DX] });
  // Linear cross-fade synced with the motion: the glass capsule (with the
  // touch-morph) fades out exactly as the embedded icon fades in, both tracking
  // the swallow progress — no "holds then pops" delay.
  const capsuleOpacity = swallow.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const embeddedIconOpacity = swallow.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  // ── Native paste wrapper (expo-paste-input) — crash-safe lazy load ──────
  // The native view `ExpoPasteInput` only exists in builds that bundled the
  // module. On OLDER binaries receiving this JS via OTA, importing the module
  // would throw at `requireNativeView` time — so we load it dynamically inside
  // an effect and swallow the rejection. When present, we wrap the TextInput so
  // the OS paste menu / keyboard can drop images, stickers and GIFs straight in.
  const [PasteWrapper, setPasteWrapper] = useState<React.ComponentType<any> | null>(null);
  useEffect(() => {
    let mounted = true;
    import('expo-paste-input')
      .then((m) => {
        const W = (m as any)?.TextInputWrapper;
        if (mounted && W) setPasteWrapper(() => W);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const handleNativePaste = useCallback((payload: any) => {
    if (payload?.type === 'images' && Array.isArray(payload.uris) && payload.uris.length > 0) {
      onPasteImages?.(payload.uris);
    }
    // 'text' is already inserted by the TextInput; 'unsupported' is ignored.
  }, [onPasteImages]);

  useImperativeHandle(ref, () => ({
    setText: (t: string) => {
      setText(t);
      if (!t) { expandedRef.current = false; setExpanded(false); }
    },
    clear: () => {
      setText('');
      lastHeightRef.current = 0;
      if (expandedRef.current) { expandedRef.current = false; setExpanded(false); }
    },
    getText: () => text,
  }), [text]);

  const canSend = text.trim().length > 0 || hasPendingImages;

  const handleSend = useCallback(() => {
    const t = text;
    setText('');
    onSend(t);
  }, [text, onSend]);

  // Animate height changes when the multiline TextInput grows/shrinks so the
  // bar resizes smoothly instead of snapping line-by-line. We also keep the
  // last reported content height so we only animate when it actually changes
  // (typing within a single line shouldn't trigger a layout pass).
  const lastHeightRef = useRef(0);
  const handleContentSizeChange = useCallback((e: { nativeEvent: { contentSize: { height: number } } }) => {
    const h = Math.round(e.nativeEvent.contentSize.height);
    if (h === lastHeightRef.current) return;
    lastHeightRef.current = h;
    // Hysteresis so the state can't flip-flop on the 1↔2 line boundary:
    // expand only once clearly on a 2nd line (>34), collapse only once clearly
    // back near a single line (<28). Single line ≈ 22px, two lines ≈ 42px.
    let next = expandedRef.current;
    if (!next && h > 34) next = true;
    else if (next && h < 28) next = false;
    const toggling = next !== expandedRef.current;
    // Smooth the height change with LayoutAnimation ONLY when we are NOT
    // toggling expand/collapse. During a toggle the horizontal swallow runs on
    // its own Animated value; letting LayoutAnimation ALSO animate the
    // resulting width/height change at the same time is exactly what made the
    // field jitter up/down/left/right. Keeping the two animation systems from
    // overlapping is the root-cause fix.
    if (!toggling) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    if (toggling) {
      expandedRef.current = next;
      setExpanded(next);
    }
  }, []);

  // Input contents shared by the glass and non-glass paths so we never
  // duplicate the stateful TextInput (which owns the live text value).
  const textInputEl = (
    <TextInput
      value={text}
      onChangeText={setText}
      placeholder={t('chat.input_placeholder')}
      placeholderTextColor={theme.colors.text.tertiary}
      style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20, alignSelf: 'stretch' }}
      multiline
      // Top-aligned so multiline text fills from the top-left and grows
      // downward (instead of staying vertically centered / bottom-anchored).
      textAlignVertical="top"
      // Autocorrect / autocomplete / spellcheck OFF — the user found the
      // keyboard's auto-replacement disruptive while chatting.
      autoCorrect={false}
      autoComplete="off"
      spellCheck={false}
      onContentSizeChange={handleContentSizeChange}
      // Captures keyboard-to-first-frame latency for the chat input —
      // the perf-monitor singleton early-returns when disabled, so this
      // is essentially free in production for users with the bubble off.
      onFocus={() => { perfMonitor.markInputFocus('chat'); }}
    />
  );
  const inputInner = (
    <>
      {/* Wrap the TextInput in the native paste handler when the module is
          present (new builds). `flex: 1` keeps it filling the row. On older
          binaries PasteWrapper stays null and we render the plain TextInput. */}
      {PasteWrapper ? (
        <PasteWrapper style={{ flex: 1 }} onPaste={handleNativePaste}>
          {textInputEl}
        </PasteWrapper>
      ) : (
        textInputEl
      )}
      {/* GIF button inside the input, right side. */}
      <Pressable onPress={onOpenGif} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, marginBottom: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.colors.accent.primary + '18' }}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.accent.primary }}>GIF</Text>
      </Pressable>
    </>
  );

  // Content of the field (TextInput + GIF) wrapped in an Animated.View whose
  // paddingLeft animates in lock-step with the photo button's margin, so the
  // text column never moves while the field swallows the button.
  const fieldContent = (
    <Animated.View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: fieldPadLeft }}>
      {inputInner}
    </Animated.View>
  );

  return (
    // alignItems:'flex-end' → the field + send pin to the bottom; the field
    // grows UPWARD on multiline.
    <Reanimated.View style={[styles.row, inputRowStyle]}>
      {/* Photo/attach button. Collapsed: a separate capsule with a gap (like
          the send button). Expanded: the field slides over it (animated
          negative margin) and the capsule fades out, leaving just the icon
          sitting inside the grown field. zIndex keeps the icon above the field. */}
      <Animated.View style={{ marginRight: photoMarginRight, alignSelf: 'flex-end', zIndex: 2 }}>
        <Pressable onPress={onPickImages} onLongPress={onPasteImage} delayLongPress={300} style={styles.photoBtn}>
          {/* Collapsed capsule — interactive liquid glass (keeps the touch
              stretch-morph) with the icon as its child. Cross-fades out as the
              field swallows it. */}
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, { opacity: capsuleOpacity }]}>
            {glassActive ? (
              <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.photoCapsuleFill}>
                <Feather name="image" size={20} color={theme.colors.accent.primary} />
              </NativeGlassView>
            ) : (
              <View style={[styles.photoCapsuleFill, { borderWidth: 1, backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
                <Feather name="image" size={20} color={theme.colors.accent.primary} />
              </View>
            )}
          </Animated.View>
          {/* Embedded icon — fades IN once the field has swallowed the button,
              so the icon reads as sitting inside the grown field. */}
          <Animated.View pointerEvents="none" style={{ opacity: embeddedIconOpacity }}>
            <Feather name="image" size={20} color={theme.colors.accent.primary} />
          </Animated.View>
        </Pressable>
      </Animated.View>
      {/* Input container: glass when enabled, flat capsule otherwise. paddingLeft
          lives on the inner Animated.View (fieldContent), not here. */}
      {glassActive ? (
        <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.inputWrapGlass}>
          {fieldContent}
        </NativeGlassView>
      ) : (
        <View style={[styles.inputWrap, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
          {fieldContent}
        </View>
      )}
      {/* Send button → solid accent when it can send; interactive glass when
          empty + glass enabled. */}
      {glassActive && !canSend ? (
        <Pressable onPress={handleSend} style={{ borderRadius: 22, marginLeft: 8 }}>
          <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.btnGlass}>
            <Feather name={isEditing ? 'check' : 'send'} size={18} color={theme.colors.text.tertiary} />
          </NativeGlassView>
        </Pressable>
      ) : (
        <Pressable onPress={handleSend} style={[styles.sendBtn, { backgroundColor: canSend ? theme.colors.accent.primary : theme.colors.background.elevated }]}>
          <Feather name={isEditing ? 'check' : 'send'} size={18} color={canSend ? '#FFFFFF' : theme.colors.text.tertiary} />
        </Pressable>
      )}
    </Reanimated.View>
  );
}));

const styles = StyleSheet.create({
  // Anchor every direct child to the bottom edge of the row so growing the
  // TextInput pushes only the input wrap upward; image/GIF/send buttons stay
  // pinned to the bottom (which is the keyboard top), so visually the user
  // sees only the input bubble grow, not the buttons jump.
  row: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8 },
  // Photo/attach button sizing. The capsule background is a separate absolute
  // layer (photoCapsule) so it can fade out independently as the field swallows
  // it; the icon is centered on top.
  photoBtn: { width: PHOTO_SLOT, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  photoCapsuleFill: { width: '100%', height: '100%', borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingRight: 14, paddingVertical: 10, minHeight: 44, borderWidth: 1, zIndex: 1 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  // Interactive-glass shape variants — same geometry as the flat capsules but
  // NO border and NO overflow clipping, so the liquid glass can morph OUTWARD
  // over content on touch. The icon/content lives INSIDE the glass as children.
  // `btnGlass` is shared by the photo and (empty-state) send buttons.
  btnGlass: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  // Input-wrap glass: same shape as `inputWrap` minus the border. NON-interactive
  // (the TextInput lives inside; interactive morph would fight text editing).
  inputWrapGlass: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingRight: 14, paddingVertical: 10, minHeight: 44, zIndex: 1 },
});
