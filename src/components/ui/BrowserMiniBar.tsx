import React from 'react';
import { View, Pressable, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { useBrowserStore } from '../../store/browserStore';

export function BrowserMiniBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { minimizedUrl, minimizedDomain, clearMinimized } = useBrowserStore();

  if (!minimizedUrl) return null;

  const handleOpen = () => {
    router.push({ pathname: '/browser', params: { url: encodeURIComponent(minimizedUrl) } });
  };

  const handleClose = () => {
    clearMinimized();
  };

  return (
    <View style={{ position: 'absolute', top: insets.top + 4, left: 16, right: 16, zIndex: 200 }}>
      <Pressable
        onPress={handleOpen}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: theme.isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.97)',
          borderRadius: 16,
          paddingHorizontal: 12,
          paddingVertical: 8,
          gap: 10,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          elevation: 8,
          borderWidth: 0.5,
          borderColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
        }}
      >
        {/* Logo */}
        <Image source={require('../../../assets/icon.png')} style={{ width: 20, height: 20, borderRadius: 6 }} />
        {/* Domain */}
        <View style={{ flex: 1 }}>
          <Text variant="caption" weight="medium" numberOfLines={1} style={{ fontSize: 12 }}>
            {minimizedDomain || 'Браузер'}
          </Text>
        </View>
        {/* Close */}
        <Pressable onPress={handleClose} hitSlop={8} style={{ padding: 4 }}>
          <Feather name="x" size={16} color={theme.colors.text.tertiary} />
        </Pressable>
      </Pressable>
    </View>
  );
}
