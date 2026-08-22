// Background sync — keeps the local entity store + on-disk caches
// fresh. Phase 5 of the Cloudflare D1 migration: all reads land on
// the Worker via `apiClient`. The previous direct-`supabase.from(...)`
// fallbacks are gone; there's no second authoritative source anymore.

// `getMessages` is deliberately NOT imported here any more. The DM history fetch belongs to
// the chat screen, which is the only thing that can merge it into the transcript — see the
// note where `syncMessages` used to live, further down.
import {
  getPosts,
  getProfile,
  getProfiles,
  getConversations,
} from '../lib/supabase';

import { apiGet } from './apiClient';
import { useEntityStore } from './entityStore';
import { syncWithThrottle } from './syncThrottle';

import {
  cacheFeed,
  cacheProfile,
  cacheLikes,
  cacheFollows,
  cacheConversations,
  LocalPost,
  LocalProfile,
  LocalConversation,
} from './cacheService';

/**
 * Sync the main feed: fetch posts via the Worker, update entity store,
 * persist to cache.
 */
export async function syncFeed(_userId?: string): Promise<void> {
  try {
    await syncWithThrottle('feed', 5 * 60 * 1000, async () => { // 5 min
      const { posts, error } = await getPosts(20, 0);
      if (error) throw error; // transport/fetch failure → don't stamp, allow retry
      if (!posts.length) return; // fetch succeeded but empty → legitimate success

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

      const store = useEntityStore.getState();
      store.upsertPosts(localPosts);
      store.setFeedIds(feedIds);

      // Extract embedded profiles from joined data so the post-card render
      // doesn't immediately have to refetch the author.
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
            theme_id: profileData.theme_id || null,
            links: profileData.links ? JSON.stringify(profileData.links) : null,
            badge: profileData.badge || null,
            is_verified: profileData.is_verified || false,
            created_at: profileData.created_at || null,
            updated_at: profileData.updated_at || null,
          };
          store.upsertProfile(localProfile);
        }
      }

      await cacheFeed(localPosts);

      const { cacheAllProfiles } = await import('./cacheService');
      const allProfiles = Object.values(store.profiles);
      await cacheAllProfiles(allProfiles);
    });
  } catch (e) {
    console.warn('[SyncService] syncFeed failed:', e);
  }
}

export async function syncProfile(profileId: string): Promise<void> {
  try {
    await syncWithThrottle(`profile:${profileId}`, 10 * 60 * 1000, async () => {
      const { profile, error } = await getProfile(profileId);
      if (error) throw error; // transport/fetch failure → don't stamp, allow retry
      if (!profile) return; // fetch succeeded, profile not found → treat as success (no retry storm)

      const localProfile: LocalProfile = {
        id: profile.id,
        username: profile.username,
        display_name: profile.display_name,
        emoji: profile.emoji || '😀',
        bio: profile.bio || '',
        banner_url: (profile as any).banner_url || null,
        theme_id: (profile as any).theme_id || null,
        links: (profile as any).links ? JSON.stringify((profile as any).links) : null,
        badge: (profile as any).badge || null,
        is_verified: (profile as any).is_verified || false,
        created_at: profile.created_at || null,
        updated_at: profile.updated_at || null,
      };

      const store = useEntityStore.getState();
      store.upsertProfile(localProfile);
      await cacheProfile(profileId, localProfile);
    });
  } catch (e) {
    console.warn('[SyncService] syncProfile failed:', e);
  }
}

export async function syncProfiles(): Promise<void> {
  try {
    await syncWithThrottle('all_profiles', 15 * 60 * 1000, async () => {
      const { profiles, error } = await getProfiles();
      if (error) throw error; // transport/fetch failure → don't stamp, allow retry
      if (!profiles.length) return; // fetch succeeded but empty → legitimate success

      const store = useEntityStore.getState();
      for (const profile of profiles) {
        const localProfile: LocalProfile = {
          id: profile.id,
          username: profile.username,
          display_name: profile.display_name,
          emoji: profile.emoji || '😀',
          bio: profile.bio || '',
          banner_url: (profile as any).banner_url || null,
          theme_id: (profile as any).theme_id || null,
          links: (profile as any).links ? JSON.stringify((profile as any).links) : null,
          badge: (profile as any).badge || null,
          is_verified: (profile as any).is_verified || false,
          created_at: profile.created_at || null,
          updated_at: profile.updated_at || null,
        };
        store.upsertProfile(localProfile);
        await Promise.resolve();
      }
    });
  } catch (e) {
    console.warn('[SyncService] syncProfiles failed:', e);
  }
}

