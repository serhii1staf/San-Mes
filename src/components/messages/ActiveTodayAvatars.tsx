import React, { memo, useMemo } from 'react';
import { View, Text as RNText, StyleSheet } from 'react-native';
import type { Conversation } from '../../types';

// ── Overlapping "active today" emoji avatars ────────────────────────────────
//
// The cluster that sits immediately left of the "Чаты" title. It shows the
// people the viewer has actually exchanged messages with in the last 24 hours,
// newest first, as overlapping ringed emoji discs.
//
// NO SERVER, NO PRESENCE SUBSCRIPTION — deliberately. "Active" here means
// "this conversation has a message from within the last 24 h", which is already
// present in the locally cached `Conversation.lastMessageAt`. That keeps this a
// pure function of data we hold anyway:
//   - zero extra requests, zero extra battery, nothing new to keep in sync;
//   - no new data collection, so no privacy-policy or App Store data-disclosure
//     change (Apple §3.3.3 — we are not gathering anything we did not already
//     have, and nothing leaves the device).
// A real presence system ("online now") would need a socket per user and would
// be a new category of collected data; this is not that, and should not become
// that without an explicit decision.

/** How far back counts as "active". */
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Hard cap on rendered discs — the header has a fixed budget of horizontal space. */
const MAX_AVATARS = 3;

const DISC = 26;
/** How much each disc slides under its left neighbour. */
const OVERLAP = 9;

export interface ActiveTodayEntry {
  id: string;
  emoji: string;
}

/**
 * Pick the conversations active within `ACTIVE_WINDOW_MS`, newest first, capped
 * at `MAX_AVATARS`. Exported (and pure) so it can be unit-tested without
 * rendering, and so the caller can decide whether to render anything at all.
 *
 * `now` is injectable for deterministic tests.
 */
export function selectActiveToday(
  conversations: readonly Conversation[],
  now: number = Date.now(),
): ActiveTodayEntry[] {
  const cutoff = now - ACTIVE_WINDOW_MS;
  const recent: { id: string; emoji: string; at: number }[] = [];

  for (const c of conversations) {
    if (!c?.lastMessageAt) continue;
    const at = Date.parse(c.lastMessageAt);
    // Guard against unparseable timestamps AND against clock skew putting a
    // message in the future (which would otherwise always sort to the top).
    if (!Number.isFinite(at) || at < cutoff || at > now) continue;
    recent.push({ id: c.id, emoji: c.participantEmoji || '💬', at });
  }

  recent.sort((a, b) => b.at - a.at);
  return recent.slice(0, MAX_AVATARS).map(({ id, emoji }) => ({ id, emoji }));
}

interface ActiveTodayAvatarsProps {
  entries: readonly ActiveTodayEntry[];
  /** Ring colour — matched to the header background so the discs read as stacked. */
  ringColor: string;
}

/**
 * Renders nothing when there is nobody to show, so the title stays optically
 * centred on a quiet day instead of being pushed off-centre by an empty gap.
 */
export const ActiveTodayAvatars = memo(function ActiveTodayAvatars({
  entries,
  ringColor,
}: ActiveTodayAvatarsProps) {
  // Deterministic per-id tint so the same person keeps the same disc colour
  // across renders and launches (no random(), no persisted state).
  const tinted = useMemo(
    () => entries.map((e) => ({ ...e, bg: tintForId(e.id) })),
    [entries],
  );

  if (tinted.length === 0) return null;

  return (
    <View style={styles.row} pointerEvents="none">
      {tinted.map((e, i) => (
        <View
          key={e.id}
          style={[
            styles.disc,
            {
              backgroundColor: e.bg,
              borderColor: ringColor,
              marginLeft: i === 0 ? 0 : -OVERLAP,
              // Later discs paint ON TOP of earlier ones, so the newest
              // conversation is the fully-visible one on the right.
              zIndex: i + 1,
            },
          ]}
        >
          <RNText style={styles.emoji} allowFontScaling={false}>
            {e.emoji}
          </RNText>
        </View>
      ))}
    </View>
  );
});

/**
 * Stable pastel tint from an id. A tiny FNV-1a hash keeps this deterministic
 * and dependency-free; the palette is fixed so discs never clash with the
 * accent colour.
 */
function tintForId(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return DISC_TINTS[Math.abs(h) % DISC_TINTS.length];
}

const DISC_TINTS = [
  '#C9A7EB', // lilac
  '#A7D8B0', // mint
  '#7FB2FF', // sky
  '#F5B7C4', // rose
  '#F5CE85', // sand
  '#8FD8D8', // teal
];

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `allowFontScaling={false}` above + a fixed size keeps the disc circular at
  // every Dynamic Type setting; an oversized glyph would otherwise stretch the
  // header row and shove the title off-centre.
  emoji: { fontSize: 13, lineHeight: 17 },
});
