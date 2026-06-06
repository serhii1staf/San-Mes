import AsyncStorage from '@react-native-async-storage/async-storage';

const THROTTLE_KEY = '@san:sync_timestamps';
const DEFAULT_INTERVAL = 5 * 60 * 1000; // 5 minutes

interface ThrottleMap { [key: string]: number; }

let cache: ThrottleMap = {};
let loaded = false;

// Throttle keys are scoped to the active account so switching accounts doesn't
// inherit another account's "recently synced" timestamps.
let activeAccountId = 'anon';
export function setThrottleAccount(accountId: string | null | undefined): void {
  const next = accountId || 'anon';
  if (next !== activeAccountId) {
    activeAccountId = next;
    cache = {};
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
 * Returns true if the sync should proceed (enough time has passed).
 * Returns false if throttled (too recent).
 */
export async function shouldSync(key: string, intervalMs: number = DEFAULT_INTERVAL): Promise<boolean> {
  await loadThrottles();
  const lastSync = cache[key] || 0;
  const now = Date.now();
  if (now - lastSync < intervalMs) return false;
  cache[key] = now;
  saveThrottles(); // non-blocking
  return true;
}

/**
 * Force reset a throttle (e.g., on pull-to-refresh).
 */
export function resetThrottle(key: string): void {
  delete cache[key];
}

/**
 * Reset all throttles (e.g., on account switch).
 */
export function resetAllThrottles(): void {
  cache = {};
  AsyncStorage.removeItem(storageKey()).catch(() => {});
}
