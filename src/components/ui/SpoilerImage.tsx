import React, { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { useT } from '../../i18n/store';

interface SpoilerImageProps {
  uri: string;
  width: number | string;
  height: number;
  borderRadius?: number;
  isSpoiler?: boolean;
}

/**
 * Image that can be hidden behind a spoiler blur overlay.
 * User taps to reveal. Shows "Контент скрыт" until tapped.
 */
export function SpoilerImage({ uri, width, height, borderRadius = 12, isSpoiler = false }: SpoilerImageProps) {
  const theme = useTheme();
  const t = useT();
  const [revealed, setRevealed] = useState(!isSpoiler);

  if (!isSpoiler || revealed) {
    return <CachedImage uri={uri} style={{ width: width as any, height, borderRadius }} resizeMode="cover" />;
  }

  return (
    <Pressable onPress={() => setRevealed(true)} style={{ width: width as any, height, borderRadius, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}>
      {/* Heavily blurred preview behind overlay */}
      <CachedImage uri={uri} style={{ width: '100%', height: '100%', opacity: 0.08 }} resizeMode="cover" />
      {/* Overlay */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.isDark ? 'rgba(20,20,20,0.92)' : 'rgba(200,200,200,0.92)', alignItems: 'center', justifyContent: 'center', borderRadius }}>
        <Feather name="eye-off" size={24} color={theme.colors.text.tertiary} />
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 6 }}>{t('spoiler.tap_to_view')}</Text>
      </View>
    </Pressable>
  );
}
