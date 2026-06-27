import AsyncStorage from '@react-native-async-storage/async-storage';

const THROTTLE_KEY = '@san:sync_timestamps';
const DEFAULT_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Minimum spacing between *attempts* for a key, independent of success.
// This is a lightweight anti-spam guard: after a FAILED sync we want the next
// attempt to be allowed promptly (we must NOT block it for the full TTL), but
// we also don't want a rejected operation to spin in a tight loop. It is far
// shorter than any success-path TTL. No timers are used — this is a pure
// timestamp comparison evaluated lazily when a caller next asks to sync.
const MIN_RETRY_GUARD = 5 * 1000; // 5 seconds

interface ThrottleMap { [key: string]: number; }

// `synced` holds the timestamp of the last *successful* sync per key — this is
// what the TTL is measured against. `attempts` holds the last *attempt* time
// per key and only backs the anti-spam guard; it is intentionally in-memory
// only (never persisted) so an app restart never blocks a fresh attempt.
let cache: ThrottleMap = {};
let attempts: ThrottleMap = {};
let loaded = false;

// Throttle keys are scoped to the active account so switching accounts doesn't
// inherit another account's "recently synced" timestamps.
let activeAccountId = 'anon';
export function setThrottleAccount(accountId: string | null | undefined): void {
  const next = accountId || 'anon';
  if (next !== activeAccountId) {
    activeAccountId = next;
    cache = {};
    attempts = {};
    loaded = false;
  }
}

function storageKey(): string {
  return `${THROTTLE_KEY}:${activeAccountId}`;
}

async function loadThrottles(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(storageKey());
    if (raw) cache = JSON.parse(raw);
  } catch {}
  loaded = true;
}

async function saveThrottles(): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(), JSON.stringify(cache));
  } catch {}
}

/**
 * Pure eligibility check against the last *successful* sync — does NOT stamp
 * any timestamp. Returns true when at least `intervalMs` has elapsed since the
 * last successful sync for `key` (or it has never synced).
 *
 * Prefer this over {@link shouldSync} in new code: pair it with
 * {@link markSynced} (called only after the network operation actually
 * succeeds) so a failed sync never advances the throttle. See
 * {@link syncWithThrottle} for a wrapper that wires this together for you.
 */
export async function canSync(key: string, intervalMs: number = DEFAULT_INTERVAL): Promise<boolean> {
  await loadThrottles();
  const lastSync = cache[key] || 0;
  return Date.now() - lastSync >= intervalMs;
}

/**
 * Record a *successful* sync for `key`. This is the only call that advances the
 * TTL window. Callers must invoke it only after confirming the network
 * operation succeeded.
 */
export async function markSynced(key: string): Promise<void> {
  await loadThrottles();
  const now = Date.now();
  cache[key] = now;
  attempts[key] = now;
  saveThrottles(); // non-blocking
}

/**
 * Record a *failed* sync for `key`. Crucially this does NOT advance the TTL
 * window, so the next attempt is allowed immediately (subject only to the
 * MIN_RETRY_GUARD anti-spam window). It also rolls back any tentative timestamp
 * left by a legacy {@link shouldSync} call, which is what unblocks retries.
 *
 * Use this when migrating a `shouldSync`-gated caller with the smallest
 * possible diff: on every failure/early-return branch, call `markSyncFailed`.
 */
export async function markSyncFailed(key: string): Promise<void> {
  await loadThrottles();
  // Drop the success timestamp so eligibility is restored on the next check.
  if (key in cache) {
    delete cache[key];
    saveThrottles(); // non-blocking
  }
  // Stamp the attempt so a rejected op can't spin synchronously.
  attempts[key] = Date.now();
}

/**
 * LEGACY check-and-stamp. Returns true if the sync should proceed (enough time
 * has passed) and, when it returns true, immediately records the timestamp.
 *
 * WARNING: because it stamps BEFORE the network operation runs, a sync that
 * then FAILS still counts as "recently synced" and blocks retries for the full
 * TTL (audit item M4). Kept for backward compatibility; callers that use it
 * MUST call {@link markSyncFailed} on every failure/early-return branch to roll
 * the timestamp back, or migrate to {@link canSync} + {@link markSynced} /
 * {@link syncWithThrottle}.
 */
export async function shouldSync(key: string, intervalMs: number = DEFAULT_INTERVAL): Promise<boolean> {
  await loadThrottles();
  const lastSync = cache[key] || 0;
  const now = Date.now();
  if (now - lastSync < intervalMs) return false;
  cache[key] = now;
  attempts[key] = now;
  saveThrottles(); // non-blocking
  return true;
}

/**
 * Throttled sync wrapper — the recommended path for new code. It checks
 * eligibility WITHOUT stamping, runs `operation`, and stamps the success
 * timestamp ONLY when the operation resolves. If the operation rejects, the
 * TTL is left untouched so the next attempt is allowed promptly; the rejection
 * is re-thrown so the caller can observe/log it.
 *
 * Returns the operation's result when it ran successfully, or `undefined` when
 * the call was skipped (still fresh, or within the MIN_RETRY_GUARD anti-spam
 * window after a very recent attempt).
 *
 * IMPORTANT: `operation` must reject (throw) to signal failure. Callers that
 * surface failures as a returned `{ error }` value should re-throw inside the
 * operation, otherwise a failed fetch will be treated as a success and stamped.
 */
export async function syncWithThrottle<T>(
  key: string,
  intervalMs: number,
  operation: () => Promise<T>
): Promise<T | undefined> {
  await loadThrottles();
  const now = Date.now();

  // Already fresh from a recent SUCCESS → skip (preserves TTL semantics).
  if (now - (cache[key] || 0) < intervalMs) return undefined;

  // Anti-spam: don't let attempts (including post-failure retries) fire closer
  // together than MIN_RETRY_GUARD.
  if (now - (attempts[key] || 0) < MIN_RETRY_GUARD) return undefined;

  attempts[key] = now;
  try {
    const result = await operation();
    // Stamp the success timestamp ONLY after the operation resolved.
    await markSynced(key);
    return result;
  } catch (e) {
    // Failure: do NOT advance the TTL. The next attempt is allowed once
    // MIN_RETRY_GUARD elapses. Re-throw so the caller can log/handle it.
    throw e;
  }
}

/**
 * Force reset a throttle (e.g., on pull-to-refresh).
 */
export function resetThrottle(key: string): void {
  delete cache[key];
  delete attempts[key];
}

/**
 * Reset all throttles (e.g., on account switch).
 */
export function resetAllThrottles(): void {
  cache = {};
  attempts = {};
  AsyncStorage.removeItem(storageKey()).catch(() => {});
}
