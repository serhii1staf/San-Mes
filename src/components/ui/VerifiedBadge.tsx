import React from 'react';
import { View, Text as RNText } from 'react-native';

interface VerifiedBadgeProps {
  size?: number;
}

/**
 * Telegram-style verification badge — blue rounded shape with white ✓
 * Uses a rotated square behind a circle to create a star-like shape
 */
export function VerifiedBadge({ size = 14 }: VerifiedBadgeProps) {
  const innerSize = size * 0.85;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Background diamond (rotated square) */}
      <View style={{
        position: 'absolute',
        width: innerSize,
        height: innerSize,
        backgroundColor: '#1DA1F2',
        borderRadius: innerSize * 0.22,
        transform: [{ rotate: '45deg' }],
      }} />
      {/* Background circle overlay */}
      <View style={{
        position: 'absolute',
        width: innerSize,
        height: innerSize,
        backgroundColor: '#1DA1F2',
        borderRadius: innerSize * 0.5,
      }} />
      {/* Checkmark */}
      <RNText style={{ fontSize: size * 0.5, color: '#FFFFFF', fontWeight: '800', lineHeight: size * 0.65, marginTop: -1 }} allowFontScaling={false}>✓</RNText>
    </View>
  );
}
