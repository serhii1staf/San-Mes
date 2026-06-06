import React from 'react';
import { View, Pressable, Image, ViewStyle, Linking } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';

export default function WelcomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const cardBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';
  const cardBorder = theme.colors.border.light;

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
    paddingHorizontal: 28,
  };

  const Button = ({ icon, label, onPress, primary }: { icon: any; label: string; onPress: () => void; primary?: boolean }) => (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingVertical: 17,
        borderRadius: 18,
        marginBottom: 12,
        backgroundColor: primary ? theme.colors.accent.primary : cardBg,
        borderWidth: primary ? 0 : 1,
        borderColor: cardBorder,
      }}
    >
      <Feather name={icon} size={18} color={primary ? '#FFFFFF' : theme.colors.text.primary} />
      <Text variant="body" weight="semibold" color={primary ? '#FFFFFF' : theme.colors.text.primary}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={containerStyle}>
      {/* Help button top-right */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 8 }}>
        <Pressable
          onPress={() => Linking.openURL('https://san-m-app.com/help').catch(() => {})}
          style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: cardBg, borderWidth: 1, borderColor: cardBorder, alignItems: 'center', justifyContent: 'center' }}
        >
          <Feather name="help-circle" size={20} color={theme.colors.text.secondary} />
        </Pressable>
      </View>

      {/* Center content */}
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {/* Logo */}
        <View
          style={{
            width: 76,
            height: 76,
            borderRadius: 22,
            overflow: 'hidden',
            marginBottom: 24,
            backgroundColor: cardBg,
            borderWidth: 1,
            borderColor: cardBorder,
          }}
        >
          <Image source={require('../../assets/icon.png')} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        </View>

        <Text weight="semibold" style={{ fontSize: 30, lineHeight: 40, marginBottom: 12 }}>
          Добро пожаловать!
        </Text>
        <Text variant="body" color={theme.colors.text.secondary} style={{ fontSize: 16, lineHeight: 22, marginBottom: 40 }}>
          Общайтесь, делитесь моментами и будьте всегда на связи.
        </Text>

        {/* Buttons */}
        <Button icon="log-in" label="Войти" primary onPress={() => router.push('/(auth)/login')} />
        <Button icon="user-plus" label="Зарегистрироваться" onPress={() => router.push('/(auth)/register')} />
      </View>

      {/* Footer policy */}
      <View style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
        <Text variant="caption" align="center" color={theme.colors.text.tertiary} style={{ fontSize: 12, lineHeight: 17 }}>
          При входе в приложение вы принимаете{' '}
          <Text
            variant="caption"
            weight="semibold"
            color={theme.colors.text.secondary}
            style={{ fontSize: 12 }}
            onPress={() => Linking.openURL('https://san-m-app.com/terms').catch(() => {})}
          >
            Политику использования
          </Text>{' '}
          и{' '}
          <Text
            variant="caption"
            weight="semibold"
            color={theme.colors.text.secondary}
            style={{ fontSize: 12 }}
            onPress={() => Linking.openURL('https://san-m-app.com/privacy').catch(() => {})}
          >
            Политику конфиденциальности
          </Text>
          .
        </Text>
      </View>
    </View>
  );
}
