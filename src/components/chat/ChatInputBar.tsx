import React, { memo, useState, useEffect, useImperativeHandle, forwardRef, useCallback, useRef } from 'react';
import { View, TextInput, Pressable, Platform, StyleSheet, Text, LayoutAnimation, UIManager } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { perfMonitor } from '../../services/perfMonitor';
import { GlassCapsule } from '../ui/GlassCapsule';

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
// Visual: the three child surfaces (image-picker / input bubble / send button)
// are wrapped in `GlassCapsule` shells so they read as Liquid-Glass material
// matching the Dynamic Island companion overlay. The shells themselves are
// memoized — they don't re-render on every keystroke. Only the inner TextInput
// state churns. NO drag-stretch on this component: three buttons + a TextInput
// in tight layout would conflict with both editing the text and tapping
// individual buttons.

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
  onOpenGif: () => void;
  inputRowStyle: any; // Reanimated animated style (paddingBottom)
}

export const ChatInputBar = memo(forwardRef<ChatInputBarHandle, ChatInputBarProps>(function ChatInputBar(
  { isEditing, hasPendingImages, onSend, onPickImages, onOpenGif, inputRowStyle },
  ref,
) {
  const theme = useTheme();
  const isDark = theme.isDark;
  const t = useT();
  const [text, setText] = useState('');

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

  return (
    // alignItems: 'flex-end' is the key — when the TextInput grows on multiline
    // input, the wrap stretches UPWARD while the side buttons stay anchored to
    // the row's bottom edge. Without this the row centers all children, which
    // visually shoves the photo/GIF/send buttons up alongside the text.
    <Reanimated.View style={[styles.row, inputRowStyle]}>
      {/* Image-picker button — 44×44 glass capsule. */}
      <GlassCapsule
        borderRadius={22}
        isDark={isDark}
        style={styles.iconBtn}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={onPickImages}
          style={StyleSheet.absoluteFill}
          android_ripple={{ color: theme.colors.accent.primary + '20', borderless: true, radius: 22 }}
        >
          <View style={styles.center}>
            <Feather name="image" size={20} color={theme.colors.accent.primary} />
          </View>
        </Pressable>
      </GlassCapsule>

      {/* Text input bubble — full-width capsule between the side buttons. */}
      <GlassCapsule
        borderRadius={22}
        isDark={isDark}
        style={styles.inputWrap}
        pointerEvents="box-none"
      >
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('chat.input_placeholder')}
          placeholderTextColor={theme.colors.text.tertiary}
          style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20 }}
          multiline
          textAlignVertical="center"
          onContentSizeChange={handleContentSizeChange}
          // Captures keyboard-to-first-frame latency for the chat input —
          // the perf-monitor singleton early-returns when disabled, so this
          // is essentially free in production for users with the bubble off.
          onFocus={() => perfMonitor.markInputFocus('chat')}
        />
        {/* GIF button inside the input, right side. alignSelf:flex-end so it
            stays at the bottom row of the input wrap when text wraps. */}
        <Pressable onPress={onOpenGif} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, marginBottom: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.colors.accent.primary + '18' }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.accent.primary }}>GIF</Text>
        </Pressable>
      </GlassCapsule>

      {/* Send / check button — accent-tinted glass capsule when canSend. */}
      <GlassCapsule
        borderRadius={22}
        isDark={isDark}
        style={styles.sendBtn}
        pointerEvents="box-none"
        tinted={canSend ? { color: theme.colors.accent.primary } : undefined}
      >
        <Pressable
          onPress={handleSend}
          style={StyleSheet.absoluteFill}
          android_ripple={{ color: '#ffffff30', borderless: true, radius: 22 }}
        >
          <View style={styles.center}>
            <Feather name={isEditing ? 'check' : 'send'} size={18} color={canSend ? '#FFFFFF' : theme.colors.text.tertiary} />
          </View>
        </Pressable>
      </GlassCapsule>
    </Reanimated.View>
  );
}));

const styles = StyleSheet.create({
  // Anchor every direct child to the bottom edge of the row so growing the
  // TextInput pushes only the input wrap upward; image/GIF/send buttons stay
  // pinned to the bottom (which is the keyboard top), so visually the user
  // sees only the input bubble grow, not the buttons jump.
  row: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8 },
  iconBtn: { width: 44, height: 44, marginRight: 8 },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, minHeight: 44 },
  sendBtn: { width: 44, height: 44, marginLeft: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
