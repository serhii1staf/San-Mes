import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountKey } from './cacheAccount';

/**
 * kvStore — fast key/value layer for chat data (messages, conversations).
 *
 * NOTE: MMKV (react-native-mmkv v4 + Nitro) caused a hard native crash on launch
 * with this Expo SDK 54 / RN 0.81 stack, so it is currently DISABLED. The layer
 * transparently uses AsyncStorage (+ an in-memory mirror for sync reads). All
 * functionality — chat persistence, per-account isolation — is preserved; we
 * only lose MMKV's synchronous-read speed. Re-enable later once a compatible
 * MMKV/Nitro combination is verified in a dedicated build.
 *
 * Every key is namespaced per account via accountKey(), so one account never
 * reads another account's chat data.
 */

// Hard kill-switch. Keep false until MMKV is verified safe on this stack.
const USE_MMKV = false;

let mmkv: any = null;
if (USE_MMKV) {
  try {
    const { MMKV } = require('react-native-mmkv');
    mmkv = new MMKV({ id: 'san-kv' });
  } catch (e) {
    mmkv = null;
    console.warn('[kvStore] MMKV unavailable — using AsyncStorage fallback.');
  }
}

export function isMMKVAvailable(): boolean {
  return mmkv !== null;
}

// ─── Raw API (key is already namespaced by the caller) ─────────────────────────
// Used by cacheService, which applies its own namespaced() before calling.

export function kvGetStringRawSync(key: string): string | null {
  if (!mmkv) return null;
  try {
    const v = mmkv.getString(key);
    return v == null ? null : v;
  } catch {
    return null;
  }
}

export function kvSetStringRaw(key: string, value: string): void {
  if (!mmkv) return;
  try {
    mmkv.set(key, value);
  } catch {
    // ignore — AsyncStorage write in cacheService is the durable path
  }
}

export function kvDeleteRaw(key: string): void {
  if (!mmkv) return;
  try {
    mmkv.delete(key);
  } catch {
    // ignore
  }
}

// In-memory mirror used only in AsyncStorage-fallback mode so that sync reads
// can return data after kvWarm() has loaded it.
const memMirror: Record<string, string> = {};

// ─── Sync string API ─────────────────────────────────────────────────────────

export function kvGetStringSync(baseKey: string): string | null {
  const key = accountKey(baseKey);
  if (mmkv) {
    try {
      const v = mmkv.getString(key);
      return v == null ? null : v;
    } catch {
      return null;
    }
  }
  return memMirror[key] ?? null;
}

export function kvSetString(baseKey: string, value: string): void {
  const key = accountKey(baseKey);
  if (mmkv) {
    try {
      mmkv.set(key, value);
      return;
    } catch {
      // fall through to fallback
    }
  }
  memMirror[key] = value;
  AsyncStorage.setItem(key, value).catch(() => {});
}

export function kvDelete(baseKey: string): void {
  const key = accountKey(baseKey);
  if (mmkv) {
    try {
      mmkv.delete(key);
      return;
    } catch {
      // fall through
    }
  }
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

// ─── Fallback warm-up ─────────────────────────────────────────────────────────

/**
 * Warm the in-memory mirror from AsyncStorage for the given base keys.
 * No-op when MMKV is available (reads are already synchronous from disk).
 * Call this before a sync read on app/screen mount in fallback mode.
 */
export async function kvWarm(baseKeys: string[]): Promise<void> {
  if (mmkv || baseKeys.length === 0) return;
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
