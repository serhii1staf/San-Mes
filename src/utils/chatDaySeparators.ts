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
/**
 * Per-message day-key cache.
 *
 * WHY THIS EXISTS
 *
 * `buildDaySeparators` is recomputed on EVERY change to a conversation's message array, and in
 * `app/chat/[id].tsx` that array changes constantly: every send (a photo send writes it about three
 * times — optimistic add, server-id reconcile, upload-URL swap), every realtime arrival, every edit,
 * every delete, every history-poll merge, every older page loaded, every photo-heal pass. Once the
 * user has opened search or jumped to an old reply, the full history is in the store, so each of
 * those recomputes walked up to a thousand messages.
 *
 * And per message the walk did the expensive part of date handling: `Date.parse` on an ISO string,
 * a `Date` allocation, three getter calls and a template-string allocation for the key. None of it
 * cheap in Hermes, and all of it repeated for messages whose timestamp had not changed — which is
 * every message except the one that just arrived.
 *
 * A message's day key is a pure function of its immutable `createdAt`, so it can be cached against
 * the message object itself. The walk still visits every row (it has to — a separator depends on the
 * row before it), but each visit becomes a WeakMap lookup and a string comparison instead of parsing
 * a date.
 *
 * A WeakMap keyed on the message object is the right cache here: entries disappear with the messages
 * themselves, so a long session moving through many conversations cannot accumulate anything, and
 * there is no key to invalidate. Writers that rebuild rows with `.map(m => ({ ...m }))` produce new
 * objects and correctly miss the cache — which is what we want, since a rebuilt row may carry a new
 * timestamp.
 */
const dayKeyCache = new WeakMap<object, string | null>();

/** `localDayKey` for a message, memoized on the message object. `null` = unusable timestamp. */
function cachedDayKey(m: DaySeparatorInput): string | null {
  // `m` is always an object in practice, but a primitive would throw on WeakMap.get — and a
  // day-separator pass must never be the thing that takes a chat screen down.
  if (typeof m !== 'object' || m === null) return null;
  const hit = dayKeyCache.get(m);
  // `undefined` means "not cached"; `null` is a cached negative (unusable timestamp), which must
  // NOT be recomputed on every pass either — a transcript full of malformed rows would otherwise
  // keep paying the full `Date.parse` cost forever.
  if (hit !== undefined) return hit;
  const d = parseIso(m.createdAt);
  const key = d ? localDayKey(d) : null;
  dayKeyCache.set(m, key);
  return key;
}

export function buildDaySeparators(
  messages: readonly DaySeparatorInput[],
): Map<string, string> {
  const out = new Map<string, string>();
  let prevKey: string | null = null;

  for (const m of messages) {
    const key = cachedDayKey(m);
    // Unusable timestamp: no chip, and the run of the day around it is not broken.
    if (key === null) continue;
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

/**
 * Test seam: drop the memoized `Intl` probe + formatter cache.
 *
 * The per-message day-key cache is deliberately NOT cleared here. It is a WeakMap keyed on message
 * objects, so a test that builds fresh message objects (which every test does) cannot see a stale
 * entry — and exposing a clear for it would suggest the cache needs invalidating, which it does not.
 */
export function __resetDaySeparatorCaches(): void {
  intlUsable = null;
  formatterCache.clear();
}
