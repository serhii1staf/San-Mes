import React, { useState, useRef } from 'react';
import { View, ViewStyle, Pressable, ScrollView, TextInput, Animated, Alert, Keyboard, TouchableWithoutFeedback, Text as RNText } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { registerUser } from '../../src/lib/supabase';

const EMOJIS = [
  '😊', '😎', '🥰', '🤩', '😇', '🦊', '🐱', '🐶',
  '🦁', '🐼', '🐨', '🦋', '🌸', '🌺', '🍀', '✨',
  '🔥', '💎', '🎭', '🎨', '🎵', '🌙', '☀️', '🌈',
  '🍄', '🪷', '🫧', '🧿', '💫', '🪐', '🌊', '🍂',
];

function EmojiStep({ selected, onSelect }: { selected: string; onSelect: (e: string) => void }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center' }}>
      <Text variant="heading" weight="bold" align="center">
        Выбери аватар
      </Text>
      <Text variant="body" color={theme.colors.text.secondary} align="center" style={{ marginTop: 8, marginBottom: 32 }}>
        Это твоя эмодзи-аватарка
      </Text>

      {/* Selected emoji preview */}
      <View style={{
        width: 96,
        height: 96,
        borderRadius: 48,
        backgroundColor: theme.colors.background.elevated,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 32,
        borderWidth: 2,
        borderColor: selected ? theme.colors.accent.primary : theme.colors.border.light,
      }}>
        <RNText style={{ fontSize: 36 }} allowFontScaling={false}>{selected || '?'}</RNText>
      </View>

      {/* Emoji grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
        {EMOJIS.map((emoji) => (
          <Pressable
            key={emoji}
            onPress={() => onSelect(emoji)}
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              backgroundColor: selected === emoji ? theme.colors.accent.primary + '20' : theme.colors.background.elevated,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: selected === emoji ? 2 : 0,
              borderColor: theme.colors.accent.primary,
            }}
          >
            <RNText style={{ fontSize: 22 }} allowFontScaling={false}>{emoji}</RNText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function NameStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const theme = useTheme();
  const isValid = value.length >= 4 && /^[a-zA-Z0-9_ ]+$/.test(value);
  return (
    <View style={{ alignItems: 'center' }}>
      <Text variant="heading" weight="bold" align="center">
        Как тебя зовут?
      </Text>
      <Text variant="body" color={theme.colors.text.secondary} align="center" style={{ marginTop: 8, marginBottom: 40 }}>
        Только английские буквы, 4–16 символов
      </Text>

      <TextInput
        value={value}
        onChangeText={(v) => onChange(v.slice(0, 16))}
        placeholder="Your name"
        placeholderTextColor={theme.colors.text.tertiary}
        style={{
          width: '100%',
          fontSize: 20,
          fontWeight: '600',
          textAlign: 'center',
          color: theme.colors.text.primary,
          paddingVertical: 16,
          borderBottomWidth: 2,
          borderBottomColor: isValid ? theme.colors.accent.primary : value.length > 0 ? theme.colors.status.error : theme.colors.border.light,
        }}
        autoFocus
        autoCapitalize="words"
      />
      {value.length > 0 && value.length < 4 && (
        <Text variant="caption" color={theme.colors.status.error} style={{ marginTop: 8 }}>
          Минимум 4 символа
        </Text>
      )}
      {value.length > 0 && !/^[a-zA-Z0-9_ ]*$/.test(value) && (
        <Text variant="caption" color={theme.colors.status.error} style={{ marginTop: 8 }}>
          Только английские буквы и цифры
        </Text>
      )}
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
  const [step, setStep] = useState(0);
  const [emoji, setEmoji] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const login = useAuthStore((s) => s.login);

  const BANNED_WORDS = [
    'fuck', 'shit', 'ass', 'bitch', 'dick', 'cock', 'pussy', 'nigger', 'nigga',
    'faggot', 'retard', 'whore', 'slut', 'cunt', 'rape', 'pedo', 'nazi',
    'hitler', 'kill', 'murder', 'terrorist', 'bomb', 'slave',
  ];

  const isValidUsername = (val: string): boolean => {
    const cleaned = val.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (cleaned.length < 4 || cleaned.length > 16) return false;
    if (!/^[a-zA-Z0-9_ ]+$/.test(val)) return false;
    const lower = val.toLowerCase();
    for (const word of BANNED_WORDS) {
      if (lower.includes(word)) return false;
    }
    return true;
  };

  const canContinue = () => {
    if (step === 0) return emoji !== '';
    if (step === 1) return isValidUsername(name);
    if (step === 2) return pin.length === 4;
    if (step === 3) return confirmPin.length === 4;
    return false;
  };

  const handleNext = async () => {
    setError('');
    if (step === 0 && emoji) {
      setStep(1);
    } else if (step === 1 && isValidUsername(name)) {
      // Additional validation message
      if (!/^[a-zA-Z0-9_ ]+$/.test(name)) {
        setError('Только английские буквы и цифры');
        return;
      }
      const lower = name.toLowerCase();
      for (const word of BANNED_WORDS) {
        if (lower.includes(word)) {
          setError('Это имя недопустимо');
          return;
        }
      }
      setStep(2);
    } else if (step === 2 && pin.length === 4) {
      setStep(3);
    } else if (step === 3) {
      if (confirmPin !== pin) {
        setError('Коды не совпадают');
        setConfirmPin('');
        return;
      }
      // Generate device key (12 chars)
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let deviceKey = '';
      for (let i = 0; i < 12; i++) {
        deviceKey += chars[Math.floor(Math.random() * chars.length)];
      }

      const username = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'user';

      // Register in Supabase
      const { profile, error: regError } = await registerUser({
        username,
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
        login(
          {
            id: profile.id,
            username: profile.username,
            displayName: profile.display_name,
            emoji: profile.emoji,
            pin,
            deviceKey: profile.device_key,
            bio: '',
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
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 32, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 0 && <EmojiStep selected={emoji} onSelect={setEmoji} />}
        {step === 1 && <NameStep value={name} onChange={setName} />}
        {step === 2 && <PinStep value={pin} onChange={setPin} title="Придумай код" subtitle="4 цифры для входа" />}
        {step === 3 && <PinStep value={confirmPin} onChange={setConfirmPin} title="Повтори код" subtitle="Введи код ещё раз" />}

        {error ? (
          <Text variant="body" color={theme.colors.status.error} align="center" style={{ marginTop: 16 }}>
            {error}
          </Text>
        ) : null}
      </ScrollView>

      {/* Bottom buttons */}
      <View style={{ paddingHorizontal: 32, paddingBottom: insets.bottom + 16, gap: 12 }}>
        <Pressable
          onPress={handleNext}
          disabled={!canContinue()}
          style={{
            paddingVertical: 16,
            borderRadius: 16,
            backgroundColor: canContinue() ? theme.colors.accent.primary : theme.colors.border.light,
            alignItems: 'center',
          }}
        >
          <Text variant="body" weight="semibold" color={canContinue() ? '#FFFFFF' : theme.colors.text.tertiary}>
            {step === 3 ? 'Готово' : 'Далее'}
          </Text>
        </Pressable>

        {step > 0 ? (
          <Pressable onPress={() => { setStep(step - 1); setError(''); }} style={{ alignItems: 'center', paddingVertical: 8 }}>
            <Text variant="body" color={theme.colors.text.secondary}>Назад</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => router.push('/(auth)/login')} style={{ alignItems: 'center', paddingVertical: 8 }}>
            <Text variant="body" color={theme.colors.text.secondary}>
              Уже есть аккаунт?{' '}
              <Text variant="body" weight="semibold" color={theme.colors.accent.primary}>
                Войти
              </Text>
            </Text>
          </Pressable>
        )}
      </View>
    </View>
    </TouchableWithoutFeedback>
  );
}
