import React, { memo, useState, useImperativeHandle, forwardRef, useCallback, useRef, useEffect } from 'react';
import { View, TextInput, Pressable, Platform, StyleSheet, Text, LayoutAnimation, UIManager } from 'react-native';
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
// Layout: three SEPARATE rounded capsules — attach button | input field | send —
// each pinned to the bottom edge so the field grows UPWARD on multiline while the
// buttons stay put. The field only ever animates its HEIGHT (a single
// LayoutAnimation pass per line change, exactly like the AI / Music composers).
// We deliberately do NOT animate any horizontal layout (no "swallow" effect):
// mixing a JS-driven layout animation with the height LayoutAnimation made the
// whole bar jitter, so it was removed in favour of rock-solid smoothness.

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
  // user enabled it — everywhere else this is false and the flat capsules render
  // unchanged (Android always hits the cheap fallback).
  const glassActive = useLiquidGlassActive();
  const [text, setText] = useState('');

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
    setText: (t: string) => setText(t),
    clear: () => { setText(''); lastHeightRef.current = 0; },
    getText: () => text,
  }), [text]);

  const canSend = text.trim().length > 0 || hasPendingImages;

  const handleSend = useCallback(() => {
    const t = text;
    setText('');
    onSend(t);
  }, [text, onSend]);

  // Animate height changes when the multiline TextInput grows/shrinks so the
  // field resizes smoothly instead of snapping line-by-line. Guard on the last
  // reported height so typing within a single line never triggers a layout pass.
  const lastHeightRef = useRef(0);
  const handleContentSizeChange = useCallback((e: { nativeEvent: { contentSize: { height: number } } }) => {
    const h = Math.round(e.nativeEvent.contentSize.height);
    if (h === lastHeightRef.current) return;
    lastHeightRef.current = h;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, []);

  // The stateful TextInput (owns the live text value), shared by both paths.
  const textInputEl = (
    <TextInput
      value={text}
      onChangeText={setText}
      placeholder={t('chat.input_placeholder')}
      placeholderTextColor={theme.colors.text.tertiary}
      style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20, alignSelf: 'stretch' }}
      multiline
      // Top-aligned so multiline text fills from the top-left and grows downward.
      textAlignVertical="top"
      // Autocorrect / autocomplete / spellcheck OFF — the user found the
      // keyboard's auto-replacement disruptive while chatting.
      autoCorrect={false}
      autoComplete="off"
      spellCheck={false}
      onContentSizeChange={handleContentSizeChange}
      onFocus={() => { perfMonitor.markInputFocus('chat'); }}
    />
  );

  const inputInner = (
    <>
      {PasteWrapper ? (
        <PasteWrapper style={{ flex: 1 }} onPaste={handleNativePaste}>
          {textInputEl}
        </PasteWrapper>
      ) : (
        textInputEl
      )}
      {/* GIF button inside the field, right side, pinned to the bottom row. */}
      <Pressable onPress={onOpenGif} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, marginBottom: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.colors.accent.primary + '18' }}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.accent.primary }}>GIF</Text>
      </Pressable>
    </>
  );

  return (
    <Reanimated.View style={[styles.row, inputRowStyle]}>
      {/* Attach/photo button — a separate capsule with a gap, like the send
          button. Interactive liquid glass (touch stretch-morph) when enabled,
          flat bordered capsule otherwise. Long-press pastes a clipboard image. */}
      <Pressable
        onPress={onPickImages}
        onLongPress={onPasteImage}
        delayLongPress={300}
        style={glassActive ? { borderRadius: 22, marginRight: 8, alignSelf: 'flex-end' } : [styles.iconBtn, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}
      >
        {glassActive ? (
          <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.btnGlass}>
            <Feather name="image" size={20} color={theme.colors.accent.primary} />
          </NativeGlassView>
        ) : (
          <Feather name="image" size={20} color={theme.colors.accent.primary} />
        )}
      </Pressable>
      {/* Input field. */}
      {glassActive ? (
        <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.inputWrapGlass}>
          {inputInner}
        </NativeGlassView>
      ) : (
        <View style={[styles.inputWrap, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
          {inputInner}
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
  // Children pinned to the bottom edge so the field grows UPWARD while the
  // buttons stay anchored to the row's bottom (the keyboard top).
  row: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 8, alignSelf: 'flex-end' },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, borderWidth: 1 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  // Interactive-glass shape — same geometry as the flat capsules but no border
  // and no overflow clipping, so the liquid glass can morph outward on touch.
  btnGlass: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  inputWrapGlass: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44 },
});
