import React from 'react';
import { View, Pressable, Image, ViewStyle, Linking } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useLiquidGlassActive, NativeGlassView } from '../../src/components/ui/LiquidGlass';
import { useT } from '../../src/i18n/store';

export default function WelcomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Native iOS-26 liquid glass for the auth buttons. iOS-only + opt-in.
  const glassActive = useLiquidGlassActive();

  const cardBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';
  const cardBorder = theme.colors.border.light;

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
    paddingHorizontal: 28,
  };

  const Button = ({ icon, label, onPress, primary }: { icon: any; label: string; onPress: () => void; primary?: boolean }) => {
    const inner = (
      <>
        <Feather name={icon} size={18} color={primary ? '#FFFFFF' : theme.colors.text.primary} />
        <Text variant="body" weight="semibold" color={primary ? '#FFFFFF' : theme.colors.text.primary}>
          {label}
        </Text>
      </>
    );
    if (glassActive) {
      // Interactive liquid glass button — primary keeps an accent tint so it
      // still reads as the main CTA; secondary is clear glass with a hairline.
      return (
        <Pressable onPress={onPress} style={{ borderRadius: 18, marginBottom: 12 }}>
          <NativeGlassView
            glassStyle="regular"
            isInteractive
            colorScheme={theme.isDark ? 'dark' : 'light'}
            tintColor={primary ? theme.colors.accent.primary : undefined}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 17, borderRadius: 18 }}
          >
            {inner}
          </NativeGlassView>
        </Pressable>
      );
    }
    return (
      <Pressable
        onPress={onPress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          paddingVertical: 17,
          borderRadius: 18,
          marginBottom: 12,
          backgroundColor: primary ? theme.colors.accent.primary : cardBg,
          borderWidth: primary ? 0 : 1,
          borderColor: cardBorder,
        }}
      >
        {inner}
      </Pressable>
    );
  };

  return (
    <View style={containerStyle}>
      {/* Help button top-right */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 8 }}>
        <Pressable
          onPress={() => Linking.openURL('https://legal.san-m-app.com/help.html').catch(() => {})}
          style={glassActive ? { borderRadius: 19 } : { width: 38, height: 38, borderRadius: 19, backgroundColor: cardBg, borderWidth: 1, borderColor: cardBorder, alignItems: 'center', justifyContent: 'center' }}
        >
          {glassActive ? (
            <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="help-circle" size={20} color={theme.colors.text.secondary} />
            </NativeGlassView>
          ) : (
            <Feather name="help-circle" size={20} color={theme.colors.text.secondary} />
          )}
        </Pressable>
      </View>

      {/* Center content */}
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {/* Logo */}
        <View
          style={{
            width: 76,
            height: 76,
            borderRadius: 22,
            overflow: 'hidden',
            marginBottom: 24,
            backgroundColor: cardBg,
            borderWidth: 1,
            borderColor: cardBorder,
          }}
        >
          <Image source={require('../../assets/icon.png')} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        </View>

        <Text weight="semibold" style={{ fontSize: 30, lineHeight: 40, marginBottom: 12 }}>
          {t('auth.welcome_title')}
        </Text>
        <Text variant="body" color={theme.colors.text.secondary} style={{ fontSize: 16, lineHeight: 22, marginBottom: 40 }}>
          {t('auth.welcome_subtitle')}
        </Text>

        {/* Buttons */}
        <Button icon="log-in" label={t('auth.signin')} primary onPress={() => router.push('/(auth)/login')} />
        <Button icon="user-plus" label={t('auth.signup')} onPress={() => router.push('/(auth)/register')} />
      </View>

      {/* Footer policy */}
      <View style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
        <Text variant="caption" align="center" color={theme.colors.text.tertiary} style={{ fontSize: 12, lineHeight: 17 }}>
          {t('auth.policy_prefix')}{' '}
          <Text
            variant="caption"
            weight="semibold"
            color={theme.colors.text.secondary}
            style={{ fontSize: 12 }}
            onPress={() => Linking.openURL('https://legal.san-m-app.com/terms.html').catch(() => {})}
          >
            {t('auth.policy_terms')}
          </Text>{' '}
          {t('auth.policy_and')}{' '}
          <Text
            variant="caption"
            weight="semibold"
            color={theme.colors.text.secondary}
            style={{ fontSize: 12 }}
            onPress={() => Linking.openURL('https://legal.san-m-app.com/privacy.html').catch(() => {})}
          >
            {t('auth.policy_privacy')}
          </Text>
          .
        </Text>
      </View>
    </View>
  );
}
