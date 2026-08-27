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
  /**
   * Render the label INSIDE the bordered field instead of above it.
   *
   * Opt-in, and deliberately not the default: this component is also used by the auth screens, and
   * moving their labels would be an unrequested visual change to sign-in and sign-up. Only the profile
   * editor asks for it.
   *
   * The inside layout also carries a rounder corner radius, because a field that contains its own
   * label reads as a card rather than as a text box, and `borderRadius.md` looks undersized at that
   * height.
   */
  labelInside?: boolean;
  /**
   * `false` makes the field read-only while keeping it fully visible.
   *
   * Used by the profile editor's view/edit toggle. `editable={false}` on a `TextInput` is the right
   * mechanism rather than rendering `Text` instead: the layout, font metrics and line wrapping stay
   * byte-identical between the two states, so switching modes cannot move anything on screen.
   */
  editable?: boolean;
}

export function Input({
  value,
  onChangeText,
  placeholder,
  label,
  multiline = false,
  secureTextEntry = false,
  style,
  labelInside = false,
  editable = true,
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
    // 18 matches the radius the profile editor's removed card used, so the field now carries the
    // rounding that the container around it used to provide.
    borderRadius: labelInside ? 18 : theme.borderRadius.md,
    paddingHorizontal: theme.spacing.base,
    // A little more breathing room when the label lives inside, since the box holds two rows.
    paddingVertical: labelInside ? theme.spacing.md + 2 : theme.spacing.md,
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

  const labelEl = label ? (
    <Text
      variant="caption"
      weight="medium"
      color={isFocused ? theme.colors.accent.primary : theme.colors.text.secondary}
      style={{ marginBottom: theme.spacing.xs } as TextStyle}
    >
      {label}
    </Text>
  ) : null;

  return (
    <View style={style}>
      {labelInside ? null : labelEl}
      <View style={containerStyle}>
        {labelInside ? labelEl : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.text.tertiary}
          multiline={multiline}
          secureTextEntry={secureTextEntry}
          editable={editable}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={inputStyle}
        />
      </View>
    </View>
  );
}
