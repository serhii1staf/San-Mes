import { useEntityStore, LocalPost, LocalProfile } from './entityStore';
import { getSyncMeta, setSyncMeta, getDatabase } from './database';
import { processQueue } from './mutationQueue';
import {
  getPosts,
  getProfile,
  getProfiles,
  supabase,
  parseImageUrls,
} from './supabase';

// --- Sync interval handle ---
let syncIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background sync loop.
 * Processes mutation queue and syncs feed every 30 seconds.
 */
export function startSyncLoop(): void {
  if (syncIntervalId) return; // Already running

  // Process queue immediately
  processQueue().catch(() => {});

  syncIntervalId = setInterval(() => {
    processQueue().catch(() => {});
  }, 30_000);
}

/**
 * Stop the background sync loop.
 */
export function stopSyncLoop(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
}

/**
 * Full sync — called on app start after hydration.
 * Fetches latest data from server and updates local store.
 * Non-blocking: errors are swallowed (offline-safe).
 */
export async function fullSync(userId?: string): Promise<void> {
  try {
    await Promise.all([
      syncFeed(userId),
      syncProfiles(),
      userId ? syncLikes(userId) : Promise.resolve(),
      processQueue(),
    ]);
  } catch (e) {
    // Network unavailable — that's fine, we have local data
    console.warn('[SyncEngine] Full sync failed (offline?):', e);
  }
}

/**
 * Sync the feed — fetch latest posts from server.
 * Uses delta sync when possible (only fetch posts newer than last sync).
 */
export async function syncFeed(userId?: string): Promise<void> {
  try {
    const { posts: dbPosts, error } = await getPosts(100, 0);
    if (error || !dbPosts.length) return;

    const store = useEntityStore.getState();
    const localPosts: LocalPost[] = [];
    const feedIds: string[] = [];
    const myPostIds: string[] = [];

    for (const p of dbPosts) {
      const post: LocalPost = {
        id: p.id,
        author_id: p.author_id,
        content: p.content || '',
        image_url: p.image_url || null,
        likes_count: p.likes_count || 0,
        comments_count: p.comments_count || 0,
        shares_count: p.shares_count || 0,
        created_at: p.created_at,
        updated_at: null,
      };
      localPosts.push(post);
      feedIds.push(post.id);
      if (userId && post.author_id === userId) {
        myPostIds.push(post.id);
      }

      // Also upsert the profile from the joined data
      const profileData = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
      if (profileData && profileData.id) {
        const existingProfile = store.getProfile(profileData.id);
        store.upsertProfile({
          id: profileData.id,
          username: profileData.username || '',
          display_name: profileData.display_name || '',
          emoji: profileData.emoji || '😊',
          bio: existingProfile?.bio || '',
          banner_url: existingProfile?.banner_url || null,
          links: existingProfile?.links || null,
          pin_hash: existingProfile?.pin_hash || null,
          device_key: existingProfile?.device_key || null,
          created_at: existingProfile?.created_at || null,
          updated_at: existingProfile?.updated_at || null,
        });
      }
    }

    store.upsertPosts(localPosts);
    store.setFeedIds(feedIds);
    if (userId) {
      store.setMyPostIds(myPostIds);
    }

    setSyncMeta('last_feed_sync', new Date().toISOString());
  } catch (e) {
    console.warn('[SyncEngine] syncFeed failed:', e);
  }
}

/**
 * Sync a specific profile from the server.
 */
export async function syncProfile(profileId: string): Promise<void> {
  try {
    const { profile, error } = await getProfile(profileId);
    if (error || !profile) return;

    const store = useEntityStore.getState();
    store.upsertProfile({
      id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      emoji: profile.emoji || '😊',
      bio: profile.bio || '',
      banner_url: (profile as any).banner_url || null,
      links: (profile as any).links ? JSON.stringify((profile as any).links) : null,
      pin_hash: profile.pin_hash || null,
      device_key: profile.device_key || null,
      created_at: profile.created_at || null,
      updated_at: profile.updated_at || null,
    });
  } catch (e) {
    console.warn('[SyncEngine] syncProfile failed:', e);
  }
}

/**
 * Sync the current user's own profile.
 */
export async function syncMyProfile(userId: string): Promise<void> {
  await syncProfile(userId);
}

/**
 * Sync all profiles (for search/discover).
 */
export async function syncProfiles(): Promise<void> {
  try {
    const { profiles, error } = await getProfiles();
    if (error || !profiles.length) return;

    const store = useEntityStore.getState();
    const localProfiles: LocalProfile[] = profiles.map((p) => ({
      id: p.id,
      username: p.username,
      display_name: p.display_name,
      emoji: p.emoji || '😊',
      bio: p.bio || '',
      banner_url: (p as any).banner_url || null,
      links: (p as any).links ? JSON.stringify((p as any).links) : null,
      pin_hash: p.pin_hash || null,
      device_key: p.device_key || null,
      created_at: p.created_at || null,
      updated_at: p.updated_at || null,
    }));

    store.upsertProfiles(localProfiles);
    setSyncMeta('last_profiles_sync', new Date().toISOString());
  } catch (e) {
    console.warn('[SyncEngine] syncProfiles failed:', e);
  }
}

/**
 * Sync likes for a user from the server.
 */
export async function syncLikes(userId: string): Promise<void> {
  try {
    const { data: likes, error } = await supabase
      .from('likes')
      .select('post_id')
      .eq('user_id', userId);

    if (error || !likes) return;

    const db = getDatabase();
    // Clear existing likes for this user and re-insert
    db.runSync('DELETE FROM likes WHERE user_id = ?', [userId]);
    for (const like of likes) {
      db.runSync(
        'INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)',
        [userId, like.post_id]
      );
    }

    // Update in-memory store
    useEntityStore.getState().loadLikes(userId);
  } catch (e) {
    console.warn('[SyncEngine] syncLikes failed:', e);
  }
}

/**
 * Sync follows for a user from the server.
 */
export async function syncFollows(userId: string): Promise<void> {
  try {
    const { data: follows, error } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);

    if (error || !follows) return;

    const db = getDatabase();
    // Clear existing follows for this user and re-insert
    db.runSync('DELETE FROM follows WHERE follower_id = ?', [userId]);
    for (const follow of follows) {
      db.runSync(
        'INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)',
        [userId, follow.following_id]
      );
    }
  } catch (e) {
    console.warn('[SyncEngine] syncFollows failed:', e);
  }
}

/**
 * Sync posts for a specific user (for their profile page).
 */
export async function syncUserPosts(userId: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !data) return;

    const store = useEntityStore.getState();
    const posts: LocalPost[] = data.map((p: any) => ({
      id: p.id,
      author_id: p.author_id,
      content: p.content || '',
      image_url: p.image_url || null,
      likes_count: p.likes_count || 0,
      comments_count: p.comments_count || 0,
      shares_count: p.shares_count || 0,
      created_at: p.created_at,
      updated_at: null,
    }));

    store.upsertPosts(posts);
  } catch (e) {
    console.warn('[SyncEngine] syncUserPosts failed:', e);
  }
}
