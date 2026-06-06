import React, { memo, useMemo } from 'react';
import { View, Text as RNText, StyleSheet } from 'react-native';

// Faint tiled emoji pattern used as a decorative background inside containers
// (e.g. link previews), Telegram-style.
//
// Performance: it is pure (memoized), renders a fixed small grid of low-opacity
// emoji as plain text (no images, no network, no animation) and is wrapped in a
// non-interactive absolute layer, so it costs almost nothing and never reloads.

interface EmojiPatternProps {
  emoji?: string;
  opacity?: number;
  color?: string; // optional tint via text color (emoji ignore color, but spacing dots use it)
}

// A compact staggered grid of positions (percentages) — looks like the
// scattered pattern in the screenshot without overdrawing.
const POSITIONS: { top: string; left: string; size: number; rot: number }[] = [
  { top: '8%', left: '6%', size: 26, rot: -12 },
  { top: '14%', left: '42%', size: 20, rot: 8 },
  { top: '6%', left: '74%', size: 28, rot: 14 },
  { top: '40%', left: '20%', size: 22, rot: -6 },
  { top: '46%', left: '60%', size: 26, rot: 10 },
  { top: '38%', left: '88%', size: 18, rot: -14 },
  { top: '72%', left: '10%', size: 24, rot: 6 },
  { top: '78%', left: '46%', size: 20, rot: -10 },
  { top: '70%', left: '80%', size: 26, rot: 12 },
];

export const EmojiPattern = memo(function EmojiPattern({ emoji, opacity = 0.12 }: EmojiPatternProps) {
  if (!emoji) return null;
  const items = useMemo(() => POSITIONS, []);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {items.map((p, i) => (
        <RNText
          key={i}
          allowFontScaling={false}
          style={{
            position: 'absolute',
            top: p.top as any,
            left: p.left as any,
            fontSize: p.size,
            opacity,
            transform: [{ rotate: `${p.rot}deg` }],
          }}
        >
          {emoji}
        </RNText>
      ))}
    </View>
  );
});
