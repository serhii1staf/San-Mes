import React, { useState, useRef } from 'react';
import { View, ViewStyle, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { loginWithPin } from '../../src/lib/supabase';

export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const login = useAuthStore((s) => s.login);

  const handleLogin = async () => {
    if (pin.length !== 4 || isLoading) return;
    setIsLoading(true);
    setError('');

    const { profile, error: loginError } = await loginWithPin(pin);

    if (loginError || !profile) {
      setError(loginError || 'Неверный код');
      setPin('');
      setIsLoading(false);
      return;
    }

    login(
      {
        id: profile.id,
        username: profile.username,
        displayName: profile.display_name,
        emoji: profile.emoji,
        bio: profile.bio,
        pin,
        deviceKey: profile.device_key,
      },
      'token-' + Date.now()
    );
    setIsLoading(false);
    router.replace('/(tabs)');
  };

  // Auto-submit when 4 digits entered
  const handlePinChange = (t: string) => {
    const cleaned = t.replace(/[^0-9]/g, '').slice(0, 4);
    setPin(cleaned);
    setError('');
    if (cleaned.length === 4) {
      setTimeout(() => handleLogin(), 200);
    }
  };

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
    paddingTop: insets.top,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  };

  return (
    <View style={containerStyle}>
      {/* Logo emoji */}
      <View style={{
        width: 80,
        height: 80,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
      }}>
        <Text style={{ fontSize: 50 }}>🔐</Text>
      </View>

      <Text variant="heading" weight="bold" align="center">
        Вход
      </Text>
      <Text variant="body" color={theme.colors.text.secondary} align="center" style={{ marginTop: 8, marginBottom: 40 }}>
        Введи свой 4-значный код
      </Text>

      {/* PIN dots */}
      <Pressable onPress={() => inputRef.current?.focus()} style={{ flexDirection: 'row', gap: 16, marginBottom: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              backgroundColor: theme.colors.background.elevated,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: i < pin.length ? theme.colors.accent.primary : theme.colors.border.light,
            }}
          >
            {i < pin.length && (
              <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.accent.primary }} />
            )}
          </View>
        ))}
      </Pressable>

      {/* Error message */}
      {error ? (
        <Text variant="caption" color={theme.colors.status.error} align="center" style={{ marginBottom: 16 }}>
          {error}
        </Text>
      ) : <View style={{ height: 32 }} />}

      {/* Loading */}
      {isLoading && <ActivityIndicator color={theme.colors.accent.primary} style={{ marginBottom: 16 }} />}

      {/* Hidden input */}
      <TextInput
        ref={inputRef}
        value={pin}
        onChangeText={handlePinChange}
        keyboardType="number-pad"
        maxLength={4}
        style={{ position: 'absolute', opacity: 0, height: 0 }}
        autoFocus
      />

      {/* Register link */}
      <Pressable
        onPress={() => router.push('/(auth)/register')}
        style={{ marginTop: 16 }}
      >
        <Text variant="body" color={theme.colors.text.secondary}>
          Нет аккаунта?{' '}
          <Text variant="body" weight="semibold" color={theme.colors.accent.primary}>
            Создать
          </Text>
        </Text>
      </Pressable>
    </View>
  );
}
