import React from 'react';
import { View, Pressable, ViewStyle, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useThemeStore, ACCENT_COLORS, AccentColor } from '../../src/store/themeStore';

export default function AppearanceScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { mode, accent, setMode, setAccent } = useThemeStore();

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  return (
    <View style={containerStyle}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          paddingTop: insets.top + 8,
          paddingBottom: 16,
          position: 'relative',
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{ position: 'absolute', left: 24, top: insets.top + 8 }}
        >
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="subheading" weight="bold">Внешний вид</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Theme mode */}
        <Text variant="body" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 12 }}>
          Тема
        </Text>
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 32 }}>
          <Pressable
            onPress={() => setMode('dark')}
            style={{
              flex: 1,
              paddingVertical: 20,
              borderRadius: 16,
              backgroundColor: '#1A1A1A',
              alignItems: 'center',
              borderWidth: mode === 'dark' ? 2 : 0,
              borderColor: theme.colors.accent.primary,
            }}
          >
            <Feather name="moon" size={24} color="#FFFDF9" />
            <Text variant="caption" weight="medium" color="#FFFDF9" style={{ marginTop: 8 }}>Тёмная</Text>
          </Pressable>

          <Pressable
            onPress={() => setMode('light')}
            style={{
              flex: 1,
              paddingVertical: 20,
              borderRadius: 16,
              backgroundColor: '#FFF8F0',
              alignItems: 'center',
              borderWidth: mode === 'light' ? 2 : 0,
              borderColor: theme.colors.accent.primary,
            }}
          >
            <Feather name="sun" size={24} color="#1A1A1A" />
            <Text variant="caption" weight="medium" color="#1A1A1A" style={{ marginTop: 8 }}>Светлая</Text>
          </Pressable>
        </View>

        {/* Accent color */}
        <Text variant="body" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 12 }}>
          Цвет акцента
        </Text>
        <View style={{
          backgroundColor: theme.colors.background.elevated,
          borderRadius: 16,
          padding: 16,
        }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
            {ACCENT_COLORS.map((c) => (
              <Pressable
                key={c.key}
                onPress={() => setAccent(c.key)}
                style={{ alignItems: 'center', width: 72 }}
              >
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: c.color,
                    borderWidth: accent === c.key ? 3 : 0,
                    borderColor: theme.colors.text.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {accent === c.key && (
                    <Feather name="check" size={20} color="#FFFFFF" />
                  )}
                </View>
                <Text variant="caption" color={theme.colors.text.secondary} style={{ marginTop: 6, textAlign: 'center' }}>
                  {c.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Preview */}
        <Text variant="body" weight="semibold" color={theme.colors.text.secondary} style={{ marginTop: 32, marginBottom: 12 }}>
          Предпросмотр
        </Text>
        <View style={{
          backgroundColor: theme.colors.background.elevated,
          borderRadius: 16,
          padding: 20,
          gap: 12,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 20 }}>😊</Text>
            </View>
            <View>
              <Text variant="body" weight="semibold">Пример сообщения</Text>
              <Text variant="caption" color={theme.colors.text.secondary}>Так будет выглядеть текст</Text>
            </View>
          </View>
          <View style={{ height: 36, borderRadius: 18, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="caption" weight="semibold" color="#FFFFFF">Кнопка</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
