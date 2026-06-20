import React, { memo, useState, useImperativeHandle, forwardRef, useCallback, useRef, useEffect } from 'react';
import { View, TextInput, Pressable, StyleSheet, Text } from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, Easing, interpolate } from 'react-native-reanimated';
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

  // Swallow progress 0→1 (UI thread). Only animated when glass is active — the
  // fusion is a glass-only effect; flat capsules stay static & separate.
  const sw = useSharedValue(0);
  const expandedRef = useRef(false);
  const glassRef = useRef(glassActive);
  glassRef.current = glassActive;
  const setExpanded = useCallback((next: boolean) => {
    if (!glassRef.current) return; // swallow/merge is glass-only
    if (next === expandedRef.current) return;
    expandedRef.current = next;
    sw.value = withTiming(next ? 1 : 0, { duration: 240, easing: Easing.inOut(Easing.quad) });
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
          </NativeGlassView>
        </GlassContainerView>
      ) : (
        // FLAT (no glass): separate static capsules — no swallow, rock-solid.
        <>
          <View style={[styles.iconBtn, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
            <Pressable onPress={onPickImages} onLongPress={onPasteImage} delayLongPress={300} hitSlop={8} style={styles.center}>
              {photoIcon}
            </Pressable>
          </View>
          <View style={[styles.inputWrap, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
            {fieldContent}
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
  photoBtn: { width: PHOTO_SLOT, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  capsuleFill: { width: '100%', height: '100%', borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  center: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: PHOTO_SLOT, height: 44, borderRadius: 22, borderWidth: 1, alignSelf: 'flex-end', marginRight: GAP },
  fieldContent: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingRight: 14, paddingVertical: 10, minHeight: 44, borderWidth: 1 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  btnGlass: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  inputWrapGlass: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingRight: 14, paddingVertical: 10, minHeight: 44 },
});
