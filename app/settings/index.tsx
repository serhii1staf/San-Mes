import React, { useState } from 'react';
import { View, ScrollView, Pressable, Switch, ViewStyle, Alert, StyleSheet, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { AppIconModal } from '../../src/components/ui/AppIconModal';
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
  const [iconModalVisible, setIconModalVisible] = useState(false);
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  // Hidden admin access: tap the "Безопасность" section title 6 times quickly.
  const adminTapCount = React.useRef(0);
  const adminLastTap = React.useRef(0);
  const handleAdminTap = () => {
    const now = Date.now();
    if (now - adminLastTap.current > 2000) adminTapCount.current = 0;
    adminLastTap.current = now;
    adminTapCount.current++;
    if (adminTapCount.current >= 6) {
      adminTapCount.current = 0;
      router.push('/settings/admin' as any);
    }
  };

  const handleLogout = () => {
    Alert.alert('Выход', 'Вы уверены, что хотите выйти?', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Выйти',
        style: 'destructive',
        onPress: () => {
          // The root AuthNavigationGuard now swaps to the splash synchronously the
          // instant auth clears, so no protected screen renders with a null user.
          // Just clear auth; the guard handles the redirect safely.
          logout();
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Удалить аккаунт?',
      'Это действие необратимо. Все ваши данные — посты, комментарии, сообщения, подписки — будут удалены навсегда.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить навсегда',
          style: 'destructive',
          onPress: async () => {
            const uid = useAuthStore.getState().user?.id;
            if (!uid) return;
            try {
              const { deleteAccount } = await import('../../src/lib/supabase');
              const { error } = await deleteAccount(uid);
              if (error) {
                Alert.alert('Ошибка', error);
                return;
              }
            } catch (e: any) {
              Alert.alert('Ошибка', e?.message || 'Не удалось удалить аккаунт');
              return;
            }
            // Guard handles the redirect synchronously once auth clears.
            logout();
          },
        },
      ]
    );
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
            isLast
            rightElement={
              <Switch
                value={useInAppBrowser}
                onValueChange={setInAppBrowser}
                trackColor={{ true: '#4CD964', false: theme.colors.border.light }}
                thumbColor="#FFFFFF"
              />
            }
          />
        </View>

        {/* Оформление */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            Оформление
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="sun"
            label="Внешний вид"
            onPress={() => router.push('/settings/appearance')}
            isFirst
          />
          <SettingsRow
            icon="type"
            label="Шрифты"
            onPress={() => router.push('/settings/fonts' as any)}
          />
          <SettingsRow
            icon="grid"
            label="Иконка приложения"
            onPress={() => setIconModalVisible(true)}
          />
          <SettingsRow
            icon="layout"
            label="Виджет"
            onPress={() => router.push('/settings/widget' as any)}
            isLast
          />
        </View>

        {/* Безопасность */}
        <Pressable onPress={handleAdminTap} style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            Безопасность
          </Text>
        </Pressable>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="smartphone"
            label="Устройства"
            value="2"
            onPress={() => router.push('/settings/device-key')}
            isFirst
          />
          <SettingsRow
            icon="shield"
            label="Политика конфиденциальности"
            onPress={() => Linking.openURL('https://legal.san-m-app.com/privacy.html').catch(() => {})}
          />
          <SettingsRow
            icon="file-text"
            label="Условия использования"
            onPress={() => Linking.openURL('https://legal.san-m-app.com/terms.html').catch(() => {})}
            isLast
          />
        </View>

        {/* Account actions: Logout + Delete side by side, version below */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <Pressable
            onPress={handleLogout}
            style={{
              flex: 1,
              paddingVertical: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.background.elevated,
              borderRadius: 14,
            }}
          >
            <Text variant="body" weight="semibold" color={theme.colors.status.error}>
              Выйти
            </Text>
          </Pressable>
          <Pressable
            onPress={handleDeleteAccount}
            style={{
              flex: 1,
              paddingVertical: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.background.elevated,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.colors.status.error + '40',
            }}
          >
            <Text variant="body" weight="semibold" color={theme.colors.text.tertiary}>
              Удалить аккаунт
            </Text>
          </Pressable>
        </View>

        {/* App version */}
        <Text variant="caption" align="center" color={theme.colors.text.tertiary} style={{ marginTop: 14, fontSize: 11 }}>
          Версия {appVersion}
        </Text>
      </ScrollView>

      <AppIconModal visible={iconModalVisible} onClose={() => setIconModalVisible(false)} />
    </View>
  );
}
