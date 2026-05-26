import React, { useState, useRef } from 'react';
import { View, ViewStyle, Pressable, TextInput } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { currentUser } from '../../src/utils/mockData';

export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState('');
  const inputRef = useRef<TextInput>(null);
  const login = useAuthStore((s) => s.login);

  const handleLogin = () => {
    if (pin.length === 4) {
      // Mock login with default user
      login(
        {
          id: currentUser.id,
          username: currentUser.username,
          displayName: currentUser.displayName,
          emoji: '😊',
          bio: currentUser.bio,
          pin,
          deviceKey: 'DEMO12345678',
        },
        'token-' + Date.now()
      );
      router.replace('/(tabs)');
    }
  };

  // Auto-submit when 4 digits entered
  if (pin.length === 4) {
    setTimeout(handleLogin, 300);
  }

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
        borderRadius: 40,
        backgroundColor: theme.colors.background.elevated,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
      }}>
        <Text style={{ fontSize: 40 }}>🔐</Text>
      </View>

      <Text variant="heading" weight="bold" align="center">
        Вход
      </Text>
      <Text variant="body" color={theme.colors.text.secondary} align="center" style={{ marginTop: 8, marginBottom: 40 }}>
        Введи свой 4-значный код
      </Text>

      {/* PIN dots */}
      <Pressable onPress={() => inputRef.current?.focus()} style={{ flexDirection: 'row', gap: 16, marginBottom: 40 }}>
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

      {/* Hidden input */}
      <TextInput
        ref={inputRef}
        value={pin}
        onChangeText={(t) => setPin(t.replace(/[^0-9]/g, '').slice(0, 4))}
        keyboardType="number-pad"
        maxLength={4}
        style={{ position: 'absolute', opacity: 0, height: 0 }}
        autoFocus
      />

      {/* Register link */}
      <Pressable
        onPress={() => router.push('/(auth)/register')}
        style={{ marginTop: 32 }}
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
