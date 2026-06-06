import React, { memo, useMemo } from 'react';
import { View, Text as RNText, StyleSheet } from 'react-native';

// Faint emoji decoration on the right side of a container (Telegram-style).
//
// Performance: pure + memoized. Renders only a FEW small low-opacity emoji as
// plain text (no images, no network, no animation), pinned to the right side,
// in a non-interactive absolute layer. Deterministic per `seed` so it never
// reshuffles on re-render → zero jank, negligible cost.

interface EmojiPatternProps {
  emoji?: string;
  opacity?: number;
  seed?: string;
}

// Fixed, uniform-size emoji on the right side. Small count + small size keeps it
// cheap and prevents clipping inside thin link rows.
const SLOTS = [
  { top: 4, right: 8 },
  { top: 22, right: 26 },
  { top: 13, right: 46 },
];

export const EmojiPattern = memo(function EmojiPattern({ emoji, opacity = 0.14 }: EmojiPatternProps) {
  if (!emoji) return null;
  const slots = useMemo(() => SLOTS, []);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {slots.map((p, i) => (
        <RNText
          key={i}
          allowFontScaling={false}
          style={{
            position: 'absolute',
            top: p.top,
            right: p.right,
            fontSize: 16,
            lineHeight: 20,
            opacity,
          }}
        >
          {emoji}
        </RNText>
      ))}
    </View>
  );
});
