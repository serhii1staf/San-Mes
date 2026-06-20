import React, { memo, useState, useImperativeHandle, forwardRef, useCallback, useRef, useEffect } from 'react';
import { View, TextInput, Pressable, StyleSheet, Text } from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, interpolate } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { perfMonitor } from '../../services/perfMonitor';
import { useLiquidGlassActive, NativeGlassView, GlassContainerView } from '../ui/LiquidGlass';

// Geometry of the photo/attach button slot. When the field expands (multiline)
// it slides LEFT over this slot so the growing input swallows the button.
const PHOTO_SLOT = 44;
const GAP = 8;
const BASE_PAD_LEFT = 14;
const SWALLOW_DX = PHOTO_SLOT + GAP; // 52 — how far the field's left edge travels
const EXPAND_PAD_LEFT = BASE_PAD_LEFT + SWALLOW_DX; // 66
// Distance (pt) within which the two glass surfaces start to liquid-merge.
// Smaller than GAP so the collapsed (8pt-apart) capsules stay separate, while
// the expanded overlap (≈0) clearly fuses them.
const GLASS_MERGE_SPACING = 4;

// ── Isolated chat input bar ───────────────────────────────────────────────
//
// Performance: owns the text-input state LOCALLY so typing re-renders only this
// bar, never the parent screen or the message FlatList.
//
// The "swallow": when the field grows to a 2nd line it slides LEFT over the
// photo button. The horizontal motion is one Reanimated shared value driving
// `marginRight` (photo) + `paddingLeft` (field content) in lock-step on the UI
// thread, so the text column stays pinned (no re-wrap) and nothing fights the
// (instant) height change — no jitter.
//
// The MERGE: when liquid glass is on, the photo + field glass surfaces live in
// a native `GlassContainer`, so as they overlap they FUSE into one glass shape
// (Apple's Liquid Glass union) — no separate capsule, no opacity fade (opacity
// on a GlassView is a documented no-render bug, which was the "delay" before).
// On non-glass devices the swallow is disabled — the capsules stay separate and
// static, which is rock-solid.

export interface ChatInputBarHandle {
  setText: (text: string) => void;
  clear: () => void;
  getText: () => string;
  // Append a string (emoji) to the local text state — used by the parent's
  // emoji panel so picks land in the composer without re-rendering the screen.
  insert: (s: string) => void;
  // Programmatically focus the TextInput (re-open the keyboard).
  focus: () => void;
}

interface ChatInputBarProps {
  isEditing: boolean;
  hasPendingImages: boolean;
  onSend: (text: string) => void;
  onPickImages: () => void;
  onPasteImage?: () => void;
  // Native paste (expo-paste-input): local file:// URIs of pasted media.
  onPasteImages?: (uris: string[]) => void;
  onOpenGif: () => void;
  inputRowStyle: any; // Reanimated animated style (paddingBottom)
  // ── Emoji panel wiring (all optional — additive) ─────────────────────────
  // True while the parent's inline emoji panel is open. Swaps the GIF button
  // for a keyboard icon so the same slot returns the user to the keyboard.
  emojiOpen?: boolean;
  // True while the parent's inline GIF panel is open (twin of emojiOpen).
  gifOpen?: boolean;
  // Tapping the keyboard icon (or the text field while a panel is open)
  // asks the parent to close the panel and re-open the keyboard.
  onToggleEmoji?: () => void;
  // Tapping the top-left emoji button asks the parent to open the panel.
  onOpenEmoji?: () => void;
}

