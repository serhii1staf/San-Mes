import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';

interface CardProps {
  children: React.ReactNode;
  shadow?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  padding?: 'sm' | 'md' | 'lg';
  style?: ViewStyle;
}

export function Card({
  children,
  shadow = 'md',
  padding = 'md',
  style,
}: CardProps) {
  const theme = useTheme();

  const paddingValues = {
    sm: theme.spacing.sm,
    md: theme.spacing.base,
    lg: theme.spacing.lg,
  };

  const cardStyle: ViewStyle = {
    backgroundColor: theme.colors.background.elevated,
    borderRadius: theme.borderRadius.lg,
    padding: paddingValues[padding],
    ...theme.getShadow(shadow),
  };

  return <View style={[cardStyle, style]}>{children}</View>;
}
