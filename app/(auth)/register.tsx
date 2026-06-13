import React, { useState, useRef, useEffect } from 'react';
import { View, ViewStyle, Pressable, ScrollView, TextInput, Animated, Alert, Keyboard, TouchableWithoutFeedback, Platform, Text as RNText } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { EmojiPickerModal } from '../../src/components/ui/EmojiPickerModal';
import { useAuthStore } from '../../src/store';
import { registerUser } from '../../src/lib/supabase';
import { useT } from '../../src/i18n/store';
import { validateName } from '../../src/services/moderation';

function EmojiStep({ selected, onSelect }: { selected: string; onSelect: (e: string) => void }) {
  const theme = useTheme();
  const t = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const glow = useRef(new Animated.Value(0)).current;

  // Continuously animate the dashed ring through accent colours.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1600, useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0, duration: 1600, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const borderColor = glow.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['#F09458', '#8B5CF6', '#22C55E'],
  });

  return (
    <View>
      <Text weight="semibold" style={{ fontSize: 28, lineHeight: 38, marginBottom: 10 }}>
        {t('register.emoji_title')}
      </Text>
      <Text variant="body" color={theme.colors.text.secondary} style={{ fontSize: 15, lineHeight: 21, marginBottom: 40 }}>
        {t('register.emoji_subtitle')}
      </Text>

      <View style={{ alignItems: 'center' }}>
        {/* Bubble label */}
        <View style={{ backgroundColor: theme.colors.background.elevated, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, marginBottom: 18, borderWidth: 1, borderColor: theme.colors.border.light }}>
          <Text variant="caption" weight="semibold" color={theme.colors.text.secondary}>{t('register.emoji_pick')}</Text>
        </View>

        {/* Dashed circle with + or selected emoji — opens the emoji modal */}
        <Pressable onPress={() => setPickerOpen(true)}>
          <Animated.View
            style={{
              width: 180,
              height: 180,
              borderRadius: 90,
              borderWidth: 3,
              borderColor,
              borderStyle: 'dashed',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.background.elevated,
            }}
          >
            {selected ? (
              <RNText style={{ fontSize: 90 }} allowFontScaling={false}>{selected}</RNText>
            ) : (
              <Feather name="plus" size={64} color={theme.colors.text.tertiary} />
            )}
          </Animated.View>
        </Pressable>

        <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 28, fontSize: 12 }}>
          {t('register.emoji_immutable')}
        </Text>
      </View>

      <EmojiPickerModal visible={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={onSelect} />
    </View>
  );
}

function NameStep({
  name, onNameChange, username, onUsernameChange, usernameValid, bio, onBioChange,
}: {
  name: string;
  onNameChange: (v: string) => void;
  username: string;
  onUsernameChange: (v: string) => void;
  usernameValid: boolean;
  bio: string;
  onBioChange: (v: string) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const fieldBg = theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const cardBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';

  return (
    <View>
      <Text weight="semibold" style={{ fontSize: 28, lineHeight: 38, marginBottom: 10 }}>
        {t('register.name_title')}
      </Text>
      <Text variant="body" color={theme.colors.text.secondary} style={{ fontSize: 15, lineHeight: 21, marginBottom: 28 }}>
        {t('register.name_subtitle')}
      </Text>

      <View style={{ backgroundColor: cardBg, borderRadius: 22, padding: 14, borderWidth: 1, borderColor: theme.colors.border.light }}>
        {/* Name */}
        <TextInput
          value={name}
          onChangeText={onNameChange}
          placeholder={t('register.name_placeholder')}
          placeholderTextColor={theme.colors.text.tertiary}
          style={{
            backgroundColor: fieldBg,
            borderRadius: 14,
            paddingVertical: 16,
            paddingHorizontal: 16,
            fontSize: 16,
            color: theme.colors.text.primary,
            marginBottom: 12,
          }}
        />

        {/* Username with checkmark */}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: fieldBg, borderRadius: 14, paddingHorizontal: 16, marginBottom: 16 }}>
          <Text variant="body" color={theme.colors.text.tertiary} style={{ fontSize: 16 }}>@</Text>
          <TextInput
            value={username}
            onChangeText={onUsernameChange}
            placeholder="username"
            placeholderTextColor={theme.colors.text.tertiary}
            autoCapitalize="none"
            style={{ flex: 1, paddingVertical: 16, paddingLeft: 2, fontSize: 16, color: theme.colors.text.primary }}
          />
          {username.length >= 4 && (
            <Feather
              name={usernameValid ? 'check-circle' : 'x-circle'}
              size={20}
              color={usernameValid ? '#22C55E' : theme.colors.status.error}
            />
          )}
        </View>

        {/* Bio (optional) */}
        <Text variant="body" weight="semibold" style={{ fontSize: 14, marginBottom: 8 }}>
          {t('register.bio_label')}
        </Text>
        <TextInput
          value={bio}
          onChangeText={(v) => onBioChange(v.slice(0, 160))}
          placeholder={t('register.bio_placeholder')}
          placeholderTextColor={theme.colors.text.tertiary}
          multiline
          style={{
            backgroundColor: fieldBg,
            borderRadius: 14,
            paddingVertical: 14,
            paddingHorizontal: 16,
            fontSize: 14,
            color: theme.colors.text.primary,
            minHeight: 80,
            textAlignVertical: 'top',
          }}
        />
      </View>
    </View>
  );
}

