import { create } from 'zustand';
import { getDatabase, isDatabaseReady } from './database';

// --- Types ---

export interface LocalPost {
  id: string;
  author_id: string;
  content: string;
  image_url: string | null;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  created_at: string;
  updated_at: string | null;
}

export interface LocalProfile {
  id: string;
  username: string;
  display_name: string;
  emoji: string;
  bio: string;
  banner_url: string | null;
  links: string | null; // JSON string
  pin_hash: string | null;
  device_key: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface LocalLike {
  user_id: string;
  post_id: string;
}

export interface LocalComment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
}

export interface LocalFollow {
  follower_id: string;
  following_id: string;
}

// --- Store Interface ---

interface EntityState {
  posts: Record<string, LocalPost>;
  profiles: Record<string, LocalProfile>;
  likes: Record<string, Set<string>>; // userId -> Set of postIds
  feedIds: string[];
  myPostIds: string[];
  isHydrated: boolean;

  // Actions
  hydrate: () => void;
  upsertPost: (post: LocalPost) => void;
  upsertPosts: (posts: LocalPost[]) => void;
  upsertProfile: (profile: LocalProfile) => void;
  upsertProfiles: (profiles: LocalProfile[]) => void;
  removePost: (id: string) => void;
  getPost: (id: string) => LocalPost | undefined;
  getProfile: (id: string) => LocalProfile | undefined;
  getFeedPosts: () => LocalPost[];
  getMyPosts: (userId: string) => LocalPost[];
  setFeedIds: (ids: string[]) => void;
  setMyPostIds: (ids: string[]) => void;

  // Like operations
  setLike: (userId: string, postId: string) => void;
  removeLike: (userId: string, postId: string) => void;
  isLiked: (userId: string, postId: string) => boolean;
  getUserLikes: (userId: string) => Set<string>;
  loadLikes: (userId: string) => void;

  // Follow operations
  setFollow: (followerId: string, followingId: string) => void;
  removeFollow: (followerId: string, followingId: string) => void;
  isFollowing: (followerId: string, followingId: string) => boolean;
}

// --- Store Implementation ---

