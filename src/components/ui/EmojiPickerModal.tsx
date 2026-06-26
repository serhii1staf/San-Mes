import React, { useRef, useEffect, useState } from 'react';
import { View, Pressable, Modal, Animated, Dimensions, ScrollView, Text as RNText, Easing, Platform } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { useLiquidGlassActive, GlassBg } from './LiquidGlass';
import { useT } from '../../i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const EMOJIS = [
  '😊', '😎', '🥰', '🤩', '😇', '🦊', '🐱', '🐶',
  '🦁', '🐼', '🐨', '🦋', '🌸', '🌺', '🍀', '✨',
  '🔥', '💎', '🎭', '🎨', '🎵', '🌙', '☀️', '🌈',
  '🍄', '🪷', '🫧', '🧿', '💫', '🪐', '🌊', '🍂',
  '🦄', '🐯', '🐰', '🦉', '🐸', '🐝', '🌻', '🍓',
  '⚡', '❄️', '🎮', '🚀', '🎸', '📚', '☕', '🍕',
];

interface EmojiPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
}

export function EmojiPickerModal({ visible, onClose, onSelect }: EmojiPickerModalProps) {
  const theme = useTheme();
  const t = useT();
  // Native iOS-26 liquid glass for the sheet surface. iOS-only + opt-in.
  const glassActive = useLiquidGlassActive();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  // Subtle scale paired with the slide so the sheet eases in instead of
  // snapping up — combined with a gentle cubic-out timing this removes the
  // abrupt "pop" the spring entrance produced.
  const scaleAnim = useRef(new Animated.Value(0.96)).current;
  // Defer mounting the 48 emoji cells (Pressable + RNText each) by one paint
  // after the open animation starts, so the open/slide-in frame carries only
  // the cheap handle + title. The ScrollView itself still mounts immediately
  // to keep layout/height stable; only its heavy children appear one frame
  // later — invisible since the slide-in runs 300ms. (Mirrors PostMenuModal.)
  const [contentReady, setContentReady] = useState(false);
  // RAF handles for the deferred content reveal — tracked so they can be
  // cancelled on cleanup / when `visible` flips before they fire.
  const rafA = useRef<number | null>(null);
  const rafB = useRef<number | null>(null);

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
      scaleAnim.setValue(0.96);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
      // Reveal the heavy emoji grid one paint after the open animation has
      // been kicked off, keeping the first (open) frame cheap.
      rafA.current = requestAnimationFrame(() => {
        rafB.current = requestAnimationFrame(() => setContentReady(true));
      });
    } else {
      setContentReady(false);
    }
    return () => {
      if (rafA.current != null) { cancelAnimationFrame(rafA.current); rafA.current = null; }
      if (rafB.current != null) { cancelAnimationFrame(rafB.current); rafB.current = null; }
    };
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 0.98, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) onClose(); });
  };

  const pick = (e: string) => {
    onSelect(e);
    dismiss();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdropAnim }}>
          <Pressable style={{ flex: 1 }} onPress={dismiss} />
        </Animated.View>
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY: slideAnim }, { scale: scaleAnim }] }}>
            <View style={{ marginHorizontal: 8, marginBottom: 16, maxHeight: SCREEN_HEIGHT * 0.6, backgroundColor: glassActive ? 'transparent' : (theme.isDark ? theme.colors.background.elevated : '#FFFFFF'), borderRadius: 28, overflow: 'hidden',
              // Heavy ambient shadow is iOS-only. On Android, a large
              // `elevation` on this big animating sheet forces the GPU to
              // re-render an expensive shadow projection every frame of the
              // slide-in — on weak Android 10 devices that lands on the same
              // frames the Modal's native view is being constructed and
              // produces a residual UI-thread stall (perfMonitor: ui<30 @
              // chat/ai). Drop to a small elevation on Android; the visual is
              // essentially unchanged behind the rounded sheet.
              ...(Platform.OS === 'ios'
                ? { shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16 }
                : { elevation: 2 }) }}>
              {/* Liquid-glass sheet surface (static, non-interactive) behind the
                  content. Tinted so it reads as frosted over the dimmed modal
                  backdrop instead of nearly-clear `regular` glass. */}
              {glassActive ? (
                <GlassBg
                  borderRadius={28}
                  glassStyle="regular"
                  interactive={false}
                  colorScheme={theme.isDark ? 'dark' : 'light'}
                  tintColor={theme.isDark ? 'rgba(26,26,31,0.6)' : 'rgba(255,255,255,0.6)'}
                />
              ) : null}
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
              </View>
              <Text variant="body" weight="bold" align="center" style={{ marginBottom: 12 }}>{t('emoji_picker.title')}</Text>
              <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                {contentReady && EMOJIS.map((e) => (
                  <Pressable
                    key={e}
                    onPress={() => pick(e)}
                    style={{ width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <RNText style={{ fontSize: 30 }} allowFontScaling={false}>{e}</RNText>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}
