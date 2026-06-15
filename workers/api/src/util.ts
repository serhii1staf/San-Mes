// Tiny query-param + UUID validators shared across route handlers.
//
// Centralising these keeps every endpoint's "is this input sane" branch
// identical so we don't end up with one route returning 200 + null and
// another returning 400 for the same shape of garbage. The helpers are
// pure and synchronous — they don't touch D1, never throw, and always
// return well-typed values that the caller can pipe straight into a
// prepared-statement bind list.

/**
 * Clamp a `?limit=` value into the inclusive range [1, max] with a
 * sensible default. Strings are parsed as base-10 integers; anything
 * non-finite (NaN, ±Infinity, junk) collapses to the default.
 */
export function parseLimit(raw: string | null | undefined, max = 50, def = 20): number {
  if (raw == null || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  if (n < 1) return 1;
  if (n > max) return max;
  return n;
}

/**
 * Clamp a `?offset=` value into [0, ∞). Bad input → 0 so pagination
 * never accidentally goes negative (D1 would error out at the bind
 * step) or yield a NaN bind value.
 */
export function parseOffset(raw: string | null | undefined): number {
  if (raw == null || raw === '') return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

// RFC 4122 UUID — v1..v5. Strict-but-friendly: lower-case hex, dashes
// in canonical positions. We never accept braces, URN prefixes, or
// upper-case (the app emits lower-case via crypto.randomUUID()).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Validate a UUID-shaped string. Returns the value verbatim on match,
 * `null` on miss. Use as the gate before binding into SQL — saves us
 * from logging "no rows" responses for malformed inputs that can't
 * possibly hit a real row.
 */
export function parseUuid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  return UUID_RE.test(v) ? v : null;
}
