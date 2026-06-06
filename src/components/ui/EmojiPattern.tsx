import React, { memo, useMemo } from 'react';
import { View, Text as RNText, StyleSheet } from 'react-native';

// Faint tiled emoji pattern used as a decorative background inside containers
// (e.g. link previews), Telegram-style.
//
// Performance: pure (memoized), renders a small set of low-opacity emoji as
// plain text (no images, no network, no animation), wrapped in a
// non-interactive absolute layer → costs almost nothing and never reloads.

interface EmojiPatternProps {
  emoji?: string;
  opacity?: number;
}

// Scattered positions across the container. Each emoji is large and given
// enough lineHeight/width so it is never clipped at the top.
const POSITIONS: { top: number; right: number; size: number; rot: number }[] = [
  { top: -6, right: 4, size: 40, rot: -12 },
  { top: 10, right: 64, size: 30, rot: 10 },
  { top: 28, right: 18, size: 36, rot: 14 },
  { top: 4, right: 120, size: 26, rot: -8 },
  { top: 34, right: 96, size: 30, rot: 8 },
];

export const EmojiPattern = memo(function EmojiPattern({ emoji, opacity = 0.14 }: EmojiPatternProps) {
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
            top: p.top,
            right: p.right,
            fontSize: p.size,
            lineHeight: p.size + 6, // prevent top clipping
            width: p.size + 10,
            height: p.size + 10,
            textAlign: 'center',
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
