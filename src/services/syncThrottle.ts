import AsyncStorage from '@react-native-async-storage/async-storage';

const THROTTLE_KEY = '@san:sync_timestamps';
const DEFAULT_INTERVAL = 5 * 60 * 1000; // 5 minutes

interface ThrottleMap { [key: string]: number; }

let cache: ThrottleMap = {};
let loaded = false;

async function loadThrottles(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(THROTTLE_KEY);
    if (raw) cache = JSON.parse(raw);
  } catch {}
  loaded = true;
}

async function saveThrottles(): Promise<void> {
  try {
    await AsyncStorage.setItem(THROTTLE_KEY, JSON.stringify(cache));
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
  AsyncStorage.removeItem(THROTTLE_KEY).catch(() => {});
}
