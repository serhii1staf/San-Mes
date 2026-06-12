import React, { useState } from 'react';
import { View, Pressable, ScrollView, Platform, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { showToast } from '../../src/store/toastStore';
import { reloadWidgetNow, isWidgetAvailable } from '../../src/services/widgetBridge';
import { useWidgetSettingsStore, WidgetContent } from '../../src/store/widgetSettingsStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';

function Step({ index, text, theme }: { index: number; text: string; theme: any }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
        <Text variant="caption" weight="bold" color="#FFF">{index}</Text>
      </View>
      <Text variant="body" color={theme.colors.text.secondary} style={{ flex: 1, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

export default function WidgetScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { postCount, content, setPostCount, setContent } = useWidgetSettingsStore();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    triggerHaptic('light');
    if (!isWidgetAvailable()) {
      showToast(t('widget_settings.toast.unavailable'), 'info');
      return;
    }
    setRefreshing(true);
    reloadWidgetNow();
    setTimeout(() => {
      setRefreshing(false);
      showToast(t('widget_settings.toast.refreshed'), 'check');
    }, 600);
  };

  const countOptions = [1, 2, 3, 4];
  const contentOptions: { key: WidgetContent; label: string }[] = [
    { key: 'feed', label: t('widget_settings.content.feed') },
    { key: 'following', label: t('widget_settings.content.following') },
  ];

  const cardStyle = {
    backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 0.5,
    borderColor: theme.colors.border.light,
  } as const;

  const bgColor = theme.colors.background.primary;
  const bgTransparent = theme.colors.background.primary + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Gradient fade header (same pattern as Settings) */}
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
            paddingHorizontal: 20,
            paddingTop: insets.top + 8,
            paddingBottom: 8,
            position: 'relative',
          }}
          pointerEvents="auto"
        >
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ position: 'absolute', left: 20, top: insets.top + 8 }}>
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="subheading" weight="bold">{t('widget_settings.title')}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: headerContentHeight, paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
        {/* How to add */}
        <View style={cardStyle}>
          <Text variant="body" weight="bold" style={{ marginBottom: 14 }}>{t('widget_settings.how_title')}</Text>
          <Step index={1} text={t('widget_settings.step1')} theme={theme} />
          <Step index={2} text={t('widget_settings.step2')} theme={theme} />
          <Step index={3} text={t('widget_settings.step3')} theme={theme} />
          <Step index={4} text={t('widget_settings.step4')} theme={theme} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, backgroundColor: theme.colors.accent.primary + '12', borderRadius: 12, padding: 12 }}>
            <Feather name="info" size={16} color={theme.colors.accent.primary} style={{ marginRight: 10 }} />
            <Text variant="caption" color={theme.colors.text.secondary} style={{ flex: 1, lineHeight: 18 }}>
              {t('widget_settings.note_ios')}
            </Text>
          </View>
        </View>

        {/* Content options */}
        <View style={cardStyle}>
          <Text variant="body" weight="bold" style={{ marginBottom: 12 }}>{t('widget_settings.what_show')}</Text>
          {contentOptions.map((opt) => {
            const active = content === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => { triggerHaptic('light'); setContent(opt.key); }}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 }}
              >
                <Text variant="body" color={theme.colors.text.primary}>{opt.label}</Text>
                <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: active ? theme.colors.accent.primary : theme.colors.border.light, alignItems: 'center', justifyContent: 'center' }}>
                  {active && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.accent.primary }} />}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Post count */}
        <View style={cardStyle}>
          <Text variant="body" weight="bold" style={{ marginBottom: 12 }}>{t('widget_settings.how_many')}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {countOptions.map((n) => {
              const active = postCount === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => { triggerHaptic('light'); setPostCount(n); }}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: active ? theme.colors.accent.primary : theme.colors.background.secondary }}
                >
                  <Text variant="body" weight="semibold" color={active ? '#FFF' : theme.colors.text.primary}>{n}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 10 }}>
            {t('widget_settings.size_hint')}
          </Text>
        </View>

        {/* Refresh now */}
        <Pressable
          onPress={handleRefresh}
          disabled={refreshing}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent.primary, borderRadius: 14, paddingVertical: 15, opacity: refreshing ? 0.6 : 1 }}
        >
          <Feather name="refresh-cw" size={16} color="#FFF" style={{ marginRight: 8 }} />
          <Text variant="body" weight="semibold" color="#FFF">{refreshing ? t('widget_settings.refreshing') : t('widget_settings.refresh_now')}</Text>
        </Pressable>

        {Platform.OS !== 'ios' && (
          <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginTop: 14 }}>
            {t('widget_settings.android_note')}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