export const useEntityStore = create<EntityState>()((set, get) => ({
  posts: {},
  profiles: {},
  likes: {},
  feedIds: [],
  myPostIds: [],
  isHydrated: false,

  hydrate: () => {
    try {
      const db = getDatabase();

      // Load recent posts (last 100)
      const posts = db.getAllSync<LocalPost>(
        'SELECT * FROM posts ORDER BY created_at DESC LIMIT 100'
      );
      const postsMap: Record<string, LocalPost> = {};
      const feedIds: string[] = [];
      for (const post of posts) {
        postsMap[post.id] = post;
        feedIds.push(post.id);
      }

      // Load profiles (last 50)
      const profiles = db.getAllSync<LocalProfile>(
        'SELECT * FROM profiles ORDER BY updated_at DESC LIMIT 50'
      );
      const profilesMap: Record<string, LocalProfile> = {};
      for (const profile of profiles) {
        profilesMap[profile.id] = profile;
      }

      set({
        posts: postsMap,
        profiles: profilesMap,
        feedIds,
        isHydrated: true,
      });
    } catch (e) {
      // If hydration fails, still mark as hydrated so app can proceed
      console.warn('[EntityStore] Hydration failed:', e);
      set({ isHydrated: true });
    }
  },

  upsertPost: (post: LocalPost) => {
    const db = getDatabase();
    db.runSync(
      `INSERT OR REPLACE INTO posts (id, author_id, content, image_url, likes_count, comments_count, shares_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [post.id, post.author_id, post.content, post.image_url, post.likes_count, post.comments_count, post.shares_count, post.created_at, post.updated_at ?? null]
    );
    set((state) => ({
      posts: { ...state.posts, [post.id]: post },
    }));
  },

  upsertPosts: (posts: LocalPost[]) => {
    const db = getDatabase();
    for (const post of posts) {
      db.runSync(
        `INSERT OR REPLACE INTO posts (id, author_id, content, image_url, likes_count, comments_count, shares_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [post.id, post.author_id, post.content, post.image_url, post.likes_count, post.comments_count, post.shares_count, post.created_at, post.updated_at ?? null]
      );
    }
    set((state) => {
      const newPosts = { ...state.posts };
      for (const post of posts) {
        newPosts[post.id] = post;
      }
      return { posts: newPosts };
    });
  },

  upsertProfile: (profile: LocalProfile) => {
    const db = getDatabase();
    db.runSync(
      `INSERT OR REPLACE INTO profiles (id, username, display_name, emoji, bio, banner_url, links, pin_hash, device_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [profile.id, profile.username, profile.display_name, profile.emoji, profile.bio, profile.banner_url, profile.links, profile.pin_hash, profile.device_key, profile.created_at, profile.updated_at]
    );
    set((state) => ({
      profiles: { ...state.profiles, [profile.id]: profile },
    }));
  },

  upsertProfiles: (profiles: LocalProfile[]) => {
    const db = getDatabase();
    for (const profile of profiles) {
      db.runSync(
        `INSERT OR REPLACE INTO profiles (id, username, display_name, emoji, bio, banner_url, links, pin_hash, device_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [profile.id, profile.username, profile.display_name, profile.emoji, profile.bio, profile.banner_url, profile.links, profile.pin_hash, profile.device_key, profile.created_at, profile.updated_at]
      );
    }
    set((state) => {
      const newProfiles = { ...state.profiles };
      for (const profile of profiles) {
        newProfiles[profile.id] = profile;
      }
      return { profiles: newProfiles };
    });
  },

  removePost: (id: string) => {
    const db = getDatabase();
    db.runSync('DELETE FROM posts WHERE id = ?', [id]);
    db.runSync('DELETE FROM likes WHERE post_id = ?', [id]);
    db.runSync('DELETE FROM comments WHERE post_id = ?', [id]);
    set((state) => {
      const newPosts = { ...state.posts };
      delete newPosts[id];
      return {
        posts: newPosts,
        feedIds: state.feedIds.filter((fid) => fid !== id),
        myPostIds: state.myPostIds.filter((fid) => fid !== id),
      };
    });
  },

  getPost: (id: string) => get().posts[id],

  getProfile: (id: string) => get().profiles[id],

  getFeedPosts: () => {
    const state = get();
    return state.feedIds
      .map((id) => state.posts[id])
      .filter(Boolean) as LocalPost[];
  },

  getMyPosts: (userId: string) => {
    const state = get();
    // If myPostIds is populated, use it; otherwise filter from all posts
    if (state.myPostIds.length > 0) {
      return state.myPostIds
        .map((id) => state.posts[id])
        .filter(Boolean) as LocalPost[];
    }
    return Object.values(state.posts)
      .filter((p) => p.author_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  setFeedIds: (ids: string[]) => set({ feedIds: ids }),

  setMyPostIds: (ids: string[]) => set({ myPostIds: ids }),

  // --- Like operations ---

  setLike: (userId: string, postId: string) => {
    const db = getDatabase();
    db.runSync(
      'INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)',
      [userId, postId]
    );
    set((state) => {
      const userLikes = new Set(state.likes[userId] || []);
      userLikes.add(postId);
      return { likes: { ...state.likes, [userId]: userLikes } };
    });
  },

  removeLike: (userId: string, postId: string) => {
    const db = getDatabase();
    db.runSync(
      'DELETE FROM likes WHERE user_id = ? AND post_id = ?',
      [userId, postId]
    );
    set((state) => {
      const userLikes = new Set(state.likes[userId] || []);
      userLikes.delete(postId);
      return { likes: { ...state.likes, [userId]: userLikes } };
    });
  },

  isLiked: (userId: string, postId: string) => {
    const state = get();
    return state.likes[userId]?.has(postId) ?? false;
  },

  getUserLikes: (userId: string) => {
    return get().likes[userId] || new Set();
  },

  loadLikes: (userId: string) => {
    const db = getDatabase();
    const rows = db.getAllSync<{ post_id: string }>(
      'SELECT post_id FROM likes WHERE user_id = ?',
      [userId]
    );
    const likeSet = new Set(rows.map((r) => r.post_id));
    set((state) => ({
      likes: { ...state.likes, [userId]: likeSet },
    }));
  },

  // --- Follow operations ---

  setFollow: (followerId: string, followingId: string) => {
    const db = getDatabase();
    db.runSync(
      'INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)',
      [followerId, followingId]
    );
  },

  removeFollow: (followerId: string, followingId: string) => {
    const db = getDatabase();
    db.runSync(
      'DELETE FROM follows WHERE follower_id = ? AND following_id = ?',
      [followerId, followingId]
    );
  },

  isFollowing: (followerId: string, followingId: string) => {
    const db = getDatabase();
    const row = db.getFirstSync<{ follower_id: string }>(
      'SELECT follower_id FROM follows WHERE follower_id = ? AND following_id = ?',
      [followerId, followingId]
    );
    return !!row;
  },
}));
