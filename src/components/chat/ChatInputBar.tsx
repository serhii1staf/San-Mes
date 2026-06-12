import React, { memo, useState, useEffect, useImperativeHandle, forwardRef, useCallback, useRef } from 'react';
import { View, TextInput, Pressable, Platform, StyleSheet, Text, LayoutAnimation, UIManager } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';

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
// Visual: every surface (left action button, input bubble, send button) is a real
// iOS Liquid-Glass capsule rather than the previous flat translucent fill. On iOS
// each capsule is a `BlurView` with a `systemChromeMaterial*` tint — Apple's
// stock chrome material, the same one stock tab bars use, so the buttons end up
// with proper backdrop refraction + vibrancy rather than a darkened rectangle.
// A faint top-edge highlight + bottom dim gradient on top of the blur sells the
// curved-glass volume. On Android (where BlurView is too expensive on a
// keyboard-coupled view) we keep a flat translucent fill — the chat bar is short
// enough that the difference is acceptable and the keyboard transition stays
// jank-free.
//
// The parent drives "edit/reply prefill" and "clear" imperatively via the ref so
// it still never needs to hold the live text value.

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

// ─── Glass capsule — shared shell behind every surface ───────────────────────
//
// Centralizes the BlurView + tint + top-highlight + hairline border stack so
// each capsule on the bar uses identical glass tokens. `style` lets the caller
// add per-instance shape (radius, dimensions); the inner stack is sized via
// `StyleSheet.absoluteFill` so it always covers the capsule regardless.

const GlassCapsule = memo(function GlassCapsule({
  children,
  style,
  isDark,
  borderRadius,
  tinted,
}: {
  children?: React.ReactNode;
  style?: any;
  isDark: boolean;
  borderRadius: number;
  // When `true` the capsule uses the accent-colored overlay (used by the
  // active send button). Otherwise it stays neutral chrome glass.
  tinted?: { color: string };
}) {
  return (
    <View style={[{ borderRadius, overflow: 'hidden' }, style]}>
      {Platform.OS === 'ios' ? (
        <BlurView
          intensity={isDark ? 60 : 70}
          tint={isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: isDark
                ? 'rgba(40,40,45,0.75)'
                : 'rgba(255,255,255,0.85)',
            },
          ]}
        />
      )}

      {/* Tint overlay — for the "send" affordance when the user can submit. */}
      {tinted ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: tinted.color, opacity: 0.85 },
          ]}
        />
      ) : null}

      {/* Top reflection — bright crescent. */}
      <LinearGradient
        colors={
          isDark
            ? ['rgba(255,255,255,0.18)', 'rgba(255,255,255,0)']
            : ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']
        }
        style={[StyleSheet.absoluteFill, { height: '55%' }]}
        pointerEvents="none"
      />

      {/* Bottom dim — depth shadow. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '38%',
          backgroundColor: isDark ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.04)',
        }}
        pointerEvents="none"
      />

      {/* Hairline border on top of all layers so the blur doesn't wash it out. */}
      <View
        style={{
          ...StyleSheet.absoluteFillObject,
          borderRadius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)',
        }}
        pointerEvents="none"
      />

      {children}
    </View>
  );
});

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
      {/* Left action — pick images */}
      <Pressable onPress={onPickImages} hitSlop={4} style={styles.iconBtnHit}>
        <GlassCapsule isDark={isDark} borderRadius={22} style={styles.iconBtn}>
          <View style={styles.iconBtnContent}>
            <Feather name="image" size={20} color={theme.colors.accent.primary} />
          </View>
        </GlassCapsule>
      </Pressable>

      {/* Text input bubble */}
      <GlassCapsule isDark={isDark} borderRadius={22} style={styles.inputWrap}>
        <View style={styles.inputContent}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('chat.input_placeholder')}
            placeholderTextColor={theme.colors.text.tertiary}
            style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20 }}
            multiline
            textAlignVertical="center"
            onContentSizeChange={handleContentSizeChange}
          />
          {/* GIF button inside the input, right side. alignSelf:flex-end so it
              stays at the bottom row of the input wrap when text wraps. */}
          <Pressable onPress={onOpenGif} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, marginBottom: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.colors.accent.primary + '22' }}>
            <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.accent.primary }}>GIF</Text>
          </Pressable>
        </View>
      </GlassCapsule>

      {/* Send / commit edit button — turns into a filled accent capsule when
          submission is possible, otherwise stays neutral glass. */}
      <Pressable onPress={handleSend} hitSlop={4} style={styles.iconBtnHit}>
        <GlassCapsule
          isDark={isDark}
          borderRadius={22}
          style={styles.iconBtn}
          tinted={canSend ? { color: theme.colors.accent.primary } : undefined}
        >
          <View style={styles.iconBtnContent}>
            <Feather name={isEditing ? 'check' : 'send'} size={18} color={canSend ? '#FFFFFF' : theme.colors.text.tertiary} />
          </View>
        </GlassCapsule>
      </Pressable>
    </Reanimated.View>
  );
}));

const styles = StyleSheet.create({
  // Anchor every direct child to the bottom edge of the row so growing the
  // TextInput pushes only the input wrap upward; image/GIF/send buttons stay
  // pinned to the bottom (which is the keyboard top), so visually the user
  // sees only the input bubble grow, not the buttons jump.
  row: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8 },
  // Hit region wrapping the GlassCapsule — the capsule itself needs `overflow: 'hidden'`
  // so we can't put `Pressable` inside it without losing iOS press ripple feel.
  iconBtnHit: { marginHorizontal: 4 },
  iconBtn: { width: 44, height: 44 },
  iconBtnContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1, minHeight: 44 },
  // Inner padded row that holds the TextInput and the GIF chip.
  inputContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, minHeight: 44 },
  sendBtn: { width: 44, height: 44 },
});
