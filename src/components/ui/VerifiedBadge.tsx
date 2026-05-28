import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

interface VerifiedBadgeProps {
  size?: number;
}

/**
 * Telegram-style verification badge — 6-pointed star with white checkmark
 * Recreates the exact Telegram Premium verified icon shape
 */
export function VerifiedBadge({ size = 14 }: VerifiedBadgeProps) {
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {/* 6-pointed star background (Telegram style) */}
        <Path
          d="M12 0.5L14.47 4.05L18.5 3.05L18.27 7.21L22 9.5L19.53 12.77L21.06 16.63L17.14 17.36L15.84 21.17L12 19.5L8.16 21.17L6.86 17.36L2.94 16.63L4.47 12.77L2 9.5L5.73 7.21L5.5 3.05L9.53 4.05L12 0.5Z"
          fill="#1DA1F2"
        />
        {/* White checkmark */}
        <Path
          d="M9.5 12.5L11 14L15 10"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}
