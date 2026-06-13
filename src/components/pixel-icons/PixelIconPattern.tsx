/**
 * PixelIconPattern — counterpart of `EmojiPattern` for pixel icons.
 *
 * Same idea: faint decoration on the right side of a container,
 * pinned in three deterministic positions, non-interactive overlay.
 * Used inside ProfilePostCard / UserProfilePostCard when the user
 * has chosen a pixel icon (rather than an emoji) as their profile
 * post decoration. The slot positions intentionally mirror
 * `EmojiPattern.SLOTS` so swapping between the two never reflows the
 * card visually.
 *
 * Performance:
 * - Each instance renders 3 `expo-image` `<Image>`s. With the
 *   `memory-disk` cache they decode once and stay warm — flipping
 *   between cards on the profile feed reuses the same bitmap.
 * - The wrapper is `pointerEvents="none"` so it never participates
 *   in hit-testing.
 * - Pure + memoized so list re-renders that don't actually change
 *   the icon id never re-walk the slots.
 */

import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { PixelIcon } from './PixelIcon';

interface PixelIconPatternProps {
  /** Registry id (no `pixel:` prefix here — caller strips it). */
  id?: string;
  /** Per-glyph opacity. Keeps the decoration faint. */
  opacity?: number;
}

// Match EmojiPattern's slot geometry exactly so the visual rhythm
// of a card is identical regardless of which decoration kind the
// user picked.
const SLOTS: Array<{ top: number; right: number; size: number }> = [
  { top: 6, right: 8, size: 22 },
  { top: 26, right: 26, size: 22 },
  { top: 50, right: 10, size: 22 },
];

export const PixelIconPattern = memo(function PixelIconPattern({
  id,
  opacity = 0.16,
}: PixelIconPatternProps) {
  if (!id) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wrap]}>
      {SLOTS.map((p, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            top: p.top,
            right: p.right,
            opacity,
          }}
        >
          <PixelIcon id={id} size={p.size} />
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
});
