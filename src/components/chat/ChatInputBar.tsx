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
    clear: () => setText(''),
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
    if (h !== lastHeightRef.current) {
      lastHeightRef.current = h;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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
      style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20 }}
      multiline
      textAlignVertical="center"
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
          present (new builds). `flex: 1` keeps it filling the row exactly like
          the bare TextInput did. On older binaries PasteWrapper stays null and
          we render the plain TextInput — identical layout, no crash. */}
      {PasteWrapper ? (
        <PasteWrapper style={{ flex: 1 }} onPaste={handleNativePaste}>
          {textInputEl}
        </PasteWrapper>
      ) : (
        textInputEl
      )}
      {/* GIF button inside the input, right side. alignSelf:flex-end so it
          stays at the bottom row of the input wrap when text wraps. */}
      <Pressable onPress={onOpenGif} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, marginBottom: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.colors.accent.primary + '18' }}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.accent.primary }}>GIF</Text>
      </Pressable>
    </>
  );

  return (
    // alignItems: 'flex-end' is the key — when the TextInput grows on multiline
    // input, the wrap stretches UPWARD while the side buttons stay anchored to
    // the row's bottom edge. Without this the row centers all children, which
    // visually shoves the photo/GIF/send buttons up alongside the text.
    <Reanimated.View style={[styles.row, inputRowStyle]}>
      {/* Photo/image button → interactive liquid glass holding the icon as a
          CHILD so the glass morphs outward on touch. NO overflow clipping. */}
      <Pressable
        onPress={onPickImages}
        onLongPress={onPasteImage}
        delayLongPress={300}
        style={
          glassActive
            ? { borderRadius: 22, marginRight: 8 }
            : [styles.iconBtn, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]
        }
      >
        {glassActive ? (
          <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.btnGlass}>
            <Feather name="image" size={20} color={theme.colors.accent.primary} />
          </NativeGlassView>
        ) : (
          <Feather name="image" size={20} color={theme.colors.accent.primary} />
        )}
      </Pressable>
      {/* Input wrap → liquid glass holding the input content (TextInput + GIF
          button) as CHILDREN. NON-interactive (interactive morph fights text
          editing — TextInput rule) and NO overflow so the shape/padding/minHeight
          stay identical to the flat path. */}
      {glassActive ? (
        <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.inputWrapGlass}>
          {inputInner}
        </NativeGlassView>
      ) : (
        <View style={[styles.inputWrap, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
          {inputInner}
        </View>
      )}
      {/* Send button → keep the solid accent affordance when it can send (a
          filled send button, no glass). When it can't (empty) AND glass is
          active, render interactive glass holding the icon as a CHILD. */}
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
  iconBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, borderWidth: 1 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  // Interactive-glass shape variants — same geometry as the flat capsules but
  // NO border and NO overflow clipping, so the liquid glass can morph OUTWARD
  // over content on touch. The icon/content lives INSIDE the glass as children.
  // `btnGlass` is shared by the photo and (empty-state) send buttons.
  btnGlass: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  // Input-wrap glass: same shape as `inputWrap` minus the border. NON-interactive
  // (the TextInput lives inside; interactive morph would fight text editing).
  inputWrapGlass: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44 },
});
