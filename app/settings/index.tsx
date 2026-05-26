import React, { useState } from 'react';
import { View, ScrollView, Pressable, Switch, ViewStyle, Alert } from 'react-native';
import Animated, { FadeInDown, useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text, Card } from '../../src/components/ui';
import { useThemeStore, useAuthStore } from '../../src/store';

function SettingsSection({ title, children, delay }: { title: string; children: React.ReactNode; delay: number }) {
  const theme = useTheme();
  return (
    <Animated.View entering={FadeInDown.duration(400).delay(delay)} style={{ marginBottom: theme.spacing.lg }}>
      <Text
        variant="caption"
        weight="semibold"
        color={theme.colors.text.secondary}
        style={{ marginBottom: theme.spacing.sm, paddingHorizontal: theme.spacing.xs }}
      >
        {title.toUpperCase()}
      </Text>
      <Card padding="sm" shadow="sm">
        {children}
      </Card>
    </Animated.View>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  onPress,
  showChevron = true,
  rightElement,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  showChevron?: boolean;
  rightElement?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          backgroundColor: theme.colors.background.secondary,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: theme.spacing.md,
        }}
      >
        <Feather name={icon as keyof typeof Feather.glyphMap} size={16} color={theme.colors.accent.primary} />
      </View>
      <Text variant="body" style={{ flex: 1 }}>{label}</Text>
      {value && <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginRight: theme.spacing.sm }}>{value}</Text>}
      {rightElement}
      {showChevron && !rightElement && (
        <Feather name="chevron-right" size={18} color={theme.colors.text.tertiary} />
      )}
    </Pressable>
  );
}

function ThemeToggle() {
  const theme = useTheme();
  const { mode, toggle } = useThemeStore();
  const toggleScale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: toggleScale.value }],
  }));

  const handleToggle = () => {
    toggleScale.value = withSpring(0.8, { damping: 10, stiffness: 300 });
    setTimeout(() => {
      toggleScale.value = withSpring(1, { damping: 10, stiffness: 300 });
    }, 150);
    toggle();
  };

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={handleToggle}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: mode === 'dark' ? theme.colors.accent.tertiary : theme.colors.accent.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather
          name={mode === 'dark' ? 'moon' : 'sun'}
          size={20}
          color={theme.colors.text.inverse}
        />
      </Pressable>
    </Animated.View>
  );
}

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { mode } = useThemeStore();
  const { logout } = useAuthStore();
  const [notifications, setNotifications] = useState(true);
  const [activityStatus, setActivityStatus] = useState(true);
  const [privateAccount, setPrivateAccount] = useState(false);

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => {
          logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  return (
    <ScrollView style={containerStyle} contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.lg,
          paddingTop: insets.top,
          paddingBottom: theme.spacing.md,
        }}
      >
        <Pressable onPress={() => router.back()} style={{ marginRight: theme.spacing.md }}>
          <Feather name="arrow-left" size={22} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="subheading" weight="bold">Settings</Text>
      </View>

      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        {/* Account */}
        <SettingsSection title="Account" delay={100}>
          <SettingsRow icon="user" label="Edit Profile" onPress={() => router.push('/profile/edit')} />
          <SettingsRow icon="lock" label="Password & Security" />
          <SettingsRow icon="mail" label="Email" value="you@email.com" />
        </SettingsSection>

        {/* Appearance */}
        <SettingsSection title="Appearance" delay={200}>
          <SettingsRow
            icon={mode === 'dark' ? 'moon' : 'sun'}
            label="Theme"
            value={mode === 'dark' ? 'Dark' : 'Light'}
            showChevron={false}
            rightElement={<ThemeToggle />}
          />
        </SettingsSection>

        {/* Notifications */}
        <SettingsSection title="Notifications" delay={300}>
          <SettingsRow
            icon="bell"
            label="Push Notifications"
            showChevron={false}
            rightElement={
              <Switch
                value={notifications}
                onValueChange={setNotifications}
                trackColor={{ true: theme.colors.accent.primary, false: theme.colors.border.light }}
                thumbColor={theme.colors.text.inverse}
              />
            }
          />
          <SettingsRow icon="message-circle" label="Message Notifications" />
          <SettingsRow icon="heart" label="Like Notifications" />
        </SettingsSection>

        {/* Privacy */}
        <SettingsSection title="Privacy" delay={400}>
          <SettingsRow
            icon="eye-off"
            label="Private Account"
            showChevron={false}
            rightElement={
              <Switch
                value={privateAccount}
                onValueChange={setPrivateAccount}
                trackColor={{ true: theme.colors.accent.primary, false: theme.colors.border.light }}
                thumbColor={theme.colors.text.inverse}
              />
            }
          />
          <SettingsRow
            icon="activity"
            label="Show Activity Status"
            showChevron={false}
            rightElement={
              <Switch
                value={activityStatus}
                onValueChange={setActivityStatus}
                trackColor={{ true: theme.colors.accent.primary, false: theme.colors.border.light }}
                thumbColor={theme.colors.text.inverse}
              />
            }
          />
          <SettingsRow icon="shield" label="Blocked Accounts" />
        </SettingsSection>

        {/* About */}
        <SettingsSection title="About" delay={500}>
          <SettingsRow icon="info" label="App Version" value="1.0.0" showChevron={false} />
          <SettingsRow icon="file-text" label="Terms of Service" />
          <SettingsRow icon="shield" label="Privacy Policy" />
        </SettingsSection>

        {/* Logout */}
        <Animated.View entering={FadeInDown.duration(400).delay(600)}>
          <Pressable
            onPress={handleLogout}
            style={{
              paddingVertical: theme.spacing.base,
              alignItems: 'center',
              backgroundColor: theme.colors.background.elevated,
              borderRadius: theme.borderRadius.lg,
              borderWidth: 1,
              borderColor: theme.colors.status.error,
            }}
          >
            <Text variant="body" weight="semibold" color={theme.colors.status.error}>
              Log Out
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </ScrollView>
  );
}
