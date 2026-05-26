import React, { useState } from 'react';
import { View, ScrollView, Pressable, Switch, ViewStyle, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';

function SettingsRow({
  icon,
  label,
  value,
  onPress,
  showChevron = true,
  rightElement,
  isLast,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  showChevron?: boolean;
  rightElement?: React.ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: isLast ? 0 : 0.5,
        borderBottomColor: theme.colors.border.light,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: theme.colors.background.secondary,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 14,
        }}
      >
        <Feather name={icon as keyof typeof Feather.glyphMap} size={18} color={theme.colors.text.secondary} />
      </View>
      <Text variant="body" style={{ flex: 1 }}>{label}</Text>
      {value && (
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginRight: 8 }}>
          {value}
        </Text>
      )}
      {rightElement}
      {showChevron && !rightElement && (
        <Feather name="chevron-right" size={18} color={theme.colors.text.tertiary} />
      )}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { logout } = useAuthStore();
  const [faceId, setFaceId] = useState(true);

  const handleLogout = () => {
    Alert.alert('Выход', 'Вы уверены, что хотите выйти?', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Выйти',
        style: 'destructive',
        onPress: () => {
          logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const sectionCardStyle: ViewStyle = {
    backgroundColor: theme.colors.background.elevated,
    borderRadius: 16,
    marginBottom: 24,
    overflow: 'hidden',
  };

  const sectionTitleStyle: ViewStyle = {
    marginBottom: 8,
    paddingHorizontal: 4,
  };

  return (
    <View style={containerStyle}>
      {/* Sticky Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: theme.spacing.lg,
          paddingTop: insets.top + 8,
          paddingBottom: theme.spacing.md,
          backgroundColor: theme.colors.background.primary,
          position: 'relative',
          zIndex: 10,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{ position: 'absolute', left: theme.spacing.lg, top: insets.top + 8 }}
        >
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="subheading" weight="bold">Настройки</Text>
      </View>

      {/* Scrollable Content */}
      <ScrollView contentContainerStyle={{ paddingBottom: 100, paddingHorizontal: theme.spacing.lg }} showsVerticalScrollIndicator={false}>
        {/* Общие */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            Общие
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="user"
            label="Профиль"
            onPress={() => router.push('/profile/edit')}
            isFirst
          />
          <SettingsRow
            icon="bell"
            label="Уведомления"
            onPress={() => router.push('/notifications')}
          />
          <SettingsRow
            icon="sun"
            label="Внешний вид"
          />
          <SettingsRow
            icon="database"
            label="Данные и память"
          />
          <SettingsRow
            icon="folder"
            label="Папки с чатами"
            isLast
          />
        </View>

        {/* Безопасность */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            Безопасность
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="shield"
            label="Face ID"
            showChevron={false}
            rightElement={
              <Switch
                value={faceId}
                onValueChange={setFaceId}
                trackColor={{ true: '#4CD964', false: theme.colors.border.light }}
                thumbColor="#FFFFFF"
              />
            }
            isFirst
          />
          <SettingsRow
            icon="lock"
            label="Конфиденциальность"
          />
          <SettingsRow
            icon="smartphone"
            label="Устройства"
            value="2"
            isLast
          />
        </View>

        {/* Платежи */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            Платежи
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="file-text"
            label="Квитанции"
            isFirst
            isLast
          />
        </View>

        {/* Logout */}
        <Pressable
          onPress={handleLogout}
          style={{
            paddingVertical: 16,
            alignItems: 'center',
            backgroundColor: theme.colors.background.elevated,
            borderRadius: 16,
            marginTop: 8,
          }}
        >
          <Text variant="body" weight="semibold" color={theme.colors.status.error}>
            Выйти
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
