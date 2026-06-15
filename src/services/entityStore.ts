import { create } from 'zustand';
import { InteractionManager } from 'react-native';

import {
  cacheFeed,
  cacheProfile,
  cacheLikes,
  cacheFollows,
  LocalPost,
  LocalProfile,
  LocalConversation,
  LocalMessage,
} from './cacheService';

// ─── Re-export types ─────────────────────────────────────────────────────────

export type { LocalPost, LocalProfile, LocalConversation, LocalMessage };

// ─── Debounced cache persistence ─────────────────────────────────────────────
// Writing the whole profiles/posts map on every single upsert would hammer the
// device under load. We coalesce writes: schedule one flush ~600ms after the
// last change, so a burst of upserts results in a single storage write.
let profilesFlushTimer: ReturnType<typeof setTimeout> | null = null;
let postsFlushTimer: ReturnType<typeof setTimeout> | null = null;

// Hard cap on the number of entries serialised into the batched
// `KEYS.allProfiles` / `KEYS.feed` cache blobs. Without these, a long-running
// session that views many profiles (each `upsertProfile` adds a new entry,
// never trimmed within a session) grows the in-memory map unboundedly. The
// debounced flush below serialises that whole map with a single synchronous
// `JSON.stringify` followed by a synchronous MMKV write — a 200-profile blob
// is ~150 KB and the stringify alone takes 100–170 ms on weak iPhones, which
// landed as the residual `SLOW long task @ (tabs) 169ms` markers users saw a
// few seconds after rapid tab-switching (the flush fires 600 ms after the
// final `upsertProfile` from `syncProfiles()`, which is itself triggered from
// the messages-tab mount). Profiles older than the cap stay in the
// per-profile `KEYS.profile(id)` cache (written eagerly by `upsertProfile`),
// so individual lookups via `getCachedProfile(id)` still resolve them — only
// the bulk-hydrate path is bounded.
const MAX_BATCH_PROFILES = 200;
const MAX_BATCH_POSTS = 200;

function scheduleProfilesFlush(getMap: () => LocalProfile[]) {
  if (profilesFlushTimer) clearTimeout(profilesFlushTimer);
  profilesFlushTimer = setTimeout(() => {
    profilesFlushTimer = null;
    // Defer the actual stringify+write past any active navigation/animation
    // so the heavy JSON serialisation never lands on a transition frame.
    // Together with the slice cap below, this kills the residual
    // `SLOW long task @ (tabs)` markers that fired ~2 s after a tab switch.
    InteractionManager.runAfterInteractions(() => {
      import('./cacheService').then(({ cacheAllProfiles }) => {
        const all = getMap();
        const capped = all.length > MAX_BATCH_PROFILES
          ? all.slice(-MAX_BATCH_PROFILES)
          : all;
        cacheAllProfiles(capped).catch(() => {});
      }).catch(() => {});
    });
  }, 600);
}

function schedulePostsFlush(getPosts: () => LocalPost[]) {
  if (postsFlushTimer) clearTimeout(postsFlushTimer);
  postsFlushTimer = setTimeout(() => {
    postsFlushTimer = null;
    // Same reasoning as scheduleProfilesFlush: defer past the active
    // interaction frame so JSON.stringify of the posts map can't compete
    // with a navigation transition. `cacheFeed` already trims to
    // MAX_FEED_POSTS (200) internally, but we cap here too so the array
    // we hand to it is bounded BEFORE the sort + stringify cost.
    InteractionManager.runAfterInteractions(() => {
      import('./cacheService').then(({ cacheFeed }) => {
        const all = getPosts();
        const capped = all.length > MAX_BATCH_POSTS
          ? all.slice(0, MAX_BATCH_POSTS)
          : all;
        cacheFeed(capped).catch(() => {});
      }).catch(() => {});
    });
  }, 600);
}

// ─── Validation Guards ───────────────────────────────────────────────────────

export function isValidPost(data: unknown): data is LocalPost {
  if (!data || typeof data !== 'object') return false;
  const d = data as any;
  return (
    typeof d.id === 'string' &&
    typeof d.author_id === 'string' &&
    typeof d.content === 'string' &&
    typeof d.created_at === 'string'
  );
}

export function isValidProfile(data: unknown): data is LocalProfile {
  if (!data || typeof data !== 'object') return false;
  const d = data as any;
  return (
    typeof d.id === 'string' &&
    typeof d.username === 'string' &&
    typeof d.display_name === 'string'
  );
}

