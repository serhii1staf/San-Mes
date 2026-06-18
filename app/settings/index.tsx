import React, { useState, useEffect } from 'react';
import { View, ScrollView, Pressable, Switch, ViewStyle, Alert, StyleSheet, Linking, InteractionManager } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { useSettingsStore } from '../../src/store/settingsStore';
import { isNativeGlassCapable } from '../../src/components/ui/LiquidGlass';
import { useT } from '../../src/i18n/store';

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
  const t = useT();
  // Field-level selector — destructuring the whole auth store re-rendered
  // this screen on every unrelated auth-state change.
  const logout = useAuthStore((s) => s.logout);
  // Field-level selectors — pulling the whole settings store re-rendered
  // the screen on every unrelated state change.
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const useInAppBrowser = useSettingsStore((s) => s.useInAppBrowser);
  const perfMonitorEnabled = useSettingsStore((s) => s.perfMonitorEnabled);
  const setHaptic = useSettingsStore((s) => s.setHaptic);
  const setInAppBrowser = useSettingsStore((s) => s.setInAppBrowser);
  const setPerfMonitorEnabled = useSettingsStore((s) => s.setPerfMonitorEnabled);
  const liquidGlassEnabled = useSettingsStore((s) => s.liquidGlassEnabled);
  const setLiquidGlassEnabled = useSettingsStore((s) => s.setLiquidGlassEnabled);
  // The liquid-glass toggle is only meaningful on iOS 26+ devices where the
  // effect can actually render. Hide it everywhere else — a toggle that does
  // nothing is worse than no toggle. Computed once (capability is static).
  const glassCapable = isNativeGlassCapable();
  const [iconModalVisible, setIconModalVisible] = useState(false);
  // App version + AppIconModal are deferred past the navigation transition.
  // - `expo-alternate-app-icons` (imported inside AppIconModal) is a native
  //   module touched ONLY on this screen, so a static import resolves on the
  //   first push to /settings — landing on the same JS frame as the open
  //   animation and producing `SLOW long task @ settings` (~150 ms).
  // - `expo-constants` is also settings-only here and reading
  //   `Constants.expoConfig?.version` first-time can warm a sizeable JSON.
  // Lazy-require both after `runAfterInteractions` and gate the modal's
  // mount on the resolved component. The "App icon" row stays tappable —
  // the modal becomes visible once the component is loaded (effectively
  // one frame later on weak devices, instant on warm devices).
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [AppIconModalLazy, setAppIconModalLazy] = useState<null | React.ComponentType<{ visible: boolean; onClose: () => void }>>(null);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ExpoConstants = require('expo-constants').default;
        setAppVersion(ExpoConstants?.expoConfig?.version || '1.0.0');
      } catch {}
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('../../src/components/ui/AppIconModal');
        // Pass the component via the function-form setter so React doesn't
        // try to call it as a state updater.
        setAppIconModalLazy(() => mod.AppIconModal);
      } catch {}
    });
    return () => handle.cancel();
  }, []);

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
    Alert.alert(t('settings.logout_title'), t('settings.logout_msg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.logout_action'),
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
      t('settings.delete_account_title'),
      t('settings.delete_account_msg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.delete_forever'),
          style: 'destructive',
          onPress: async () => {
            const uid = useAuthStore.getState().user?.id;
            if (!uid) return;
            try {
              const { deleteAccount } = await import('../../src/lib/supabase');
              const { error } = await deleteAccount(uid);
              if (error) {
                Alert.alert(t('common.error'), error);
                return;
              }
              // Wipe ALL on-device data so nothing about the user remains locally
              // (App Store / Google Play data-deletion requirement).
              try {
                const { kvClearAll } = await import('../../src/services/kvStore');
                await kvClearAll();
              } catch {}
            } catch (e: any) {
              Alert.alert(t('common.error'), e?.message || t('settings.delete_failed'));
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
          <Text variant="subheading" weight="bold">{t('settings.title')}</Text>
        </View>
      </View>

      {/* Scrollable Content */}
      <ScrollView contentContainerStyle={{ paddingBottom: 100, paddingHorizontal: theme.spacing.lg, paddingTop: headerContentHeight }} showsVerticalScrollIndicator={false}>
        {/* General */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            {t('settings.section.general')}
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="user"
            iconTint="blue"
            label={t('settings.profile')}
            onPress={() => router.push('/profile/edit')}
            isFirst
          />
          <SettingsRow
            icon="bell"
            iconTint="red"
            label={t('settings.notifications')}
            onPress={() => router.push('/notifications')}
          />
          <SettingsRow
            icon="hard-drive"
            iconTint="green"
            label={t('settings.data_storage')}
            onPress={() => router.push('/settings/storage')}
          />
          <SettingsRow
            icon="zap"
            iconTint="orange"
            label={t('settings.haptic')}
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
            label={t('settings.browser')}
            value={useInAppBrowser ? t('settings.browser.in_app') : t('settings.browser.external')}
            isLast
            onPress={() => router.push('/settings/browser')}
          />
        </View>

        {/* Developer / diagnostics */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            {t('settings.section.developer', 'Разработчик')}
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="activity"
            iconTint="green"
            label={t('settings.perf_monitor', 'Монитор производительности')}
            showChevron={false}
            rightElement={
              <Switch
                value={perfMonitorEnabled}
                onValueChange={setPerfMonitorEnabled}
                trackColor={{ true: '#4CD964', false: theme.colors.border.light }}
                thumbColor="#FFFFFF"
              />
            }
            isFirst
            isLast
          />
        </View>

        {/* Appearance */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            {t('settings.section.appearance')}
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="droplet"
            iconTint="purple"
            label={t('settings.appearance')}
            onPress={() => router.push('/settings/appearance')}
            isFirst
          />
          <SettingsRow
            icon="type"
            iconTint="indigo"
            label={t('settings.fonts')}
            onPress={() => router.push('/settings/fonts' as any)}
          />
          <SettingsRow
            icon="globe"
            iconTint="teal"
            label={t('settings.language')}
            onPress={() => router.push('/settings/language' as any)}
          />
          <SettingsRow
            icon="grid"
            iconTint="pink"
            label={t('settings.app_icon')}
            onPress={() => setIconModalVisible(true)}
          />
          <SettingsRow
            icon="image"
            iconTint="orange"
            label="Pixel icons"
            onPress={() => router.push('/settings/pixel-icons' as any)}
          />
          <SettingsRow
            icon="image"
            iconTint="pink"
            label={t('settings.mini_app_preview')}
            onPress={() => router.push('/settings/mini-app-preview' as any)}
          />
          <SettingsRow
            icon="layout"
            iconTint="teal"
            label={t('settings.widget')}
            onPress={() => router.push('/settings/widget' as any)}
          />
          <SettingsRow
            icon="cloud"
            iconTint="orange"
            label={t('settings.weather')}
            onPress={() => router.push('/settings/weather' as any)}
            isLast={!glassCapable}
          />
          {glassCapable && (
            <SettingsRow
              icon="aperture"
              iconTint="cyan"
              label={t('settings.liquid_glass', 'Жидкое стекло')}
              showChevron={false}
              rightElement={
                <Switch
                  value={liquidGlassEnabled}
                  onValueChange={setLiquidGlassEnabled}
                  trackColor={{ true: '#4CD964', false: theme.colors.border.light }}
                  thumbColor="#FFFFFF"
                />
              }
              isLast
            />
          )}
        </View>

        {/* Security */}
        <Pressable onPress={handleAdminTap} style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            {t('settings.section.security')}
          </Text>
        </Pressable>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="smartphone"
            iconTint="blue"
            label={t('settings.devices')}
            value="2"
            onPress={() => router.push('/settings/device-key')}
            isFirst
          />
          <SettingsRow
            icon="shield"
            iconTint="gray"
            label={t('settings.privacy_policy')}
            onPress={() => Linking.openURL('https://legal.san-m-app.com/privacy.html').catch(() => {})}
          />
          <SettingsRow
            icon="file-text"
            iconTint="gray"
            label={t('settings.terms')}
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
              {t('settings.logout')}
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
              {t('settings.delete_account')}
            </Text>
          </Pressable>
        </View>

        {/* App version */}
        <Text variant="caption" align="center" color={theme.colors.text.tertiary} style={{ marginTop: 14, fontSize: 11 }}>
          {t('settings.version', undefined, { version: appVersion })}
        </Text>
      </ScrollView>

      {/* Bottom fade — mirrors the top header fade so the settings list
          dissolves into the background at the bottom edge instead of cutting
          off against a hard line. Pinned absolute over the bottom of the
          ScrollView; box-none so it never blocks taps on the last rows. */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: insets.bottom + 48 }} pointerEvents="none">
        <LinearGradient
          colors={[bgTransparent, bgColor + 'B3', bgColor]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* App icon picker — lazy-loaded because it imports expo-image-manipulator
          (a native module) at import time. Mounting it before the navigation
          transition completes was the source of the long task on this screen.
          The component flips in one frame after `runAfterInteractions`. */}
      {AppIconModalLazy ? (
        <AppIconModalLazy visible={iconModalVisible} onClose={() => setIconModalVisible(false)} />
      ) : null}
    </View>
  );
}
