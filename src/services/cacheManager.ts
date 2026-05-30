import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Production-grade Cache Manager
 * - TTL-based expiration
 * - LRU eviction when size limit reached
 * - Offline-first: read cache → return → fetch in background → update cache
 * - Automatic cleanup of stale entries
 */

const CACHE_INDEX_KEY = '@san:cache_index';
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB limit
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  key: string;
  size: number;
  lastAccess: number;
  createdAt: number;
  ttl: number;
}

interface CacheIndex {
  entries: CacheEntry[];
  totalSize: number;
}

let cacheIndex: CacheIndex = { entries: [], totalSize: 0 };
let indexLoaded = false;

// ─── Index Management ────────────────────────────────────────────────────────

async function loadIndex(): Promise<void> {
  if (indexLoaded) return;
  try {
    const raw = await AsyncStorage.getItem(CACHE_INDEX_KEY);
    if (raw) cacheIndex = JSON.parse(raw);
  } catch {}
  indexLoaded = true;
}

async function saveIndex(): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(cacheIndex));
  } catch {}
}

// ─── Core API ────────────────────────────────────────────────────────────────

/**
 * Get cached data. Returns null if expired or not found.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  await loadIndex();
  const entry = cacheIndex.entries.find(e => e.key === key);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.createdAt > entry.ttl) {
    // Expired — don't delete yet (stale-while-revalidate), just return null for fresh fetch
    return null;
  }

  // Update last access (LRU)
  entry.lastAccess = Date.now();

  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Get cached data even if expired (stale). For offline-first display.
 */
export async function cacheGetStale<T>(key: string): Promise<T | null> {
  await loadIndex();
  const entry = cacheIndex.entries.find(e => e.key === key);
  if (!entry) return null;

  entry.lastAccess = Date.now();

  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Store data in cache with TTL.
 */
export async function cacheSet(key: string, data: any, ttlMs: number = DEFAULT_TTL_MS): Promise<void> {
  await loadIndex();
  const json = JSON.stringify(data);
  const size = json.length * 2; // approximate bytes (UTF-16)

  // Remove old entry if exists
  const existingIdx = cacheIndex.entries.findIndex(e => e.key === key);
  if (existingIdx >= 0) {
    cacheIndex.totalSize -= cacheIndex.entries[existingIdx].size;
    cacheIndex.entries.splice(existingIdx, 1);
  }

  // Evict LRU entries if over size limit
  while (cacheIndex.totalSize + size > MAX_CACHE_SIZE_BYTES && cacheIndex.entries.length > 0) {
    // Sort by lastAccess, remove oldest
    cacheIndex.entries.sort((a, b) => a.lastAccess - b.lastAccess);
    const evicted = cacheIndex.entries.shift();
    if (evicted) {
      cacheIndex.totalSize -= evicted.size;
      AsyncStorage.removeItem(evicted.key).catch(() => {});
    }
  }

  // Store
  try {
    await AsyncStorage.setItem(key, json);
    cacheIndex.entries.push({
      key,
      size,
      lastAccess: Date.now(),
      createdAt: Date.now(),
      ttl: ttlMs,
    });
    cacheIndex.totalSize += size;
    // Save index periodically (not every write for performance)
    if (Math.random() < 0.2) saveIndex();
  } catch {}
}

/**
 * Remove specific cache entry.
 */
export async function cacheRemove(key: string): Promise<void> {
  await loadIndex();
  const idx = cacheIndex.entries.findIndex(e => e.key === key);
  if (idx >= 0) {
    cacheIndex.totalSize -= cacheIndex.entries[idx].size;
    cacheIndex.entries.splice(idx, 1);
  }
  await AsyncStorage.removeItem(key).catch(() => {});
}

/**
 * Check if cache entry exists and is fresh.
 */
export async function cacheHas(key: string): Promise<boolean> {
  await loadIndex();
  const entry = cacheIndex.entries.find(e => e.key === key);
  if (!entry) return false;
  return Date.now() - entry.createdAt < entry.ttl;
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Remove all expired entries. Call periodically (e.g., on app start).
 */
export async function cacheCleanup(): Promise<{ removed: number; freedBytes: number }> {
  await loadIndex();
  const now = Date.now();
  const expired = cacheIndex.entries.filter(e => now - e.createdAt > e.ttl * 2); // Keep stale for 2x TTL
  let freedBytes = 0;

  for (const entry of expired) {
    freedBytes += entry.size;
    cacheIndex.totalSize -= entry.size;
    AsyncStorage.removeItem(entry.key).catch(() => {});
  }

  cacheIndex.entries = cacheIndex.entries.filter(e => now - e.createdAt <= e.ttl * 2);
  await saveIndex();

  return { removed: expired.length, freedBytes };
}

/**
 * Get cache stats.
 */
export async function cacheStats(): Promise<{ entries: number; totalSizeMB: number; maxSizeMB: number }> {
  await loadIndex();
  return {
    entries: cacheIndex.entries.length,
    totalSizeMB: Math.round(cacheIndex.totalSize / 1024 / 1024 * 100) / 100,
    maxSizeMB: MAX_CACHE_SIZE_BYTES / 1024 / 1024,
  };
}

/**
 * Clear all cache.
 */
export async function cacheClearAll(): Promise<void> {
  await loadIndex();
  const keys = cacheIndex.entries.map(e => e.key);
  await AsyncStorage.multiRemove(keys).catch(() => {});
  cacheIndex = { entries: [], totalSize: 0 };
  await saveIndex();
}

// ─── Offline-First Helper ────────────────────────────────────────────────────

/**
 * Offline-first data fetcher:
 * 1. Returns cached data immediately (even stale)
 * 2. Fetches fresh data in background
 * 3. Updates cache and calls onUpdate with fresh data
 */
export async function offlineFirst<T>(
  key: string,
  fetcher: () => Promise<T | null>,
  options?: { ttl?: number; onUpdate?: (data: T) => void }
): Promise<T | null> {
  const ttl = options?.ttl || DEFAULT_TTL_MS;

  // 1. Try cache first (even stale for instant display)
  const cached = await cacheGetStale<T>(key);

  // 2. Check if fresh
  const isFresh = await cacheHas(key);

  if (isFresh && cached) {
    // Fresh cache — no need to fetch
    return cached;
  }

  // 3. If we have stale cache, return it immediately and fetch in background
  if (cached) {
    // Background refresh
    fetcher().then(async (fresh) => {
      if (fresh) {
        await cacheSet(key, fresh, ttl);
        options?.onUpdate?.(fresh);
      }
    }).catch(() => {});
    return cached;
  }

  // 4. No cache at all — must fetch
  try {
    const fresh = await fetcher();
    if (fresh) {
      await cacheSet(key, fresh, ttl);
    }
    return fresh;
  } catch {
    return null;
  }
}
