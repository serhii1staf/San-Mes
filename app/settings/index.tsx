import React, { useState } from 'react';
import { View, ScrollView, Pressable, Switch, ViewStyle, Alert, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { useSettingsStore } from '../../src/store/settingsStore';

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
  const { hapticEnabled, useInAppBrowser, setHaptic, setInAppBrowser } = useSettingsStore();
  const [faceId, setFaceId] = useState(true);

  const handleLogout = () => {
    Alert.alert('Выход', 'Вы уверены, что хотите выйти?', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Выйти',
        style: 'destructive',
        onPress: () => {
          logout();
          // AuthNavigationGuard will handle redirect to login
        },
      },
    ]);
  };

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const bgColor = theme.colors.background.primary;
  const bgTransparent = theme.colors.background.primary + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

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
      {/* Gradient fade header */}
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
            paddingHorizontal: theme.spacing.lg,
            paddingTop: insets.top + 8,
            paddingBottom: 8,
            position: 'relative',
          }}
          pointerEvents="auto"
        >
          <Pressable
            onPress={() => router.back()}
            style={{ position: 'absolute', left: theme.spacing.lg, top: insets.top + 8 }}
          >
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="subheading" weight="bold">Настройки</Text>
        </View>
      </View>

      {/* Scrollable Content */}
      <ScrollView contentContainerStyle={{ paddingBottom: 100, paddingHorizontal: theme.spacing.lg, paddingTop: headerContentHeight }} showsVerticalScrollIndicator={false}>
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
            onPress={() => router.push('/settings/appearance')}
          />
          <SettingsRow
            icon="database"
            label="Данные и память"
            onPress={() => router.push('/settings/storage')}
          />
          <SettingsRow
            icon="smartphone"
            label="Вибро-отклик"
            showChevron={false}
            rightElement={
              <Switch
                value={hapticEnabled}
                onValueChange={setHaptic}
                trackColor={{ true: '#4CD964', false: theme.colors.border.light }}
                thumbColor="#FFFFFF"
              />
            }
          />
          <SettingsRow
            icon="globe"
            label="Встроенный браузер"
            showChevron={false}
            rightElement={
              <Switch
                value={useInAppBrowser}
                onValueChange={setInAppBrowser}
                trackColor={{ true: '#4CD964', false: theme.colors.border.light }}
                thumbColor="#FFFFFF"
              />
            }
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
            onPress={() => router.push('/settings/device-key')}
          />
          <SettingsRow
            icon="shield"
            label="Политика конфиденциальности"
            onPress={() => router.push('/settings/privacy')}
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
