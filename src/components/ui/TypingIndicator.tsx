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
import { GlassBg, useLiquidGlassActive } from './LiquidGlass';
import { perfMonitor } from '../../services/perfMonitor';
import { useSettingsStore } from '../../store/settingsStore';

/**
 * Cap on rendered emoji. A comment thread can have many simultaneous typists and the strip
 * must stay one line; beyond this the text carries the count instead.
 */
const MAX_EMOJI = 3;

function TypingIndicatorImpl({ channelName }: { channelName: string | null }) {
  const theme = useTheme();
  const t = useT();
  const glassActive = useLiquidGlassActive();
  const peers = useTypingPeers(channelName);

  // ── INSTRUMENTED, BECAUSE THIS IS A SUSPECT AND GUESSING HAS COST US ROUNDS ─
  //
  // A device trace shows `chat/[id]` blocked for 320-530 ms roughly every 2.0-2.7 s, sustained
  // for 18 s, with all image loading finished and `pendingDecodes` 0-2. The only exact 2 s
  // cadence left in the codebase is `PUBLISH_THROTTLE_MS` in services/realtime/typing.ts, and a
  // keystroke-gated throttle is the one mechanism that produces a SPREAD like that rather than
  // clean 2.0 s ticks.
  //
  // The plausible chain: `IDLE_STOP_MS` (2600) makes the publisher emit a STOP after a short
  // silence, so a peer typing in ordinary bursts drives this component between `null` and the
  // strip repeatedly. Each transition changes the composer's height, and the transcript above it
  // is a FlashList with `maintainVisibleContentPosition`, which anchors on items.
  //
  // That is a hypothesis, not a finding, and the honest thing is to make the next snapshot
  // answer it instead of changing behaviour on a guess. If these marks land immediately before
  // the long tasks, the chain is real; if they do not appear at all, typing is exonerated and
  // the remaining candidate is the older-chunk prepend loop.
  //
  // The flag is checked HERE, not inside `mark`. I first wrote that `mark` guards itself; it does
  // not — it goes straight to `_record` + `_notify` with no check, unlike `markImageDecode` and
  // `markScreenMount`. So an unguarded call would write into the event ring for every user, forever,
  // to serve a diagnostic. Read non-reactively (`getState`), the same way `MessageBubble` does it, so
  // toggling the monitor cannot re-render this strip.
  //
  // The count is in the label because 0 -> N and N -> 0 are the transitions that move layout, while
  // N -> N does not: `flush` in the typing service returns the PREVIOUS array when membership is
  // unchanged, so this effect should not even fire for a steadily-typing peer. If it fires every two
  // seconds anyway, that itself is the finding.
  const peerCount = peers.length;
  React.useEffect(() => {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    perfMonitor.mark(`typing.peers(${peerCount})`);
  }, [peerCount]);

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
            borderColor: theme.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)',
          },
          // The flat fill is only for devices without liquid glass. With glass active the
          // `GlassBg` below supplies the material, and painting a translucent fill on top of it
          // would mute the blur it exists to provide.
          glassActive ? null : { backgroundColor: theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)' },
        ]}
        // Announced as a live status so a screen reader mentions it without stealing focus
        // from the field the user is typing into.
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        accessibilityLabel={label}
      >
        {/* Blur behind the pill, as requested — the flat translucent fill read as "just
            transparent" over a busy transcript.

            `GlassBg` sits BEHIND the content as an absolute sibling rather than wrapping it. That
            is the app-wide rule for this material (see the reply/edit banners in both composers):
            wrapping text in a glass view puts the text INSIDE the blur, which optically warps it.
            Behind it, the text stays crisp and only what is underneath is blurred.

            `interactive={false}` because this pill is `pointerEvents="none"` — an interactive
            glass surface animates in response to touches it can never receive, which is pure
            cost. `overflow: 'hidden'` on the pill is what clips the material to the rounded
            corners. */}
        {glassActive ? (
          <GlassBg
            borderRadius={13}
            glassStyle="regular"
            interactive={false}
            colorScheme={theme.isDark ? 'dark' : 'light'}
            tintColor={theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.45)'}
          />
        ) : null}
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
        {/* `text.secondary`, not `text.tertiary`. Reported as the label reading dark rather than
            white: tertiary is the dimmest step in the palette, intended for de-emphasised
            metadata sitting on an opaque surface. This pill is translucent and floats over the
            transcript — often over a message bubble — so the dimmest step does not have the
            contrast to carry. Secondary is still clearly subordinate to message text without
            disappearing into whatever is behind it, on either theme. */}
        <Text variant="caption" color={theme.colors.text.secondary} numberOfLines={1} style={styles.label}>
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
    gap: 6,
    paddingHorizontal: 10,
    // Vertical padding follows the emoji's box (22) rather than the label's (12): a tall glyph in
    // a pill sized for small text is the other half of "the emoji is cut off".
    paddingVertical: 4,
    borderRadius: 13,
    // Clips `GlassBg` to the rounded corners. Without it the material paints a square behind the
    // pill and the border looks detached from the blur.
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    // Bounded so a long display name cannot push the pill past the screen edge.
    maxWidth: '86%',
  },
  emojiRow: { flexDirection: 'row', alignItems: 'center' },
  // ── EMOJI SIZING: TWO SEPARATE CAUSES OF THE CLIPPING ─────────────────────
  //
  // Reported as the emoji being cut off and looking low quality. Both parts were real.
  //
  // CUT OFF — the glyph had `fontSize: 13` and no `lineHeight`. A colour emoji is drawn taller
  // than a Latin glyph of the same point size, so the default line box is shorter than the
  // bitmap and the top and bottom are trimmed. An explicit `lineHeight` comfortably above the
  // font size gives the glyph room. The `marginRight: -2` made it worse by pulling the next
  // emoji into the previous one's box; the row uses the pill's `gap` for spacing instead.
  //
  // LOW QUALITY — a knock-on of the same thing. Colour emoji ship as bitmap strikes at fixed
  // sizes, so at 13 pt the renderer scales a larger strike down and the result looks soft. 16 pt
  // lands closer to a native strike and reads crisp. It is also simply easier to recognise
  // whose emoji it is, which is the point of showing it.
  // ── STILL CLIPPED AFTER lineHeight, SO THE BOX IS MADE EXPLICIT ───────────
  //
  // Reported as still cut off after the first fix. `lineHeight` alone is not enough on Android:
  // the text view's height comes from the font's ascent+descent metrics, and a colour emoji's
  // bitmap routinely exceeds them — so the glyph overflows a box that `lineHeight` merely
  // *suggested*. Reanimated/RN then clips to the measured view, not to the line box.
  //
  // Giving the Text an explicit `height` and `textAlignVertical: 'center'` makes the box
  // authoritative and comfortably larger than the glyph at this size, so there is nothing left to
  // trim. `includeFontPadding: false` removes Android's extra ascent/descent padding, which
  // otherwise pushes the glyph off-centre inside that taller box.
  emoji: {
    fontSize: 17,
    lineHeight: 22,
    height: 22,
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  label: { fontSize: 12, flexShrink: 1 },
});

/**
 * Memoized on `channelName`, which is the only prop. The component re-renders when its own
 * subscription changes, never because a parent did.
 */
export const TypingIndicator = React.memo(TypingIndicatorImpl);
