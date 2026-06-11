import React from 'react';
import { View, Pressable, Switch, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useSettingsStore } from '../../src/store/settingsStore';
import { triggerHaptic } from '../../src/utils/haptics';

// Browser-specific settings: in-app browser toggle + position of the
// minimised-session widget. Kept out of the generic Behavior/Appearance
// sections so the user can land on a page dedicated to one feature.

export default function BrowserSettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const useInAppBrowser = useSettingsStore((s) => s.useInAppBrowser);
  const setInAppBrowser = useSettingsStore((s) => s.setInAppBrowser);
  const browserWidgetPosition = useSettingsStore((s) => s.browserWidgetPosition);
  const setBrowserWidgetPosition = useSettingsStore((s) => s.setBrowserWidgetPosition);

  const cardBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="body" weight="bold" style={{ flex: 1, textAlign: 'center', marginRight: 32 }}>Браузер</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        {/* In-app browser toggle */}
        <View style={{ backgroundColor: cardBg, borderRadius: 14, marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
            <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: 'rgba(100,210,255,0.16)', alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
              <Feather name="globe" size={17} color="#64D2FF" />
            </View>
            <Text variant="body" style={{ flex: 1 }}>Встроенный браузер</Text>
            <Switch
              value={useInAppBrowser}
              onValueChange={setInAppBrowser}
              trackColor={{ true: '#4CD964', false: theme.colors.border.light }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* Position picker — visual side-by-side cards */}
        <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginLeft: 4, marginBottom: 8, textTransform: 'uppercase', fontSize: 11 }}>
          Положение мини-виджета
        </Text>
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          <PositionCard
            label="Сверху"
            active={browserWidgetPosition === 'top'}
            onPress={() => { triggerHaptic('selection'); setBrowserWidgetPosition('top'); }}
            theme={theme}
            kind="top"
          />
          <PositionCard
            label="Снизу"
            active={browserWidgetPosition === 'bottom'}
            onPress={() => { triggerHaptic('selection'); setBrowserWidgetPosition('bottom'); }}
            theme={theme}
            kind="bottom"
          />
        </View>
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ paddingHorizontal: 4 }}>
          Когда вы сворачиваете браузер или мини-приложение, плашка с названием
          сайта появится в выбранном месте. Нажмите по ней чтобы вернуться,
          крестик — чтобы закрыть сессию.
        </Text>
      </ScrollView>
    </View>
  );
}

function PositionCard({
  label,
  active,
  onPress,
  theme,
  kind,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: any;
  kind: 'top' | 'bottom';
}) {
  const cardBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';
  const accent = theme.colors.accent.primary;
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: cardBg,
        borderRadius: 18,
        padding: 12,
        borderWidth: 2,
        borderColor: active ? accent : theme.colors.border.light,
      }}
    >
      {/* Tiny phone illustration */}
      <View style={{ aspectRatio: 9 / 16, borderRadius: 12, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', borderWidth: 1, borderColor: theme.colors.border.light, padding: 4, justifyContent: 'space-between', overflow: 'hidden' }}>
        {kind === 'top' && (
          <View style={{ height: 8, borderRadius: 4, backgroundColor: accent + '99', marginBottom: 4 }} />
        )}
        <View style={{ flex: 1, justifyContent: 'flex-end', gap: 4 }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.border.medium, width: '70%' }} />
          <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.border.medium, width: '90%' }} />
          <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.border.medium, width: '50%' }} />
        </View>
        {kind === 'bottom' && (
          <View style={{ height: 8, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: accent + '99', marginTop: 4 }} />
        )}
        {/* Faux tab bar */}
        <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)', marginTop: 4 }} />
      </View>
      <Text variant="caption" weight="semibold" align="center" style={{ marginTop: 10, color: active ? accent : theme.colors.text.primary }}>
        {label}
      </Text>
    </Pressable>
  );
}
