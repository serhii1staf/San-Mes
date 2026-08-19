// ── Day separators for the chat transcript ──────────────────────────────────
//
// Telegram-style: a small centred date chip is drawn above the first message of
// each calendar day, so scrolling back through history stays oriented.
//
// Everything here is pure and takes an injectable `now`, so the boundary rules
// (which are the whole risk surface) are unit-testable without a clock.
//
// CORRECTNESS NOTES — these are the parts that quietly break if done naively:
//
//   * Days are LOCAL, never UTC. Two messages 10 minutes apart can belong to
//     different calendar days for the user while sharing a UTC date (and vice
//     versa). Using `getFullYear/getMonth/getDate` resolves in the device's own
//     zone, which is what the user sees on the clock.
//   * Because the key is built from local Y/M/D rather than by dividing a
//     timestamp by 86 400 000, DST transitions (23- and 25-hour days) and
//     half-hour/45-minute offset zones (India, Nepal, parts of Australia) all
//     work without special cases.
//   * "Today"/"Yesterday" are computed by comparing local day keys, not by
//     differencing milliseconds — a 25-hour DST day would otherwise report a
//     message from yesterday evening as two days ago.
//   * Unparseable / missing timestamps never produce a chip and never throw.

/** A stable, sortable local-calendar-day key: `YYYY-M-D` in the device's zone. */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Parse an ISO string, returning null for anything unusable. */
function parseIso(iso: string | undefined | null): Date | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

export interface DaySeparatorInput {
  id: string;
  /** ISO timestamp of the message. */
  createdAt?: string;
}

/**
 * Given messages in OLDEST → NEWEST order, return the ids that begin a new local
 * calendar day, mapped to the timestamp to render.
 *
 * The first message with a usable timestamp always gets a chip — the top of the
 * loaded transcript should state its date rather than leaving the oldest visible
 * day unlabelled.
 *
 * Messages with unusable timestamps are skipped entirely: they neither get a chip
 * nor break the run of the day around them.
 */
export function buildDaySeparators(
  messages: readonly DaySeparatorInput[],
): Map<string, string> {
  const out = new Map<string, string>();
  let prevKey: string | null = null;

  for (const m of messages) {
    const d = parseIso(m.createdAt);
    if (!d) continue;
    const key = localDayKey(d);
    if (key !== prevKey) {
      out.set(m.id, m.createdAt as string);
      prevKey = key;
    }
  }

  return out;
}

export type DayRelation = 'today' | 'yesterday' | 'thisYear' | 'olderYear';

/**
 * Classify a timestamp relative to `now`, by LOCAL day. Split out from the
 * formatting so the (locale-dependent) label rendering and the (locale-agnostic)
 * date logic can be tested separately.
 */
export function classifyDay(iso: string, now: number): DayRelation | null {
  const d = parseIso(iso);
  if (!d) return null;

  const nowDate = new Date(now);
  if (localDayKey(d) === localDayKey(nowDate)) return 'today';

  // Yesterday = the local day before today. Derived by stepping the DATE
  // component back one, which `Date` normalises across month/year ends, so this
  // is correct on the 1st of a month, on Jan 1st, and across DST shifts.
  const y = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1);
  if (localDayKey(d) === localDayKey(y)) return 'yesterday';

  return d.getFullYear() === nowDate.getFullYear() ? 'thisYear' : 'olderYear';
}

/**
 * `Intl` availability guard.
 *
 * Hermes can be built without full ICU, in which case `Intl.DateTimeFormat`
 * either is missing or silently ignores the locale. Probing once and caching the
 * answer keeps the label locale-correct on every device that CAN do it, and
 * falls back to a deterministic numeric format everywhere else, instead of
 * throwing on a device we cannot test from here.
 */
let intlUsable: boolean | null = null;
function canUseIntl(): boolean {
  if (intlUsable !== null) return intlUsable;
  try {
    intlUsable =
      typeof Intl !== 'undefined' &&
      typeof Intl.DateTimeFormat === 'function' &&
      // A formatter that produces SOMETHING for a known date.
      new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric' }).format(
        new Date(0),
      ).length > 0;
  } catch {
    intlUsable = false;
  }
  return intlUsable;
}

/** Cache formatters per locale+shape — constructing one is not cheap. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatterFor(locale: string, withYear: boolean): Intl.DateTimeFormat | null {
  if (!canUseIntl()) return null;
  const cacheKey = `${locale}|${withYear ? 'y' : 'n'}`;
  const hit = formatterCache.get(cacheKey);
  if (hit) return hit;
  try {
    const f = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      ...(withYear ? { year: 'numeric' } : {}),
    });
    formatterCache.set(cacheKey, f);
    return f;
  } catch {
    // An unknown/malformed locale tag must not take the chip down with it.
    return null;
  }
}

/**
 * Human label for a day-separator chip.
 *
 * `t` supplies the localized "Today"/"Yesterday" strings (they live in the app
 * dictionary, not in `Intl`). Absolute dates go through `Intl.DateTimeFormat`
 * with the app's active locale, so month names and day/month order follow the
 * user's region rather than being hardcoded — and the year is only shown when the
 * message is from a different year, which is what keeps the chip short.
 *
 * Returns null when the timestamp is unusable, so callers render no chip.
 */
export function formatDaySeparator(
  iso: string,
  now: number,
  locale: string,
  t: (key: string, fallback?: string) => string,
): string | null {
  const relation = classifyDay(iso, now);
  if (!relation) return null;

  if (relation === 'today') return t('chat.day.today', 'Сегодня');
  if (relation === 'yesterday') return t('chat.day.yesterday', 'Вчера');

  const d = parseIso(iso)!;
  const withYear = relation === 'olderYear';
  const formatter = formatterFor(locale, withYear);
  if (formatter) return formatter.format(d);

  // Fallback: no ICU. Deterministic and unambiguous, if not localized.
  const day = d.getDate();
  const month = d.getMonth() + 1;
  return withYear ? `${day}.${month}.${d.getFullYear()}` : `${day}.${month}`;
}

/** Test seam: drop the memoized `Intl` probe + formatter cache. */
export function __resetDaySeparatorCaches(): void {
  intlUsable = null;
  formatterCache.clear();
}
