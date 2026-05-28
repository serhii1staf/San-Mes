import React from 'react';
import { View, Text as RNText } from 'react-native';

interface VerifiedBadgeProps {
  size?: number;
}

/**
 * Telegram-style verification badge — blue filled circle with white ✓
 */
export function VerifiedBadge({ size = 14 }: VerifiedBadgeProps) {
  return (
    <View style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: '#1DA1F2',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <RNText style={{
        fontSize: size * 0.55,
        color: '#FFFFFF',
        fontWeight: '900',
        lineHeight: size * 0.7,
        textAlign: 'center',
      }} allowFontScaling={false}>✓</RNText>
    </View>
  );
}
