import {
  getPosts,
  getProfile,
  getProfiles,
  getConversations,
  getMessages,
  supabase,
} from '../lib/supabase';

import { useEntityStore } from './entityStore';
import { shouldSync } from './syncThrottle';

import {
  cacheFeed,
  cacheProfile,
  cacheLikes,
  cacheFollows,
  cacheConversations,
  cacheMessages,
  LocalPost,
  LocalProfile,
  LocalConversation,
  LocalMessage,
} from './cacheService';

// ─── Sync Functions ──────────────────────────────────────────────────────────

/**
 * Sync the main feed: fetch posts from Supabase, update entity store, persist to cache.
 */
export async function syncFeed(userId?: string): Promise<void> {
  if (!await shouldSync('feed', 5 * 60 * 1000)) return; // 5 min
  try {
    const { posts, error } = await getPosts(100, 0);
    if (error || !posts.length) return;

    // Map to local types
    const localPosts: LocalPost[] = posts.map((p: any) => ({
      id: p.id,
      author_id: p.author_id,
      content: p.content,
      image_url: p.image_url || null,
      likes_count: p.likes_count || 0,
      comments_count: p.comments_count || 0,
      shares_count: p.shares_count || 0,
      created_at: p.created_at,
      status: 'synced' as const,
    }));

    const feedIds = localPosts.map((p) => p.id);

    // Update store (triggers UI re-render)
    const store = useEntityStore.getState();
    store.upsertPosts(localPosts);
    store.setFeedIds(feedIds);

    // Also extract and cache profiles from joined data
    for (const p of posts) {
      const profileData = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
      if (profileData?.id) {
        const localProfile: LocalProfile = {
          id: profileData.id,
          username: profileData.username || '',
          display_name: profileData.display_name || '',
          emoji: profileData.emoji || '😀',
          bio: profileData.bio || '',
          banner_url: profileData.banner_url || null,
          links: profileData.links ? JSON.stringify(profileData.links) : null,
          badge: profileData.badge || null,
          is_verified: profileData.is_verified || false,
          created_at: profileData.created_at || null,
          updated_at: profileData.updated_at || null,
        };
        store.upsertProfile(localProfile);
      }
    }

    // Persist to cache
    await cacheFeed(localPosts);

    // Also persist all profiles to batch cache for hydration
    const { cacheAllProfiles } = await import('./cacheService');
    const allProfiles = Object.values(store.profiles);
    await cacheAllProfiles(allProfiles);
  } catch (e) {
    console.warn('[SyncService] syncFeed failed:', e);
  }
}

/**
 * Sync a single profile by ID.
 */
export async function syncProfile(profileId: string): Promise<void> {
  if (!await shouldSync(`profile:${profileId}`, 10 * 60 * 1000)) return; // 10 min
  try {
    const { profile, error } = await getProfile(profileId);
    if (error || !profile) return;

    const localProfile: LocalProfile = {
      id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      emoji: profile.emoji || '😀',
      bio: profile.bio || '',
      banner_url: (profile as any).banner_url || null,
      links: (profile as any).links ? JSON.stringify((profile as any).links) : null,
      badge: (profile as any).badge || null,
      is_verified: (profile as any).is_verified || false,
      created_at: profile.created_at || null,
      updated_at: profile.updated_at || null,
    };

    const store = useEntityStore.getState();
    store.upsertProfile(localProfile);

    await cacheProfile(profileId, localProfile);
  } catch (e) {
    console.warn('[SyncService] syncProfile failed:', e);
  }
}

/**
 * Sync all profiles (for search/discover).
 */
export async function syncProfiles(): Promise<void> {
  if (!await shouldSync('all_profiles', 15 * 60 * 1000)) return; // 15 min
  try {
    const { profiles, error } = await getProfiles();
    if (error || !profiles.length) return;

    const store = useEntityStore.getState();

    for (const profile of profiles) {
      const localProfile: LocalProfile = {
        id: profile.id,
        username: profile.username,
        display_name: profile.display_name,
        emoji: profile.emoji || '😀',
        bio: profile.bio || '',
        banner_url: (profile as any).banner_url || null,
        links: (profile as any).links ? JSON.stringify((profile as any).links) : null,
        badge: (profile as any).badge || null,
        is_verified: (profile as any).is_verified || false,
        created_at: profile.created_at || null,
        updated_at: profile.updated_at || null,
      };

      store.upsertProfile(localProfile);
      await cacheProfile(profile.id, localProfile);
    }
  } catch (e) {
    console.warn('[SyncService] syncProfiles failed:', e);
  }
}

/**
 * Sync likes for a user: fetch liked post IDs from Supabase.
 */
