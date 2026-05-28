import React from 'react';
import { Image } from 'react-native';

interface VerifiedBadgeProps {
  size?: number;
}

/**
 * Verified badge — uses custom PNG icon
 */
export function VerifiedBadge({ size = 14 }: VerifiedBadgeProps) {
  return (
    <Image
      source={require('../../../assets/verified-badge.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}
