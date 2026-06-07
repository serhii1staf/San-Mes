import React, { memo } from 'react';
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

// Three small emoji on the right — deliberately minimal so it never weighs on
// rendering. Fixed, deterministic positions → rendered once, no reshuffle.
const SLOTS = [
  { top: 8, right: 10 },
  { top: 30, right: 28 },
  { top: 52, right: 12 },
];

export const EmojiPattern = memo(function EmojiPattern({ emoji, opacity = 0.14 }: EmojiPatternProps) {
  if (!emoji) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {SLOTS.map((p, i) => (
        <RNText
          key={i}
          allowFontScaling={false}
          style={{
            position: 'absolute',
            top: p.top,
            right: p.right,
            fontSize: 15,
            lineHeight: 18,
            opacity,
          }}
        >
          {emoji}
        </RNText>
      ))}
    </View>
  );
});