export async function syncLikes(userId: string): Promise<void> {
  if (!await shouldSync(`likes:${userId}`, 10 * 60 * 1000)) return; // 10 min
  try {
    const { data, error } = await supabase
      .from('likes')
      .select('post_id')
      .eq('user_id', userId);

    if (error || !data) return;

    const postIds = data.map((row: any) => row.post_id as string);

    const store = useEntityStore.getState();
    // Clear existing likes for this user and set fresh ones
    for (const postId of postIds) {
      store.setLike(userId, postId);
    }

    await cacheLikes(userId, postIds);
  } catch (e) {
    console.warn('[SyncService] syncLikes failed:', e);
  }
}

/**
 * Sync follows for a user: fetch following IDs from Supabase.
 */
export async function syncFollows(userId: string): Promise<void> {
  if (!await shouldSync(`follows:${userId}`, 10 * 60 * 1000)) return; // 10 min
  try {
    const { data, error } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);

    if (error || !data) return;

    const followingIds = data.map((row: any) => row.following_id as string);

    const store = useEntityStore.getState();
    // Set follows for this user
    for (const followingId of followingIds) {
      store.setFollow(userId, followingId);
    }

    await cacheFollows(userId, followingIds);
  } catch (e) {
    console.warn('[SyncService] syncFollows failed:', e);
  }
}

/**
 * Sync posts authored by a specific user (for profile screen).
 */
export async function syncUserPosts(userId: string): Promise<void> {
  if (!await shouldSync(`user_posts:${userId}`, 5 * 60 * 1000)) return; // 5 min
  try {
    const { data, error } = await supabase
      .from('posts')
      .select(`
        *,
        profiles:author_id (id, username, display_name, emoji)
      `)
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error || !data || !data.length) return;

    const localPosts: LocalPost[] = data.map((p: any) => ({
      id: p.id,
      author_id: p.author_id,
      content: p.content,
      image_url: p.image_url || null,
      likes_count: p.likes_count || 0,
      comments_count: p.comments_count || 0,
      shares_count: p.shares_count || 0,
      created_at: p.created_at,
      status: 'synced' as const,
    }));

    const myPostIds = localPosts.map((p) => p.id);

    const store = useEntityStore.getState();
    store.upsertPosts(localPosts);
    store.setMyPostIds(myPostIds);
  } catch (e) {
    console.warn('[SyncService] syncUserPosts failed:', e);
  }
}

/**
 * Sync conversations for a user.
 */
export async function syncConversations(userId: string): Promise<void> {
  if (!await shouldSync(`conversations:${userId}`, 3 * 60 * 1000)) return; // 3 min
  try {
    const { conversations, error } = await getConversations(userId);
    if (error || !conversations.length) return;

    // Map to local conversation type
    const localConversations: LocalConversation[] = conversations.map((c: any) => {
      const conv = Array.isArray(c.conversations) ? c.conversations[0] : c.conversations;
      const profile = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;

      return {
        id: conv?.id || c.conversation_id,
        participantId: profile?.id || '',
        participantName: profile?.display_name || '',
        participantUsername: profile?.username || '',
        participantEmoji: profile?.emoji || '😀',
        participantVerified: profile?.is_verified || false,
      };
    });

    const store = useEntityStore.getState();
    store.setConversations(localConversations);

    await cacheConversations(localConversations);
  } catch (e) {
    console.warn('[SyncService] syncConversations failed:', e);
  }
}

/**
 * Sync messages for a specific conversation.
 */
export async function syncMessages(conversationId: string): Promise<void> {
  if (!await shouldSync(`messages:${conversationId}`, 60 * 1000)) return; // 1 min
  try {
    const { messages, error } = await getMessages(conversationId);
    if (error || !messages.length) return;

    const localMessages: LocalMessage[] = messages.map((m: any) => ({
      id: m.id,
      conversation_id: m.conversation_id,
      sender_id: m.sender_id,
      text: m.text,
      created_at: m.created_at,
      status: 'synced' as const,
    }));

    await cacheMessages(conversationId, localMessages);
  } catch (e) {
    console.warn('[SyncService] syncMessages failed:', e);
  }
}

/**
 * Full sync: run all sync functions in parallel.
 */
export async function fullSync(userId: string): Promise<void> {
  try {
    await Promise.all([
      syncFeed(userId),
      syncProfile(userId),
      syncProfiles(),
      syncLikes(userId),
      syncFollows(userId),
      syncUserPosts(userId),
      syncConversations(userId),
    ]);
  } catch (e) {
    console.warn('[SyncService] fullSync failed:', e);
  }
}
