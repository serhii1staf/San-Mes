import React from 'react';
import { Pressable, ViewStyle, TextStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  style?: ViewStyle;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  style,
}: ButtonProps) {
  const theme = useTheme();

  const getBackgroundColor = (): string => {
    if (disabled) return theme.colors.border.light;
    switch (variant) {
      case 'primary':
        return theme.colors.accent.primary;
      case 'secondary':
        return theme.colors.accent.secondary;
      case 'outline':
      case 'ghost':
        return 'transparent';
      default:
        return theme.colors.accent.primary;
    }
  };

  const getTextColor = (): string => {
    if (disabled) return theme.colors.text.tertiary;
    switch (variant) {
      case 'primary':
        return theme.colors.text.inverse;
      case 'secondary':
        return theme.colors.text.inverse;
      case 'outline':
      case 'ghost':
        return theme.colors.accent.primary;
      default:
        return theme.colors.text.inverse;
    }
  };

  const sizeStyles: Record<ButtonSize, { paddingVertical: number; paddingHorizontal: number }> = {
    sm: { paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.base },
    md: { paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.lg },
    lg: { paddingVertical: theme.spacing.base, paddingHorizontal: theme.spacing.xl },
  };

  const containerStyle: ViewStyle = {
    backgroundColor: getBackgroundColor(),
    borderRadius: theme.borderRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: variant === 'outline' ? 1.5 : 0,
    borderColor: variant === 'outline' ? theme.colors.accent.primary : 'transparent',
    ...sizeStyles[size],
  };

  const textVariant: 'body' | 'caption' = size === 'sm' ? 'caption' : 'body';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[containerStyle, style]}
    >
      <Text
        variant={textVariant}
        weight="semibold"
        style={{ color: getTextColor() } as TextStyle}
      >
        {title}
      </Text>
    </Pressable>
  );
}
