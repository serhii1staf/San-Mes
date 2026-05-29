import React from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useThemeStore, FONT_FAMILIES, FONT_SIZES } from '../../src/store/themeStore';

export default function FontsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { fontFamily, fontSize, setFontFamily, setFontSize } = useThemeStore();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: insets.top + 8, paddingBottom: 16, position: 'relative' }}>
        <Pressable onPress={() => router.back()} style={{ position: 'absolute', left: 24, top: insets.top + 8 }}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="body" weight="bold">Шрифты</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {/* Preview */}
        <View style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 20, padding: 20, marginBottom: 28, borderWidth: 1, borderColor: theme.colors.border.light }}>
          <Text variant="body" weight="bold" style={{ marginBottom: 8 }}>Привет, мир! 👋</Text>
          <Text variant="body" color={theme.colors.text.secondary} style={{ marginBottom: 12 }}>Это пример текста с текущими настройками.</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1, backgroundColor: theme.colors.accent.primary + '15', borderRadius: 12, padding: 10 }}>
              <Text variant="caption" weight="semibold" color={theme.colors.accent.primary}>Заголовок</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 2 }}>Подзаголовок</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: theme.colors.background.secondary, borderRadius: 12, padding: 10 }}>
              <Text variant="caption" weight="medium">12:30</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 2 }}>Сообщение</Text>
            </View>
          </View>
        </View>

        {/* Font Size */}
        <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 12 }}>Размер текста</Text>
        <View style={{ gap: 8, marginBottom: 28 }}>
          {FONT_SIZES.map(f => (
            <Pressable
              key={f.key}
              onPress={() => setFontSize(f.key)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderRadius: 14,
                backgroundColor: fontSize === f.key ? theme.colors.accent.primary + '15' : theme.colors.background.elevated,
                borderWidth: fontSize === f.key ? 1.5 : 0,
                borderColor: theme.colors.accent.primary,
              }}
            >
              <Text variant="body" weight={fontSize === f.key ? 'semibold' : 'regular'} color={fontSize === f.key ? theme.colors.accent.primary : theme.colors.text.primary}>
                {f.label}
              </Text>
              <Text variant="caption" color={theme.colors.text.tertiary}>{Math.round(f.scale * 100)}%</Text>
            </Pressable>
          ))}
        </View>

        {/* Font Family */}
        <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 12 }}>Шрифт</Text>
        <View style={{ gap: 8 }}>
          {FONT_FAMILIES.map(f => (
            <Pressable
              key={f.key}
              onPress={() => setFontFamily(f.key)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderRadius: 14,
                backgroundColor: fontFamily === f.key ? theme.colors.accent.primary + '15' : theme.colors.background.elevated,
                borderWidth: fontFamily === f.key ? 1.5 : 0,
                borderColor: theme.colors.accent.primary,
              }}
            >
              <Text variant="body" weight={fontFamily === f.key ? 'semibold' : 'regular'} color={fontFamily === f.key ? theme.colors.accent.primary : theme.colors.text.primary}>
                {f.label}
              </Text>
              {fontFamily === f.key && <Feather name="check" size={18} color={theme.colors.accent.primary} />}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
