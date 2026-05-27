import React from 'react';
import { Text as RNText, TextStyle, Linking } from 'react-native';
import { useTheme } from '../../theme';

interface LinkedTextProps {
  children: string;
  style?: TextStyle;
  color?: string;
}

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

export function LinkedText({ children, style, color }: LinkedTextProps) {
  const theme = useTheme();
  const textColor = color || theme.colors.text.secondary;
  const linkColor = theme.colors.accent.primary;

  const parts = children.split(URL_REGEX);

  return (
    <RNText style={[{ fontSize: 15, color: textColor, fontFamily: 'Inter_400Regular' }, style]}>
      {parts.map((part, i) => {
        if (URL_REGEX.test(part)) {
          URL_REGEX.lastIndex = 0; // Reset regex state
          return (
            <RNText
              key={i}
              style={{ color: linkColor, textDecorationLine: 'underline' }}
              onPress={() => Linking.openURL(part)}
            >
              {part}
            </RNText>
          );
        }
        return part;
      })}
    </RNText>
  );
}
