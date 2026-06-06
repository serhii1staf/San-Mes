import React, { useRef, useEffect } from 'react';
import { View, Pressable, Modal, Animated, Dimensions, ScrollView, Text as RNText } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';

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
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: true }),
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
          <Animated.View style={{ transform: [{ translateY: slideAnim }] }}>
            <View style={{ marginHorizontal: 8, marginBottom: 16, maxHeight: SCREEN_HEIGHT * 0.6, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}>
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
              </View>
              <Text variant="body" weight="bold" align="center" style={{ marginBottom: 12 }}>Выберите эмодзи</Text>
              <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                {EMOJIS.map((e) => (
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
