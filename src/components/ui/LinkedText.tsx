import React from 'react';
import { Text as RNText, TextStyle } from 'react-native';
import { useTheme } from '../../theme';
import { openUrl } from '../../utils/openUrl';

interface LinkedTextProps {
  children: string;
  style?: TextStyle;
  color?: string;
}

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    let display = u.hostname.replace('www.', '');
    if (u.pathname && u.pathname !== '/') {
      const path = u.pathname.length > 15 ? u.pathname.slice(0, 15) + '...' : u.pathname;
      display += path;
    }
    return display;
  } catch {
    return url.length > 30 ? url.slice(0, 30) + '...' : url;
  }
}

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
              style={{ color: linkColor }}
              onPress={() => openUrl(part)}
            >
              {shortenUrl(part)}
            </RNText>
          );
        }
        return part;
      })}
    </RNText>
  );
}
