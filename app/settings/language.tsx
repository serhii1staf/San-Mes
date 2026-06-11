import React from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useI18nStore, useT, SUPPORTED_LOCALES, Locale } from '../../src/i18n/store';
import { triggerHaptic } from '../../src/utils/haptics';

export default function LanguageScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);

  const cardBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';

  const choose = (next: Locale) => {
    if (next === locale) return;
    triggerHaptic('selection');
    setLocale(next);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="body" weight="bold" style={{ flex: 1, textAlign: 'center', marginRight: 32 }}>
          {t('language.title')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        <View style={{ backgroundColor: cardBg, borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
          {SUPPORTED_LOCALES.map((opt, idx) => {
            const isLast = idx === SUPPORTED_LOCALES.length - 1;
            const isSelected = locale === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => choose(opt.key)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderBottomWidth: isLast ? 0 : 0.5,
                  borderBottomColor: theme.colors.border.light,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="body" weight="semibold">{opt.native}</Text>
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 2 }}>{opt.name}</Text>
                </View>
                {isSelected && <Feather name="check" size={20} color={theme.colors.accent.primary} />}
              </Pressable>
            );
          })}
        </View>
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ paddingHorizontal: 4 }}>
          {t('language.hint')}
        </Text>
      </ScrollView>
    </View>
  );
}
