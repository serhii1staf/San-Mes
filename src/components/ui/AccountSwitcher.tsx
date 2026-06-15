import React, { useState, useRef, useEffect } from 'react';
import { View, Pressable, Modal, TextInput, Alert, Animated, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { useAuthStore } from '../../store/authStore';
import { useAccountsStore, SavedAccount } from '../../store/accountsStore';
import * as Updates from 'expo-updates';
import { useT } from '../../i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface AccountSwitcherProps {
  visible: boolean;
  onClose: () => void;
}

export function AccountSwitcher({ visible, onClose }: AccountSwitcherProps) {
  const theme = useTheme();
  const t = useT();
  // Field-level selectors so this modal (mounted permanently inside the
  // profile screen) doesn't re-render on every unrelated auth/accounts mutation.
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const accounts = useAccountsStore((s) => s.accounts);
  const addAccount = useAccountsStore((s) => s.addAccount);
  const removeAccount = useAccountsStore((s) => s.removeAccount);
  const [showLogin, setShowLogin] = useState(false);
  const [deviceKey, setDeviceKey] = useState('');
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
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
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) onClose();
    });
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
    // Show the full-screen cover IMMEDIATELY, before any async work
    // runs. The previous flow ran loginUser → switchAccount → login →
    // setSwitching(true) all in one go, which meant the user tapped a
    // row and watched the modal sit motionless until the whole chain
    // resolved (and on weak devices the synchronous chunk inside
    // switchAccount — entityStore.hydrate, disconnectRealtime — was
    // long enough to register as a "the app froze" event). Painting
    // the cover first gives unambiguous tap feedback; the heavy work
    // then runs behind it where any micro-stutter is invisible.
    setSwitching(true);

    // Re-login so we get a fresh Worker JWT scoped to this account.
    // The saved `pin + deviceKey` is enough to re-issue without
    // re-prompting; if the account is gone (deleted on another device)
    // the login fails and we drop the row.
    const { loginUser } = await import('../../lib/supabase');
    const { profile, error } = await loginUser({ deviceKey: account.deviceKey, pin: account.pin });
    if (error || !profile) {
      // Roll the cover back up so the alert isn't covered by it.
      setSwitching(false);
      Alert.alert(t('common.error'), t('account_switcher.not_found'));
      removeAccount(account.id);
      return;
    }

    saveCurrentAccount();

    // Re-scope cache + flush previous account's in-memory data (Telegram-style
    // isolation). switchAccount now defers the heavy hydrate + realtime
    // teardown past the next interaction so it can't compete with the
    // cover paint above. A reload follows, but this guarantees no
    // cross-account bleed even if reload is unavailable (dev client).
    const { switchAccount } = await import('../../services/accountSwitch');
    switchAccount(profile.id);

    // Persist the new account to the auth store BEFORE reloading so the fresh
    // launch comes up already logged into the target account. The `loginUser`
    // call above also wrote the fresh JWT into MMKV, so apiClient will see it
    // immediately.
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
    });

    // Reload on the next tick (avoids the navigation race). The cover
    // is already up so we don't need a delay to "give it time to paint".
    setTimeout(() => {
      Updates.reloadAsync().catch(() => {
        // If reload isn't available (e.g. dev client), just close the sheet —
        // the reactive stores already point at the new account.
        setSwitching(false);
        onClose();
      });
    }, 60);
  };

  const handleAddAccount = async () => {
    if (!deviceKey || pin.length !== 4) {
      Alert.alert(t('common.error'), t('account_switcher.error.fill_fields'));
      return;
    }
    setIsLoading(true);
    // Use the loginUser flow — it verifies the device key + PIN against
    // the Worker and writes a fresh JWT into MMKV. Wrong PIN or unknown
    // device key both surface as `error: 'invalid_key_or_pin'`.
    const { loginUser } = await import('../../lib/supabase');
    const { profile, error } = await loginUser({ deviceKey, pin });
    if (error || !profile) {
      Alert.alert(t('common.error'), error || t('account_switcher.error.wrong_pin'));
      setIsLoading(false);
      return;
    }
    // Save current and switch
    saveCurrentAccount();

    // Re-scope cache + flush previous account's in-memory data.
    const { switchAccount } = await import('../../services/accountSwitch');
    switchAccount(profile.id);

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
    });

    setIsLoading(false);

    // Show a full-screen cover so the native reload doesn't flash white.
    setSwitching(true);
    setTimeout(() => {
      Updates.reloadAsync().catch(() => {
        setSwitching(false);
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
              <Text variant="body" weight="bold" align="center" style={{ marginBottom: 16 }}>{t('account_switcher.title')}</Text>

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
                    <Text variant="caption" color={theme.colors.accent.primary} style={{ fontSize: 10 }}>{t('account_switcher.active')}</Text>
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
                <Pressable onPress={() => { if (accounts.length >= 3 && !accounts.find(a => a.id === user?.id)) { Alert.alert(t('account_switcher.limit_title'), t('account_switcher.limit_msg')); return; } setShowLogin(true); }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.accent.primary + '15', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="plus" size={18} color={theme.colors.accent.primary} />
                  </View>
                  <Text variant="body" weight="medium" color={theme.colors.accent.primary} style={{ marginLeft: 12 }}>{t('account_switcher.add')}</Text>
                </Pressable>
              ) : (
                <View style={{ paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}>
                  <TextInput
                    value={deviceKey}
                    onChangeText={setDeviceKey}
                    placeholder={t('account_switcher.device_key_placeholder')}
                    placeholderTextColor={theme.colors.text.tertiary}
                    style={{ backgroundColor: theme.colors.background.secondary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: theme.colors.text.primary, marginBottom: 8 }}
                  />
                  <TextInput
                    value={pin}
                    onChangeText={(v) => setPin(v.slice(0, 4))}
                    placeholder={t('account_switcher.pin_placeholder')}
                    placeholderTextColor={theme.colors.text.tertiary}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={4}
                    style={{ backgroundColor: theme.colors.background.secondary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: theme.colors.text.primary, marginBottom: 12 }}
                  />
                  <Pressable onPress={handleAddAccount} disabled={isLoading} style={{ backgroundColor: theme.colors.accent.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', opacity: isLoading ? 0.6 : 1 }}>
                    <Text variant="body" weight="semibold" color="#FFFFFF">{isLoading ? t('account_switcher.signing_in') : t('auth.signin')}</Text>
                  </Pressable>
                </View>
              )}

              <View style={{ height: 16 }} />
            </View>
          </Animated.View>
        </View>

        {/* Full-screen cover shown right before app reload so the native restart
            doesn't flash white. Uses the app background color. */}
        {switching && (
          <View
            pointerEvents="auto"
            style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: theme.colors.background.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          />
        )}
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
