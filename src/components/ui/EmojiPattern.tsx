import React, { memo, useMemo } from 'react';
import { View, Text as RNText, StyleSheet } from 'react-native';

// Faint tiled emoji pattern used as a decorative background inside containers
// (e.g. link previews), Telegram-style.
//
// Performance: pure (memoized) and cheap — renders a fixed number of
// low-opacity emoji as plain text (no images, no network, no animation) in a
// non-interactive absolute layer. The scatter is randomized but DETERMINISTIC
// per `seed` (e.g. the url), so it never reshuffles on re-render → no jank.

interface EmojiPatternProps {
  emoji?: string;
  opacity?: number;
  seed?: string; // stable seed so the random layout doesn't change per render
  count?: number;
}

// Tiny deterministic PRNG (mulberry32) seeded from a string.
function seededRandom(seedStr: string) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const EmojiPattern = memo(function EmojiPattern({ emoji, opacity = 0.16, seed = 'x', count = 9 }: EmojiPatternProps) {
  if (!emoji) return null;
  const items = useMemo(() => {
    const rnd = seededRandom(seed + emoji);
    return Array.from({ length: count }, () => {
      const size = 26 + Math.floor(rnd() * 26); // 26–52px (larger)
      return {
        top: Math.floor(rnd() * 80) - 8, // -8 .. 72 px
        right: Math.floor(rnd() * 240), // spread across width
        size,
        rot: Math.floor(rnd() * 40) - 20, // -20°..20°
      };
    });
  }, [seed, emoji, count]);

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
            lineHeight: p.size + 8, // prevent top clipping
            width: p.size + 12,
            height: p.size + 12,
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
