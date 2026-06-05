import { create } from 'zustand';

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
      const { getCachedFeed, getCachedConversations, getCachedLikes, getCachedAllProfiles } = await import('./cacheService');
      const [feed, conversations, profiles] = await Promise.all([
        getCachedFeed(),
        getCachedConversations(),
        getCachedAllProfiles(),
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

      set({ posts: postsMap, feedIds, conversations, profiles: profilesMap, isHydrated: true });
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

    // Persist to cache in background (non-blocking)
    const state = get();
    const allPosts = state.feedIds.map((id) => state.posts[id]).filter(Boolean) as LocalPost[];
    cacheFeed(allPosts).catch(() => {});
  },

  upsertProfile: (profile: LocalProfile) => {
    if (!isValidProfile(profile)) return;

    set((state) => ({
      profiles: { ...state.profiles, [profile.id]: profile },
    }));

    // Persist to cache in background (non-blocking)
    cacheProfile(profile.id, profile).catch(() => {});
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
