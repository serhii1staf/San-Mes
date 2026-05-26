import React, { useState } from 'react';
import { View, ViewStyle, Pressable, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme';
import { Text, Input, Button, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';

export default function RegisterScreen() {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const login = useAuthStore((s) => s.login);

  const handleRegister = () => {
    const username = name.toLowerCase().replace(/\s+/g, '_');
    const mockToken = 'mock-jwt-token-' + Date.now();
    login(
      {
        id: 'user-new',
        username,
        displayName: name || 'New User',
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'New User')}&background=FF6B6B&color=fff&size=200`,
        bio: '',
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
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing['2xl'],
  };

  const avatarContainerStyle: ViewStyle = {
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
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
        <View>
          <Text variant="heading" weight="bold" align="center">
            Create Account
          </Text>
          <Text
            variant="body"
            color={theme.colors.text.secondary}
            align="center"
            style={{ marginTop: theme.spacing.xs, marginBottom: theme.spacing.lg }}
          >
            Join the community
          </Text>
        </View>

        <View style={avatarContainerStyle}>
          <Pressable>
            <Avatar name={name || 'U'} size="xl" />
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: theme.colors.accent.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="caption" color={theme.colors.text.inverse}>+</Text>
            </View>
          </Pressable>
        </View>

        <View>
          <Input
            label="Full Name"
            value={name}
            onChangeText={setName}
            placeholder="Your full name"
            style={{ marginBottom: theme.spacing.base }}
          />
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
            placeholder="Create a password"
            secureTextEntry
            style={{ marginBottom: theme.spacing.base }}
          />
        </View>

        <View>
          <Input
            label="Confirm Password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm your password"
            secureTextEntry
            style={{ marginBottom: theme.spacing.lg }}
          />
        </View>

        <View>
          <Button title="Create Account" onPress={handleRegister} size="lg" />
        </View>

        <View>
          <Pressable
            onPress={() => router.back()}
            style={{ alignItems: 'center', marginTop: theme.spacing.lg }}
          >
            <Text variant="body" color={theme.colors.text.secondary}>
              Already have an account?{' '}
              <Text variant="body" weight="semibold" color={theme.colors.accent.primary}>
                Sign In
              </Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
