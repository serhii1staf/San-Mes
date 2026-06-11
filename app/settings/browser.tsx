import React from 'react';
import { View, Pressable, Switch, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useT } from '../../src/i18n/store';
import { triggerHaptic } from '../../src/utils/haptics';

// Browser-specific settings: in-app browser toggle + position of the
// minimised-session widget. Kept out of the generic Behavior/Appearance
// sections so the user can land on a page dedicated to one feature.

export default function BrowserSettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
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
        <Text variant="body" weight="bold" style={{ flex: 1, textAlign: 'center', marginRight: 32 }}>{t('browser_settings.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        {/* In-app browser toggle */}
        <View style={{ backgroundColor: cardBg, borderRadius: 14, marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
            <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: 'rgba(100,210,255,0.16)', alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
              <Feather name="globe" size={17} color="#64D2FF" />
            </View>
            <Text variant="body" style={{ flex: 1 }}>{t('browser_settings.in_app_label')}</Text>
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
          {t('browser_settings.position_label')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          <PositionCard
            label={t('browser_settings.position_top')}
            active={browserWidgetPosition === 'top'}
            onPress={() => { triggerHaptic('selection'); setBrowserWidgetPosition('top'); }}
            theme={theme}
            kind="top"
          />
          <PositionCard
            label={t('browser_settings.position_bottom')}
            active={browserWidgetPosition === 'bottom'}
            onPress={() => { triggerHaptic('selection'); setBrowserWidgetPosition('bottom'); }}
            theme={theme}
            kind="bottom"
          />
        </View>
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ paddingHorizontal: 4 }}>
          {t('browser_settings.position_hint')}
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
  const screenBg = theme.isDark ? '#000' : '#F5F5F7';
  const subtle = theme.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  const stroke = theme.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.10)';

  // The mini "browser pill" used inside the preview, styled to match the
  // real widget — pill shape on top, rounded-rectangle band on bottom.
  const renderPill = () => {
    if (kind === 'top') {
      return (
        <View style={{ position: 'absolute', top: 8, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.isDark ? 'rgba(40,40,40,0.9)' : 'rgba(255,255,255,0.95)', borderWidth: 0.5, borderColor: stroke, gap: 3 }}>
          <View style={{ width: 5, height: 5, borderRadius: 1, backgroundColor: accent }} />
          <View style={{ width: 22, height: 3, borderRadius: 1.5, backgroundColor: subtle }} />
          <View style={{ width: 4, height: 4, backgroundColor: subtle, borderRadius: 1 }} />
        </View>
      );
    }
    return (
      <View style={{ position: 'absolute', bottom: 14, left: 0, right: 0, height: 14, borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: cardBg, borderWidth: 0.5, borderColor: stroke, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 3 }}>
        <View style={{ width: 5, height: 5, borderRadius: 1, backgroundColor: accent }} />
        <View style={{ width: 18, height: 3, borderRadius: 1.5, backgroundColor: subtle, flex: 1 }} />
        <View style={{ width: 4, height: 4, backgroundColor: subtle, borderRadius: 1 }} />
      </View>
    );
  };

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
      {/* Mini phone — proportions roughly match a real device */}
      <View
        style={{
          aspectRatio: 9 / 18,
          borderRadius: 14,
          backgroundColor: screenBg,
          borderWidth: 1.5,
          borderColor: stroke,
          overflow: 'hidden',
          padding: 6,
          paddingTop: 10,
          paddingBottom: 4,
        }}
      >
        {/* Notch */}
        <View style={{ position: 'absolute', top: 3, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: theme.isDark ? '#000' : '#222' }} />
        </View>

        {/* Header — app title + bell */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <View style={{ width: 14, height: 5, borderRadius: 1, backgroundColor: theme.colors.text.primary, opacity: 0.7 }} />
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: subtle }} />
        </View>

        {/* Feed cards — 3 pieces with avatar + lines + image */}
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              backgroundColor: cardBg,
              borderRadius: 5,
              padding: 4,
              marginBottom: 4,
              borderWidth: 0.5,
              borderColor: stroke,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 3 }}>
              <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: accent + '99' }} />
              <View style={{ flex: 1 }}>
                <View style={{ width: '70%', height: 2.5, borderRadius: 1, backgroundColor: theme.colors.text.primary, opacity: 0.6 }} />
                <View style={{ width: '50%', height: 2, borderRadius: 1, backgroundColor: subtle, marginTop: 1.5 }} />
              </View>
            </View>
            {i === 1 ? (
              <View style={{ height: 14, borderRadius: 3, backgroundColor: subtle }} />
            ) : (
              <>
                <View style={{ width: '95%', height: 2, borderRadius: 1, backgroundColor: subtle, marginBottom: 2 }} />
                <View style={{ width: '70%', height: 2, borderRadius: 1, backgroundColor: subtle }} />
              </>
            )}
          </View>
        ))}

        {/* Tab bar — floating pill with 5 dots */}
        <View
          style={{
            position: 'absolute',
            left: 6,
            right: 6,
            bottom: kind === 'bottom' ? 32 : 6,
            height: 12,
            borderRadius: 6,
            backgroundColor: cardBg,
            borderWidth: 0.5,
            borderColor: stroke,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-around',
            paddingHorizontal: 4,
          }}
        >
          {[0, 1, 2, 3, 4].map((d) => (
            <View
              key={d}
              style={{
                width: 4,
                height: 4,
                borderRadius: 2,
                backgroundColor: d === 0 ? accent : subtle,
              }}
            />
          ))}
        </View>

        {/* The browser pill */}
        {renderPill()}
      </View>

      <Text variant="caption" weight="semibold" align="center" style={{ marginTop: 10, color: active ? accent : theme.colors.text.primary }}>
        {label}
      </Text>
    </Pressable>
  );
}
