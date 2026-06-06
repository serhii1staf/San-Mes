import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LocalPost {
  id: string;
  author_id: string;
  content: string;
  image_url: string | null;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  created_at: string;
  status?: 'synced' | 'pending' | 'failed';
  localImageUris?: string[];
}

export interface LocalProfile {
  id: string;
  username: string;
  display_name: string;
  emoji: string;
  bio: string;
  banner_url: string | null;
  links: string | null;
  badge?: string | null;
  is_verified?: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface LocalConversation {
  id: string;
  participantId: string;
  participantName: string;
  participantUsername: string;
  participantEmoji: string;
  participantVerified?: boolean;
  participantBadge?: string | null;
  lastMessage?: string;
  lastMessageAt?: string;
}

export interface LocalMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  status?: 'synced' | 'pending' | 'failed';
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const KEYS = {
  feed: '@san:feed',
  profile: (id: string) => `@san:profile:${id}`,
  conversations: '@san:conversations',
  messages: (convId: string) => `@san:messages:${convId}`,
  likes: (userId: string) => `@san:likes:${userId}`,
  follows: (userId: string) => `@san:follows:${userId}`,
  mutations: '@san:mutation_queue',
  allProfiles: '@san:all_profiles',
} as const;

export const MAX_FEED_POSTS = 200;

// ─── Per-account namespacing ─────────────────────────────────────────────────
// Namespacing lives in cacheAccount.ts (shared with kvStore.ts to avoid a cycle).
// Re-exported here so existing imports from cacheService keep working unchanged.

import {
  setCacheAccount,
  getCacheAccount,
  accountKey,
  GLOBAL_KEY_PREFIXES,
  namespaced,
} from './cacheAccount';

export { setCacheAccount, getCacheAccount, accountKey };

// ─── Generic Helpers ─────────────────────────────────────────────────────────
// Backed by MMKV (synchronous, native) when available, falling back to
// AsyncStorage otherwise. Writes go to both so a later native build that enables
// MMKV can still read data written in fallback mode, and vice-versa.

import { isMMKVAvailable, kvGetStringRawSync, kvSetStringRaw, kvDeleteRaw } from './kvStore';

export async function cacheGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const nsKey = namespaced(key);
    let raw: string | null = null;
    if (isMMKVAvailable()) {
      raw = kvGetStringRawSync(nsKey);
    }
    if (raw === null) {
      raw = await AsyncStorage.getItem(nsKey);
    }
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed === null || parsed === undefined) return fallback;
    return parsed as T;
  } catch (e) {
    console.warn('[CacheService] Read failed for key:', key, e);
    return fallback;
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  try {
    const nsKey = namespaced(key);
    const serialized = JSON.stringify(value);
    if (isMMKVAvailable()) {
      kvSetStringRaw(nsKey, serialized);
    }
    await AsyncStorage.setItem(nsKey, serialized);
  } catch (e) {
    console.warn('[CacheService] Write failed for key:', key, e);
  }
}

export async function cacheRemove(key: string): Promise<void> {
  try {
    const nsKey = namespaced(key);
    if (isMMKVAvailable()) {
      kvDeleteRaw(nsKey);
    }
    await AsyncStorage.removeItem(nsKey);
  } catch (e) {
    console.warn('[CacheService] Remove failed for key:', key, e);
  }
}

// ─── Entity-Specific Helpers ─────────────────────────────────────────────────

export async function cacheFeed(posts: LocalPost[]): Promise<void> {
  try {
    const sorted = [...posts].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const trimmed = sorted.slice(0, MAX_FEED_POSTS);
    await cacheSet(KEYS.feed, trimmed);
  } catch (e) {
    console.warn('[CacheService] cacheFeed failed:', e);
  }
}

export async function getCachedFeed(): Promise<LocalPost[]> {
  return cacheGet<LocalPost[]>(KEYS.feed, []);
}

export async function cacheProfile(id: string, profile: LocalProfile): Promise<void> {
  await cacheSet(KEYS.profile(id), profile);
}

export async function getCachedProfile(id: string): Promise<LocalProfile | null> {
  return cacheGet<LocalProfile | null>(KEYS.profile(id), null);
}

export async function cacheConversations(conversations: LocalConversation[]): Promise<void> {
  await cacheSet(KEYS.conversations, conversations);
}

export async function getCachedConversations(): Promise<LocalConversation[]> {
  return cacheGet<LocalConversation[]>(KEYS.conversations, []);
}

export async function cacheMessages(convId: string, messages: LocalMessage[]): Promise<void> {
  await cacheSet(KEYS.messages(convId), messages);
}

export async function getCachedMessages(convId: string): Promise<LocalMessage[]> {
  return cacheGet<LocalMessage[]>(KEYS.messages(convId), []);
}

export async function cacheLikes(userId: string, postIds: string[]): Promise<void> {
  await cacheSet(KEYS.likes(userId), postIds);
}

export async function getCachedLikes(userId: string): Promise<string[]> {
  return cacheGet<string[]>(KEYS.likes(userId), []);
}

export async function cacheFollows(userId: string, followingIds: string[]): Promise<void> {
  await cacheSet(KEYS.follows(userId), followingIds);
}

export async function getCachedFollows(userId: string): Promise<string[]> {
  return cacheGet<string[]>(KEYS.follows(userId), []);
}


// ─── Batch Profiles Cache ────────────────────────────────────────────────────

export async function cacheAllProfiles(profiles: LocalProfile[]): Promise<void> {
  await cacheSet(KEYS.allProfiles, profiles);
}

export async function getCachedAllProfiles(): Promise<LocalProfile[]> {
  return cacheGet<LocalProfile[]>(KEYS.allProfiles, []);
}
