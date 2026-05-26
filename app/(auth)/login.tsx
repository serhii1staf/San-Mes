import React, { useState } from 'react';
import { View, ViewStyle, Pressable, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme';
import { Text, Input, Button } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { currentUser } from '../../src/utils/mockData';

export default function LoginScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useAuthStore((s) => s.login);

  const handleLogin = () => {
    const mockToken = 'mock-jwt-token-' + Date.now();
    login(
      {
        id: currentUser.id,
        username: currentUser.username,
        displayName: currentUser.displayName,
        avatar: currentUser.avatar,
        bio: currentUser.bio,
      },
      mockToken
    );
    router.replace('/(tabs)');
  };

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const contentStyle: ViewStyle = {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
  };

  const logoContainerStyle: ViewStyle = {
    alignItems: 'center',
    marginBottom: theme.spacing['2xl'],
  };

  const logoCircleStyle: ViewStyle = {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.accent.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.base,
  };

  return (
    <KeyboardAvoidingView
      style={containerStyle}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={contentStyle}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={logoContainerStyle}>
          <View style={logoCircleStyle}>
            <Text variant="heading" weight="bold" color={theme.colors.text.inverse}>
              S
            </Text>
          </View>
          <Text variant="heading" weight="bold">
            San
          </Text>
          <Text variant="body" color={theme.colors.text.secondary} style={{ marginTop: theme.spacing.xs }}>
            Connect with warmth
          </Text>
        </View>

        <View>
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="your@email.com"
            style={{ marginBottom: theme.spacing.base }}
          />
        </View>

        <View>
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Enter your password"
            secureTextEntry
            style={{ marginBottom: theme.spacing.lg }}
          />
        </View>

        <View>
          <Button title="Sign In" onPress={handleLogin} size="lg" />
        </View>

        <View>
          <Pressable
            onPress={() => router.push('/(auth)/register')}
            style={{ alignItems: 'center', marginTop: theme.spacing.lg }}
          >
            <Text variant="body" color={theme.colors.text.secondary}>
              Don't have an account?{' '}
              <Text variant="body" weight="semibold" color={theme.colors.accent.primary}>
                Sign Up
              </Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
