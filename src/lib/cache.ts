import AsyncStorage from '@react-native-async-storage/async-storage';

// Cache keys
const CACHE_FEED = 'cache_feed';
const CACHE_PROFILES = 'cache_profiles';
const CACHE_MY_POSTS = 'cache_my_posts';

// Save feed posts to cache
export async function cacheFeed(posts: any[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_FEED, JSON.stringify(posts));
  } catch {}
}

// Load cached feed posts
export async function getCachedFeed(): Promise<any[] | null> {
  try {
    const data = await AsyncStorage.getItem(CACHE_FEED);
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

// Save user's own posts to cache
export async function cacheMyPosts(userId: string, posts: any[]): Promise<void> {
  try {
    await AsyncStorage.setItem(`${CACHE_MY_POSTS}_${userId}`, JSON.stringify(posts));
  } catch {}
}

// Load cached user posts
export async function getCachedMyPosts(userId: string): Promise<any[] | null> {
  try {
    const data = await AsyncStorage.getItem(`${CACHE_MY_POSTS}_${userId}`);
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

// Save a profile to cache
export async function cacheProfile(profileId: string, profile: any): Promise<void> {
  try {
    await AsyncStorage.setItem(`profile_${profileId}`, JSON.stringify(profile));
  } catch {}
}

// Load cached profile
export async function getCachedProfile(profileId: string): Promise<any | null> {
  try {
    const data = await AsyncStorage.getItem(`profile_${profileId}`);
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}