// ─── State Interface ─────────────────────────────────────────────────────────

interface EntityState {
  // Data
  posts: Record<string, LocalPost>;
  profiles: Record<string, LocalProfile>;
  likes: Record<string, string[]>; // userId -> postId[]
  follows: Record<string, string[]>; // userId -> followingId[]
  conversations: LocalConversation[];
  feedIds: string[];
  myPostIds: string[];

  // Status
  isHydrated: boolean;

  // Actions
  hydrate: () => Promise<void>;
  upsertPost: (post: LocalPost) => void;
  upsertPosts: (posts: LocalPost[]) => void;
  upsertProfile: (profile: LocalProfile) => void;
  removePost: (id: string) => void;
  setLike: (userId: string, postId: string) => void;
  removeLike: (userId: string, postId: string) => void;
  isLiked: (userId: string, postId: string) => boolean;
  setFollow: (followerId: string, followingId: string) => void;
  removeFollow: (followerId: string, followingId: string) => void;
  isFollowing: (followerId: string, followingId: string) => boolean;
  setFeedIds: (ids: string[]) => void;
  setMyPostIds: (ids: string[]) => void;
  setConversations: (convs: LocalConversation[]) => void;
  replaceTempPost: (tempId: string, realPost: LocalPost) => void;

  // Selectors
  getFeedPosts: () => LocalPost[];
  getMyPosts: () => LocalPost[];
}

// ─── Store Implementation ────────────────────────────────────────────────────

