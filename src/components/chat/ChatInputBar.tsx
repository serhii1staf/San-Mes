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

// Width of the photo/attach button slot. When the field expands (multiline),
// the field slides LEFT over this slot (negative margin) so the growing input
// visually swallows the still-in-place button.
const PHOTO_SLOT = 44;

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
    // One layout animation per height change — the height grow AND the
    // expand/collapse margin+padding shifts all ride this single native pass.
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    // >1 line → expanded. Single line content height ≈ 20-24px; threshold 30
    // is comfortably between one and two lines.
    const next = h > 30;
    if (next !== expandedRef.current) {
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

  // Field's left padding: normal when collapsed; when expanded it leaves room
  // for the photo button, which slides UNDER the field's left edge.
  const wrapPadLeft = expanded ? PHOTO_SLOT + 2 : 14;

  return (
    // alignItems:'flex-end' → the field + send pin to the bottom; the field
    // grows UPWARD on multiline.
    <Reanimated.View style={[styles.row, inputRowStyle]}>
      {/* Photo/attach button. COLLAPSED: a separate capsule with a gap, just
          like the send button. EXPANDED (multiline): goes borderless and slides
          UNDER the field via a negative margin, so the growing field visually
          swallows it while the icon stays put. `zIndex` keeps the icon painted
          on top of the field background. It's a SIBLING of the field (not a
          child), so the interactive-glass "transparent child" issue never
          applies. */}
      <Pressable
        onPress={onPickImages}
        onLongPress={onPasteImage}
        delayLongPress={300}
        style={[styles.photoBtn, { marginRight: expanded ? -PHOTO_SLOT : 8 }]}
      >
        {expanded ? (
          // Embedded inside the grown field — just the icon, no capsule.
          <Feather name="image" size={20} color={theme.colors.accent.primary} />
        ) : glassActive ? (
          // Collapsed + glass: liquid-glass capsule (icon as child).
          <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.photoFill}>
            <Feather name="image" size={20} color={theme.colors.accent.primary} />
          </NativeGlassView>
        ) : (
          // Collapsed, no glass: flat bordered capsule.
          <View style={[styles.photoFill, { borderWidth: 1, backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
            <Feather name="image" size={20} color={theme.colors.accent.primary} />
          </View>
        )}
      </Pressable>
      {/* Input container: TextInput + GIF. NON-interactive-editing-friendly
          glass when enabled, flat capsule otherwise. */}
      {glassActive ? (
        <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={[styles.inputWrapGlass, { paddingLeft: wrapPadLeft }]}>
          {inputInner}
        </NativeGlassView>
      ) : (
        <View style={[styles.inputWrap, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light, paddingLeft: wrapPadLeft }]}>
          {inputInner}
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
  // Photo/attach button. zIndex:2 so when the field slides under it (expanded)
  // the icon stays painted on top of the field background. Sizing only — the
  // capsule background lives on the inner fill so it can fade in/out cleanly.
  photoBtn: { width: PHOTO_SLOT, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end', zIndex: 2 },
  photoFill: { width: '100%', height: '100%', borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingLeft: 14, paddingRight: 14, paddingVertical: 10, minHeight: 44, borderWidth: 1, zIndex: 1 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  // Interactive-glass shape variants — same geometry as the flat capsules but
  // NO border and NO overflow clipping, so the liquid glass can morph OUTWARD
  // over content on touch. The icon/content lives INSIDE the glass as children.
  // `btnGlass` is shared by the photo and (empty-state) send buttons.
  btnGlass: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  // Input-wrap glass: same shape as `inputWrap` minus the border. NON-interactive
  // (the TextInput lives inside; interactive morph would fight text editing).
  inputWrapGlass: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingLeft: 14, paddingRight: 14, paddingVertical: 10, minHeight: 44, zIndex: 1 },
});
