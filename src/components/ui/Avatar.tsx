import React from 'react';
import { View, Image, ViewStyle, TextStyle, Platform } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  source?: string;
  name?: string;
  emoji?: string;
  size?: AvatarSize;
  style?: ViewStyle;
}

export function Avatar({
  source,
  name,
  emoji,
  size = 'md',
  style,
}: AvatarProps) {
  const theme = useTheme();

  const sizeMap: Record<AvatarSize, number> = {
    xs: 24,
    sm: 32,
    md: 44,
    lg: 64,
    xl: 96,
  };

  const emojiSizeMap: Record<AvatarSize, number> = {
    xs: 14,
    sm: 20,
    md: 28,
    lg: 42,
    xl: 60,
  };

  const fontSizeMap: Record<AvatarSize, number> = {
    xs: 10,
    sm: theme.typography.sizes.xs,
    md: theme.typography.sizes.base,
    lg: theme.typography.sizes.lg,
    xl: theme.typography.sizes['2xl'],
  };

  const dimension = sizeMap[size];

  // Emoji avatar — render as plain Text, no View wrapper with borderRadius
  // This prevents clipping on Android where borderRadius clips children
  if (emoji) {
    return (
      <View
        style={[
          {
            width: dimension,
            height: dimension,
            alignItems: 'center',
            justifyContent: 'center',
            // NO borderRadius, NO overflow hidden — prevents clipping
          },
          style,
        ]}
      >
        <Text
          style={{
            fontSize: emojiSizeMap[size],
            lineHeight: emojiSizeMap[size] * 1.15,
            textAlign: 'center',
          } as TextStyle}
        >
          {emoji}
        </Text>
      </View>
    );
  }

  const containerStyle: ViewStyle = {
    width: dimension,
    height: dimension,
    borderRadius: dimension / 2,
    overflow: 'hidden',
    backgroundColor: theme.colors.accent.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  };

  if (source) {
    return (
      <View style={[containerStyle, style]}>
        <Image
          source={{ uri: source }}
          style={{ width: dimension, height: dimension }}
        />
      </View>
    );
  }

  const getInitials = (name?: string): string => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name[0].toUpperCase();
  };

  return (
    <View style={[containerStyle, style]}>
      <Text
        weight="semibold"
        color={theme.colors.text.inverse}
        style={{ fontSize: fontSizeMap[size] } as TextStyle}
      >
        {getInitials(name)}
      </Text>
    </View>
  );
}