export const useEntityStore = create<EntityState>()((set, get) => ({
  posts: {},
  profiles: {},
  likes: {},
  follows: {},
  conversations: [],
  feedIds: [],
  myPostIds: [],
  isHydrated: false,

  hydrate: async () => {
    try {
      const { getCachedFeed, getCachedConversations, getCachedLikes, getCachedAllProfiles, getCachedFollows, getCacheAccount } = await import('./cacheService');
      // Follows are scoped to the active account (the viewer). Rehydrate
      // them on cold start / account switch so follow buttons show the
      // correct state before the network resolves. `getCacheAccount()` is
      // set in _layout.tsx before hydrate() runs, so it already points at
      // the active viewer here.
      const accountId = getCacheAccount();
      const [feed, conversations, profiles, follows] = await Promise.all([
        getCachedFeed(),
        getCachedConversations(),
        getCachedAllProfiles(),
        accountId && accountId !== 'anon'
          ? getCachedFollows(accountId)
          : Promise.resolve([] as string[]),
      ]);

      const postsMap: Record<string, LocalPost> = {};
      const feedIds: string[] = [];

      for (const post of feed) {
        if (isValidPost(post)) {
          postsMap[post.id] = post;
          feedIds.push(post.id);
        }
      }

      const profilesMap: Record<string, LocalProfile> = {};
      for (const profile of profiles) {
        if (isValidProfile(profile)) {
          profilesMap[profile.id] = profile;
        }
      }

      const followsMap: Record<string, string[]> =
        accountId && accountId !== 'anon' && Array.isArray(follows) && follows.length > 0
          ? { [accountId]: follows }
          : {};

      set({ posts: postsMap, feedIds, conversations, profiles: profilesMap, follows: followsMap, isHydrated: true });
    } catch (e) {
      console.warn('[EntityStore] Hydration failed:', e);
      set({ isHydrated: true });
    }
  },

  upsertPost: (post: LocalPost) => {
    if (!isValidPost(post)) return;

    set((state) => ({
      posts: { ...state.posts, [post.id]: post },
    }));

    // Persist to cache in background (non-blocking)
    const state = get();
    const allPosts = state.feedIds.map((id) => state.posts[id]).filter(Boolean) as LocalPost[];
    cacheFeed(allPosts).catch(() => {});
  },

  upsertPosts: (posts: LocalPost[]) => {
    const validPosts = posts.filter(isValidPost);
    if (validPosts.length === 0) return;

    set((state) => {
      const newPosts = { ...state.posts };
      for (const post of validPosts) {
        newPosts[post.id] = post;
      }
      return { posts: newPosts };
    });

    // Coalesced persist of the most-recent posts (capped in cacheFeed) so viewed
    // profiles' posts survive an offline restart, not only the home feed.
    schedulePostsFlush(() => {
      const all = Object.values(get().posts) as LocalPost[];
      return all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    });
  },

  upsertProfile: (profile: LocalProfile) => {
    if (!isValidProfile(profile)) return;

    set((state) => ({
      profiles: { ...state.profiles, [profile.id]: profile },
    }));

    // Persist this profile individually + schedule a coalesced write of the full
    // profiles map so ANY viewed profile survives an offline restart.
    cacheProfile(profile.id, profile).catch(() => {});
    scheduleProfilesFlush(() => Object.values(get().profiles));
  },

  removePost: (id: string) => {
    set((state) => {
      const newPosts = { ...state.posts };
      delete newPosts[id];
      return {
        posts: newPosts,
        feedIds: state.feedIds.filter((fid) => fid !== id),
        myPostIds: state.myPostIds.filter((fid) => fid !== id),
      };
    });

    // Persist updated feed to cache in background
    const state = get();
    const allPosts = state.feedIds.map((fid) => state.posts[fid]).filter(Boolean) as LocalPost[];
    cacheFeed(allPosts).catch(() => {});
  },

  setLike: (userId: string, postId: string) => {
    set((state) => {
      const userLikes = [...(state.likes[userId] || [])];
      if (!userLikes.includes(postId)) {
        userLikes.push(postId);
      }
      return { likes: { ...state.likes, [userId]: userLikes } };
    });

    // Persist to cache in background
    const state = get();
    const userLikes = state.likes[userId] || [];
    cacheLikes(userId, userLikes).catch(() => {});
  },

  removeLike: (userId: string, postId: string) => {
    set((state) => {
      const userLikes = (state.likes[userId] || []).filter((id) => id !== postId);
      return { likes: { ...state.likes, [userId]: userLikes } };
    });

    // Persist to cache in background
    const state = get();
    const userLikes = state.likes[userId] || [];
    cacheLikes(userId, userLikes).catch(() => {});
  },

  isLiked: (userId: string, postId: string) => {
    const state = get();
    return (state.likes[userId] || []).includes(postId);
  },

  setFollow: (followerId: string, followingId: string) => {
    set((state) => {
      const userFollows = [...(state.follows[followerId] || [])];
      if (!userFollows.includes(followingId)) {
        userFollows.push(followingId);
      }
      return { follows: { ...state.follows, [followerId]: userFollows } };
    });

    // Persist to cache in background
    const state = get();
    const userFollows = state.follows[followerId] || [];
    cacheFollows(followerId, userFollows).catch(() => {});
  },

  removeFollow: (followerId: string, followingId: string) => {
    set((state) => {
      const userFollows = (state.follows[followerId] || []).filter(
        (id) => id !== followingId
      );
      return { follows: { ...state.follows, [followerId]: userFollows } };
    });

    // Persist to cache in background
    const state = get();
    const userFollows = state.follows[followerId] || [];
    cacheFollows(followerId, userFollows).catch(() => {});
  },

  isFollowing: (followerId: string, followingId: string) => {
    const state = get();
    return (state.follows[followerId] || []).includes(followingId);
  },

  setFeedIds: (ids: string[]) => {
    set({ feedIds: ids });
  },

  setMyPostIds: (ids: string[]) => {
    set({ myPostIds: ids });
  },

  setConversations: (convs: LocalConversation[]) => {
    set({ conversations: convs });
    // Persist to cache so conversations survive app restart (even offline)
    import('./cacheService').then(({ cacheConversations }) => {
      cacheConversations(convs).catch(() => {});
    }).catch(() => {});
  },

  replaceTempPost: (tempId: string, realPost: LocalPost) => {
    if (!isValidPost(realPost)) return;

    set((state) => {
      const newPosts = { ...state.posts };
      delete newPosts[tempId];
      newPosts[realPost.id] = realPost;

      const feedIds = state.feedIds.map((id) => (id === tempId ? realPost.id : id));
      const myPostIds = state.myPostIds.map((id) => (id === tempId ? realPost.id : id));

      return { posts: newPosts, feedIds, myPostIds };
    });

    // Persist updated feed to cache in background
    const state = get();
    const allPosts = state.feedIds.map((id) => state.posts[id]).filter(Boolean) as LocalPost[];
    cacheFeed(allPosts).catch(() => {});
  },

  // ─── Selectors ───────────────────────────────────────────────────────────

  getFeedPosts: () => {
    const state = get();
    return state.feedIds
      .map((id) => state.posts[id])
      .filter(Boolean) as LocalPost[];
  },

  getMyPosts: () => {
    const state = get();
    return state.myPostIds
      .map((id) => state.posts[id])
      .filter(Boolean) as LocalPost[];
  },
}));
