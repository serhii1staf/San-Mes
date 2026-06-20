import React, { memo, useState, useImperativeHandle, forwardRef, useCallback, useRef, useEffect } from 'react';
import { View, TextInput, Pressable, StyleSheet, Text } from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, Easing, interpolate } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { perfMonitor } from '../../services/perfMonitor';
import { useLiquidGlassActive, NativeGlassView } from '../ui/LiquidGlass';

// Geometry of the photo/attach button slot. When the field expands (multiline)
// it slides LEFT over this slot so the growing input swallows the button.
const PHOTO_SLOT = 44;
const GAP = 8;
const BASE_PAD_LEFT = 14;
// The field's left edge travels this far to reach the button's left edge.
const SWALLOW_DX = PHOTO_SLOT + GAP; // 52
const EXPAND_PAD_LEFT = BASE_PAD_LEFT + SWALLOW_DX; // 66

// ── Isolated chat input bar ───────────────────────────────────────────────
//
// Performance: owns the text-input state LOCALLY so typing re-renders only this
// bar, never the parent screen or the message FlatList.
//
// Animation architecture (this is the important part): EVERYTHING animates on
// the UI thread via Reanimated. The earlier jitter came from mixing RN
// `Animated` (JS-thread layout writes) with RN `LayoutAnimation` — two systems
// fighting over the same layout pass. Here:
//   • The "swallow" (photo button sliding under the field) animates `marginRight`
//     + the field's `paddingLeft` from ONE shared value via `useAnimatedStyle`.
//     Reanimated commits these layout props on the UI thread, and because the
//     margin and padding move in lock-step the text column stays pinned (no
//     re-wrap, no feedback loop).
//   • Height grows instantly (no LayoutAnimation) — so nothing competes with the
//     swallow animation. One animation system only ⇒ no jitter.

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
  // Native paste (expo-paste-input): local file:// URIs of pasted media.
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
  const glassActive = useLiquidGlassActive();
  const [text, setText] = useState('');

  // Swallow progress 0→1, animated entirely on the UI thread.
  const sw = useSharedValue(0);
  // Capsule visibility 1→0, driven SEPARATELY with a fast timing so the photo
  // capsule disappears/reappears immediately on toggle (no perceived delay),
  // independent of the slower 240ms slide. Front-loaded in BOTH directions
  // because each toggle kicks its own fast withTiming.
  const cap = useSharedValue(1);
  const expandedRef = useRef(false);
  const setExpanded = useCallback((next: boolean) => {
    if (next === expandedRef.current) return;
    expandedRef.current = next;
    sw.value = withTiming(next ? 1 : 0, { duration: 240, easing: Easing.inOut(Easing.quad) });
    cap.value = withTiming(next ? 0 : 1, { duration: 130, easing: Easing.out(Easing.quad) });
  }, [sw, cap]);

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
  }), [text, setExpanded]);

  const canSend = text.trim().length > 0 || hasPendingImages;

  const handleSend = useCallback(() => {
    const val = text;
    setText('');
    onSend(val);
  }, [text, onSend]);

  // Detect 1↔multi-line with hysteresis (expand >34px, collapse <28px) so it
  // can't flip-flop on the boundary. Height itself snaps (no LayoutAnimation).
  const lastHeightRef = useRef(0);
  const handleContentSizeChange = useCallback((e: { nativeEvent: { contentSize: { height: number } } }) => {
    const h = Math.round(e.nativeEvent.contentSize.height);
    if (h === lastHeightRef.current) return;
    lastHeightRef.current = h;
    if (!expandedRef.current && h > 34) setExpanded(true);
    else if (expandedRef.current && h < 28) setExpanded(false);
  }, [setExpanded]);

  // UI-thread animated styles.
  const photoWrapStyle = useAnimatedStyle(() => ({
    marginRight: interpolate(sw.value, [0, 1], [GAP, -PHOTO_SLOT]),
  }));
  const fieldPadStyle = useAnimatedStyle(() => ({
    paddingLeft: interpolate(sw.value, [0, 1], [BASE_PAD_LEFT, EXPAND_PAD_LEFT]),
  }));
  const capsuleStyle = useAnimatedStyle(() => ({ opacity: cap.value }));
  const embeddedIconStyle = useAnimatedStyle(() => ({ opacity: interpolate(cap.value, [0, 1], [1, 0]) }));

  const textInputEl = (
    <TextInput
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
      onFocus={() => { perfMonitor.markInputFocus('chat'); }}
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
      <Pressable onPress={onOpenGif} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, marginBottom: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.colors.accent.primary + '18' }}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.accent.primary }}>GIF</Text>
      </Pressable>
    </Reanimated.View>
  );

  return (
    <Reanimated.View style={[styles.row, inputRowStyle]}>
      {/* Photo/attach button — slides under the field as it expands (animated
          marginRight). zIndex keeps the icon above the field. */}
      <Reanimated.View style={[styles.photoWrap, photoWrapStyle]}>
        <Pressable onPress={onPickImages} onLongPress={onPasteImage} delayLongPress={300} style={styles.photoBtn}>
          {/* Collapsed capsule (interactive glass with touch-morph, or flat) —
              cross-fades out as the field swallows it. */}
          <Reanimated.View style={[StyleSheet.absoluteFill, styles.center, capsuleStyle]}>
            {glassActive ? (
              <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.capsuleFill}>
                <Feather name="image" size={20} color={theme.colors.accent.primary} />
              </NativeGlassView>
            ) : (
              <View style={[styles.capsuleFill, { borderWidth: 1, backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
                <Feather name="image" size={20} color={theme.colors.accent.primary} />
              </View>
            )}
          </Reanimated.View>
          {/* Embedded icon — fades in over the field once swallowed. */}
          <Reanimated.View pointerEvents="none" style={embeddedIconStyle}>
            <Feather name="image" size={20} color={theme.colors.accent.primary} />
          </Reanimated.View>
        </Pressable>
      </Reanimated.View>
      {/* Input field. */}
      {glassActive ? (
        <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.inputWrapGlass}>
          {fieldContent}
        </NativeGlassView>
      ) : (
        <View style={[styles.inputWrap, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
          {fieldContent}
        </View>
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
  photoWrap: { alignSelf: 'flex-end', zIndex: 2 },
  photoBtn: { width: PHOTO_SLOT, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  capsuleFill: { width: '100%', height: '100%', borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  fieldContent: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingRight: 14, paddingVertical: 10, minHeight: 44, borderWidth: 1, zIndex: 1 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  btnGlass: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  inputWrapGlass: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingRight: 14, paddingVertical: 10, minHeight: 44, zIndex: 1 },
});
