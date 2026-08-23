/**
 * "N is typing…" strip, shown directly above a composer.
 *
 * ── WHY THIS OWNS ITS OWN SUBSCRIPTION ──────────────────────────────────────
 *
 * The component subscribes internally rather than taking a `peers` prop. That is the whole
 * point of it existing as a separate component: if the chat or comments screen subscribed and
 * passed the list down, every "someone started typing" would re-render the screen — and with
 * it the transcript, the banner, the keyboard-driven animated styles and every mounted bubble.
 * Keeping the subscription in a leaf means a typing event re-renders these few dozen pixels
 * and nothing else.
 *
 * Both screens are extremely re-render sensitive and already carry deliberate machinery to
 * isolate their composers (`ChatField`, `CommentField`). This follows the same rule from the
 * other direction.
 *
 * ── LAYOUT ──────────────────────────────────────────────────────────────────
 *
 * Absolutely nothing about this strip changes the composer's layout when it is empty: it
 * renders `null`. When it appears it adds its own height above the input, which is correct —
 * it should push the banner/input up rather than overlap them, so it can never cover the text
 * being typed.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { useTypingPeers } from '../../services/realtime/typing';

/**
 * Cap on rendered emoji. A comment thread can have many simultaneous typists and the strip
 * must stay one line; beyond this the text carries the count instead.
 */
const MAX_EMOJI = 3;

function TypingIndicatorImpl({ channelName }: { channelName: string | null }) {
  const theme = useTheme();
  const t = useT();
  const peers = useTypingPeers(channelName);

  if (peers.length === 0) return null;

  // Wording is resolved here, not in the service, so it stays translatable and the service
  // stays free of presentation. Three cases, because "5 people are typing" and
  // "Alice is typing" are different sentences in both shipped locales.
  let label: string;
  if (peers.length === 1) {
    const name = peers[0].name.trim();
    label = name
      ? t('typing.one', undefined, { name })
      : t('typing.someone');
  } else if (peers.length === 2) {
    const a = peers[0].name.trim();
    const b = peers[1].name.trim();
    label = a && b ? t('typing.two', undefined, { a, b }) : t('typing.many', undefined, { n: peers.length });
  } else {
    label = t('typing.many', undefined, { n: peers.length });
  }

  const emoji = peers.filter((p) => !!p.emoji).slice(0, MAX_EMOJI);

  return (
    <View style={styles.row} pointerEvents="none">
      {/* Outlined pill. The strip used to be bare text floating over the transcript, which
          read as a stray line rather than a piece of chrome — a border plus a faint fill gives
          it an edge so it separates from whatever message happens to sit behind it.

          Accessibility props live on these Views, not on `Text`: the app's `Text` wrapper
          exposes a narrow prop surface (variant/color/weight/numberOfLines/style) and does not
          forward accessibility props, so putting them here is both type-correct and the right
          granularity — the pill is one status, not several strings. */}
      <View
        style={[
          styles.pill,
          {
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            borderColor: theme.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)',
          },
        ]}
        // Announced as a live status so a screen reader mentions it without stealing focus
        // from the field the user is typing into.
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        accessibilityLabel={label}
      >
        {emoji.length > 0 ? (
          // Emoji are decorative — the label already names who is typing — so they are hidden
          // from assistive tech rather than read out as stray characters.
          <View style={styles.emojiRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {emoji.map((p) => (
              <Text key={p.id} variant="caption" style={styles.emoji}>
                {p.emoji}
              </Text>
            ))}
          </View>
        ) : null}
        <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={styles.label}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // `flex-start` so the pill hugs its content instead of stretching the full width.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    // Bounded so a long display name cannot push the pill past the screen edge.
    maxWidth: '86%',
  },
  emojiRow: { flexDirection: 'row', alignItems: 'center' },
  // Slight negative margin so several emoji read as a small cluster rather than a spaced list.
  emoji: { fontSize: 13, marginRight: -2 },
  label: { fontSize: 12, flexShrink: 1 },
});

/**
 * Memoized on `channelName`, which is the only prop. The component re-renders when its own
 * subscription changes, never because a parent did.
 */
export const TypingIndicator = React.memo(TypingIndicatorImpl);
