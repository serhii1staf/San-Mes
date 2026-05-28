import React from 'react';
import { View, Text as RNText } from 'react-native';
import { Feather } from '@expo/vector-icons';

interface VerifiedBadgeProps {
  size?: number;
}

/**
 * Verification badge — blue filled circle with white check icon (Feather)
 * Uses @expo/vector-icons which is guaranteed to render
 */
export function VerifiedBadge({ size = 14 }: VerifiedBadgeProps) {
  const iconSize = Math.round(size * 0.6);
  return (
    <View style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: '#2AABEE',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Feather name="check" size={iconSize} color="#FFFFFF" />
    </View>
  );
}
