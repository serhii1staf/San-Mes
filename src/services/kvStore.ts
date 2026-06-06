import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountKey } from './cacheAccount';

/**
 * kvStore — fast key/value layer for chat data (messages, conversations).
 *
 * Backed entirely by AsyncStorage (+ an in-memory mirror for synchronous reads).
 *
 * NOTE: react-native-mmkv (v4 + Nitro) was removed because it caused a hard
 * native crash on launch with this Expo SDK 54 / RN 0.81 stack. All
 * functionality — chat persistence, per-account isolation — is preserved here;
 * we only forgo MMKV's synchronous-read speed. The in-memory mirror gives the
 * same instant cache-first rendering after kvWarm() runs on screen mount.
 *
 * Every key is namespaced per account via accountKey(), so one account never
 * reads another account's chat data.
 */

export function isMMKVAvailable(): boolean {
  return false;
}

// In-memory mirror so sync reads return data after kvWarm() has loaded it.
const memMirror: Record<string, string> = {};

// ─── Raw API (key is already namespaced by the caller) ─────────────────────────
// Used by cacheService, which applies its own namespaced() before calling.

export function kvGetStringRawSync(_key: string): string | null {
  return null; // AsyncStorage path handles raw reads in cacheService
}

export function kvSetStringRaw(_key: string, _value: string): void {
  // no-op: cacheService writes through AsyncStorage as the durable path
}

export function kvDeleteRaw(_key: string): void {
  // no-op
}

// ─── Sync string API ─────────────────────────────────────────────────────────

export function kvGetStringSync(baseKey: string): string | null {
  const key = accountKey(baseKey);
  return memMirror[key] ?? null;
}

export function kvSetString(baseKey: string, value: string): void {
  const key = accountKey(baseKey);
  memMirror[key] = value;
  AsyncStorage.setItem(key, value).catch(() => {});
}

export function kvDelete(baseKey: string): void {
  const key = accountKey(baseKey);
  delete memMirror[key];
  AsyncStorage.removeItem(key).catch(() => {});
}

// ─── JSON helpers ──────────────────────────────────────────────────────────-

export function kvGetJSONSync<T>(baseKey: string, fallback: T): T {
  const raw = kvGetStringSync(baseKey);
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function kvSetJSON(baseKey: string, value: unknown): void {
  try {
    kvSetString(baseKey, JSON.stringify(value));
  } catch {
    // ignore serialization errors
  }
}

// ─── Warm-up ───────────────────────────────────────────────────────────────-

/**
 * Warm the in-memory mirror from AsyncStorage for the given base keys.
 * Call before a sync read on app/screen mount so cache-first render works.
 */
export async function kvWarm(baseKeys: string[]): Promise<void> {
  if (baseKeys.length === 0) return;
  try {
    const keys = baseKeys.map(accountKey);
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [k, v] of pairs) {
      if (v != null) memMirror[k] = v;
    }
  } catch {
    // ignore — sync reads will just return null until data is written
  }
}
