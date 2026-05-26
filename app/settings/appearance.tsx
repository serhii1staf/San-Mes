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
  const { accent, setAccent } = useThemeStore();

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
        {/* Color theme selection */}
        <Text variant="body" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 16 }}>
          Цветовая тема
        </Text>

        <View style={{ gap: 12, marginBottom: 32 }}>
          {ACCENT_COLORS.map((c) => {
            const isSelected = accent === c.key;
            return (
              <Pressable
                key={c.key}
                onPress={() => setAccent(c.key)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 14,
                  paddingHorizontal: 16,
                  borderRadius: 16,
                  backgroundColor: theme.colors.background.elevated,
                  borderWidth: isSelected ? 2 : 0,
                  borderColor: c.color,
                }}
              >
                {/* Color circle */}
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: c.color,
                    marginRight: 14,
                  }}
                />
                <Text variant="body" weight={isSelected ? 'semibold' : 'regular'} style={{ flex: 1 }}>
                  {c.label}
                </Text>
                {isSelected && (
                  <Feather name="check-circle" size={20} color={c.color} />
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Preview */}
        <Text variant="body" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 12 }}>
          Предпросмотр
        </Text>

        {/* Mini app preview */}
        <View style={{
          backgroundColor: theme.colors.background.elevated,
          borderRadius: 24,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.colors.border.light,
        }}>
          {/* Mini header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
            <Text variant="body" weight="bold">San</Text>
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 9, color: '#FFF' }}>2</Text>
            </View>
          </View>

          {/* Mini stories row */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, gap: 12 }}>
            {['😊', '🌸', '🌿', '🦋'].map((e, i) => (
              <View key={i} style={{ alignItems: 'center' }}>
                <View style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  borderWidth: 2,
                  borderColor: i === 0 ? theme.colors.border.light : theme.colors.accent.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 18 }}>{e}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Mini post */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ fontSize: 18, marginRight: 8 }}>🌿</Text>
              <View>
                <Text variant="caption" weight="semibold">Alex Woods</Text>
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 9 }}>2m ago</Text>
              </View>
            </View>
            <Text variant="caption" color={theme.colors.text.secondary} numberOfLines={2}>
              Golden hour in the forest today...
            </Text>
            {/* Mini image placeholder */}
            <View style={{
              height: 80,
              borderRadius: 12,
              backgroundColor: theme.colors.background.secondary,
              marginTop: 8,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Feather name="image" size={24} color={theme.colors.text.tertiary} />
            </View>
            {/* Mini actions */}
            <View style={{ flexDirection: 'row', marginTop: 8, gap: 16 }}>
              <Feather name="heart" size={14} color={theme.colors.accent.primary} />
              <Feather name="message-circle" size={14} color={theme.colors.text.tertiary} />
              <Feather name="repeat" size={14} color={theme.colors.text.tertiary} />
            </View>
          </View>

          {/* Mini tab bar */}
          <View style={{
            flexDirection: 'row',
            justifyContent: 'space-around',
            paddingVertical: 10,
            borderTopWidth: 0.5,
            borderTopColor: theme.colors.border.light,
            marginTop: 8,
          }}>
            <Feather name="home" size={16} color={theme.colors.accent.primary} />
            <Feather name="search" size={16} color={theme.colors.text.tertiary} />
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.accent.secondary, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="plus" size={12} color="#FFF" />
            </View>
            <Feather name="send" size={16} color={theme.colors.text.tertiary} />
            <Feather name="user" size={16} color={theme.colors.text.tertiary} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
