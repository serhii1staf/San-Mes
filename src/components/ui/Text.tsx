import React from 'react';
import { Text as RNText, TextStyle, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';

type TextVariant = 'heading' | 'subheading' | 'body' | 'caption' | 'label';
type TextWeight = 'light' | 'regular' | 'medium' | 'semibold' | 'bold';

interface TextProps {
  children: React.ReactNode;
  variant?: TextVariant;
  weight?: TextWeight;
  color?: string;
  align?: TextStyle['textAlign'];
  style?: TextStyle;
  numberOfLines?: number;
}

export function Text({
  children,
  variant = 'body',
  weight = 'regular',
  color,
  align,
  style,
  numberOfLines,
}: TextProps) {
  const theme = useTheme();

  const variantStyles: Record<TextVariant, TextStyle> = {
    heading: {
      fontSize: theme.typography.sizes['2xl'] * theme.fontScale,
      lineHeight: theme.typography.sizes['2xl'] * theme.fontScale * theme.typography.lineHeights.tight,
    },
    subheading: {
      fontSize: theme.typography.sizes.lg * theme.fontScale,
      lineHeight: theme.typography.sizes.lg * theme.fontScale * theme.typography.lineHeights.tight,
    },
    body: {
      fontSize: theme.typography.sizes.base * theme.fontScale,
      lineHeight: theme.typography.sizes.base * theme.fontScale * theme.typography.lineHeights.normal,
    },
    caption: {
      fontSize: theme.typography.sizes.sm * theme.fontScale,
      lineHeight: theme.typography.sizes.sm * theme.fontScale * theme.typography.lineHeights.normal,
    },
    label: {
      fontSize: theme.typography.sizes.xs * theme.fontScale,
      lineHeight: theme.typography.sizes.xs * theme.fontScale * theme.typography.lineHeights.normal,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
  };

  const weightToFont: Record<TextWeight, string> = {
    light: theme.fontFamily.light,
    regular: theme.fontFamily.regular,
    medium: theme.fontFamily.medium,
    semibold: theme.fontFamily.semibold,
    bold: theme.fontFamily.bold,
  };

  const textStyle: TextStyle = {
    color: color || theme.colors.text.primary,
    fontFamily: weightToFont[weight],
    textAlign: align,
    ...variantStyles[variant],
  };

  return (
    <RNText style={[textStyle, style]} numberOfLines={numberOfLines}>
      {children}
    </RNText>
  );
}
