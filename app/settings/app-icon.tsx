import React, { useState, useEffect } from 'react';
import { View, Pressable, ScrollView, Image, ActivityIndicator, Alert, Platform, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import {
  setAlternateAppIcon,
  getAppIconName,
  resetAppIcon,
  supportsAlternateIcons,
} from 'expo-alternate-app-icons';

interface IconOption {
  // null = default app icon
  name: string | null;
  label: string;
  source: any;
}

// Bundled previews. The actual home-screen icon is installed natively by the
// expo-alternate-app-icons config plugin; these images are just for the picker UI.
const ICONS: IconOption[] = [
  { name: null, label: 'По умолчанию', source: require('../../assets/icon.png') },
  { name: 'Classic', label: 'Классическая', source: require('../../assets/app-icons/classic.png') },
  { name: 'Dark', label: 'Тёмная', source: require('../../assets/app-icons/dark.png') },
  { name: 'Blue', label: 'Синяя', source: require('../../assets/app-icons/blue.png') },
  { name: 'Orange', label: 'Оранжевая', source: require('../../assets/app-icons/orange.png') },
  { name: 'Mono', label: 'Моно', source: require('../../assets/app-icons/mono.png') },
  { name: 'Gradient', label: 'Градиент', source: require('../../assets/app-icons/gradient.png') },
];

export default function AppIconScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    try {
      setCurrent(getAppIconName());
    } catch {
      setCurrent(null);
    }
  }, []);

  const handleSelect = async (icon: IconOption) => {
    if (Platform.OS !== 'ios') {
      Alert.alert('Недоступно', 'Смена иконки доступна только на iOS.');
      return;
    }
    if (!supportsAlternateIcons) {
      Alert.alert('Недоступно', 'Это устройство не поддерживает смену иконки.');
      return;
    }
    // Compare against current (null/default normalizes to null).
    const isSame = (icon.name ?? null) === (current ?? null);
    if (isSame || applying) return;

    setApplying(icon.name ?? 'default');
    try {
      await setAlternateAppIcon(icon.name);
      setCurrent(icon.name ?? null);
    } catch (e: any) {
      Alert.alert('Ошибка', 'Не удалось сменить иконку.');
    } finally {
      setApplying(null);
    }
  };

  const bgColor = theme.colors.background.primary;
  const bgTransparent = theme.colors.background.primary + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Gradient fade header (same pattern as Settings) */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, height: headerGradientHeight }} pointerEvents="box-none">
        <LinearGradient
          colors={[bgColor, bgColor, bgTransparent]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 20,
            paddingTop: insets.top + 8,
            paddingBottom: 8,
            position: 'relative',
          }}
          pointerEvents="auto"
        >
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ position: 'absolute', left: 20, top: insets.top + 8 }}>
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="subheading" weight="bold">Иконка приложения</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: headerContentHeight, paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginBottom: 16, paddingHorizontal: 4 }}>
          Выберите иконку, которая будет отображаться на главном экране телефона.
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {ICONS.map((icon) => {
            const selected = (icon.name ?? null) === (current ?? null);
            const isApplying = applying === (icon.name ?? 'default');
            return (
              <Pressable
                key={icon.label}
                onPress={() => handleSelect(icon)}
                style={{
                  width: '31%',
                  alignItems: 'center',
                  marginBottom: 20,
                }}
              >
                <View
                  style={{
                    width: '100%',
                    aspectRatio: 1,
                    borderRadius: 20,
                    overflow: 'hidden',
                    borderWidth: selected ? 2.5 : 1,
                    borderColor: selected ? theme.colors.accent.primary : theme.colors.border.light,
                  }}
                >
                  <Image source={icon.source} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  {isApplying && (
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
                      <ActivityIndicator color="#FFF" />
                    </View>
                  )}
                  {selected && !isApplying && (
                    <View style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
                      <Feather name="check" size={13} color="#FFF" />
                    </View>
                  )}
                </View>
                <Text variant="caption" weight={selected ? 'semibold' : 'regular'} color={selected ? theme.colors.accent.primary : theme.colors.text.secondary} style={{ marginTop: 6 }} numberOfLines={1}>
                  {icon.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
