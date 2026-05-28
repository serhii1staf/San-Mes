import React, { useState, useEffect } from 'react';
import { View, Pressable, ViewStyle, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { triggerHaptic } from '../../src/utils/haptics';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [storageInfo, setStorageInfo] = useState({ posts: 0, messages: 0, profiles: 0, total: 0 });

  useEffect(() => {
    calculateStorage();
  }, []);

  const calculateStorage = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      let posts = 0, messages = 0, profiles = 0, total = 0;
      
      for (const key of keys as string[]) {
        const value = await AsyncStorage.getItem(key);
        const size = value ? new Blob([value]).size || value.length * 2 : 0;
        total += size;
        
        if (key.includes('feed') || key.includes('post')) posts += size;
        else if (key.includes('chat') || key.includes('message') || key.includes('conversation')) messages += size;
        else if (key.includes('profile') || key.includes('auth')) profiles += size;
      }
      
      setStorageInfo({ posts, messages, profiles, total });
    } catch {
      // Fallback: estimate from key count
      try {
        const keys = await AsyncStorage.getAllKeys();
        const total = (keys as string[]).length * 512; // rough estimate
        setStorageInfo({ posts: 0, messages: 0, profiles: 0, total });
      } catch {}
    }
  };

  const handleClearCache = async () => {
    triggerHaptic('medium');
    setIsClearing(true);
    try {
      const keys = await AsyncStorage.getAllKeys();
      const nonAuthKeys = (keys as string[]).filter(k => !k.includes('auth'));
      await (AsyncStorage as any).multiRemove(nonAuthKeys);
      Alert.alert('Готово', 'Кэш успешно очищен');
      setStorageInfo({ posts: 0, messages: 0, profiles: 0, total: 0 });
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
          <StorageRow icon="image" label="Публикации" value={formatBytes(storageInfo.posts)} />
          <StorageRow icon="message-circle" label="Сообщения" value={formatBytes(storageInfo.messages)} />
          <StorageRow icon="user" label="Профили" value={formatBytes(storageInfo.profiles)} />
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
          <StorageRow icon="hard-drive" label="Общий кэш" value={formatBytes(storageInfo.total)} />
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
