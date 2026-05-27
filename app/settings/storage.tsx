import React, { useState } from 'react';
import { View, Pressable, ViewStyle, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { triggerHaptic } from '../../src/utils/haptics';

function StorageRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
    }}>
      <View style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: theme.colors.background.secondary,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 14,
      }}>
        <Feather name={icon as keyof typeof Feather.glyphMap} size={18} color={theme.colors.text.secondary} />
      </View>
      <Text variant="body" style={{ flex: 1 }}>{label}</Text>
      <Text variant="caption" color={theme.colors.text.tertiary}>{value}</Text>
    </View>
  );
}

export default function StorageScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [isClearing, setIsClearing] = useState(false);

  const handleClearCache = async () => {
    triggerHaptic('medium');
    setIsClearing(true);
    try {
      const keys = await AsyncStorage.getAllKeys();
      const nonAuthKeys = keys.filter(k => !k.includes('auth'));
      await AsyncStorage.multiRemove(nonAuthKeys);
      Alert.alert('Готово', 'Кэш успешно очищен');
    } catch (e) {
      Alert.alert('Ошибка', 'Не удалось очистить кэш');
    }
    setIsClearing(false);
  };

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
        <Text variant="subheading" weight="bold">Данные и память</Text>
      </View>

      <View style={{ paddingHorizontal: 24 }}>
        {/* Storage usage */}
        <Text variant="body" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 12 }}>
          Использование
        </Text>
        <View style={{
          backgroundColor: theme.colors.background.elevated,
          borderRadius: 16,
          overflow: 'hidden',
          marginBottom: 24,
        }}>
          <StorageRow icon="image" label="Фото" value="0 KB" />
          <StorageRow icon="video" label="Видео" value="0 KB" />
          <StorageRow icon="file" label="Файлы" value="0 KB" />
          <StorageRow icon="message-circle" label="Сообщения" value="0 KB" />
        </View>

        {/* Cache */}
        <Text variant="body" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 12 }}>
          Кэш
        </Text>
        <View style={{
          backgroundColor: theme.colors.background.elevated,
          borderRadius: 16,
          overflow: 'hidden',
          marginBottom: 24,
        }}>
          <StorageRow icon="hard-drive" label="Общий кэш" value="0 KB" />
        </View>

        <Pressable
          onPress={handleClearCache}
          disabled={isClearing}
          style={{
            paddingVertical: 16,
            alignItems: 'center',
            backgroundColor: theme.colors.background.elevated,
            borderRadius: 16,
            opacity: isClearing ? 0.5 : 1,
          }}
        >
          <Text variant="body" weight="semibold" color={theme.colors.accent.primary}>
            {isClearing ? 'Очистка...' : 'Очистить кэш'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
