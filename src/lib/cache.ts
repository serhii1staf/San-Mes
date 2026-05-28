import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = 'cache_';
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    // Check if expired (30 days)
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      await AsyncStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Silently fail — cache is best-effort
  }
}

export async function clearCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = (keys as string[]).filter(k => k.startsWith(CACHE_PREFIX));
    if (cacheKeys.length > 0) {
      await (AsyncStorage as any).multiRemove(cacheKeys);
    }
  } catch {}
}

// Cache keys
export const CACHE_KEYS = {
  feed: 'feed_posts',
  profile: (id: string) => `profile_${id}`,
  profileMeta: (id: string) => `profile_meta_${id}`,
  conversations: (userId: string) => `conversations_${userId}`,
  messages: (convId: string) => `messages_${convId}`,
  followCounts: (id: string) => `follow_counts_${id}`,
  myPosts: (userId: string) => `my_posts_${userId}`,
  profiles: 'all_profiles',
};
