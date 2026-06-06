import React, { useState, useRef, useEffect } from 'react';
import { View, Pressable, Modal, TextInput, Alert, Animated, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { useAuthStore } from '../../store/authStore';
import { useAccountsStore, SavedAccount } from '../../store/accountsStore';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../store/toastStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { resetAllThrottles } from '../../services/syncThrottle';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface AccountSwitcherProps {
  visible: boolean;
  onClose: () => void;
}

export function AccountSwitcher({ visible, onClose }: AccountSwitcherProps) {
  const theme = useTheme();
  const { user, login } = useAuthStore();
  const { accounts, addAccount, removeAccount } = useAccountsStore();
  const [showLogin, setShowLogin] = useState(false);
  const [deviceKey, setDeviceKey] = useState('');
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setShowLogin(false);
      setDeviceKey('');
      setPin('');
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => setTimeout(onClose, 30));
  };

  // Save current account before switching
  const saveCurrentAccount = () => {
    if (user) {
      addAccount({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        emoji: user.emoji,
        deviceKey: user.deviceKey || '',
        pin: user.pin || '',
        badge: user.badge,
        is_verified: user.is_verified,
      });
    }
  };

  const switchToAccount = async (account: SavedAccount) => {
    // Verify account still exists in DB
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', account.id).single();
    if (!profile) {
      Alert.alert('Ошибка', 'Аккаунт не найден');
      removeAccount(account.id);
      return;
    }

    saveCurrentAccount();

    // Switch the cache namespace to the new account. We do NOT clear the previous
    // account's cache — each account keeps its own namespace so switching back is instant.
    const { setCacheAccount } = await import('../../services/cacheService');
    const { setThrottleAccount } = await import('../../services/syncThrottle');
    setCacheAccount(profile.id);
    setThrottleAccount(profile.id);
    resetAllThrottles();

    // Persist the new account to the auth store BEFORE reloading so the fresh
    // launch comes up already logged into the target account.
    login({
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name,
      emoji: profile.emoji,
      bio: profile.bio,
      pin: account.pin,
      deviceKey: account.deviceKey,
      badge: profile.badge || undefined,
      is_verified: profile.is_verified || false,
      bannerUrl: profile.banner_url || undefined,
      links: profile.links || undefined,
    }, 'token-' + Date.now());

    // Defer the reload to the next tick so the auth-state change and any pending
    // navigation/render settle first. Reloading mid-render races with the
    // navigation triggered by login() and crashes the app. A short delay lets
    // React commit, then we cleanly restart to load the new account's data.
    setTimeout(() => {
      Updates.reloadAsync().catch(() => {
        // If reload isn't available (e.g. dev client), just close the sheet —
        // the reactive stores already point at the new account.
        onClose();
      });
    }, 120);
  };

  const handleAddAccount = async () => {
    if (!deviceKey || pin.length !== 4) {
      Alert.alert('Ошибка', 'Введите ключ устройства и 4-значный PIN');
      return;
    }
    setIsLoading(true);
    // Find profile by device key
    const { data: profile } = await supabase.from('profiles').select('*').eq('device_key', deviceKey).single();
    if (!profile) {
      Alert.alert('Ошибка', 'Аккаунт не найден');
      setIsLoading(false);
      return;
    }
    // Verify PIN
    const { hashPin } = await import('../../lib/supabase');
    if (profile.pin_hash && profile.pin_hash !== hashPin(pin)) {
      Alert.alert('Ошибка', 'Неверный PIN');
      setIsLoading(false);
      return;
    }
    // Save current and switch
    saveCurrentAccount();

    // Switch the cache namespace to the new account (keeps each account's data isolated).
    const { setCacheAccount } = await import('../../services/cacheService');
    const { setThrottleAccount } = await import('../../services/syncThrottle');
    setCacheAccount(profile.id);
    setThrottleAccount(profile.id);
    resetAllThrottles();

    addAccount({
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name,
      emoji: profile.emoji,
      deviceKey,
      pin,
      badge: profile.badge || undefined,
      is_verified: profile.is_verified || false,
    });
    login({
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name,
      emoji: profile.emoji,
      bio: profile.bio,
      pin,
      deviceKey,
      badge: profile.badge || undefined,
      is_verified: profile.is_verified || false,
      bannerUrl: profile.banner_url || undefined,
      links: profile.links || undefined,
    }, 'token-' + Date.now());

    setIsLoading(false);

    // Defer the reload so the auth-state change / navigation settles first
    // (reloading mid-render races with login()'s navigation and crashes).
    setTimeout(() => {
      Updates.reloadAsync().catch(() => {
        onClose();
      });
    }, 120);
  };

  const otherAccounts = accounts.filter(a => a.id !== user?.id);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1 }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdropAnim }}>
          <Pressable style={{ flex: 1 }} onPress={dismiss} />
        </Animated.View>
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY: slideAnim }] }}>
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}>
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
              </View>
              <Text variant="body" weight="bold" align="center" style={{ marginBottom: 16 }}>Аккаунты</Text>

              {/* Current account */}
              {user && (
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, backgroundColor: theme.colors.accent.primary + '10' }}>
                  <Avatar emoji={user.emoji} size="sm" />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text variant="body" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{user.displayName}</Text>
                      {user.is_verified && <VerifiedBadge size={12} />}
                    </View>
                    <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>@{user.username}</Text>
                  </View>
                  <View style={{ backgroundColor: theme.colors.accent.primary + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                    <Text variant="caption" color={theme.colors.accent.primary} style={{ fontSize: 10 }}>Активный</Text>
                  </View>
                </View>
              )}

              {/* Other saved accounts */}
              {otherAccounts.map(account => (
                <Pressable key={account.id} onPress={() => switchToAccount(account)} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}>
                  <Avatar emoji={account.emoji} size="sm" />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text variant="body" weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>{account.displayName}</Text>
                      {account.is_verified && <VerifiedBadge size={11} />}
                    </View>
                    <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>@{account.username}</Text>
                  </View>
                  <Feather name="log-in" size={16} color={theme.colors.text.tertiary} />
                </Pressable>
              ))}

              {/* Add account */}
              {!showLogin ? (
                <Pressable onPress={() => { if (accounts.length >= 3 && !accounts.find(a => a.id === user?.id)) { Alert.alert('Лимит', 'Максимум 3 аккаунта'); return; } setShowLogin(true); }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.accent.primary + '15', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="plus" size={18} color={theme.colors.accent.primary} />
                  </View>
                  <Text variant="body" weight="medium" color={theme.colors.accent.primary} style={{ marginLeft: 12 }}>Добавить аккаунт</Text>
                </Pressable>
              ) : (
                <View style={{ paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}>
                  <TextInput
                    value={deviceKey}
                    onChangeText={setDeviceKey}
                    placeholder="Ключ устройства"
                    placeholderTextColor={theme.colors.text.tertiary}
                    style={{ backgroundColor: theme.colors.background.secondary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: theme.colors.text.primary, marginBottom: 8 }}
                  />
                  <TextInput
                    value={pin}
                    onChangeText={(t) => setPin(t.slice(0, 4))}
                    placeholder="PIN (4 цифры)"
                    placeholderTextColor={theme.colors.text.tertiary}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={4}
                    style={{ backgroundColor: theme.colors.background.secondary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: theme.colors.text.primary, marginBottom: 12 }}
                  />
                  <Pressable onPress={handleAddAccount} disabled={isLoading} style={{ backgroundColor: theme.colors.accent.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', opacity: isLoading ? 0.6 : 1 }}>
                    <Text variant="body" weight="semibold" color="#FFFFFF">{isLoading ? 'Вход...' : 'Войти'}</Text>
                  </Pressable>
                </View>
              )}

              <View style={{ height: 16 }} />
            </View>
          </Animated.View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