function PinStep({ value, onChange, title, subtitle }: { value: string; onChange: (v: string) => void; title: string; subtitle: string }) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);

  return (
    <View style={{ alignItems: 'center' }}>
      <Text variant="heading" weight="bold" align="center">
        {title}
      </Text>
      <Text variant="body" color={theme.colors.text.secondary} align="center" style={{ marginTop: 8, marginBottom: 40 }}>
        {subtitle}
      </Text>

      {/* PIN dots display */}
      <Pressable onPress={() => inputRef.current?.focus()} style={{ flexDirection: 'row', gap: 16, marginBottom: 32 }}>
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
              borderColor: i < value.length ? theme.colors.accent.primary : theme.colors.border.light,
            }}
          >
            {i < value.length && (
              <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.accent.primary }} />
            )}
          </View>
        ))}
      </Pressable>

      {/* Hidden input */}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9]/g, '').slice(0, 4))}
        keyboardType="number-pad"
        maxLength={4}
        style={{ position: 'absolute', opacity: 0, height: 0 }}
        autoFocus
      />
    </View>
  );
}

export default function RegisterScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [step, setStep] = useState(0);
  const [emoji, setEmoji] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [bio, setBio] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const login = useAuthStore((s) => s.login);

  // Auto-derive username from the display name until the user edits it manually.
  const deriveUsername = (n: string) =>
    n.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 16);

  const handleNameChange = (v: string) => {
    const next = v.slice(0, 24);
    setName(next);
    if (!usernameEdited) setUsername(deriveUsername(next));
    setError('');
  };

  const handleUsernameChange = (v: string) => {
    setUsernameEdited(true);
    setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16));
    setError('');
  };

  const BANNED_WORDS = [
    'fuck', 'shit', 'ass', 'bitch', 'dick', 'cock', 'pussy', 'nigger', 'nigga',
    'faggot', 'retard', 'whore', 'slut', 'cunt', 'rape', 'pedo', 'nazi',
    'hitler', 'kill', 'murder', 'terrorist', 'bomb', 'slave',
  ];

  const usernameValid = (val: string): boolean => {
    if (val.length < 4 || val.length > 16) return false;
    const lower = val.toLowerCase();
    for (const word of BANNED_WORDS) {
      if (lower.includes(word)) return false;
    }
    return true;
  };

  const nameValid = (val: string): boolean => {
    if (val.trim().length < 2) return false;
    const lower = val.toLowerCase();
    for (const word of BANNED_WORDS) {
      if (lower.includes(word)) return false;
    }
    return true;
  };

  const canContinue = () => {
    if (step === 0) return nameValid(name) && usernameValid(username);
    if (step === 1) return emoji !== '';
    if (step === 2) return pin.length === 4;
    if (step === 3) return confirmPin.length === 4;
    return false;
  };

  const handleNext = async () => {
    setError('');
    if (step === 0 && nameValid(name) && usernameValid(username)) {
      // Run the full moderation pipeline now (NFKC + confusable-fold + leet
      // collapse) before we let the user move past the name step. Catches
      // obfuscated tries that the cheap inline BANNED_WORDS check misses.
      const nameCheck = validateName(name);
      if (!nameCheck.ok) {
        setError(t(nameCheck.reasonKey || 'moderation.reason.profanity'));
        return;
      }
      const userCheck = validateName(username);
      if (!userCheck.ok) {
        setError(t(userCheck.reasonKey || 'moderation.reason.profanity'));
        return;
      }
      setStep(1);
    } else if (step === 1 && emoji) {
      setStep(2);
    } else if (step === 2 && pin.length === 4) {
      setStep(3);
    } else if (step === 3) {
      if (confirmPin !== pin) {
        setError(t('register.error.pins_mismatch'));
        setConfirmPin('');
        return;
      }
      // Generate device key (12 chars)
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let deviceKey = '';
      for (let i = 0; i < 12; i++) {
        deviceKey += chars[Math.floor(Math.random() * chars.length)];
      }

      const finalUsername = (username || deriveUsername(name) || 'user').slice(0, 16);

      // Register in Supabase
      const { profile, error: regError } = await registerUser({
        username: finalUsername,
        displayName: name.trim(),
        emoji,
        pin,
        deviceKey,
      });

      if (regError) {
        setError(regError);
        return;
      }

      if (profile) {
        const { switchAccount } = require('../../src/services/accountSwitch');
        switchAccount(profile.id);
        login(
          {
            id: profile.id,
            username: profile.username,
            displayName: profile.display_name,
            emoji: profile.emoji,
            pin,
            deviceKey: profile.device_key,
            bio: bio.trim(),
            badge: profile.badge || undefined,
            is_verified: profile.is_verified || false,
          },
          'token-' + Date.now()
        );
        router.replace('/(tabs)');
      }
    }
  };

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
    paddingTop: insets.top + 16,
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
    <View style={containerStyle}>
      {/* Step indicator */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 32, marginBottom: 32, gap: 8 }}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              backgroundColor: i <= step ? theme.colors.accent.primary : theme.colors.border.light,
            }}
          />
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 32, paddingBottom: 32, justifyContent: 'flex-start' }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 0 && (
          <NameStep
            name={name}
            onNameChange={handleNameChange}
            username={username}
            onUsernameChange={handleUsernameChange}
            usernameValid={usernameValid(username)}
            bio={bio}
            onBioChange={setBio}
          />
        )}
        {step === 1 && <EmojiStep selected={emoji} onSelect={setEmoji} />}
        {step === 2 && <PinStep value={pin} onChange={setPin} title={t('register.pin_title')} subtitle={t('register.pin_subtitle')} />}
        {step === 3 && <PinStep value={confirmPin} onChange={setConfirmPin} title={t('register.confirm_pin_title')} subtitle={t('register.confirm_pin_subtitle')} />}

        {error ? (
          <Text variant="body" color={theme.colors.status.error} align="center" style={{ marginTop: 16 }}>
            {error}
          </Text>
        ) : null}
      </ScrollView>

      {/* Bottom buttons */}
      <View style={{ paddingHorizontal: 32, paddingBottom: insets.bottom + 16 }}>
        {step > 0 ? (
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Pressable
              onPress={() => { setStep(step - 1); setError(''); }}
              style={{
                paddingVertical: 16,
                paddingHorizontal: 24,
                borderRadius: 16,
                backgroundColor: theme.colors.background.elevated,
                borderWidth: 1,
                borderColor: theme.colors.border.light,
                alignItems: 'center',
              }}
            >
              <Text variant="body" weight="semibold" color={theme.colors.text.primary}>{t('common.back')}</Text>
            </Pressable>
            <Pressable
              onPress={handleNext}
              disabled={!canContinue()}
              style={{
                flex: 1,
                paddingVertical: 16,
                borderRadius: 16,
                backgroundColor: canContinue() ? theme.colors.accent.primary : theme.colors.border.light,
                alignItems: 'center',
              }}
            >
              <Text variant="body" weight="semibold" color={canContinue() ? '#FFFFFF' : theme.colors.text.tertiary}>
                {step === 3 ? t('common.done') : t('common.continue')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Pressable
              onPress={handleNext}
              disabled={!canContinue()}
              style={{
                paddingVertical: 16,
                borderRadius: 16,
                backgroundColor: canContinue() ? theme.colors.accent.primary : theme.colors.border.light,
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <Text variant="body" weight="semibold" color={canContinue() ? '#FFFFFF' : theme.colors.text.tertiary}>
                {t('common.continue')}
              </Text>
            </Pressable>
            <Pressable onPress={() => router.push('/(auth)/login')} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text variant="body" color={theme.colors.text.secondary}>
                {t('auth.have_account')}{' '}
                <Text variant="body" weight="semibold" color={theme.colors.accent.primary}>
                  {t('auth.signin')}
                </Text>
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
    </TouchableWithoutFeedback>
  );
}
