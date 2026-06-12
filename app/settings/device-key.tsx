import React, { useState } from 'react';
import { View, Pressable, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { useT } from '../../src/i18n/store';

export default function DeviceKeyScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { user } = useAuthStore();
  const [copied, setCopied] = useState(false);

  const deviceKey = user?.deviceKey || 'XXXXXXXXXXXX';
  // Format key as XXX-XXX-XXX-XXX for readability
  const formattedKey = deviceKey.match(/.{1,3}/g)?.join('-') || deviceKey;

  const handleCopy = async () => {
    await Clipboard.setStringAsync(deviceKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
        <Text variant="subheading" weight="bold">{t('device_key.title')}</Text>
      </View>

      <View style={{ paddingHorizontal: 24, alignItems: 'center', marginTop: 32 }}>
        <View style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: theme.colors.background.elevated,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
        }}>
          <Feather name="key" size={32} color={theme.colors.accent.primary} />
        </View>

        <Text variant="body" weight="semibold" align="center" style={{ marginBottom: 8 }}>
          {t('device_key.subtitle')}
        </Text>
        <Text variant="caption" color={theme.colors.text.secondary} align="center" style={{ marginBottom: 32, paddingHorizontal: 16 }}>
          {t('device_key.description')}
        </Text>

        {/* Device key display */}
        <View style={{
          backgroundColor: theme.colors.background.elevated,
          borderRadius: 20,
          paddingVertical: 24,
          paddingHorizontal: 32,
          width: '100%',
          alignItems: 'center',
          marginBottom: 16,
          borderWidth: 1,
          borderColor: theme.colors.border.light,
        }}>
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginBottom: 8 }}>
            {t('device_key.your_key')}
          </Text>
          <Text
            variant="heading"
            weight="bold"
            style={{ letterSpacing: 2, fontSize: 22 }}
          >
            {formattedKey}
          </Text>
        </View>

        {/* Copy button */}
        <Pressable
          onPress={handleCopy}
          style={{
            backgroundColor: theme.colors.accent.primary,
            borderRadius: 14,
            paddingVertical: 14,
            paddingHorizontal: 24,
            width: '100%',
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <Text variant="body" weight="semibold" color={theme.colors.text.inverse}>
            {copied ? t('device_key.copied') : t('common.copy')}
          </Text>
        </Pressable>

        {/* PIN reminder */}
        <View style={{
          backgroundColor: theme.colors.background.elevated,
          borderRadius: 16,
          padding: 16,
          width: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}>
          <View style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: theme.colors.accent.primary + '20',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Feather name="lock" size={18} color={theme.colors.accent.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="caption" weight="semibold">{t('device_key.dont_forget')}</Text>
            <Text variant="caption" color={theme.colors.text.tertiary}>
              {t('device_key.reminder')}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
