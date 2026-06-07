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
  dense?: boolean; // more emoji, covering the right side (e.g. profile post cards)
}

// Fixed, uniform-size emoji on the right side. Small count + small size keeps it
// cheap and prevents clipping inside thin link rows.
const SLOTS = [
  { top: 4, right: 8 },
  { top: 22, right: 26 },
  { top: 13, right: 46 },
];

// Denser, evenly-tiled set for larger containers (profile cards). Still a fixed,
// deterministic layout → rendered once, never re-shuffles, negligible cost.
const DENSE_SLOTS = [
  { top: 4, right: 8 }, { top: 6, right: 34 }, { top: 2, right: 60 }, { top: 8, right: 86 },
  { top: 30, right: 18 }, { top: 34, right: 46 }, { top: 30, right: 72 }, { top: 36, right: 98 },
  { top: 58, right: 6 }, { top: 60, right: 32 }, { top: 56, right: 60 }, { top: 62, right: 88 },
];

export const EmojiPattern = memo(function EmojiPattern({ emoji, opacity = 0.14, dense }: EmojiPatternProps) {
  if (!emoji) return null;
  const slots = dense ? DENSE_SLOTS : SLOTS;
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
