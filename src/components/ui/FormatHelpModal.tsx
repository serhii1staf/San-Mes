import React from 'react';
import { View, Pressable, Modal, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';

interface FormatHelpModalProps {
  visible: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
}

const FORMAT_OPTIONS = [
  { label: '@упоминание', syntax: '@username', description: 'Упомяните пользователя', icon: 'at-sign' },
  { label: 'Жирный', syntax: '**текст**', description: 'Выделяет текст жирным', icon: 'bold' },
  { label: 'Курсив', syntax: '*текст*', description: 'Наклонный текст', icon: 'italic' },
  { label: 'Спойлер', syntax: '||текст||', description: 'Скрытый текст до нажатия', icon: 'eye-off' },
  { label: 'Код', syntax: '`код`', description: 'Моноширинный текст', icon: 'code' },
  { label: 'Зачёркнутый', syntax: '~~текст~~', description: 'Перечёркнутый текст', icon: 'minus' },
  { label: 'Подчёркнутый', syntax: '__текст__', description: 'Подчёркнутый текст', icon: 'underline' },
  { label: 'Хэштег', syntax: '#тег', description: 'Выделяет хэштег цветом', icon: 'hash' },
  { label: 'Скрытое фото', syntax: '(добавь фото + ↓)', description: 'Фото скрыто до нажатия', icon: 'image' },
];

export function FormatHelpModal({ visible, onClose, onInsert }: FormatHelpModalProps) {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', maxHeight: '60%' }}>
            {/* Handle */}
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
            </View>
            <Text variant="body" weight="bold" align="center" style={{ marginBottom: 12 }}>Форматирование</Text>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}>
              {FORMAT_OPTIONS.map((opt, i) => (
                <Pressable
                  key={i}
                  onPress={() => { onInsert(opt.syntax); onClose(); }}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: i < FORMAT_OPTIONS.length - 1 ? 0.5 : 0, borderBottomColor: theme.colors.border.light }}
                >
                  <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.colors.accent.primary + '15', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                    <Feather name={opt.icon as any} size={16} color={theme.colors.accent.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="body" weight="medium">{opt.label}</Text>
                    <Text variant="caption" color={theme.colors.text.tertiary}>{opt.description}</Text>
                  </View>
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontFamily: 'Courier', fontSize: 11 }}>{opt.syntax}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}
