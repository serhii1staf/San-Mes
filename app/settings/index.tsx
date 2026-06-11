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

// Per-row tint pairs (icon color + soft tile bg) — picked to be readable in
// both light and dark mode without being eye-piercing. Same hue family as
// system iOS Settings but desaturated.
const ICON_TINTS = {
  blue:    { fg: '#0A84FF', bg: 'rgba(10,132,255,0.16)'   },
  red:     { fg: '#FF453A', bg: 'rgba(255,69,58,0.16)'    },
  orange:  { fg: '#FF9F0A', bg: 'rgba(255,159,10,0.16)'   },
  yellow:  { fg: '#FFD60A', bg: 'rgba(255,214,10,0.18)'   },
  green:   { fg: '#30D158', bg: 'rgba(48,209,88,0.16)'    },
  teal:    { fg: '#40C8E0', bg: 'rgba(64,200,224,0.16)'   },
  cyan:    { fg: '#64D2FF', bg: 'rgba(100,210,255,0.16)'  },
  indigo:  { fg: '#5E5CE6', bg: 'rgba(94,92,230,0.16)'    },
  purple:  { fg: '#BF5AF2', bg: 'rgba(191,90,242,0.16)'   },
  pink:    { fg: '#FF66D9', bg: 'rgba(255,102,217,0.16)'  },
  gray:    { fg: '#8E8E93', bg: 'rgba(142,142,147,0.18)'  },
} as const;
type IconTint = keyof typeof ICON_TINTS;

function SettingsRow({
  icon,
  iconTint,
  label,
  value,
  onPress,
  showChevron = true,
  rightElement,
  isLast,
}: {
  icon: keyof typeof Feather.glyphMap;
  iconTint: IconTint;
  label: string;
  value?: string;
  onPress?: () => void;
  showChevron?: boolean;
  rightElement?: React.ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const theme = useTheme();
  const tint = ICON_TINTS[iconTint];
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
          width: 32,
          height: 32,
          // Round-rectangle iOS-Settings-style tile (~28% radius — closer to
          // an iOS app-icon shape than a fully rounded squircle). The user
          // said the previous 14 px (~44%) read as too circle-like; 9 keeps
          // the corners obviously rounded but the silhouette stays a square.
          borderRadius: 9,
          backgroundColor: tint.bg,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 14,
        }}
      >
        <Feather name={icon} size={17} color={tint.fg} />
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
  // Field-level selectors — pulling the whole settings store re-rendered
  // the screen on every unrelated state change.
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const useInAppBrowser = useSettingsStore((s) => s.useInAppBrowser);
  const setHaptic = useSettingsStore((s) => s.setHaptic);
  const setInAppBrowser = useSettingsStore((s) => s.setInAppBrowser);
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
          // Flush this account's in-memory data and re-scope cache to anon so the
          // next account never sees the previous one's feed/chats/profile.
          try { require('../../src/services/accountSwitch').switchAccount(null); } catch {}
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
              // Wipe ALL on-device data so nothing about the user remains locally
              // (App Store / Google Play data-deletion requirement).
              try {
                const { kvClearAll } = await import('../../src/services/kvStore');
                await kvClearAll();
              } catch {}
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
    borderRadius: 24,
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
            iconTint="blue"
            label="Профиль"
            onPress={() => router.push('/profile/edit')}
            isFirst
          />
          <SettingsRow
            icon="bell"
            iconTint="red"
            label="Уведомления"
            onPress={() => router.push('/notifications')}
          />
          <SettingsRow
            icon="hard-drive"
            iconTint="green"
            label="Данные и память"
            onPress={() => router.push('/settings/storage')}
          />
          <SettingsRow
            icon="zap"
            iconTint="orange"
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
            iconTint="cyan"
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
            icon="droplet"
            iconTint="purple"
            label="Внешний вид"
            onPress={() => router.push('/settings/appearance')}
            isFirst
          />
          <SettingsRow
            icon="type"
            iconTint="indigo"
            label="Шрифты"
            onPress={() => router.push('/settings/fonts' as any)}
          />
          <SettingsRow
            icon="grid"
            iconTint="pink"
            label="Иконка приложения"
            onPress={() => setIconModalVisible(true)}
          />
          <SettingsRow
            icon="layout"
            iconTint="teal"
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
            iconTint="blue"
            label="Устройства"
            value="2"
            onPress={() => router.push('/settings/device-key')}
            isFirst
          />
          <SettingsRow
            icon="shield"
            iconTint="gray"
            label="Политика конфиденциальности"
            onPress={() => Linking.openURL('https://legal.san-m-app.com/privacy.html').catch(() => {})}
          />
          <SettingsRow
            icon="file-text"
            iconTint="gray"
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