export const ChatInputBar = memo(forwardRef<ChatInputBarHandle, ChatInputBarProps>(function ChatInputBar(
  { isEditing, hasPendingImages, onSend, onPickImages, onPasteImage, onPasteImages, onOpenGif, inputRowStyle, emojiOpen, gifOpen, onToggleEmoji, onOpenEmoji },
  ref,
) {
  const theme = useTheme();
  const t = useT();
  const glassActive = useLiquidGlassActive();
  const [text, setText] = useState('');
  // Ref to the underlying TextInput so the parent (via the handle) can focus
  // it to re-open the keyboard when leaving the emoji panel.
  const textInputRef = useRef<TextInput>(null);

  // Swallow progress 0→1 (UI thread). Runs on BOTH glass and flat now — on
  // glass the surfaces liquid-merge; on flat the photo capsule slides under the
  // opaque field (lower zIndex) so the field simply covers it. Either way the
  // expansion + the top-left emoji button behave identically.
  const sw = useSharedValue(0);
  const expandedRef = useRef(false);
  // JS mirror of the expanded flag — drives the emoji button's `pointerEvents`
  // so the (fully transparent) button can't intercept taps while collapsed.
  const [fieldExpanded, setFieldExpanded] = useState(false);
  const setExpanded = useCallback((next: boolean) => {
    if (next === expandedRef.current) return;
    expandedRef.current = next;
    setFieldExpanded(next);
    // Soft spring → "liquid" feel as the field expands/collapses.
    sw.value = withSpring(next ? 1 : 0, { damping: 17, stiffness: 120, mass: 0.8, overshootClamping: false });
  }, [sw]);

  // ── Native paste wrapper (expo-paste-input) — crash-safe lazy load ──────
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
  }, [onPasteImages]);

  useImperativeHandle(ref, () => ({
    setText: (val: string) => { setText(val); if (!val) setExpanded(false); },
    clear: () => { setText(''); lastHeightRef.current = 0; setExpanded(false); },
    getText: () => text,
    insert: (s: string) => { setText((prev) => prev + s); },
    focus: () => { textInputRef.current?.focus(); },
  }), [text, setExpanded]);

  const canSend = text.trim().length > 0 || hasPendingImages;

  const handleSend = useCallback(() => {
    const val = text;
    setText('');
    onSend(val);
  }, [text, onSend]);

  // Detect 1↔multi-line with hysteresis (expand >34px, collapse <28px). Height
  // itself snaps (no LayoutAnimation) so nothing competes with the swallow.
  const lastHeightRef = useRef(0);
  const handleContentSizeChange = useCallback((e: { nativeEvent: { contentSize: { height: number } } }) => {
    const h = Math.round(e.nativeEvent.contentSize.height);
    if (h === lastHeightRef.current) return;
    lastHeightRef.current = h;
    if (!expandedRef.current && h > 34) setExpanded(true);
    else if (expandedRef.current && h < 28) setExpanded(false);
  }, [setExpanded]);

  const photoWrapStyle = useAnimatedStyle(() => ({
    marginRight: interpolate(sw.value, [0, 1], [GAP, -PHOTO_SLOT]),
  }));
  const fieldPadStyle = useAnimatedStyle(() => ({
    paddingLeft: interpolate(sw.value, [0, 1], [BASE_PAD_LEFT, EXPAND_PAD_LEFT]),
  }));
  // Emoji button reveal — tied to the SAME `sw` expansion shared value so it
  // fades + scales in on the UI thread exactly as the field expands to 2+
  // lines, and out as it collapses. No new per-frame JS.
  const emojiBtnStyle = useAnimatedStyle(() => ({
    opacity: sw.value,
    transform: [{ scale: interpolate(sw.value, [0, 1], [0.55, 1]) }],
  }));

  const textInputEl = (
    <TextInput
      ref={textInputRef}
      value={text}
      onChangeText={setText}
      placeholder={t('chat.input_placeholder')}
      placeholderTextColor={theme.colors.text.tertiary}
      style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20, alignSelf: 'stretch' }}
      multiline
      textAlignVertical="top"
      autoCorrect={false}
      autoComplete="off"
      spellCheck={false}
      onContentSizeChange={handleContentSizeChange}
      onFocus={() => {
        perfMonitor.markInputFocus('chat');
        // Tapping the field while a panel is open should close it and
        // return to the keyboard (which is already coming up).
        if (emojiOpen || gifOpen) onToggleEmoji?.();
      }}
    />
  );

  // Field content (TextInput + GIF) with the animated left padding that keeps
  // the text pinned while the field swallows the button.
  const fieldContent = (
    <Reanimated.View style={[styles.fieldContent, fieldPadStyle]}>
      {PasteWrapper ? (
        <PasteWrapper style={{ flex: 1 }} onPaste={handleNativePaste}>
          {textInputEl}
        </PasteWrapper>
      ) : (
        textInputEl
      )}
      {emojiOpen || gifOpen ? (
        // A panel is open → this slot returns the user to the keyboard.
        <Pressable onPress={onToggleEmoji} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, marginBottom: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.colors.accent.primary + '18' }}>
          <Feather name="type" size={15} color={theme.colors.accent.primary} />
        </Pressable>
      ) : (
        <Pressable onPress={onOpenGif} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, marginBottom: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.colors.accent.primary + '18' }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.accent.primary }}>GIF</Text>
        </Pressable>
      )}
    </Reanimated.View>
  );

  // Emoji button — overlaid at the field's TOP-LEFT, OUTSIDE the padded
  // `fieldContent` so the animated left padding can't shove it over the text.
  // It anchors to the field wrapper's own left edge. Opacity/scale ride `sw`
  // on the UI thread (visible when sw≈1 / multiline); `pointerEvents` is gated
  // on the JS expansion mirror so the transparent button never eats taps while
  // collapsed. Rendered as a sibling inside each field wrapper below.
  const emojiOverlay = (
    <Reanimated.View
      style={[styles.emojiBtnWrap, emojiBtnStyle]}
      pointerEvents={fieldExpanded ? 'auto' : 'none'}
    >
      <Pressable onPress={onOpenEmoji} hitSlop={8} style={styles.emojiBtn}>
        <Feather name="smile" size={20} color={theme.colors.accent.primary} />
      </Pressable>
    </Reanimated.View>
  );

  const photoIcon = <Feather name="image" size={20} color={theme.colors.accent.primary} />;

  return (
    <Reanimated.View style={[styles.row, inputRowStyle]}>
      {glassActive ? (
        // GLASS: photo + field glass live in a GlassContainer so they FUSE as
        // the field slides over the button (liquid union). No opacity anywhere.
        <GlassContainerView spacing={GLASS_MERGE_SPACING} style={styles.glassGroup}>
          <Reanimated.View style={[styles.photoWrap, photoWrapStyle]}>
            <Pressable onPress={onPickImages} onLongPress={onPasteImage} delayLongPress={300} style={styles.photoBtn}>
              <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.capsuleFill}>
                {photoIcon}
              </NativeGlassView>
            </Pressable>
          </Reanimated.View>
          <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.inputWrapGlass}>
            {fieldContent}
            {emojiOverlay}
          </NativeGlassView>
        </GlassContainerView>
      ) : (
        // FLAT (no glass): same swallow geometry, but the photo capsule slides
        // UNDER the opaque field (lower zIndex) so the field "covers" it — no
        // liquid merge, but the expansion + emoji button work identically.
        <>
          <Reanimated.View style={[styles.photoWrap, styles.photoWrapFlat, photoWrapStyle]}>
            <Pressable onPress={onPickImages} onLongPress={onPasteImage} delayLongPress={300} style={[styles.photoBtn, styles.iconBtnFlat, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
              {photoIcon}
            </Pressable>
          </Reanimated.View>
          <View style={[styles.inputWrap, styles.inputWrapFlatZ, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
            {fieldContent}
            {emojiOverlay}
          </View>
        </>
      )}
      {/* Send button. */}
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
  row: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8 },
  // Glass group holds the photo + field glass so the GlassContainer can fuse
  // them. Send button stays OUTSIDE so it never merges.
  glassGroup: { flex: 1, flexDirection: 'row', alignItems: 'flex-end' },
  photoWrap: { alignSelf: 'flex-end', zIndex: 2 },
  // Flat path: photo sits UNDER the opaque field so the field covers it on overlap.
  photoWrapFlat: { zIndex: 0 },
  photoBtn: { width: PHOTO_SLOT, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  iconBtnFlat: { borderWidth: 1 },
  inputWrapFlatZ: { zIndex: 1 },
  capsuleFill: { width: '100%', height: '100%', borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  center: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: PHOTO_SLOT, height: 44, borderRadius: 22, borderWidth: 1, alignSelf: 'flex-end', marginRight: GAP },
  fieldContent: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  emojiBtnWrap: { position: 'absolute', left: 8, top: 3, zIndex: 3 },
  emojiBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingRight: 14, paddingVertical: 10, minHeight: 44, borderWidth: 1 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  btnGlass: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  inputWrapGlass: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingRight: 14, paddingVertical: 10, minHeight: 44 },
});
