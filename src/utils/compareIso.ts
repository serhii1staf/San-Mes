/**
 * Order two ISO-8601 timestamps by their characters, which for ISO-8601 is chronological order.
 * Ascending; swap the arguments for newest first.
 *
 * `localeCompare` gives the same order for these strings but runs the locale collator on every
 * comparison. Measured inside the app (Hermes on Android): sorting 200 timestamps took 605 ms with
 * `localeCompare` and under 1 ms with this. The conversation list sorts this way every time it is
 * shown.
 */
export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
