import React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';

export default function PrivacyPolicyScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: insets.top + 8, paddingBottom: 16, position: 'relative' }}>
        <Pressable onPress={() => router.back()} style={{ position: 'absolute', left: 24, top: insets.top + 8 }}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="subheading" weight="bold">Конфиденциальность</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <Text variant="body" weight="semibold" style={{ marginBottom: 12 }}>Политика конфиденциальности San</Text>
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginBottom: 20 }}>Последнее обновление: 27 мая 2026</Text>

        <Text variant="body" weight="semibold" style={{ marginTop: 16, marginBottom: 8 }}>1. Какие данные мы собираем</Text>
        <Text variant="body" color={theme.colors.text.secondary} style={{ marginBottom: 12, lineHeight: 22 }}>
          Мы собираем минимальный объём данных для работы приложения: имя пользователя, отображаемое имя, эмодзи-аватар, биографию, и контент который вы публикуете (посты, комментарии, сообщения).
        </Text>

        <Text variant="body" weight="semibold" style={{ marginTop: 16, marginBottom: 8 }}>2. Как мы используем данные</Text>
        <Text variant="body" color={theme.colors.text.secondary} style={{ marginBottom: 12, lineHeight: 22 }}>
          Ваши данные используются исключительно для предоставления функциональности приложения: отображение профиля, публикация контента, обмен сообщениями с другими пользователями.
        </Text>

        <Text variant="body" weight="semibold" style={{ marginTop: 16, marginBottom: 8 }}>3. Хранение данных</Text>
        <Text variant="body" color={theme.colors.text.secondary} style={{ marginBottom: 12, lineHeight: 22 }}>
          Данные хранятся на защищённых серверах Supabase. Мы не передаём ваши персональные данные третьим лицам без вашего согласия.
        </Text>

        <Text variant="body" weight="semibold" style={{ marginTop: 16, marginBottom: 8 }}>4. Безопасность</Text>
        <Text variant="body" color={theme.colors.text.secondary} style={{ marginBottom: 12, lineHeight: 22 }}>
          Вход в аккаунт защищён 4-значным PIN-кодом и уникальным ключом устройства. Мы не храним PIN в открытом виде — только хеш.
        </Text>

        <Text variant="body" weight="semibold" style={{ marginTop: 16, marginBottom: 8 }}>5. Ваши права</Text>
        <Text variant="body" color={theme.colors.text.secondary} style={{ marginBottom: 12, lineHeight: 22 }}>
          Вы можете в любой момент удалить свой аккаунт и все связанные данные. Для этого обратитесь в поддержку или используйте соответствующую функцию в настройках.
        </Text>

        <Text variant="body" weight="semibold" style={{ marginTop: 16, marginBottom: 8 }}>6. Контакты</Text>
        <Text variant="body" color={theme.colors.text.secondary} style={{ marginBottom: 12, lineHeight: 22 }}>
          По вопросам конфиденциальности пишите нам в приложении или на email поддержки.
        </Text>
      </ScrollView>
    </View>
  );
}