/**
 * Sync the user's likes — turned into a thin Worker read against the
 * `/v1/profiles/:id/likes` endpoint. The endpoint returns posts; we
 * project to the post-id list the entity store wants.
 */
export async function syncLikes(userId: string): Promise<void> {
  try {
    await syncWithThrottle(`likes:${userId}`, 10 * 60 * 1000, async () => {
      const { data, error } = await apiGet<any[]>(`/v1/profiles/${encodeURIComponent(userId)}/likes?limit=100`);
      if (error) throw error; // transport/fetch failure → don't stamp, allow retry
      if (!data) return; // fetch succeeded with no payload → legitimate success
      const postIds = data.map((p: any) => p.id as string);

      const store = useEntityStore.getState();
      for (const postId of postIds) {
        store.setLike(userId, postId);
      }
      await cacheLikes(userId, postIds);
    });
  } catch (e) {
    console.warn('[SyncService] syncLikes failed:', e);
  }
}

/**
 * Sync the user's follows — fetches the `following` list via the
 * Worker. The legacy version did its own `select('following_id')` on
 * Supabase; the Worker variant gives the full embedded profile, but
 * we project to the id list the entity store consumes.
 */
export async function syncFollows(userId: string): Promise<void> {
  try {
    await syncWithThrottle(`follows:${userId}`, 10 * 60 * 1000, async () => {
      const { data, error } = await apiGet<{ id: string }[]>(`/v1/profiles/${encodeURIComponent(userId)}/following?limit=200`);
      if (error) throw error; // transport/fetch failure → don't stamp, allow retry
      if (!data) return; // fetch succeeded with no payload → legitimate success
      const followingIds = data.map((p) => p.id);

      const store = useEntityStore.getState();
      for (const followingId of followingIds) {
        store.setFollow(userId, followingId);
      }
      await cacheFollows(userId, followingIds);
    });
  } catch (e) {
    console.warn('[SyncService] syncFollows failed:', e);
  }
}

export async function syncUserPosts(userId: string): Promise<void> {
  try {
    await syncWithThrottle(`user_posts:${userId}`, 5 * 60 * 1000, async () => {
      const { data, error } = await apiGet<any[]>(`/v1/profiles/${encodeURIComponent(userId)}/posts?limit=25`);
      if (error) throw error; // transport/fetch failure → don't stamp, allow retry
      if (!data || !data.length) return; // fetch succeeded but empty → legitimate success

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
    });
  } catch (e) {
    console.warn('[SyncService] syncUserPosts failed:', e);
  }
}

export async function syncConversations(userId: string): Promise<void> {
  try {
    await syncWithThrottle(`conversations:${userId}`, 3 * 60 * 1000, async () => {
      const { conversations, error } = await getConversations(userId);
      if (error) throw error; // transport/fetch failure → don't stamp, allow retry
      if (!conversations.length) return; // fetch succeeded but empty → legitimate success

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
          participantBadge: profile?.badge || null,
        };
      });

      const store = useEntityStore.getState();
      store.setConversations(localConversations);
      await cacheConversations(localConversations);
    });
  } catch (e) {
    console.warn('[SyncService] syncConversations failed:', e);
  }
}

// ── `syncMessages` USED TO BE HERE, AND IT WAS A TRAP ─────────────────────────
//
// It fetched `GET /v1/conversations/:id/messages` and wrote the result through
// `cacheMessages` to `KEYS.messages(convId)`. Two things were wrong with it, and together
// they are why direct messages appeared to vanish:
//
//   1. NOTHING CALLED IT. A grep across src/ and app/ found no invocation — the DM read path
//      on the client was local cache plus live Ably and nothing else, so any message
//      published while the app was not subscribed was never retrievable. The push still
//      arrived (the Worker fans that out), so the symptom was "push lands, chat is empty".
//
//   2. It wrote to a key NO SCREEN READS. `app/chat/[id].tsx` reads `chat_messages:<id>` and
//      its tail cache; `KEYS.messages(convId)` is a different namespace, and
//      `getCachedMessages` is never called outside a unit test. Even if something had called
//      it, the messages would not have reached the transcript.
//
// The real fetch now lives in `app/chat/[id].tsx`, next to the other hydration paths, and
// merges into the chat store — which the existing persistence effect then mirrors to
// `chat_messages:<id>`. This stub is left as a comment rather than a function so nobody
// "fixes" the bug by calling a helper that quietly does nothing.

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
