import React, { useState, useRef } from 'react';
import { View, ViewStyle, Pressable, TextInput, ActivityIndicator, Keyboard, TouchableWithoutFeedback } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { loginUser } from '../../src/lib/supabase';

export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [deviceKey, setDeviceKey] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const pinRef = useRef<TextInput>(null);
  const login = useAuthStore((s) => s.login);

  const handleLogin = async () => {
    if (deviceKey.length < 6 || pin.length !== 4 || isLoading) return;
    setIsLoading(true);
    setError('');

    const { profile, error: loginError } = await loginUser({
      deviceKey: deviceKey.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      pin,
    });

    if (loginError || !profile) {
      setError(loginError || 'Неверный ключ или код');
      setPin('');
      setIsLoading(false);
      return;
    }

    // Re-scope cache + flush previous account's in-memory data BEFORE setting the
    // new user, so nothing bleeds across accounts.
    const { switchAccount } = require('../../src/services/accountSwitch');
    switchAccount(profile.id);

    login(
      {
        id: profile.id,
        username: profile.username,
        displayName: profile.display_name,
        emoji: profile.emoji,
        bio: profile.bio,
        pin,
        deviceKey: profile.device_key,
        badge: profile.badge || undefined,
        is_verified: profile.is_verified || false,
        bannerUrl: profile.banner_url || undefined,
        links: profile.links || undefined,
      },
      'token-' + Date.now()
    );
    setIsLoading(false);
    router.replace('/(tabs)');
  };

  const canLogin = deviceKey.length >= 6 && pin.length === 4;

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
    paddingTop: insets.top + 24,
    paddingHorizontal: 28,
  };

  const cardBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
    <View style={containerStyle}>
      {/* Header */}
      <View style={{ marginBottom: 36, marginTop: 12 }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            backgroundColor: theme.colors.accent.primary + '18',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
          }}
        >
          <Feather name="lock" size={28} color={theme.colors.accent.primary} />
        </View>
        <Text weight="semibold" style={{ fontSize: 30, lineHeight: 40, marginBottom: 8 }}>
          С возвращением!
        </Text>
        <Text variant="body" color={theme.colors.text.secondary} style={{ fontSize: 16, lineHeight: 22 }}>
          Введите ключ устройства и код для входа.
        </Text>
      </View>

      {/* Device Key Input */}
      <View style={{ marginBottom: 20 }}>
        <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 8 }}>
          Ключ устройства
        </Text>
        <TextInput
          value={deviceKey}
          onChangeText={(t) => { setDeviceKey(t.toUpperCase()); setError(''); }}
          placeholder="XXX-XXX-XXX-XXX"
          placeholderTextColor={theme.colors.text.tertiary}
          autoCapitalize="characters"
          style={{
            backgroundColor: theme.colors.background.elevated,
            borderRadius: 14,
            paddingVertical: 14,
            paddingHorizontal: 16,
            fontSize: 18,
            fontWeight: '600',
            color: theme.colors.text.primary,
            letterSpacing: 2,
            textAlign: 'center',
            borderWidth: 1,
            borderColor: theme.colors.border.light,
          }}
        />
      </View>

      {/* PIN Input */}
      <View style={{ marginBottom: 24 }}>
        <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 8 }}>
          4-значный код
        </Text>
        <Pressable onPress={() => pinRef.current?.focus()} style={{ flexDirection: 'row', gap: 12, justifyContent: 'center' }}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                backgroundColor: theme.colors.background.elevated,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1.5,
                borderColor: i < pin.length ? theme.colors.accent.primary : theme.colors.border.light,
              }}
            >
              {i < pin.length && (
                <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: theme.colors.accent.primary }} />
              )}
            </View>
          ))}
        </Pressable>
        <TextInput
          ref={pinRef}
          value={pin}
          onChangeText={(t) => { setPin(t.replace(/[^0-9]/g, '').slice(0, 4)); setError(''); }}
          keyboardType="number-pad"
          maxLength={4}
          style={{ position: 'absolute', opacity: 0, height: 0 }}
        />
      </View>

      {/* Error */}
      {error ? (
        <Text variant="caption" color={theme.colors.status.error} align="center" style={{ marginBottom: 16 }}>
          {error}
        </Text>
      ) : null}

      {/* Login button */}
      <Pressable
        onPress={handleLogin}
        disabled={!canLogin || isLoading}
        style={{
          paddingVertical: 16,
          borderRadius: 16,
          backgroundColor: canLogin ? theme.colors.accent.primary : theme.colors.border.light,
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        {isLoading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text variant="body" weight="semibold" color={canLogin ? '#FFFFFF' : theme.colors.text.tertiary}>
            Войти
          </Text>
        )}
      </Pressable>

      {/* Register link */}
      <Pressable
        onPress={() => router.push('/(auth)/register')}
        style={{ alignItems: 'center', paddingVertical: 8 }}
      >
        <Text variant="body" color={theme.colors.text.secondary}>
          Нет аккаунта?{' '}
          <Text variant="body" weight="semibold" color={theme.colors.accent.primary}>
            Создать
          </Text>
        </Text>
      </Pressable>
    </View>
    </TouchableWithoutFeedback>
  );
}
