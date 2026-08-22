import { create } from 'zustand';
import { Post } from '../types';
import { listEqualOn, POST_FIELDS } from '../utils/listEquality';

export type { Post } from '../types';

interface EditingPost {
  id: string;
  content: string;
  imageUrl?: string;
  imageUrls?: string[];
}

interface FeedStoreState {
  posts: Post[];
  isLoading: boolean;
  isRefreshing: boolean;
  hasMore: boolean;
  pendingRepostId: string | null;
  editingPost: EditingPost | null;

  // Новые поля для сохранения данных между табами
  profilePosts: Post[];
  feedScrollOffset: number;
  profileScrollOffset: number;
  lastFeedFetch: number | null;
  lastProfileFetch: number | null;

  setPosts: (posts: Post[]) => void;
  addPost: (post: Post) => void;
  removePost: (postId: string) => void;
  toggleLike: (postId: string) => void;
  setLoading: (loading: boolean) => void;
  setRefreshing: (refreshing: boolean) => void;
  setPendingRepost: (postId: string | null) => void;
  setEditingPost: (post: EditingPost | null) => void;

  // Новые методы
  setProfilePosts: (posts: Post[]) => void;
  updatePost: (postId: string, data: Partial<Post>) => void;
  setFeedScrollOffset: (offset: number) => void;
  setProfileScrollOffset: (offset: number) => void;
}

export const useFeedStore = create<FeedStoreState>()((set) => ({
  posts: [],
  isLoading: false,
  isRefreshing: false,
  hasMore: true,
  pendingRepostId: null,
  editingPost: null,

  // Новые поля
  profilePosts: [],
  feedScrollOffset: 0,
  profileScrollOffset: 0,
  lastFeedFetch: null,
  lastProfileFetch: null,

  // Same guard as `setProfilePosts`. See the note there for why the timestamp is
  // still advanced when the content turns out to be identical.
  setPosts: (posts) =>
    set((state) =>
      listEqualOn(state.posts, posts, POST_FIELDS)
        ? { lastFeedFetch: Date.now() }
        : { posts, lastFeedFetch: Date.now() },
    ),
  addPost: (post) => set((state) => ({ posts: [post, ...state.posts] })),
  removePost: (postId) =>
    set((state) => ({
      posts: state.posts.filter((p) => p.id !== postId),
      profilePosts: state.profilePosts.filter((p) => p.id !== postId),
    })),
  toggleLike: (postId) =>
    set((state) => ({
      posts: state.posts.map((p) =>
        p.id === postId
          ? { ...p, isLiked: !p.isLiked, likesCount: p.isLiked ? p.likesCount - 1 : p.likesCount + 1 }
          : p
      ),
      profilePosts: state.profilePosts.map((p) =>
        p.id === postId
          ? { ...p, isLiked: !p.isLiked, likesCount: p.isLiked ? p.likesCount - 1 : p.likesCount + 1 }
          : p
      ),
    })),
  setLoading: (isLoading) => set({ isLoading }),
  setRefreshing: (isRefreshing) => set({ isRefreshing }),
  setPendingRepost: (pendingRepostId) => set({ pendingRepostId }),
  setEditingPost: (editingPost) => set({ editingPost }),

  // Новые методы
  // Bail out when nothing visible changed. `setProfilePosts` is called on every
  // profile focus and after every publish, usually with a new array holding the
  // same rows — writing it re-rendered the profile and broke `React.memo` on every
  // card, which is what made the profile blink on entry.
  //
  // `lastProfileFetch` is still advanced on a no-op: the fetch DID happen, and the
  // throttle that reads this timestamp must not re-fire just because the result was
  // identical.
  setProfilePosts: (posts) =>
    set((state) =>
      listEqualOn(state.profilePosts, posts, POST_FIELDS)
        ? { lastProfileFetch: Date.now() }
        : { profilePosts: posts, lastProfileFetch: Date.now() },
    ),
  updatePost: (postId, data) =>
    set((state) => ({
      posts: state.posts.map((p) =>
        p.id === postId ? { ...p, ...data } : p
      ),
      profilePosts: state.profilePosts.map((p) =>
        p.id === postId ? { ...p, ...data } : p
      ),
    })),
  setFeedScrollOffset: (offset) => set({ feedScrollOffset: offset }),
  setProfileScrollOffset: (offset) => set({ profileScrollOffset: offset }),
}));
