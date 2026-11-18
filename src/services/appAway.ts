/**
 * How long the app was really away before the current return to the foreground.
 *
 * Several resume handlers refetch "whatever may have arrived while we were gone": the chat list and
 * its unread counters, the notifications bell, the open chat's read mark, the session check. They
 * used to run on EVERY `'active'` event, and on iOS most of those events are not returns at all.
 * Pulling down Control Center or the notification shade, a Face ID prompt, a permission sheet, the
 * photo picker: each is `active → inactive → active` with the app on screen the whole time and the
 * realtime socket connected. Every one of them cost several Worker requests for nothing, and the
 * Worker's free plan is 100k requests a day.
 *
 * Nothing can be missed while the app is merely `inactive`: JS keeps running and realtime keeps
 * delivering. The window that needs a catch-up is a real `background` long enough for
 * `RealtimeAccountBridge` to have dropped its socket, which it does after a 10 s grace period. Below
 * that the socket either stayed up or Ably resumes it and replays what was missed.
 *
 * Read lazily, so the answer is right however the `AppState` listeners happen to be ordered: if this
 * module's listener has not run yet for the current return, the clock is still running from the
 * moment the app went to the background.
 */
import { AppState } from 'react-native';

/** A return after at least this long in the background is treated as "things may have changed". */
export const AWAY_REFRESH_MS = 10_000;

let backgroundedAt: number | null = null;
let lastAwayMs = 0;
// A process that starts in the background (woken by a push) and is opened later has been "away" for
// as long as it matters: nothing was listening.
let everActive = AppState.currentState === 'active';

try {
  AppState.addEventListener('change', (next) => {
    if (next === 'background') {
      if (backgroundedAt == null) backgroundedAt = Date.now();
      return;
    }
    if (next === 'active') {
      if (!everActive) {
        everActive = true;
        lastAwayMs = Number.POSITIVE_INFINITY;
      } else {
        lastAwayMs = backgroundedAt == null ? 0 : Date.now() - backgroundedAt;
      }
      backgroundedAt = null;
    }
  });
} catch {
  // No AppState (tests with a partial react-native mock): every return counts as a long one, which is
  // the old behaviour.
  everActive = false;
}

/** Milliseconds spent in the background before the latest return. 0 for an `inactive` blip. */
export function getLastAwayMs(): number {
  if (!everActive) return Number.POSITIVE_INFINITY;
  if (backgroundedAt != null) return Date.now() - backgroundedAt;
  return lastAwayMs;
}

/** Whether the latest return to the foreground was long enough to need a catch-up refetch. */
export function wasAwayLongEnough(minMs: number = AWAY_REFRESH_MS): boolean {
  return getLastAwayMs() >= minMs;
}
