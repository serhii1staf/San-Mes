import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountKey } from './cacheAccount';

/**
 * kvStore — fast key/value layer for chat data (messages, conversations) and the
 * general cache.
 *
 * Uses react-native-mmkv v3 (TurboModules, synchronous, no Nitro) when the
 * native module loads successfully. Falls back transparently to AsyncStorage
 * (+ an in-memory mirror for sync reads) if MMKV is unavailable or throws — so
 * the app NEVER crashes because of storage. (v4 + Nitro caused a hard launch
 * crash on this Expo SDK 54 / RN 0.81 stack; v3 is the stable line.)
 *
 * Every key is namespaced per account via accountKey(), so one account never
 * reads another account's data.
 */

// Master switch. MMKV v3 is stable on this stack; flip to false to force the
// AsyncStorage fallback without touching anything else.
const USE_MMKV = true;

let mmkv: any = null;
if (USE_MMKV) {
  try {
    const { MMKV } = require('react-native-mmkv');
    mmkv = new MMKV({ id: 'san-kv' });
    // Probe once so a broken native module trips the catch here (not later mid-render).
    mmkv.set('__probe__', '1');
    mmkv.getString('__probe__');
    mmkv.delete('__probe__');
  } catch (e) {
    mmkv = null;
    console.warn('[kvStore] MMKV unavailable — using AsyncStorage fallback.', e);
  }
}

export function isMMKVAvailable(): boolean {
  return mmkv !== null;
}

// In-memory mirror so sync reads return data after kvWarm() has loaded it
// (used only in the AsyncStorage-fallback path).
const memMirror: Record<string, string> = {};

// ─── Raw API (key is already namespaced by the caller — used by cacheService) ──

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

// ─── Sync string API (applies account namespace) ──────────────────────────────

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
      // fall through to AsyncStorage fallback
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

// ─── Warm-up ───────────────────────────────────────────────────────────────-

/**
 * Warm the in-memory mirror from AsyncStorage for the given base keys.
 * No-op when MMKV is available (reads are already synchronous from disk).
 * Call before a sync read on app/screen mount so cache-first render works.
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
    // ignore — sync reads return null until data is written
  }
}
