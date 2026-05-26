import React, { useState } from 'react';
import { TextInput, View, ViewStyle, TextStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';

interface InputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  label?: string;
  multiline?: boolean;
  secureTextEntry?: boolean;
  style?: ViewStyle;
}

export function Input({
  value,
  onChangeText,
  placeholder,
  label,
  multiline = false,
  secureTextEntry = false,
  style,
}: InputProps) {
  const theme = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  const containerStyle: ViewStyle = {
    borderWidth: 1.5,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.base,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.background.elevated,
    borderColor: isFocused ? theme.colors.accent.primary : theme.colors.border.light,
  };

  const inputStyle: TextStyle = {
    fontSize: theme.typography.sizes.base,
    fontFamily: theme.fontFamily.regular,
    color: theme.colors.text.primary,
    padding: 0,
    minHeight: multiline ? 80 : undefined,
    textAlignVertical: multiline ? 'top' : 'center',
  };

  return (
    <View style={style}>
      {label && (
        <Text
          variant="caption"
          weight="medium"
          color={isFocused ? theme.colors.accent.primary : theme.colors.text.secondary}
          style={{ marginBottom: theme.spacing.xs } as TextStyle}
        >
          {label}
        </Text>
      )}
      <View style={containerStyle}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.text.tertiary}
          multiline={multiline}
          secureTextEntry={secureTextEntry}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={inputStyle}
        />
      </View>
    </View>
  );
}
